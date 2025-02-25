import * as Sentry from '@sentry/node';

import Usage from '@/mongo/schemas/usage';
import UserMeta from '@/mongo/schemas/userMeta';
import { deleteCachedData } from '@/redis/helpers';
import { makeDateKey } from '@/helpers';
import { CacheKeys } from '@/constants';
import logger from '@/logger';

export const bumpUsageForUser = async (userId, userTz) => {
  let res = { userId, dates: {} };

  try {
    let usage = await Usage.findOne({ userId }).maxTime(3000).exec();

    if (!usage) usage = new Usage({ userId });

    const dateKey = makeDateKey(userTz);

    usage.dates[dateKey] = true;
    usage.markModified('dates');
    usage = await usage.save();

    res.dates = { ...usage.dates };

    deleteCachedData(CacheKeys.dashboard.usage(userId));
  } catch (err) {
    logger.error('bumpUsageForUser:', err);
  }

  return res;
};

export const getOrCreateUserMeta = async userId => {
  let userMeta = await UserMeta.findOne({ userId }).maxTime(3000).exec();

  if (!userMeta) userMeta = new UserMeta({ userId });

  userMeta = await userMeta.save();

  return userMeta;
};

export const setUserMetaProp = async (userId, key, value) => {
  let userMeta;

  try {
    userMeta = await getOrCreateUserMeta(userId);
  } catch (error) {
    Sentry.captureException(new Error(error.message));
    logger.error(error.message);

    return null;
  }

  userMeta[key] = value;
  userMeta.markModified(key);

  userMeta = await userMeta.save();

  return userMeta;
};

export const getUserMetaByUserId = async userId =>
  UserMeta.findOne({ userId }).maxTime(3000).exec();

export const getUserMetaByStripeSession = async stripeSessionId =>
  UserMeta.findOne({ stripeSessionId }).maxTime(3000).exec();

export const getUserMetaByStripeCustomer = async stripeCustomerId =>
  UserMeta.findOne({ stripeCustomerId }).maxTime(3000).exec();

export const getUserMetaByStripeSubscription = async stripeSubscriptionId =>
  UserMeta.findOne({ stripeSubscriptionId }).maxTime(3000).exec();

export default {};
