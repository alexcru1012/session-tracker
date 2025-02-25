import logger from '@/logger';
import pool from '@/postgres';
import {
  getExpiredUserSubscriptions,
  setSubscriptionTier,
} from '@/models/userSubscriptions';

/**
 * Summary
 * Reset subscription "tier" after they expire
 *
 */
const scanExpiredSubscriptions = async () => {
  logger.info('CRON scanExpiredSubscriptions...');

  const poolClient = await pool.connect();

  let numProcessed = 0;

  const subscriptions = (await getExpiredUserSubscriptions()) || [];

  if (subscriptions && subscriptions.length) {
    for (let i = 0; i < subscriptions.length; i++) {
      try {
        await setSubscriptionTier(subscriptions[i].id, 1, poolClient);
      } catch (error) {
        logger.error('scanExpiredSubscriptions ERROR:', error);
        // Continue the loop...
      }
      numProcessed++;
    }
  }

  poolClient.release();

  logger.info(
    `CRON scanExpiredSubscriptions complete. Processed ${numProcessed} subscriptions.`
  );
};

export default scanExpiredSubscriptions;
