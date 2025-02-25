import SQL from 'sql-template-strings';
import moment from 'moment-timezone';
import * as Sentry from '@sentry/node';

import { CacheKeys, Options } from '@/constants';
import { runQuery, generateHash, generateRandomCode } from '@/helpers';
import { cacheData, getDataFromCache } from '@/redis/helpers';
import { getUser } from './users';

export const getMe = async (userId, poolClient) => {
  const cacheKey = CacheKeys.userKey(userId);
  const activeUserKey = CacheKeys.activeUserKey(userId);

  const rows = await runQuery(
    SQL`
    SELECT u.*
    FROM users u
    WHERE id = ${userId};
  `,
    cacheKey,
    null,
    poolClient
  );

  if (rows && rows.length) {
    try {
      // Track basic user activity (60 days)
      cacheData(activeUserKey, true, 5184000);
    } catch (error) {
      Sentry.captureException(error);
      // Continue...
    }

    return rows[0];
  }

  return null;
};

export const changePassword = async (userId, passwordInput, poolClient) => {
  const updatedAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
      UPDATE users
      SET
        password = ${generateHash(passwordInput)},
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

export const bumpUpdatedAt = async (userId, poolClient) => {
  const updatedAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
    UPDATE users
    SET
      last_login_at = ${updatedAt},
      updated_at = ${updatedAt},
      is_active = true
    WHERE id = ${userId}
    RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const resetActivationToken = async (
  userId,
  token,
  expires,
  poolClient
) => {
  const updatedAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
    UPDATE users
    SET
      is_activated = false,
      activation_token = ${token},
      activation_token_expires = ${expires},
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

export const activateMe = async (userId, poolClient) => {
  const updatedAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
    UPDATE users
    SET
      is_activated = true,
      activation_token = null,
      activation_token_expires = null,
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

export const deactivateMe = async (userId, poolClient) => {
  const updatedAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
    UPDATE users
    SET
      is_active = false,
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

export const getPassports = async (userId, poolClient) => {
  const cacheKey = CacheKeys.getPassports(userId);

  const existingData = await getDataFromCache(cacheKey);

  if (existingData) return existingData;

  const user = await getUser(userId, poolClient);
  const googleRows = await runQuery(
    SQL`
    SELECT * from google_passports WHERE user_id = ${userId};`,
    null,
    null,
    poolClient
  );
  const facebookRows = await runQuery(
    SQL`
    SELECT * from facebook_passports WHERE user_id = ${userId};`,
    null,
    null,
    poolClient
  );
  const appleRows = await runQuery(
    SQL`
    SELECT * from apple_passports WHERE user_id = ${userId};`,
    null,
    null,
    poolClient
  );

  const data = {
    local: !!(user && user.password),
    google: !!(googleRows && googleRows.length),
    facebook: !!(facebookRows && facebookRows.length),
    apple: !!(appleRows && appleRows.length),
  };

  await cacheData(cacheKey, data, Options.defaultCacheTimeS * 3);

  return data;
};

export const deletePassport = async (userId, type, poolClient) => {
  const tables = {
    google: 'google_passports',
    facebook: 'facebook_passports',
    apple: 'apple_passports',
  };

  const table = tables[type];

  if (!table) return false;

  const rows = await runQuery(
    SQL`
    DELETE FROM google_passports
    WHERE user_id = ${userId}
    RETURNING *;
    `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export default {};
