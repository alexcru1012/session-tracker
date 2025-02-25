import redis from 'redis';

import logger from '@/logger';

const redisClient = redis.createClient({
  host: '127.0.0.1',
  port: process.env.REDIS_PORT,
});

redisClient.on('ready', err => {
  if (err) {
    console.log(`Error connecting to redis: ${err}`);

    return;
  }

  logger.info('Connected to redis');
});

export default redisClient;
