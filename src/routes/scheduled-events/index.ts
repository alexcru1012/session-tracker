// @ts-nocheck
import express, { Request, Response } from 'express';
import * as Sentry from '@sentry/node';

import pool from '@/postgres';
import passport from '@/passport';
import logger from '@/logger';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';
import {
  createScheduledEvent,
  deleteScheduledEvent,
  getScheduledEvent,
  getScheduledEvents,
  updateScheduledEvent,
} from '@/models/scheduledEvents';
import { sendBadRequest } from '@/helpers';
import { getSessionType } from '@/models/sessionTypes';
import { ServerResponse } from '@/types';
import {
  GetScheduledEventIdParams,
  PostScheduledEvent,
  PostScheduledEventParams,
  PostScheduledEventResponse,
} from '@/models/scheduledEvents/types';
import { validatePatch, validatePost } from './helpers';
// import { CreateScheduledEventInputs } from './types';

const router = express.Router();

router
  .route('/')
  // Get my scheduled events
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req: Request, res: Response) => {
      const { user } = req;
      const { user, poop } = req.body;

      logger.info(`Get scheduled events (${user?.id})`);

      const poolClient = await pool.connect();

      let scheduledEvents = [];

      try {
        scheduledEvents = await getScheduledEvents(
          user?.id,
          user?.email,
          poolClient
        );
      } catch (err) {
        logger.error(`Get scheduled events: ${err}`);
        Sentry.captureException(err);
      } finally {
        poolClient.release();
      }

      return res.json({
        success: true,
        data: {
          scheduledEvents,
        },
      });
    }
  );

router
  .route('/:targetUserId')
  // Get all scheduled events for target user
  .get<PostScheduledEventParams, ServerResponse, never, never>(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, _next) => {
      const { user } = req;
      const { targetUserId } = req.params;

      logger.info(`Get scheduled events for ${targetUserId} (${user.id})`);

      return res.json({
        success: true,
      });
    }
  )
  // Create a scheduled event with target user (public)
  .post<
    PostScheduledEventParams,
    ServerResponse<PostScheduledEventResponse>,
    PostScheduledEvent,
    never
  >(
    [
      passport.authenticate('jwt', { session: false }),
      // requireSubscriptionTier(1),
    ],
    async (req, res, _next) => {
      const { user } = req;
      const { targetUserId } = req.params;
      const { sessionTypeId } = req.body;

      logger.info(`Create scheduled event with ${targetUserId} (public)`);

      if (user.id !== targetUserId)
        return sendBadRequest(res, error.message, 401);

      const result = validatePost(req.body);

      if (!result.isEmpty()) {
        return sendBadRequest(res, 'Invalid input.', 400, {
          errors: result.array(),
        });
      }

      const poolClient = await pool.connect();

      const sessionType = await getSessionType(
        targetUserId,
        sessionTypeId,
        poolClient
      );

      if (!sessionType) {
        poolClient.release();

        return sendBadRequest(res, 'Session type not found');
      }

      const scheduledEvent = await createScheduledEvent(
        user.id,
        request.body,
        poolClient
      );

      poolClient.release();

      return res.json({
        success: true,
        data: {
          scheduledEvent,
        },
      });
    }
  );

// Get a scheduled event
router.route('/:targetUserId/:scheduledEventId').get<
  GetScheduledEventIdParams,
  never,
  ServerResponse<{ scheduledEvent: ScheduledEvent }>, never>(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, _next) => {
      const { user } = req;
      const { targetUserId, scheduledEventId } = req.params;

      logger.info(`Get scheduled event (${user.id})`);

      const poolClient = await pool.connect();

      const scheduledEvent = await getScheduledEvent(
        targetUserId,
        scheduledEventId,
        poolClient
      );

      const sessionType = scheduledEvent?.session_type_id
        ? await getSessionType(
            targetUserId,
            scheduledEvent.session_type_id,
            poolClient
          )
        : null;

      poolClient.release();

      return res.json({
        success: true,
        data: {
          scheduledEvent,
          sessionType,
        },
      });
    }
  )
    // Update a scheduled event
    .patch<
      GetScheduledEventIdParams,
      ServerResponse<PostScheduledEventResponse>,
      Partial<PostScheduledEvent>,
      never
    >(
      [
        passport.authenticate('jwt', { session: false }),
        requireSubscriptionTier(1),
      ],
      async (req, res, _next) => {
        const { user } = req;
        const { targetUserId, scheduledEventId } = req.params;

        logger.info(`Update scheduled event (${user.id})`);

        if (user.id !== targetUserId)
          return sendBadRequest(res, error.message, 401);

        const result = validatePatch(req.body);

        if (!result.isEmpty()) {
          return sendBadRequest(res, 'Invalid input.', 400, {
            errors: result.array(),
          });
        }

        const poolClient = await pool.connect();

        const existingScheduledEvent = await getScheduledEvent(
          targetUserId,
          scheduledEventId,
          poolClient
        );

        const data = {
          sessionTypeId: req.body.sessionTypeId || existingScheduledEvent.sessionTypeId,
          startsAt: req.body.startsAt || existingScheduledEvent.startsAt,
          localTime: req.body.localTime || existingScheduledEvent.localTime,
          tz: req.body.tz || existingScheduledEvent.tz,
          guestName: req.body.guestName || existingScheduledEvent.guestName,
          guestEmail: req.body.guestEmail || existingScheduledEvent.guestEmail,
          notes?: req.body.notes, // || existingScheduledEvent.notes,
          isActive?: req.body.isActive, // || existingScheduledEvent.isActive,
        };

        const scheduledEvent = await updateScheduledEvent(
          targetUserId,
          scheduledEventId,
          data,
          poolClient
        );

        const sessionType = scheduledEvent?.session_type_id
          ? await getSessionType(
              targetUserId,
              scheduledEvent.session_type_id,
              poolClient
            )
          : null;

        poolClient.release();

        return res.json({
          success: true,
          data: {
            scheduledEvent,
            sessionType,
          },
        });
      }
    )
    // Delete a scheduled event
    .delete<
      GetScheduledEventIdParams,
      ServerResponse<{id: number}>,
      never,
      never
    >(
      [
        passport.authenticate('jwt', { session: false }),
        requireSubscriptionTier(1),
      ],
      async (req, res, _next) => {
        const { user } = req;
        const { targetUserId, scheduledEventId } = req.params;

        logger.info(`Delete scheduled event (${user.id})`);

        if (user.id !== targetUserId)
          return sendBadRequest(res, error.message, 401);

        const poolClient = await pool.connect();

        const deletedScheduledEvent = await deleteScheduledEvent(targetUserId, scheduledEventId, poolClient);

        poolClient.release();

        return res.json({
          success: true,
          data: {
            id: deletedScheduledEvent?.id,
          }
        });
      }
    );

export default router;
