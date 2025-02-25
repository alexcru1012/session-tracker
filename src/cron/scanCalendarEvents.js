import moment from 'moment-timezone';
import * as Sentry from '@sentry/node';

import logger from '@/logger';
import { CacheKeys, Options } from '@/constants';
import { cacheData, getDataFromCache } from '@/redis/helpers';
import { getActiveUsers } from '@/models/users';
import { getCalendarEvents } from '@/models/calendar';
import pool from '@/postgres';

/**
 *
 * Get all active users
 * Get their calendar events for the near future
 * See if any sessions are starting soon (next 24 hours) or recently ended
 * Add their ids to cache arrays `cronEventIdStartingSoon` and `cronEventIdEnded`
 * Only organize events here and let other cron jobs perform any writes
 *
 */
const scanCalendarEvents = async () => {
  logger.info('CRON scanCalendarEvents...');

  const poolClient = await pool.connect();
  const now = moment();

  let users;

  try {
    users = await getActiveUsers(poolClient);
  } catch (error) {
    logger.error(`scanCalendarEvents ERROR: ${error.message || error}`);
    Sentry.captureException(error);

    if (poolClient) poolClient.release();

    return;
  }

  const eventPromises = [];

  logger.info(`CRON scanCalendarEvents... ${users.length} active users...`);

  // console.log('users', users.map(u => u.id));

  for (let i = 0; i < users.length; i++) {
    const user = users[i];

    eventPromises.push(getCalendarEvents(user, null, null, poolClient, true));
  }

  let eventResults;

  try {
    eventResults = await Promise.all(eventPromises);
  } catch (error) {
    logger.error(`scanCalendarEvents error: ${error.message || error}`);
    Sentry.captureException(error);

    if (poolClient) poolClient.release();

    return;
  }

  logger.info(
    `CRON scanCalendarEvents... ${eventResults?.length || '0'} eventResults...`
  );

  // I believe we're done with this now...
  if (poolClient) poolClient.release();

  let totalEvents = 0;
  let totalEnded = 0;
  let totalStartingSoon = 0;

  // eslint-disable-next-line
  outer: for (let j = 0; j < eventResults.length; j++) {
    const user = users[j];
    const { pgEventsById, events: calendarEvents } = eventResults[j];

    // eslint-disable-next-line
    if (!calendarEvents || !calendarEvents.length) continue outer;

    // eslint-disable-next-line
    inner: for (let o = 0; o < calendarEvents.length; o++) {
      const event = calendarEvents[o];
      const pgEvent = pgEventsById[(event.id || '').split('-')[0]] || {};

      // Just incase?
      if (!event) {
        totalEvents++;
        // eslint-disable-next-line
        continue inner;
      }

      const existingStartingSoon = await getDataFromCache(
        CacheKeys.cronEventIdStartingSoon(event.id)
      );
      const existingEnded = await getDataFromCache(
        CacheKeys.cronEventIdEnded(event.id)
      );

      // if ()
      // Get the start/end times
      const startsAt = moment.tz(event.starts_at, user.tz).startOf('minute');
      const endsAt = startsAt
        .clone()
        .add(pgEvent.duration || Options.defaultSessionDurationS, 'seconds');

      // Event start is <= 24 hours away (5 minute past buffer)
      if (!existingStartingSoon) {
        const startDiffS = Math.floor(startsAt.diff(now) / 1000);

        if (startDiffS >= -300 && startDiffS <= 86400) {
          logger.info(
            `CRON EVENT STARTING SOON: "${
              pgEvent.title
            }", start: ${startsAt.format()}, diff: ${Math.floor(
              startDiffS / 60
            )}min`
          );
          // Mark event as starting soon
          await cacheData(
            CacheKeys.cronEventIdStartingSoon(event.id),
            true,
            Math.floor(Math.max(startDiffS + 60, 3600)) // cache until event starts
          );

          totalStartingSoon++;
        }
      }

      // Event ended recently (in the past 6 hours) (10 second start buffer)
      if (!existingEnded) {
        const endDiffS = Math.floor(now.diff(endsAt) / 1000);

        if (endDiffS >= -10 && endDiffS <= 3600 * 6) {
          logger.info(
            `CRON EVENT ENDED: "${pgEvent.title}", 'diff', ${Math.floor(
              endDiffS / 60
            )}min`
          );
          // Mark event as ended
          await cacheData(
            CacheKeys.cronEventIdEnded(event.id),
            true,
            43200 // 12h
          );

          totalEnded++;
        }
      }

      totalEvents++;
    }
  }

  try {
    logger.info(
      `CRON scanCalendarEvents complete. Processed ${users?.length ||
        '0'} users. ${totalEvents} events. ${totalStartingSoon} starting soon. ${totalEnded} just ended. Time elapsed: ${moment().diff(
        now
      ) / 1000}s`
    );
  } catch (err) {
    logger.error(`im lost... ${err.message || err}`);
  }
};

export default scanCalendarEvents;
