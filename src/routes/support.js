import express from 'express';
import * as Sentry from '@sentry/node';

import logger from '@/logger';
import passport from '@/passport';
import { sendSupportMessage } from '@/emails/support';
import { sendBadRequest, sendMaskedError } from '@/helpers';
// import { requireSubscriptionTier } from '@/helpers/userSubscriptions';

const router = express.Router();

router.route('/email').post(
  [
    passport.authenticate('jwt', { session: false }),
    // requireSubscriptionTier(1),
  ],
  async (req, res, next) => {
    const { user } = req;
    const { name, email, subject, message } = req.body;

    logger.info(`Send support message (${user?.id})`);

    if (!user || !subject || !message)
      return sendBadRequest(res, 'Missing required input.');

    try {
      await sendSupportMessage(
        { ...user, name: user.name || name, email: user.email || email },
        subject,
        message
      );
    } catch (error) {
      Sentry.captureException(error);
      logger.error(error);

      return sendMaskedError(
        error,
        'There was a problem sending this support message.',
        next
      );
    }

    return res.json({
      success: true,
      message: 'Message was sent.',
    });
  }
);

export default router;
