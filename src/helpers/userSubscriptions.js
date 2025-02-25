import * as Sentry from '@sentry/node';
import createError from 'http-errors';
import moment from 'moment-timezone';

import logger from '@/logger';
import pool from '@/postgres';
import { omit } from '@/helpers';
import { getUser, setSubscriptionId } from '@/models/users';
import {
  createUserSubscription,
  getUserSubscription,
} from '@/models/userSubscriptions';
import { OmitProps, TierLimits } from '@/constants';
// import { deleteCachedData } from '@/redis/helpers';
// import { CacheKeys } from '@/constants';

/** Basic fallback subscription for users without a subscription, failed payments, etc */
export const makeDefaultSubscription = () => {
  const expiresAt = moment()
    .add(1, 'year')
    .toISOString();

  return {
    tier: 1,
    is_active: true,
    expires_at: expiresAt,
  };
};

/** Subscription for new users (all start with 14 day unlimited) */
export const makeNewSignupTrialSubscription = () => {
  const expiresAt = moment()
    .add(14, 'days')
    .toISOString();

  return {
    tier: 2,
    is_active: true,
    expires_at: expiresAt,
  };
};

// Assume new users want to start trial
export const attachUserSubscription = async (user, poolClient) => {
  let subscription;
  let wasCreated;

  const isNewUser = moment()
    .subtract(1, 'month')
    .isBefore(user.created_at);

  if (!user.subscription_id) {
    // Will expire in 14 days
    subscription = await createUserSubscription(
      user.id,
      isNewUser ? makeNewSignupTrialSubscription() : makeDefaultSubscription(),
      poolClient
    );
    wasCreated = true;
  } else
    subscription = await getUserSubscription(user.subscription_id, poolClient);

  if (wasCreated) await setSubscriptionId(user.id, subscription.id, poolClient);

  // Attach limit
  subscription = {
    ...subscription,
    limit: TierLimits[subscription.tier],
  };

  return {
    ...user,
    subscription: omit(subscription, OmitProps.subscription),
  };
};

/**
 *
 * @param {'month'|'year'} interval - Length of subscription
 */
export const makePaidSubscription = _expiresAt => {
  const expiresAt =
    _expiresAt ||
    moment()
      .add(1, 'month')
      .toISOString();

  return {
    tier: 2,
    is_active: true,
    expires_at: expiresAt,
  };
};

// Middleware to check if user has sufficient tier to access data
export const requireSubscriptionTier = tierRequired => async (
  req,
  res,
  next
) => {
  const { id } = req.user;

  const poolClient = await pool.connect();

  try {
    const user = await getUser(id, poolClient);

    // && user.is_active
    if (user && user.subscription_id) {
      const subscription = await getUserSubscription(
        user.subscription_id,
        poolClient
      );

      if (
        subscription &&
        subscription.is_active &&
        subscription.tier >= tierRequired
      ) {
        poolClient.release();

        // Ok
        return next();
      }
    }
  } catch (error) {
    Sentry.captureException(error);

    logger.error(`Couldnt find subscription for user ${id}`);

    poolClient.release();

    // Internal server error
    return next(createError(500));
  }

  if (poolClient) poolClient.release();

  // Forbidden
  return next(createError(403));
};



export default {};
