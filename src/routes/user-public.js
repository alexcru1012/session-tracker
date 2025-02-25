import express from 'express';
import validator from 'validator';
import * as Sentry from '@sentry/node';

import passport from '@/passport';
import logger from '@/logger';
import { omit, sendBadRequest, sendMaskedError } from '@/helpers';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';
import { getOrCreateUserMeta, setUserMetaProp } from '@/mongo/helpers';
import { OmitProps } from '@/constants';
import {
  getUserBySlug,
  getPublicSessionTypes,
  getPublicSessionType,
} from '@/models/userPublic';
import pool from '@/postgres';
import { getSchedule } from '@/models/schedules';

const router = express.Router();

router.route('/:userSlug').get(
  [
    // passport.authenticate('jwt', { session: false }),
    // requireSubscriptionTier(1),
  ],
  async (req, res, next) => {
    // const { user } = req;
    const { userSlug } = req.params;

    logger.info(`Get public user index (${userSlug})`);

    const poolClient = await pool.connect();

    let targetUser = null;
    let sessionTypes = [];

    try {
      targetUser = await getUserBySlug(userSlug, poolClient);

      if (targetUser?.id) {
        sessionTypes =
          (await getPublicSessionTypes(targetUser.id, poolClient)) || [];
      }

      for (let i = 0; i < sessionTypes.length; i++) {
        const st = sessionTypes[i];
        const schedule = st.schedule_id
          ? await getSchedule(targetUser.id, st.schedule_id, poolClient)
          : null;

        st.user_slug = targetUser.slug;
        st.schedule = omit(schedule, OmitProps.schedule);
      }
    } catch (error) {
      Sentry.captureException(error);
      logger.error(error);

      poolClient.release();

      return res.json({
        success: false,
        message: "There was a problem fetching this user's page",
        data: {},
      });
    }

    poolClient.release();

    return res.json({
      success: true,
      message: '',
      data: {
        user: omit(targetUser, OmitProps.userPublic),
        sessionTypes: sessionTypes.map(st => omit(st, OmitProps.sessionType)),
      },
    });
  }
);

router.route('/:userSlug/:sessionTypeSlug').get(
  [
    // passport.authenticate('jwt', { session: false }),
    // requireSubscriptionTier(1),
  ],
  async (req, res, next) => {
    // const { user } = req;
    const { userSlug, sessionTypeSlug } = req.params;

    logger.info(`Get public session-type (${userSlug})`);

    const poolClient = await pool.connect();

    let targetUser = null;
    let sessionType = null;
    let schedule = null;

    try {
      targetUser = await getUserBySlug(userSlug, poolClient);

      if (targetUser) {
        sessionType = await getPublicSessionType(
          targetUser.id,
          sessionTypeSlug,
          poolClient
        );

        schedule = sessionType?.schedule_id
          ? await getSchedule(
              targetUser.id,
              sessionType.schedule_id,
              poolClient
            )
          : null;

        if (sessionType) {
          sessionType.user_slug = targetUser.slug;
          sessionType.schedule = omit(schedule, OmitProps.schedule);
        }
      }
    } catch (error) {
      Sentry.captureException(error);
      logger.error(error);

      poolClient.release();

      return res.json({
        success: false,
        message: 'There was a problem finding this session type.',
        data: {},
      });
    }

    poolClient.release();

    return res.json({
      success: true,
      data: {
        user: omit(targetUser, OmitProps.userPublic),
        sessionType: omit(sessionType, OmitProps.sessionType),
      },
    });
  }
);

export default router;
