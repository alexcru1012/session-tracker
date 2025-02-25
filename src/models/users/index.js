import SQL from 'sql-template-strings';
import moment from 'moment-timezone';
// import * as Sentry from '@sentry/node';

import { getClientCountAndUserTier } from '@/models/clients';
import { CacheKeys, TierLimits } from '@/constants';
import { runQuery } from '@/helpers';
import {
  scanCache,
  cacheData,
  getDataFromCache,
  deleteCachedData,
} from '@/redis/helpers';
// import logger from '@/logger';

export const getUser = async (userId, poolClient) => {
  const cacheKey = CacheKeys.userKey(userId);

  const rows = await runQuery(
    SQL`
    SELECT * FROM users WHERE id = ${userId};
  `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const getUserByEmail = async (email, poolClient) => {
  const cacheKey = CacheKeys.userEmailKey(email);

  const rows = await runQuery(
    SQL`
    SELECT * FROM users WHERE email ILIKE ${email};
  `,
    cacheKey,
    null,
    poolClient
  );

  // Find exact email match only
  return rows && rows.length ? rows.find(r => r.email === email) : null;
};

export const createUser = async (email, isActive, poolClient) => {
  const createdAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
      INSERT INTO users (email, is_active, created_at, updated_at)
      VALUES (${email}, ${isActive}, ${createdAt}, ${createdAt})
      RETURNING *;
    `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const getActiveUserIds = async () => {
  const cacheKey = CacheKeys.activeUserIdsKey();

  try {
    // Get cached data
    const cachedData = await getDataFromCache(cacheKey);

    if (cachedData) return cachedData;
  } catch (error) {
    // Nothing found, continue
  }

  // Scan cache
  const pattern = CacheKeys.activeUserKey('*');
  const prefix = CacheKeys.activeUserKey('');
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
    scanResults = scanResults.concat(
      _scanResults.map(r => r.replace(prefix, ''))
    );
  } while (nextCursor !== '0');

  // Cache results
  await cacheData(cacheKey, scanResults, 600); // 10 min

  return scanResults;
};

export const getActiveUsers = async poolClient => {
  const cacheKey = CacheKeys.activeUsersKey();

  const ids = (await getActiveUserIds()) || [];

  const rows = await runQuery(
    SQL`SELECT * FROM users WHERE id = ANY(${ids});`,
    cacheKey,
    600, // 10 min
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const getActiveUsersOld = async poolClient => {
  const cacheKey = CacheKeys.activeUsersKeyOLD();

  const rows = await runQuery(
    SQL`SELECT * FROM users WHERE is_active = true;`,
    cacheKey,
    600, // 10 min
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const setSubscriptionId = async (userId, subscriptionId, poolClient) => {
  const updatedAt = moment().toISOString();

  const rows = await runQuery(
    SQL`UPDATE users
      SET
        subscription_id = ${subscriptionId},
        updated_at = ${updatedAt}
      WHERE id = ${userId}
      RETURNING *;`,
    null,
    null,
    poolClient
  );

  const user = rows && rows.length ? rows[0] : null;

  if (user) {
    deleteCachedData(CacheKeys.meKey(user.id));
    deleteCachedData(CacheKeys.userKey(user.id));
    deleteCachedData(CacheKeys.userEmailKey(user.email));
  }

  return user;
};

export const updateUserOTPassword = async (userId, otPassword, poolClient) => {
  const updatedAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
    UPDATE users
    SET
      ot_password = ${otPassword},
      updated_at = ${updatedAt}
    WHERE id = ${userId}
    RETURNING *;`,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const getUsersByLastLoginDate = async (date, poolClient) => {
  const rows = await runQuery(
    SQL`
     SELECT * FROM users WHERE is_active = true AND last_login_at <= ${date};
   `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows : null;
};

export const canUserAddClient = async (userId, poolClient) => {
  // Get clients limit based on user's tier level
  const countAndTierRes = await getClientCountAndUserTier(userId, poolClient);

  if (!countAndTierRes) return false;

  const { tier, clients_count } = countAndTierRes;

  if (tier === 0) return false;
  if (clients_count >= TierLimits[tier]) return false;

  return true;
};

export const updateSlug = async (userId, slug, poolClient) => {
  const updatedAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
     UPDATE users
     SET
      slug = ${slug},
      updated_at = ${updatedAt}
     WHERE id = ${userId}
     RETURNING *;
   `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export default {};
