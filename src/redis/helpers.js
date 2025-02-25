import * as Sentry from '@sentry/node';

import { Options } from '@/constants';
import redis from '@/redis';
import logger from '@/logger';

// Cache response in redis
export const cacheData = (
  cacheKey,
  data,
  cacheTimeS = Options.defaultCacheTimeS
) => {
  try {
    redis.set(cacheKey, JSON.stringify(data));
    redis.expire(cacheKey, cacheTimeS);
  } catch (error) {
    logger.error(error);
    Sentry.captureException(error);
  }
};

export const getDataFromCache = cacheKey =>
  new Promise((resolve, reject) => {
    try {
      // Check redis first
      redis.get(cacheKey, (error, reply) => {
        if (error) {
          logger.error(error);

          // Nothing found in redis
          return reject(new Error(error)); // || Strings.defaultError));
        }

        // Send response
        resolve(JSON.parse(reply));
      });
    } catch (error) {
      logger.error(error);
      reject(error);
    }
  });

export const keys = key => redis.keys(key);

export const scanCache = (cursor, pattern, count = '100') =>
  new Promise((resolve, reject) =>
    redis.scan([cursor, 'MATCH', pattern, 'COUNT', count], (err, res) => {
      if (err) {
        logger.warn(`redis scan error: ${pattern}, ${err}`);

        return reject(err);
      }
      // console.log('redis scan res', pattern, res);

      return resolve(res);
    })
  );

// export const cacheMultiData = (keys, values, cacheTime = 60) => {
//   if (keys.length !== values.length) return;
//   // Cache multiple items at once
//   const data = [];

//   for (let i = 0; i < keys.length; i++)
//     data.push({ key: keys[i], val: JSON.stringify(values[i]), ttl: cacheTime });

//   redis.mset(data);
// };

export const deleteCachedData = cacheKey => {
  // seconds. 3600 = 1 hour
  // Invalidate cache key
  if (cacheKey) {
    try {
      return redis.del(cacheKey);
    } catch (error) {
      logger.error(error);
      Sentry.captureException(error);
    }
  }
};
