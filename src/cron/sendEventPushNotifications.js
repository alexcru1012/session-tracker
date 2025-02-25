import * as Sentry from '@sentry/node';
import { Expo as ExpoSDK } from 'expo-server-sdk';
import moment from 'moment-timezone';

import logger from '@/logger';
import { CacheKeys } from '@/constants';
import { scanCache, cacheData, getDataFromCache } from '@/redis/helpers';
import { getUser } from '@/models/users';
import { getCalendarEvent, getPgCalendarEvent } from '@/models/calendar';
import pool from '@/postgres';
import { getTimezone } from '@/helpers';

const expo = new ExpoSDK();

/**
 *
 * Scan cache `cronEventIdStartingSoon` for events starting soon
 * If notification_distance has recently passed
 * Send the user a push notification
 *
 */
const sendEventPushNotifications = async () => {
  logger.info('CRON sendEventPushNotifications...');

  const poolClient = await pool.connect();
  const now = moment();

  // Scan cache
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

  // console.log('scanResults', scanResults);
  // logger.info(`scanResults: ${scanResults.length} ${scanResults}`);

  const eventIds = scanResults.map(
    result => result.replace(pattern.substr(0, pattern.length - 1), '') // remove *
  );

  const markAsComplete = async eventId => {
    // This event will skip the loop next time
    await cacheData(
      CacheKeys.cronEventIdPushSent(eventId),
      true,
      86400 * 5 // 5 days
    );
  };

  // console.log('eventIds', eventIds);

  const eventsToNotify = [];
  const usersById = {};

  try {
    // Filter events that want to be notified
    for (let i = 0; i < eventIds.length; i++) {
      // Check a push notification was already sent for this event
      const wasPushSent = await getDataFromCache(
        CacheKeys.cronEventIdPushSent(eventIds[i])
      );

      if (!!wasPushSent) continue;

      // Fetch pgEvent
      const pgEvent = await getPgCalendarEvent(eventIds[i], poolClient);

      if (!pgEvent) {
        logger.error(`no pgEvent....... ${eventIds[i]}`);
        // Event was likely deleted... remove this key...
        markAsComplete(eventIds[i]);
        continue;
      }
      // Fetch user
      const user =
        pgEvent && pgEvent.user_id
          ? await getUser(pgEvent.user_id, poolClient)
          : null;

      if (!user) {
        logger.error(`no user....... ${eventIds[i]} ${pgEvent?.user_id}`);
        continue;
      }

      // Fetch event with accurate starts_at
      const event = await getCalendarEvent(eventIds[i], user.tz, poolClient);

      // No event???
      if (!event) {
        logger.error(`no event..... ${eventIds[i]}`);
        continue;
      }
      // Ignore events with no notification
      if (
        !event.notification_distance &&
        event.notification_distance !== 0 &&
        event.notification_distance !== '0'
      ) {
        // logger.error(
        //   `no notification_distance..... ${eventIds[i]}, ${event?.notification_distance}`
        // );
        continue;
      }

      // User doesn't have a registered push token
      if (
        !user.expo_push_token ||
        !ExpoSDK.isExpoPushToken(user.expo_push_token)
      ) {
        // logger.warn(`no expo_push_token..... ${eventIds[i]}, ${user?.id}`);
        continue;
      }

      const whenToSend = moment(event.starts_at)
        .startOf('minute')
        .subtract(event.notification_distance || 0, 'seconds');
      const diffS = Math.floor(whenToSend.diff(now) / 1000);

      // if notification_distance has passed in the last 6 hours
      if (diffS <= 0 && diffS >= -3600 * 6) {
        eventsToNotify.push(event);
        usersById[event.user_id] = user;
      } else if (diffS < 0) {
        // These events are long gone...
        markAsComplete(eventIds[i]);
      }
    }
  } catch (error) {
    logger.error(error);
    Sentry.captureException(error);
  }

  // logger.info(`eventsToNotify ${eventsToNotify.length}`);
  // console.log('eventsToNotify', eventsToNotify.length);
  // console.log('usersById', usersById);

  const notificationsToSend = [];

  try {
    for (let j = 0; j < eventsToNotify.length; j++) {
      const event = eventsToNotify[j];
      const user = usersById[event.user_id];

      if (!user) {
        logger.warn(
          `Cannot send push notification for event (${event.id}). No user (${event.user_id})`
        );
        continue;
      }

      const startsAt = moment(event.starts_at);
      const human =
        Math.abs(now.diff(event.starts_at) / 1000) <= 60
          ? 'now'
          : startsAt.startOf('minute').from(now.startOf('minute'));
      const userTz = getTimezone(user.tz || 'UTC');
      // Display GMT if we don't know the users timezone
      const specific =
        userTz !== 'UTC'
          ? moment
              .utc(startsAt)
              .tz(userTz)
              .format('h:mmA z')
          : `${startsAt.format('h:mmA')} GMT`;
      const diffS = now.diff(startsAt) / 1000;
      const body = `"${event.title}" ${
        diffS <= 10 ? 'is starting' : 'started'
      } ${human} (${specific}).`;

      // console.log('CRON SENDING PUSH NOTIFICATION', event.id);
      logger.info(`CRON SENDING PUSH NOTIFICATION: ${event.id}`);

      // Store ids of events with sent push notifications
      markAsComplete(event.id);

      // Construct a message (see https://docs.expo.io/versions/latest/guides/push-notifications)
      notificationsToSend.push({
        to: user.expo_push_token,
        sound: 'default',
        title: 'An event is starting soon!',
        body,
        data: { eventId: event.id },
      });
    }
  } catch (error) {
    logger.error(error);
    Sentry.captureException(error);
  }

  // console.log('notificationsToSend', notificationsToSend);

  try {
    // The Expo push notification service accepts batches of notifications
    const chunks = expo.chunkPushNotifications(notificationsToSend);
    const chunkPromises = [];

    for (let k = 0; k < chunks.length; k++)
      chunkPromises.push(expo.sendPushNotificationsAsync(chunks[k]));

    const pushResultChunks = await Promise.all(chunkPromises);
    const failedTickets = [];

    // Loop through the results
    if (pushResultChunks.length) {
      for (let l = 0; l < pushResultChunks.length; l++) {
        const resultChunk = pushResultChunks[l];

        if (resultChunk.length) {
          for (let m = 0; m < resultChunk.length; m++) {
            const ticket = resultChunk[l];

            // Keep record of failed tickets
            if (ticket.status !== 'ok') {
              // console.log('CRON FAILED PUSH NOTIFICATION', ticket);
              logger.error(
                `CRON FAILED PUSH NOTIFICATION: ${JSON.stringify(ticket)}`
              );

              failedTickets.push(ticket);
            }
          }
        }
      }
    }

    // Append list of failed tickets to cache
    if (failedTickets.length) {
      const existingFailedTickets =
        (await getDataFromCache(
          CacheKeys.cronFailedPushNotificationTickets()
        )) || [];

      await cacheData(
        CacheKeys.cronFailedPushNotificationTickets(),
        existingFailedTickets && existingFailedTickets.length
          ? existingFailedTickets.concat(failedTickets)
          : failedTickets,
        86400 // 1 day
      );
    }
  } catch (error) {
    logger.error(error);
    Sentry.captureException(error);
  }

  if (poolClient) poolClient.release();

  logger.info(
    `CRON sendEventPushNotifications complete. Processed ${
      scanResults.length
    } events. Sent ${
      notificationsToSend.length
    } notifications. Time elapsed: ${moment().diff(now) / 1000}s`
  );
};

export default sendEventPushNotifications;
