import moment from 'moment';
import ejs from 'ejs';
import { Expo as ExpoSDK } from 'expo-server-sdk';
import * as Sentry from '@sentry/node';

import logger from '@/logger';
import { CacheKeys, Templates } from '@/constants';
import { deleteCachedData, getDataFromCache } from '@/redis/helpers';
import { sendEmail } from '@/emails/helpers';
import { commonData } from '@/emails/constants';

const expo = new ExpoSDK();

/**
 * Summary
 *
 * The receipts may contain error codes to which you must respond. In
 * particular, Apple or Google may block apps that continue to send
 * notifications to devices that have blocked notifications or have uninstalled
 * your app. Expo does not control this policy and sends back the feedback from
 * Apple and Google so you can handle it appropriately.
 *
 */
const scanFailedTickets = async () => {
  logger.info('CRON scanFailedTickets...');

  const now = moment();

  const failedTickets =
    (await getDataFromCache(CacheKeys.cronFailedPushNotificationTickets())) ||
    [];

  // console.log('failedTickets', failedTickets);

  const receiptIds = [];

  for (let i = 0; i < failedTickets.length; i++) {
    const ticket = failedTickets[i];
    // NOTE: Not all tickets have IDs; for example, tickets for notifications
    // that could not be enqueued will have error information and no receipt ID.
    if (ticket.id) receiptIds.push(ticket.id);
  }

  const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
  const receiptIdPromises = [];

  // Like sending notifications, there are different strategies you could use
  // to retrieve batches of receipts from the Expo service.
  for (let j = 0; j < receiptIdChunks.length; j++) {
    receiptIdPromises.push(
      expo.getPushNotificationReceiptsAsync(receiptIdChunks[j])
    );
  }

  const receiptIdResultChunks = await Promise.all(receiptIdPromises);
  const failedReceipts = [];

  if (receiptIdResultChunks.length) {
    for (let l = 0; l < receiptIdResultChunks.length; l++) {
      const receiptChunk = receiptIdResultChunks[l];
      const entries = Object.entries(receiptChunk);

      for (let m = 0; m < entries.length; m++) {
        const [id, receipt] = entries[m];
        const { status, message, details } = receipt;

        if (status !== 'ok') failedReceipts.push(receipt);
      }
    }
  }

  if (failedReceipts.length) {
    const options = {};
    const smtpOptions = {
      to: process.env.GMAIL_EMAIL,
      subject: 'Failed push notifications!!!',
    };
    const emailCacheKey = CacheKeys.failedPushNotifications();

    const data = {
      ...commonData,
      failedReceipts,
      title: 'Failed push notifications',
      year: moment().format('YYYY'),
    };

    logger.info(
      `CRON scanFailedTickets complete. Processed ${
        failedReceipts.length
      } receipts. Time elapsed: ${moment().diff(now) / 1000}s`
    );

    return ejs.renderFile(
      Templates.failedPushNotifications,
      data,
      options,
      (error, str) => {
        if (error) logger.error(error);
        if (error || !str) return;

        try {
          sendEmail(
            str,
            smtpOptions,
            err => {
              if (err) logger.error(err);
              else if (failedTickets.length) {
                // Email sent
                // Reset the cache array?
                deleteCachedData(CacheKeys.cronFailedPushNotificationTickets());
              }
            },
            emailCacheKey
          );
        } catch (err) {
          Sentry.captureException(err);
          logger.error(err);
        }
      }
    );
  }

  logger.info(
    `CRON scanFailedTickets complete. Processed 0 receipts. Time elapsed: ${moment().diff(
      now
    ) / 1000}s`
  );

  return true;
};

export default scanFailedTickets;
