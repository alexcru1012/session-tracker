import express from 'express';
import SQL from 'sql-template-strings';
import validator from 'validator';
import moment from 'moment';

import passport from '@/passport';
import { CacheKeys, OmitProps } from '@/constants';
import {
  omit,
  runQuery,
  sendMaskedError,
  sendBadRequest,
  slugify,
} from '@/helpers';
import { deleteCachedData } from '@/redis/helpers';
import logger from '@/logger';
import visitor from '@/analytics';
import pool from '@/postgres';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';
import { getSessionType, getSessionTypes } from '@/models/sessionTypes';
import { getSchedule } from '@/models/schedules';

const router = express.Router();

router
  .route('/')
  // Get session types
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Get my sessionTypes (${user.id})`);
      visitor
        .event({
          ec: 'session-types',
          ea: 'get /',
        })
        .send();

      const poolClient = await pool.connect();
      let rows;

      try {
        rows = await getSessionTypes(user.id, poolClient);
      } catch (error) {
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding your session types.',
          next
        );
      }

      if (poolClient) poolClient.release();

      return res.json({
        success: true,
        data: rows.map(e => omit(e, OmitProps.sessionType)),
      });
    }
  )
  // Create session type
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { name, description, color, price, schedule_id } = req.body;

      logger.info(`Create sessionType (${user.id})`);
      visitor
        .event({
          ec: 'session-types',
          ea: 'post /',
        })
        .send();

      // Missing required fields
      if (!name) return sendBadRequest(res, 'Missing required input.');

      // Escape required inputs
      const nameInput = validator.escape(String(name));
      const scheduleIdInput = schedule_id
        ? validator.escape(String(schedule_id))
        : null;
      // Escape optional inputs
      let descriptionInput = description ? validator.escape(description) : '';

      descriptionInput = descriptionInput.substring(0, 501);
      const colorInput = color ? validator.escape(color.toString()) : '';

      const priceInput = Math.min(
        Math.max(parseFloat(price) || 0.0, 0.0),
        999999.9999
      );

      // Validate name length
      if (!validator.isLength(nameInput, { min: 2, max: 100 }))
        return sendBadRequest(res, 'Invalid name input. (2-100 chars)');

      const slug = slugify(nameInput);

      // Validate description length
      if (
        !!descriptionInput &&
        !validator.isLength(descriptionInput, { min: 1, max: 500 })
      )
        return sendBadRequest(res, 'Invalid description input. (too long)');

      // Validate color
      if (
        !!colorInput &&
        (!validator.isHexColor(colorInput) ||
          !validator.isLength(colorInput, { min: 3, max: 8 }))
      ) {
        return sendBadRequest(
          res,
          'Invalid color input. (must be hex ie. "ff0000")'
        );
      }

      // Validate price
      if (
        !!priceInput &&
        (priceInput > 999999.9999 ||
          priceInput < 0 ||
          !validator.isNumeric(String(priceInput)))
      )
        return sendBadRequest(res, 'Invalid price input. (numbers only)');

      const createdAt = moment().toISOString();
      const poolClient = await pool.connect();

      const schedule = scheduleIdInput
        ? await getSchedule(user.id, scheduleIdInput, poolClient)
        : null;

      if (scheduleIdInput && !schedule) {
        poolClient.release();

        return sendBadRequest(res, 'Invalid schedule_id.');
      }

      try {
        const rows = await runQuery(
          SQL`
        INSERT INTO session_types (user_id, name, slug, description, color, price, schedule_id, created_at, updated_at)
        VALUES (${user.id}, ${nameInput}, ${slug}, ${descriptionInput}, ${colorInput}, ${priceInput}, ${scheduleIdInput}, ${createdAt}, ${createdAt})
        RETURNING *;
      `,
          null,
          null,
          poolClient
        );

        const createdSessionType = rows[0];

        // Invalidate cache so user can fetch new data
        deleteCachedData(CacheKeys.schedule.userSchedules(user.id));
        deleteCachedData(CacheKeys.sessionTypesKey(user.id));
        CacheKeys.sessionTypeKey(user.id, createdSessionType.id);
        deleteCachedData();
        deleteCachedData(CacheKeys.sessionTypesPublicKey(user.id));
        deleteCachedData(
          CacheKeys.sessionTypePublicKey(user.id, createdSessionType.slug)
        );

        if (poolClient) poolClient.release();

        return res.json({
          success: true,
          message: 'Session type was created.',
          data: omit(createdSessionType, OmitProps.sessionType),
        });
      } catch (error) {
        if (poolClient) poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem creating this Session type.',
          next
        );
      }
    }
  );

router
  .route('/:sessionTypeId')
  // Get session type
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { sessionTypeId } = req.params;

      logger.info(`Get single sessionType (${user.id}-${sessionTypeId})`);
      visitor
        .event({
          ec: 'session-types',
          ea: 'get /:sessionTypeId',
        })
        .send();

      const poolClient = await pool.connect();

      let sessionType;
      let schedule;

      try {
        sessionType = await getSessionType(user.id, sessionTypeId, poolClient);
        schedule = sessionType?.schedule_id
          ? await getSchedule(user.id, sessionType.schedule_id, poolClient)
          : null;

        if (sessionType) {
          sessionType.user_slug = user.slug;
          sessionType.schedule = omit(schedule, OmitProps.schedule);
        }
      } catch (error) {
        logger.error(`get /:sessionTypeId: ${error}`);
      }

      if (poolClient) poolClient.release();

      if (!sessionType)
        return sendMaskedError(null, 'Could not find this session type', next);

      return res.json({
        success: true,
        data: omit(sessionType, OmitProps.sessionType),
      });
    }
  )
  // Update session type
  .patch(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { sessionTypeId } = req.params;
      const { name, description, color, price, schedule_id } = req.body;

      logger.info(`Update sessionType (${user.id}-${sessionTypeId})`);
      visitor
        .event({
          ec: 'session-types',
          ea: 'patch /:sessionTypeId',
        })
        .send();

      // Missing required fields
      if (!name) return sendBadRequest(res, 'Missing required input.');

      // Get session_type
      let sessionType;

      const poolClient = await pool.connect();

      try {
        sessionType = await getSessionType(user.id, sessionTypeId, poolClient);
      } catch (error) {
        if (poolClient) poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this Session type.',
          next
        );
      }

      if (!sessionType) {
        if (poolClient) poolClient.release();

        return sendBadRequest(res, 'Session type was not found.');
      }

      // Escape required inputs
      const nameInput = name
        ? validator.escape(name.toString())
        : sessionType.name;
      // Escape optional inputs
      const descriptionInput = description
        ? validator.escape(description).substring(0, 501)
        : '';
      const colorInput = color ? validator.escape(color.toString()) : '';
      const priceInput = Math.min(
        Math.max(parseFloat(price) || 0.0, 0.0),
        999999.9999
      );
      const scheduleIdInput = schedule_id
        ? validator.escape(String(schedule_id))
        : null;

      let updatedAt = !!name ? moment().toISOString() : null;
      if (!updatedAt) {
        updatedAt = user.updated_at
          ? moment(user.updated_at).toISOString()
          : null;
      }

      // Validate name length
      if (!validator.isLength(nameInput, { min: 2, max: 100 })) {
        if (poolClient) poolClient.release();

        return sendBadRequest(res, 'Invalid name input. (2-100 chars)');
      }

      const slug = slugify(nameInput);

      // Validate description length
      if (
        !!descriptionInput &&
        !validator.isLength(descriptionInput, { min: 1, max: 500 })
      ) {
        if (poolClient) poolClient.release();

        return sendBadRequest(res, 'Invalid description input. (too long)');
      }

      // Validate color
      if (
        !!colorInput &&
        (!validator.isHexColor(colorInput) ||
          !validator.isLength(colorInput, { min: 3, max: 8 }))
      ) {
        if (poolClient) poolClient.release();

        return sendBadRequest(res, 'Invalid color input. (must be hex)');
      }

      // Validate price
      if (!!priceInput && (priceInput > 999999.9999 || priceInput < 0)) {
        if (poolClient) poolClient.release();

        return sendBadRequest(res, 'Invalid price input. (numbers only)');
      }

      // Validate schedule
      if (!!scheduleIdInput) {
        const schedule = await getSchedule(
          user.id,
          scheduleIdInput,
          poolClient
        );

        if (!schedule) {
          if (poolClient) poolClient.release();

          return sendBadRequest(res, 'Schedule was not found.');
        }
      }

      try {
        const rows = await runQuery(
          SQL`
            UPDATE session_types
            SET
              name = ${nameInput},
              slug = ${slug},
              description = ${descriptionInput},
              color = ${colorInput},
              price = ${priceInput},
              schedule_id = ${scheduleIdInput},
              updated_at = ${updatedAt}
            WHERE id = ${sessionType.id}
            RETURNING *;
          `,
          null,
          null,
          poolClient
        );

        const updatedSessionType = rows[0];

        // Invalidate cache so user can fetch new data
        deleteCachedData(CacheKeys.schedule.userSchedules(user.id));
        deleteCachedData(CacheKeys.sessionTypesKey(user.id));
        deleteCachedData(CacheKeys.sessionTypeKey(user.id, sessionTypeId));
        deleteCachedData(CacheKeys.sessionTypesPublicKey(user.id));
        deleteCachedData(
          CacheKeys.sessionTypePublicKey(user.id, updatedSessionType.slug)
        );

        if (poolClient) poolClient.release();

        return res.json({
          success: true,
          message: 'Session type was updated.',
          data: omit(updatedSessionType, OmitProps.sessionType),
        });
      } catch (error) {
        if (poolClient) poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem updating this Session type.',
          next
        );
      }
    }
  )
  // Delete session type
  .delete(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { sessionTypeId } = req.params;

      logger.info(`Delete sessionType (${user.id}-${sessionTypeId})`);
      visitor
        .event({
          ec: 'session-types',
          ea: 'delete /:sessionTypeId',
        })
        .send();

      const poolClient = await pool.connect();

      try {
        // Perform query
        const rows = await runQuery(
          SQL`DELETE from session_types WHERE id = ${sessionTypeId} AND user_id = ${user.id} RETURNING *;`,
          null,
          null,
          poolClient
        );

        if (!rows.length) {
          if (poolClient) poolClient.release();

          return sendBadRequest(res, 'Session type was not found.');
        }

        // Invalidate cache items
        deleteCachedData(CacheKeys.sessionTypesKey(user.id));
        deleteCachedData(CacheKeys.sessionTypeKey(user.id, sessionTypeId));
        deleteCachedData(CacheKeys.sessionTypesPublicKey(user.id));
        deleteCachedData(
          CacheKeys.sessionTypePublicKey(user.id, rows[0]?.slug)
        );

        if (poolClient) poolClient.release();

        // Success
        return res.json({
          success: true,
          message: 'Session type was removed.',
        });
      } catch (error) {
        if (poolClient) poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem deleting this Session type.',
          next
        );
      }
    }
  );

// Helper to get the schedule attached to session_type
router
  .route('/:sessionTypeId/schedule')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { sessionTypeId } = req.params;

      logger.info(`Get sessionType schedule (${user.id}-${sessionTypeId})`);
      visitor
        .event({
          ec: 'session-types',
          ea: 'get /:sessionTypeId/schedule',
        })
        .send();

      const poolClient = await pool.connect();

      const sessionType = await getSessionType(
        user.id,
        sessionTypeId,
        poolClient
      );

      if (!sessionType) {
        poolClient.release();

        return sendBadRequest(res, 'SessionType not found.');
      }

      const schedule = sessionType.schedule_id
        ? await getSchedule(user.id, sessionType.schedule_id, poolClient)
        : null;

      if (poolClient) poolClient.release();

      deleteCachedData(CacheKeys.sessionTypesKey(user.id));
      deleteCachedData(CacheKeys.sessionTypeKey(user.id, sessionType.id));
      deleteCachedData(CacheKeys.sessionTypesPublicKey(user.id));
      deleteCachedData(
        CacheKeys.sessionTypePublicKey(user.id, sessionType.slug)
      );

      return res.json({
        success: !!schedule,
        data: {
          schedule,
        },
      });
    }
  );

export default router;
