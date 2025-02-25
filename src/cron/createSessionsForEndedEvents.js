import moment from 'moment';
import * as Sentry from '@sentry/node';

import logger from '@/logger';
import {
  CacheKeys,
  ClientSettings,
  ClientSettingDefaults,
  TierLimits,
} from '@/constants';
import {
  cacheData,
  getDataFromCache,
  scanCache,
  deleteCachedData,
} from '@/redis/helpers';
import { getUser } from '@/models/users';

import {
  getClient,
  getClientCountAndUserTier,
  writeTempSessionsLeft,
} from '@/models/clients';
import { getCalendarEvent, getPgCalendarEvent } from '@/models/calendar';
import { getSingleOptionByKey } from '@/models/clientOptions';
import { sendSessionReceipt } from '@/emails/sessions';
import {
  createNewSession,
  getAvailableSessionIds,
  useSessionFromCalendarEvent,
} from '@/models/sessions';
import pool from '@/postgres';
import { getUserSubscription } from '@/models/userSubscriptions';

/**
 * Summary
 *
 * Scan cronEventIdEnded cache
 * foreach calendarEvent, if event hasnt been deleted or already processed
 * get user, client, getAvailableSessionIds
 * if a client exists, choose an available session or create a new one to log
 * use session and write cronClientEventSessionAdded
 *
 */
const createSessionsForEndedEvents = async () => {
  logger.info('CRON createSessionsForEndedEvents...');

  const poolClient = await pool.connect();
  const now = moment();
  const pattern = CacheKeys.cronEventIdEnded('*');
  const count = '10';
  let scanResults = [];
  let nextCursor = '0';
  let created = 0;
  let logged = 0;

  do {
    /* eslint-disable */
    const [_nextCursor, _scanResults] = await scanCache(
      nextCursor,
      pattern,
      count
    );
    /* eslint-enable */

    nextCursor = _nextCursor;
    scanResults = scanResults.concat(_scanResults);
  } while (nextCursor !== '0');

  // console.log('scanResults', scanResults);
  // logger.info(`scanResults: ${scanResults.length} ${scanResults}`);

  if (scanResults.length) {
    const sessionsThatWereJustUsed = [];
    const eventIds = scanResults.map(key =>
      key.replace(CacheKeys.cronEventIdEnded(''), '')
    );

    for (let i = 0; i < eventIds.length; i++) {
      const eventId = eventIds[i];

      const pgEvent = await getPgCalendarEvent(eventId, poolClient);

      const user = pgEvent ? await getUser(pgEvent.user_id, poolClient) : null;

      if (!user) continue;

      const userSubscription = user?.subscription_id
        ? await getUserSubscription(user.subscription_id, poolClient)
        : null;

      if (!userSubscription) continue;

      const eventHasBeenProcessed = await getDataFromCache(
        CacheKeys.cronEventIdProcessed(user.id, eventId)
      );

      // Full event
      const event = await getCalendarEvent(eventId, user.tz, poolClient);

      // Event may have been deleted or cancelled, and we only care about events with clients
      if (!event || !event.client_id || !event.is_active) {
        // Delete key
        // deleteCachedData(CacheKeys.cronEventIdEnded(eventId));

        continue;
      }
      // Event was already processed...?
      if (!!eventHasBeenProcessed) {
        // Delete key
        // deleteCachedData(CacheKeys.cronEventIdEnded(eventId));

        continue;
      }

      const client = await getClient(user.id, event.client_id, poolClient);

      if (!client) continue;

      const sessionIds = await getAvailableSessionIds(client.id, poolClient);

      if (!sessionIds) continue;

      const availableSessions = sessionIds
        ? sessionIds.filter(sId => !sessionsThatWereJustUsed.includes(sId))
        : [];

      // Pick or create new session
      let sessionToUse;
      // Pick the next available session
      if (availableSessions && availableSessions.length)
        sessionToUse = availableSessions[0];
      else if (client) {
        // Need to create a new session
        sessionToUse = await createNewSession(client.id, poolClient); // eslint-disable-line

        // Annoy users who have more than 3 clients and are still logging sessions
        // Get clients limit based on user's tier level
        const countAndTierRes = await getClientCountAndUserTier(
          user.id,
          poolClient
        );
        const { tier, clients_count } = countAndTierRes;
        // If user has more than allowed num clients
        if (tier < 2 && clients_count > TierLimits[tier]) {
          // Error, b*tch!
          continue;
        }

        // Display a temporary negative number to the user
        let tempSessionsLeft = client.temp_sessions_left || 0;

        tempSessionsLeft--;

        // smallint max?
        if (tempSessionsLeft > -32768) {
          await writeTempSessionsLeft(
            user.id,
            client.id,
            tempSessionsLeft,
            poolClient
          );
        }

        logger.info(
          `CRON CREATED NEW SESSION: ${sessionToUse.id} for event ${event.id}. TEMP: ${tempSessionsLeft}.`
        );

        created++;

        // Invalidate cache so user can fetch new data
        await deleteCachedData(CacheKeys.clientsKey(user.id));
        await deleteCachedData(CacheKeys.clientKey(user.id, client.id));
      }

      if (!sessionToUse) continue;

      sessionsThatWereJustUsed.push(sessionToUse.id);

      // Use it up
      const session = await useSessionFromCalendarEvent(
        client.id,
        event,
        sessionToUse,
        null,
        poolClient
      );

      if (!session) continue;

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.usedSessionsKey(client.id));
      await deleteCachedData(CacheKeys.sessionsKey(client.id));
      await deleteCachedData(CacheKeys.allSessionNotesKey(client.id));
      await deleteCachedData(CacheKeys.clientsKey(user.id));
      await deleteCachedData(CacheKeys.clientKey(user.id, client.id));
      // This event was successfully processed
      // await deleteCachedData(CacheKeys.cronEventIdEnded(eventId));
      // Create a key to verify we won't process this event again
      await cacheData(
        CacheKeys.cronEventIdProcessed(user.id, eventId),
        true,
        86400 * 2 // 2 days
      );
      // Store a key so users can see which sessions have been added automatically
      const addedKey = CacheKeys.cronClientEventSessionAdded(
        user.id,
        client.id,
        eventId,
        sessionToUse.id
      );

      await cacheData(addedKey, true, 86400 * 14); // 14 days

      // console.log(
      //   'CRON LOGGED AUTOMATIC SESSION',
      //   sessionToUse.id,
      //   addedKey
      // );
      logger.info(
        `CRON LOGGED AUTOMATIC SESSION:' (${sessionToUse.id}) ${addedKey}`
      );

      logged++;

      // Get option to see if user wants an email sent to client
      const option = await getSingleOptionByKey(
        client.id,
        ClientSettings.postSessionSummary,
        poolClient
      );

      const sendReceipt = option
        ? option.option_value === 'true' || option.option_value === true
        : ClientSettingDefaults[ClientSettings.postSessionSummary];

      const wasAlreadyEmailed = await getDataFromCache(
        CacheKeys.sessionReceipt(user.id, client.id, session.id)
      );

      // Send email
      if (sendReceipt && !wasAlreadyEmailed) {
        await sendSessionReceipt(
          user.id,
          client.id,
          session.id,
          '',
          false,
          poolClient
        );
      }
      // Continue...
    }
  }

  // Finished
  if (poolClient) poolClient.release();

  logger.info(
    `CRON createSessionsForEndedEvents complete. Processed ${
      scanResults.length
    } ended events. Created ${created}. Logged ${logged}. Time elapsed: ${
      moment().diff(now) / 1000
    }s`
  );
};

export default createSessionsForEndedEvents;
