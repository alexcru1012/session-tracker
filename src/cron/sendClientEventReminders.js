import moment from 'moment';
import * as Sentry from '@sentry/node';

import logger from '@/logger';
import { CacheKeys, ClientSettings } from '@/constants';
import { cacheData, getDataFromCache, scanCache } from '@/redis/helpers';
import { sendClientEventReminder } from '@/emails/calendar';
import { getSingleOptionByKey } from '@/models/clientOptions';
import { getUser } from '@/models/users';
import { getPgCalendarEvent, getCalendarEvent } from '@/models/calendar';
import pool from '@/postgres';

/**
 * Summary
 *
 * Scan cronEventIdStartingSoon cache
 * foreach calendarEvent, if event hasnt been deleted or already processed
 * get user, client, getAvailableSessionIds
 * if a client exists, send a reminder email
 * write clientEventReminder
 *
 */
const sendClientEventReminders = async () => {
  logger.info('CRON sendClientEventReminders...');

  const now = moment();
  const pattern = CacheKeys.cronEventIdStartingSoon('*');
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

  // console.log('starting soon scanResults', scanResults);
  // logger.info(`scanResults: ${scanResults.length} ${scanResults}`);

  if (scanResults.length) {
    const poolClient = await pool.connect();

    const eventIds = scanResults.map(key =>
      key.replace(CacheKeys.cronEventIdStartingSoon(''), '')
    );

    // console.log('eventIds', eventIds);

    const oneHourAgo = moment().subtract(1, 'hour');

    for (let i = 0; i < eventIds.length; i++) {
      const eventId = eventIds[i];

      try {
        // console.log('eventId', eventId);
        const pgEvent = await getPgCalendarEvent(eventId, poolClient);
        // Get the full event incase it has been cancelled.
        const user = pgEvent
          ? await getUser(pgEvent.user_id, poolClient)
          : null;
        const calendarEvent = await getCalendarEvent(
          eventId,
          user?.tz,
          poolClient
        );

        // console.log('pgEvent', pgEvent);
        // console.log('pgEvent.client_id', pgEvent.client_id);

        // Event may have been deleted, and we only care about events with clients
        if (!pgEvent || !pgEvent.client_id) {
          // Do not delete
          // deleteCachedData(CacheKeys.cronEventIdStartingSoon(eventId));
          continue;
        }
        // Event may have been cancelled
        if (!calendarEvent || !calendarEvent.is_active) {
          // Do not delete?
          continue;
        }

        const reminderOption = await getSingleOptionByKey(
          pgEvent.client_id,
          ClientSettings.dayOfReminder,
          poolClient
        );

        const isTrue =
          reminderOption?.option_value === 'true' ||
          reminderOption?.option_value === true;

        // console.log('reminderOption', reminderOption, isTrue);

        // Read the client Option to make sure they want to send a reminder
        // reminder is default FALSE
        if (!reminderOption || !isTrue) continue;

        // const user = await getUser(event.user_id, poolClient);

        // if (!user) continue;

        const reminderCacheKey = CacheKeys.clientEventReminder(
          pgEvent.user_id,
          eventId,
          pgEvent.client_id
        );

        const reminderHasBeenSent = await getDataFromCache(reminderCacheKey);

        // console.log('reminderHasBeenSent', reminderHasBeenSent);

        if (!!reminderHasBeenSent) {
          // Do not delete any keys
          // deleteCachedData(CacheKeys.cronEventIdStartingSoon(eventId));
          continue;
        }
        // Only send reminders for events created > 1 hour ago
        // since a confirmation was just sent
        if (
          process.env.NODE_ENV === 'production' &&
          moment(pgEvent.created_at).isAfter(oneHourAgo)
        ) {
          // Wait
          continue;
        }

        // logger.info(
        //   `attempting to send reminder for ${event.id} to ${event.client_id}`
        // );

        // Send email

        await sendClientEventReminder(
          eventId,
          pgEvent,
          reminderCacheKey,
          poolClient
        );

        // Cache for 24h
        cacheData(reminderCacheKey, true, 86400);

        logger.info(
          `CRON SENT CLIENT EVENT REMINDER: client ${pgEvent.client_id} for event ${eventId}.`
        );

        sent++;
      } catch (err) {
        console.warn(err);
        Sentry.captureException(err);
        logger.error(err);

        // Retry again next minute?
        // Might spam the logs but at least it'll be noticable
        continue;
      }
    }

    // Finished
    if (poolClient) poolClient.release();
  }

  logger.info(
    `CRON sendClientEventReminders complete. Processed ${
      scanResults.length
    } events. Sent ${sent} emails. Time elapsed: ${moment().diff(now) / 1000}s`
  );
};

export default sendClientEventReminders;
