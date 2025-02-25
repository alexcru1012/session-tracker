import express from 'express';
import validator from 'validator';
import moment from 'moment-timezone';
import * as Sentry from '@sentry/node';

import { omit, sendBadRequest, sendMaskedError } from '@/helpers';
import { cacheData, deleteCachedData } from '@/redis/helpers';
import passport from '@/passport';
import { OmitProps, CacheKeys } from '@/constants';
import { getCalendarEvent } from '@/models/calendar';
import {
  getCalendarEventEdit,
  getEventEditsForEvent,
  createCalendarEventEdit,
  updateCalendarEventEdit,
  deleteCalendarEventEdit,
} from '@/models/calendarEdits';
import pool from '@/postgres';
// import { getSession } from '@/models/sessions';
import logger from '@/logger';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';

const router = express.Router();

router
  .route('/:eventId')
  // Get all instances for calendar event
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { eventId: eventIdRaw } = req.params;

      logger.info(`Get calendar edits for ${eventIdRaw}`);

      // Just incase...
      const eventId = String(eventIdRaw).split('-')[0];

      // Get existing event
      let edits;

      try {
        edits = await getEventEditsForEvent(user.id, eventId);
      } catch (error) {
        // Mask sensitive errors
        return res.sendStatus(404);
      }

      // console.log('edits', edits);

      if (!edits) edits = [];

      return res.json({
        success: true,
        data: edits.map(e => omit(e, OmitProps.calendarEventEdit)),
      });
    }
  )
  // Create an individual calendar event instance
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      // const { eventId } = req.params;
      const { eventId: eventIdRaw } = req.params;
      const { index, isActive, startsAt, systemEventId } = req.body;

      // Just incase...
      const eventId = String(eventIdRaw).split('-')[0];

      // console.log('index', index);
      // console.log('eventId', eventId);
      // console.log('eventIdRaw', eventIdRaw);

      // Missing required fields
      if (index === null || index === undefined)
        return sendBadRequest(res, 'Missing required input.');

      const poolClient = await pool.connect();

      // Check if event exists
      let event;

      try {
        event = await getCalendarEvent(eventIdRaw, user.tz, poolClient);
      } catch (error) {
        poolClient.release();

        return sendMaskedError(
          error,
          'There was a problem finding this calendar event',
          next
        );
      }

      if (!event) {
        poolClient.release();

        return sendMaskedError(
          null,
          'Could not find this calendar event',
          next
        );
      }

      // It should be possible to cancel a single event (and possibly notifiy client)
      // if (event.occurrence === Occurrence.single) {
      //   poolClient.release();

      //   return res.status(400).json({
      //     success: false,
      //     message: 'Single events cannot have instances',
      //   });
      // }

      logger.info(`Create calendar edit for ${eventId}-${index} (${user.id})`);

      // Escape required inputs
      const indexInput = index ? validator.escape(String(index)) : 0;
      const isActiveInput =
        validator.escape(String(isActive)).toLowerCase() === 'true';

      let startsAtInput = startsAt ? validator.escape(startsAt) : undefined;
      const startsAtMoment = moment(startsAtInput);

      startsAtInput = startsAtMoment.isValid()
        ? startsAtMoment.toISOString()
        : event.starts_at;

      const systemEventIdInput =
        systemEventId !== null && systemEventId !== undefined
          ? validator.escape(String(systemEventId))
          : null;

      let existingEdit;

      try {
        const edits = await getEventEditsForEvent(user.id, eventId, poolClient);

        // console.log('edits', edits);

        // Find the exact edit
        if (edits && edits.length) {
          existingEdit = edits.find(
            e =>
              String(e.event_id) === String(eventId) &&
              String(e.event_index) === String(index)
          );
        }
      } catch (error) {
        // Mask sensitive errors
        Sentry.captureException(error);
        // return res.sendStatus(404);
      }

      let result;

      // console.log('existingEdit', existingEdit);

      // Track if this event is getting cancelled
      let wasCancelled;

      try {
        if (existingEdit) {
          result = await updateCalendarEventEdit(
            user.id,
            existingEdit.id,
            {
              isActive: isActiveInput,
              startsAt: startsAtInput,
              systemEventId: systemEventIdInput,
            },
            poolClient
          );

          if (existingEdit.is_active && !isActiveInput) wasCancelled = true;
        } else {
          result = await createCalendarEventEdit(
            user.id,
            eventId,
            indexInput,
            {
              isActive: isActiveInput,
              startsAt: startsAtInput,
              systemEventId: systemEventIdInput,
            },
            poolClient
          );

          if (event.is_active && !isActiveInput) wasCancelled = true;
        }
      } catch (error) {
        poolClient.release();

        return sendMaskedError(
          error,
          'There was a problem creating this event instance (may be a duplicate).',
          next
        );
      }

      poolClient.release();

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.calendarEventEditsForUserKey(user.id));
      await deleteCachedData(CacheKeys.calendarEventEditsKey(user.id, eventId));
      // calendarEventsKey takes start & end so this might not work
      await deleteCachedData(CacheKeys.calendarEventsKey(user.id));
      await deleteCachedData(CacheKeys.calendarEventKey(eventIdRaw));
      await deleteCachedData(CacheKeys.calendarEventKey(eventId));
      await deleteCachedData(CacheKeys.pgCalendarEventKey(eventIdRaw));
      await deleteCachedData(CacheKeys.pgCalendarEventKey(eventId));
      await deleteCachedData(CacheKeys.dashboard.nextEvents(user.id));
      if (event.client_id) {
        await deleteCachedData(
          CacheKeys.calendarEventsForClientKey(user.id, event.client_id)
        );
        await deleteCachedData(
          CacheKeys.pgCalendarEventsForClientKey(user.id, event.client_id)
        );
      }
      if (wasCancelled) {
        // Mark for cron to notify client of cancellation
        cacheData(
          CacheKeys.cancelledEvent.notifiyClient(
            user.id,
            event.client_id,
            eventIdRaw
          ),
          true,
          86400
        );
      }

      return res.json({
        success: true,
        message: 'Event instance was created.',
        data: omit(result, OmitProps.calendarEventEdit),
      });
    }
  );

router
  .route('/:eventId/:editId')
  // Get a single calendar event instance edit
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { editId } = req.params;
      const { eventId: eventIdRaw } = req.params;

      logger.info(`Get calendar edit for ${eventIdRaw} (${user.id})`);

      // Just incase...
      const eventId = String(eventIdRaw).split('-')[0];

      let edit;

      try {
        edit = await getCalendarEventEdit(user.id, eventId, editId);
      } catch (error) {
        return sendMaskedError(
          error,
          'There was a problem finding this calendar event instance',
          next
        );
      }

      if (!edit) {
        return sendMaskedError(
          null,
          'Could not find this calendar event instance',
          next
        );
      }

      return res.json({
        success: true,
        data: omit(edit, OmitProps.calendarEventEdit),
      });
    }
  )
  // Update a single calendar event instance
  .patch(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { editId } = req.params;
      const { eventId: eventIdRaw } = req.params;
      const { isActive, startsAt, systemEventId } = req.body;

      // Just incase...
      const eventId = String(eventIdRaw).split('-')[0];

      // Missing required fields
      if (isActive === undefined)
        return sendBadRequest(res, 'Missing required input.');

      logger.info(`Update calendar edit for ${eventIdRaw} (${user.id})`);

      const poolClient = await pool.connect();

      let existingEvent;

      try {
        existingEvent = await getCalendarEvent(eventIdRaw, user.tz, poolClient);
      } catch (error) {
        poolClient.release();

        return sendMaskedError(
          error,
          'There was a problem finding this calendar event',
          next
        );
      }

      if (!existingEvent) {
        poolClient.release();

        return sendMaskedError(
          null,
          'There was a problem finding this calendar event',
          next
        );
      }

      // Escape required inputs
      // const indexInput = index ? validator.escape(String(index)) : 0;
      const isActiveInput =
        validator.escape(String(isActive)).toLowerCase() === 'true';

      let startsAtInput = startsAt ? validator.escape(startsAt) : undefined;
      const startsAtMoment = moment(startsAtInput);

      startsAtInput = startsAtMoment.isValid()
        ? startsAtMoment.toISOString()
        : existingEvent.starts_at;

      const systemEventIdInput =
        (systemEventId !== null && systemEventId !== undefined
          ? validator.escape(String(systemEventId))
          : existingEvent.system_event_id) || null;

      let edit;

      try {
        edit = await updateCalendarEventEdit(
          user.id,
          editId,
          {
            isActive: isActiveInput,
            startsAt: startsAtInput,
            systemEventId: systemEventIdInput,
          },
          poolClient
        );
      } catch (error) {
        poolClient.release();

        return sendMaskedError(
          error,
          'There was a problem updating this calendar event instance',
          next
        );
      }

      poolClient.release();

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.calendarEventEditsForUserKey(user.id));
      await deleteCachedData(CacheKeys.calendarEventEditsKey(user.id, eventId));
      await deleteCachedData(
        CacheKeys.calendarEventEditKey(user.id, eventId, editId)
      );
      // calendarEventsKey takes start & end so this might not work
      await deleteCachedData(CacheKeys.calendarEventsKey(user.id));
      await deleteCachedData(CacheKeys.calendarEventKey(eventIdRaw));
      await deleteCachedData(CacheKeys.calendarEventKey(eventId));
      await deleteCachedData(CacheKeys.pgCalendarEventKey(eventIdRaw));
      await deleteCachedData(CacheKeys.pgCalendarEventKey(eventId));
      await deleteCachedData(CacheKeys.dashboard.nextEvents(user.id));
      if (existingEvent && existingEvent.client_id) {
        await deleteCachedData(
          CacheKeys.calendarEventsForClientKey(user.id, existingEvent.client_id)
        );
        await deleteCachedData(
          CacheKeys.pgCalendarEventsForClientKey(
            user.id,
            existingEvent.client_id
          )
        );
      }

      return res.json({
        success: true,
        message: 'Event instance was updated.',
        data: omit(edit, OmitProps.calendarEventEdit),
      });
    }
  )
  // Delete a single calendar event instance
  .delete(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { editId } = req.params;
      const { eventId: eventIdRaw } = req.params;

      logger.info(`Delete calendar edit for ${eventIdRaw} (${user.id})`);

      // Just incase...
      const eventId = String(eventIdRaw).split('-')[0];

      let row;
      let existingEvent;

      const poolClient = await pool.connect();

      try {
        row = await deleteCalendarEventEdit(user.id, eventId, editId);

        existingEvent = await getCalendarEvent(eventIdRaw, user.tz, poolClient);
      } catch (error) {
        await pool.release();

        return sendMaskedError(
          error,
          'There was a problem deleting this calendar event instance',
          next
        );
      }

      await pool.release();

      if (!row) return sendBadRequest(res, 'Event instance was not found.');

      const { event_index } = row;

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.calendarEventEditsForUserKey(user.id));
      await deleteCachedData(CacheKeys.calendarEventEditsKey(user.id, eventId));
      await deleteCachedData(
        CacheKeys.calendarEventEditKey(user.id, eventId, editId)
      );
      // calendarEventsKey takes start & end so this might not work
      await deleteCachedData(CacheKeys.calendarEventsKey(user.id));
      await deleteCachedData(CacheKeys.calendarEventKey(eventIdRaw));
      await deleteCachedData(CacheKeys.calendarEventKey(eventId));
      await deleteCachedData(CacheKeys.pgCalendarEventKey(eventIdRaw));
      await deleteCachedData(CacheKeys.pgCalendarEventKey(eventId));
      await deleteCachedData(CacheKeys.dashboard.nextEvents(user.id));
      if (existingEvent && existingEvent.client_id) {
        await deleteCachedData(
          CacheKeys.calendarEventsForClientKey(user.id, existingEvent.client_id)
        );
        await deleteCachedData(
          CacheKeys.pgCalendarEventsForClientKey(
            user.id,
            existingEvent.client_id
          )
        );
      }

      return res.json({
        success: true,
        message: 'Event instance was removed.',
        data: { eventId, eventIndex: event_index, editId },
        // data: omit(result, OmitProps.calendarEventEdit),
      });
    }
  );

export default router;
