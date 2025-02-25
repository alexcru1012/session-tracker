import moment from 'moment-timezone';
import * as Sentry from '@sentry/node';

import logger from '@/logger';
import { CacheKeys } from '@/constants';
import {
  cacheData,
  getDataFromCache,
  scanCache,
  deleteCachedData,
} from '@/redis/helpers';
import { getCalendarEvent, getPgCalendarEvent } from '@/models/calendar';
import { sendClientEventConfirmation } from '@/emails/calendar';
import { getUser } from '@/models/users';
import pool from '@/postgres';

/**
 * Summary
 *
 * Scan calendarEventForClientScheduled cache
 * foreach calendarEvent, if event hasnt been deleted or already processed
 * get user, client, getAvailableSessionIds
 * if a client exists, send a confirmation email
 * write clientEventConfirmation
 *
 */
const sendClientEventConfirmations = async () => {
  logger.info('CRON sendClientEventConfirmations...');

  const now = moment();
  const pattern = CacheKeys.calendarEventForClientScheduled('*');
  const count = '20';
  let scanResults = [];
  let nextCursor = '0';

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

  let sent = 0;

  // console.log('scanResults', scanResults);
  // logger.info(`scanResults: ${scanResults.length} ${scanResults}`);

  if (scanResults.length) {
    const poolClient = await pool.connect();

    const eventIds = scanResults.map(key =>
      key.replace(CacheKeys.calendarEventForClientScheduled(''), '')
    );

    // console.log('eventIds', eventIds);

    // Range to show upcoming events
    const startDate = moment()
      .startOf('day')
      .toISOString();
    const endDate = moment()
      .add(3, 'months')
      .endOf('day')
      .toISOString();

    for (let i = 0; i < eventIds.length; i++) {
      const eventId = eventIds[i];

      try {
        const pgEvent = await getPgCalendarEvent(eventId, poolClient);
        const user = pgEvent
          ? await getUser(pgEvent.user_id, poolClient)
          : null;
        // Fetch event with accurate starts_at
        const event = user
          ? await getCalendarEvent(eventId, user.tz, poolClient)
          : null;

        // console.log('event', event);

        const cacheKey = CacheKeys.calendarEventForClientScheduled(eventId);
        if (!event) {
          // Delete key (event was deleted)
          deleteCachedData(cacheKey);

          continue;
        }
        if (!event.client_id) {
          // Maybe they will add a client sometime before the event starts...
          continue;
        }

        const confirmationCacheKey = CacheKeys.clientEventConfirmation(
          event.user_id,
          eventId,
          event.client_id
        );
        const reminderCacheKey = CacheKeys.clientEventReminder(
          event.user_id,
          eventId,
          event.client_id
        );

        // Confirmation should have been sent before the reminder, otherwise skip
        const confirmationHasBeenSent = await getDataFromCache(
          confirmationCacheKey
        );
        const reminderHasBeenSent = await getDataFromCache(reminderCacheKey);

        // console.log('confirmationHasBeenSent', confirmationHasBeenSent);
        // console.log('reminderHasBeenSent', reminderHasBeenSent);

        if (!!confirmationHasBeenSent || !!reminderHasBeenSent) {
          // Delete key
          deleteCachedData(cacheKey);

          continue;
        }

        // logger.info(
        //   `attempting to send confirmation for ${event.id} to ${event.client_id}`
        // );

        // Send email

        await sendClientEventConfirmation(
          event,
          startDate,
          endDate,
          confirmationCacheKey,
          poolClient
        );

        // Mark email as sent. Cache for 24h
        cacheData(confirmationCacheKey, true, 86400);
        // Also mark "reminder" email as sent for 1h to prevent multiple emails
        cacheData(reminderCacheKey, true, 3600);

        logger.info(
          `CRON SENT CLIENT EVENT CONFIRMATION: client ${event.client_id} for event ${eventId}.`
        );

        sent++;
      } catch (err) {
        console.warn(err);
        logger.error(`sendClientEventConfirmation: ${err}`);

        // Retry again next minute?
        // Might spam the logs but at least it'll be noticable
        continue;
      }
    }

    // Finished
    if (poolClient) poolClient.release();
  }

  logger.info(
    `CRON sendClientEventConfirmations complete. Processed ${
      scanResults.length
    } events. Sent ${sent} emails. Time elapsed: ${moment().diff(now) / 1000}s`
  );
};

export default sendClientEventConfirmations;
