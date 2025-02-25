import * as Sentry from '@sentry/node';
import SQL from 'sql-template-strings';
import moment from 'moment-timezone';

import logger from '@/logger';
import pool from '@/postgres';
import { runQuery } from '@/helpers';
import { sendPostgresHealthCheckAlert } from '@/emails/health';
import { cacheData, getDataFromCache } from '@/redis/helpers';
import { CacheKeys } from '@/constants';

/**
 * Summary
 * Query pg_stat_activity to see if any connections have been idle
 * for too long. If there are many, send an email to support.
 * Or maybe manually close the pids
 *
 */
const healthCheckPostgres = async () => {
  logger.info('CRON healthCheckPostgres...');

  const poolClient = await pool.connect();

  let results;

  const olderThan = moment()
    .subtract(1, 'hour')
    .toISOString();

  try {
    results = await runQuery(
      SQL`
      SELECT state, backend_start, query, query_start
      FROM pg_stat_activity
      WHERE datname = ${process.env.PG_DATABASE}
      AND backend_start < ${olderThan};
    `,
      null,
      null,
      poolClient
    );
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`healthCheckPostgres ERR: ${err}`);
  }

  poolClient.release();

  const numIdle = (results && results.length) || 0;

  const lastSent = await getDataFromCache(
    CacheKeys.emails.health.postgresCheckSent()
  );
  // Once every 2 hours max
  const okToSend =
    lastSent &&
    moment()
      .subtract(2, 'hours')
      .isAfter(lastSent);

  if (okToSend && numIdle > 10) {
    try {
      // Send email
      await sendPostgresHealthCheckAlert(results);
      // Store date this email was sent
      await cacheData(
        CacheKeys.emails.health.postgresCheckSent(),
        moment().toISOString(),
        86400 // 24h
      );
    } catch (err) {
      Sentry.captureException(err);
      logger.error(`CRON healthCheckPostgres sendEmail ERR: ${err}`);
    }
  } else if (numIdle > 10)
    logger.info('CRON healthCheckPostgres skipping sending email');

  logger.info(
    `CRON healthCheckPostgres complete. ${numIdle} idle connections.`
  );
};

export default healthCheckPostgres;
