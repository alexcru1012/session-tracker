import ejs from 'ejs';

import logger from '@/logger';
import { CacheKeys, Templates } from '@/constants';
import { hasRequiredData, sendEmail } from '@/emails/helpers';
import { commonData, commonSmtpOptions } from './constants';

export const sendPostgresHealthCheckAlert = rows =>
  new Promise(async (resolve, reject) => {
    if (!rows || !rows.length) return resolve();

    // Prepare data for template
    const data = {
      ...commonData,
      title: 'Postgres Health check',
      rows,
      numIdle: rows.length,
    };
    const optional = [];

    // Make sure everything exists...
    if (!hasRequiredData(data, optional))
      return reject(new Error('Missing required input'));

    const options = {};
    const smtpOptions = {
      ...commonSmtpOptions,
      to: process.env.GMAIL_EMAIL,
      subject: 'Postgres Health Alert!!!!!',
    };
    const emailCacheKey = CacheKeys.emails.health.postgresCheck();

    let htmlString;

    try {
      htmlString = await ejs.renderFile(
        Templates.healthCheckPostgres,
        data,
        options
      );
    } catch (err) {
      logger.info(`healthCheckPostgresAlert error ${err}`);

      return reject(err);
    }

    return sendEmail(
      htmlString,
      smtpOptions,
      err => {
        if (err) reject(err);
        else resolve();
      },
      emailCacheKey
    );
  });

export default {};
