import moment from 'moment';

import logger from '@/logger';
import pool from '@/postgres';
import { deactivateMe } from '@/models/me';
import { getUsersByLastLoginDate } from '@/models/users';

/**
 * Summary
 * Set users inactive if they have not logged in
 * for more than 90 days
 *
 */
const scanInactiveUsers = async () => {
  logger.info('CRON scanInactiveUsers...');

  const poolClient = await pool.connect();

  const lastMonthDate = moment().subtract(90, 'day');
  let numProcessed = 0;

  const users =
    (await getUsersByLastLoginDate(lastMonthDate, poolClient)) || [];

  if (users && users.length) {
    for (let i = 0; i < users.length; i++) {
      try {
        await deactivateMe(users[i].id, poolClient);
      } catch (error) {
        logger.error('scanInactiveUsers deactivateMe ERROR:', error);
        // Continue the loop...
      }
      numProcessed++;
    }
  }

  poolClient.release();

  logger.info(
    `CRON scanInactiveUsers complete. Processed ${numProcessed} users.`
  );
};

export default scanInactiveUsers;
