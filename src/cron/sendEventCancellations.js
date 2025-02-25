import moment from 'moment-timezone';
import * as Sentry from '@sentry/node';
import ejs from 'ejs';

import logger from '@/logger';
import { CacheKeys, Templates } from '@/constants';
import { scanCache, getDataFromCache, deleteCachedData } from '@/redis/helpers';
import { getCalendarEvent } from '@/models/calendar';
import { sendClientEventCancellation } from '@/emails/calendar';
import { getUser } from '@/models/users';
import pool from '@/postgres';
import { getClientSimple } from '@/models/clients';

/**
 * Summary
 *
 * Scan cancelledEvent.notifiyClient cache
 * for loop get getCalendarEvent, if event iscancelled
 * get user behalf of getCalendarEvent data ,
 * if an event & user exists, send a event cancel email
 *
 */
const sendEventCancellations = async () => {
  logger.info('CRON sendEventCancellations...');

  const now = moment();
  const pattern = CacheKeys.cancelledEvent.notifiyClient('*', '*', '*');
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

  if (scanResults.length) {
    const poolClient = await pool.connect();

    // Reuse template function to optimize opening the file many times in a loop
    const renderHtml = (data, options) =>
      ejs.renderFile(Templates.clientEventCancelled, data, options);

    for (let i = 0; i < scanResults.length; i++) {
      const cacheKey = scanResults[i];
      const chunk = cacheKey.slice('st__cron__notifyEventCancelled__'.length);
      const [userId, eventId, clientId] = chunk.split('__').filter(c => !!c);

      if (!userId || !clientId || !eventId) continue;

      const cancellationHasBeenSent = await getDataFromCache(
        CacheKeys.emails.toClient.eventCancellationSent(
          userId,
          clientId,
          eventId
        )
      );

      if (!!cancellationHasBeenSent) continue;

      try {
        const user = await getUser(userId, poolClient);

        if (!user) continue;

        const event = await getCalendarEvent(eventId, user?.tz, poolClient);

        if (!event || !event.is_active) continue;

        const client = await getClientSimple(
          user.id,
          event.client_id,
          poolClient
        );

        if (!client || !client.email_alias) {
          // Remove from queue
          deleteCachedData(cacheKey);

          continue;
        }

        // Send email
        await sendClientEventCancellation(
          event,
          user,
          client,
          renderHtml,
          poolClient
        );
        sent++;

        logger.info(`sendClientEventCancellation (${event.id}, ${user.id})`);
      } catch (err) {
        logger.error(`sendClientEventCancel: ${err}`);
        continue;
      }
    }

    // Finished
    if (poolClient) poolClient.release();
  }

  logger.info(
    `CRON sendClientEventCancel complete. Processed ${
      scanResults.length
    } events. Sent ${sent} emails. Time elapsed: ${moment().diff(now) / 1000}s`
  );
};

export default sendEventCancellations;
