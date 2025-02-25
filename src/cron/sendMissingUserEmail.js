import moment from 'moment-timezone';

import logger from '@/logger';
import pool from '@/postgres';
import { sendMailToMissingUser } from '@/emails/users';
import { getActiveUsersOld } from '@/models/users';
import { getOrCreateUserMeta } from '@/mongo/helpers';
import Usage from '@/mongo/schemas/usage';

/**
 * Summary
 * send email to users which are not loged-in
 * from last 30 days
 *
 */
const sendMissingUserEmail = async () => {
  logger.info('CRON sendMissingUserEmail...');

  const poolClient = await pool.connect();

  const users = await getActiveUsersOld(poolClient);
  let numProcessed = 0;
  let emailsSent = 0;

  if (!users || !users.length) {
    poolClient.release();

    return;
  }

  const now = moment();

  for (let i = 0; i < users.length; i++) {
    try {
      const user = users[i];

      if (!user) continue;

      const lastDiff = now.diff(user.last_login_at, 'days');

      // Logged in recently...
      if (lastDiff < 30) continue;

      const usage = await Usage.findOne({ userId: user.id });
      const userMeta = await getOrCreateUserMeta(user.id);

      // Missing email was already sent this year...
      if (
        !userMeta ||
        (userMeta.wasSentMissingEmail &&
          now.diff(userMeta.wasSentMissingEmail, 'days') < 360)
      )
        continue;

      // Check most recent usage date
      if (!usage) continue;

      const dates = usage.getDateKeys();

      if (dates && dates.length) {
        const diff = now.diff(dates[dates.length - 1], 'days');

        // Fetched data recently...
        if (diff < 30) continue;
      }

      // Ok this person hasn't logged in in a while...
      await sendMailToMissingUser(user);

      userMeta.wasSentMissingEmail = new Date().toISOString();
      userMeta.save();

      emailsSent++;
    } catch (error) {
      logger.error('sendMissingUserEmail ERROR:', error);
      // Continue the loop...
    }

    numProcessed++;
  }

  poolClient.release();

  logger.info(
    `CRON sendMissingUserEmail complete. Processed ${numProcessed} users. Sent ${emailsSent} emails.`
  );
};

export default sendMissingUserEmail;
