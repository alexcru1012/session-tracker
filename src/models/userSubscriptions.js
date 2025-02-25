import moment from 'moment-timezone';
import SQL from 'sql-template-strings';
// import * as Sentry from '@sentry/node';

// import logger from '@/logger';
import { runQuery } from '@/helpers';
import { CacheKeys, Options } from '@/constants';
import { deleteCachedData } from '@/redis/helpers';

export const getUserSubscription = async (subscriptionId, poolClient) => {
  const cacheKey = CacheKeys.payment.userSubscription(subscriptionId);

  const rows = await runQuery(
    SQL`
    SELECT * from user_subscriptions
    WHERE id = ${subscriptionId}
    `,
    cacheKey,
    Options.defaultCacheTimeS * 5,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const getExpiredUserSubscriptions = async poolClient => {
  const rows = await runQuery(
    SQL`
     SELECT *
      FROM user_subscriptions
      WHERE expires_at <= NOW() AT TIME ZONE 'UTC';
   `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const setSubscriptionTier = async (
  subscriptionId,
  tier = 1,
  poolClient
) => {
  const rows = await runQuery(
    SQL`
    UPDATE user_subscriptions
      SET tier = ${tier}
      WHERE id = ${subscriptionId}
      RETURNING *;
   `,
    null,
    null,
    poolClient
  );

  const subscription = rows && rows.length ? rows[0] : null;

  deleteCachedData(CacheKeys.payment.userSubscription(subscriptionId));
  if (subscription) {
    deleteCachedData(CacheKeys.meKey(subscription.user_id));
    deleteCachedData(CacheKeys.userKey(subscription.user_id));
  }

  return subscription;
};

export const createUserSubscription = async (userId, data, poolClient) => {
  const { tier, is_active, expires_at } = data;

  const createdAt = moment().toISOString();
  const expiresAt =
    expires_at ||
    moment()
      .add(1, 'month')
      .toISOString();

  const rows = await runQuery(
    SQL`
      INSERT INTO user_subscriptions (user_id, tier, is_active, expires_at, created_at, updated_at)
        VALUES (${userId}, ${tier}, ${is_active}, ${expiresAt}, ${createdAt}, ${createdAt})
        RETURNING *;
    `,
    null,
    null,
    poolClient
  );

  const subscription = rows && rows.length ? rows[0] : null;

  deleteCachedData(CacheKeys.meKey(userId));
  deleteCachedData(CacheKeys.userKey(userId));
  if (subscription)
    deleteCachedData(CacheKeys.payment.userSubscription(subscription.id));

  return subscription;
};

export const updateUserSubscription = async (
  userId,
  subscriptionId,
  data,
  poolClient
) => {
  const updatedAt = moment().toISOString();

  const { tier, expires_at } = data;

  const rows = await runQuery(
    SQL`UPDATE user_subscriptions
    SET
      tier = ${tier},
      is_active = ${true},
      expires_at = ${expires_at},
      updated_at = ${updatedAt}
    WHERE id = ${subscriptionId}
    AND user_id = ${userId}
    RETURNING *;`,
    null,
    null,
    poolClient
  );

  const subscription = rows && rows.length ? rows[0] : null;

  deleteCachedData(CacheKeys.meKey(userId));
  deleteCachedData(CacheKeys.userKey(userId));
  deleteCachedData(CacheKeys.payment.userSubscription(subscriptionId));

  return subscription;
};

export default {};
