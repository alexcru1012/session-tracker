import { Pool } from 'pg';
// import env from 'node-env-file';
import * as dotenv from 'dotenv';

import logger from '@/logger';

// Read env file
dotenv.config();
// env(`${__dirname}/../../.env`);

// Postgres
const config = {
  // Connection settings
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASS,
  database: process.env.PG_DATABASE,
  // Pool settings
  idleTimeoutMillis: 6000,
  connectionTimeoutMillis: 7000,
  // acquireTimeoutMillis: 8000,
  min: 0,
  max: 50,
};
const pool = new Pool(config);

pool.on('connect', () => logger.info('Connected to postgres'));

pool.on('error', error => {
  logger.error('idle client error', error.message, error.stack);
});

export default pool;
