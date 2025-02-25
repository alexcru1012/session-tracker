import express from 'express';
import validator from 'validator';
import * as Sentry from '@sentry/node';

import { omit, sendBadRequest, sendMaskedError } from '@/helpers';
import passport from '@/passport';
import logger from '@/logger';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';
import { getOrCreateUserMeta, setUserMetaProp } from '@/mongo/helpers';
import { OmitProps } from '@/constants';

const router = express.Router();

router
  .route('/')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Get user meta (${user.id})`);

      let userMeta;

      try {
        userMeta = getOrCreateUserMeta(user.id);
      } catch (error) {
        return sendMaskedError(
          error,
          'There was a problem finding user data.',
          next
        );
      }

      return res.json({
        success: true,
        data: {
          userMeta: {
            ...omit(userMeta, OmitProps.userMeta),
            probablyHasStripe:
              userMeta.stripeSessionId ||
              userMeta.stripeCustomerId ||
              userMeta.stripeSubscriptionId,
          },
        },
      });
    }
  );

router
  .route('/:metaKey')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { metaKey } = req.params;

      logger.info(`Get user meta key (${user.id}-${metaKey})`);

      let userMeta;

      try {
        userMeta = getOrCreateUserMeta(user.id);
      } catch (error) {
        return sendMaskedError(
          error,
          'There was a problem finding user data.',
          next
        );
      }

      return res.json({
        success: true,
        data: {
          metaKey,
          metaValue: userMeta[metaKey],
        },
      });
    }
  )
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { metaKey } = req.params;
      const { metaValue } = req.body;

      const possibleKeys = ['shouldDisplayMobileAppTutorial'];
      const keyInput = validator.escape(String(metaKey));
      const valueInput = metaValue
        ? validator.escape(String(metaValue))
        : user.metaValue;

      if (!possibleKeys.includes(keyInput))
        return sendBadRequest(res, 'Missing required input.');

      try {
        await setUserMetaProp(user.id, keyInput, valueInput);
      } catch (error) {
        Sentry.captureException(error);
        logger.error(`setMetaKey error: ${error}`);
      }

      return res.json({
        success: true,
        data: {
          metaKey,
          metaValue: valueInput,
        },
      });
    }
  );

export default router;
