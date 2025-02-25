import express from 'express';
import moment from 'moment-timezone';
import SQL from 'sql-template-strings';
import * as Sentry from '@sentry/node';

import {
  omit,
  sendBadRequest,
  sendMaskedError,
  runQuery,
  doesUserHaveClient,
} from '@/helpers';
import {
  scanCache,
  cacheData,
  getDataFromCache,
  deleteCachedData,
} from '@/redis/helpers';
import logger from '@/logger';
import passport from '@/passport';
import pool from '@/postgres';
import {
  OmitProps,
  CacheKeys,
  Strings,
  Options,
  ClientSettings,
} from '@/constants';
import { getCalendarEvents, getCalendarEvent } from '@/models/calendar';
import { validatePost, validatePatch } from '@/helpers/calendar';
import { getSession } from '@/models/sessions';
import { getSingleOptionByKey } from '@/models/clientOptions';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';
import { bumpUsageForUser } from '@/mongo/helpers';

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
      const { startDate, endDate } = req.query;

      // console.log('startDate', startDate);
      // console.log('endDate', endDate);

      logger.info(`Get calendar (${user.id})`);

      try {
        const poolClient = await pool.connect();

        const { events } = await getCalendarEvents(
          user,
          startDate && moment(startDate).toISOString(),
          endDate && moment(endDate).toISOString(),
          poolClient
        );

        await poolClient.release();

        // Update usage stats
        bumpUsageForUser(user.id);

        return res.json({
          success: true,
          data: events.map(e => omit(e, OmitProps.calendarEvent)),
        });
      } catch (error) {
        logger.error(error);
      }
    }
  )
  // Create calendar event
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.body;

      logger.info(`Create calendar event (${user.id})`);

      // First see if user owns this client
      if (clientId) {
        let doesUserHaveClientResponse;

        try {
          doesUserHaveClientResponse = await doesUserHaveClient(
            user.id,
            clientId
          );
        } catch (error) {
          return sendBadRequest(res, error.message, 401);
        }

        if (doesUserHaveClientResponse !== true)
          return sendBadRequest(res, doesUserHaveClientResponse, 401);
      }

      // Validate
      let inputs = {};

      try {
        inputs = validatePost(req);
      } catch (err) {
        console.log('err', err);

        return sendBadRequest(res, err.message || err || Strings.defaultError);
      }

      const {
        error,
        startsAtInput,
        localTimeInput,
        tzInput,
        titleInput,
        clientIdInput,
        sessionTypeIdInput,
        notesInput,
        colorInput,
        durationInput,
        isActiveInput,
        occurrenceInput,
        frequencyInput,
        recurringStartsAtInput,
        recurringEndsAtInput,
        intervalInput,
        monthOfYearInput,
        dayOfMonthInput,
        dayOfWeekInput,
        hourOfDayInput,
        minuteOfHourInput,
        // sendNotificationsInput,
        notificationDistanceInput,
        systemEventIdInput,
      } = inputs;

      if (error) return sendBadRequest(res, error);

      // Create
      let createEventResult;

      const poolClient = await pool.connect();

      try {
        const createdAt = moment().toISOString();

        // Create event
        createEventResult = await runQuery(
          SQL`
          INSERT INTO calendar_events (
            user_id,
            title,
            client_id,
            session_type_id,
            notes,
            color,
            starts_at,
            local_time,
            tz,
            duration,
            is_active,
            occurrence,
            frequency,
            recurring_starts_at,
            recurring_ends_at,
            interval,
            month_of_year,
            day_of_month,
            day_of_week,
            hour_of_day,
            minute_of_hour,
            notification_distance,
            system_event_id,
            created_at,
            updated_at
          ) VALUES (
            ${user.id},
            ${titleInput},
            ${clientIdInput},
            ${sessionTypeIdInput},
            ${notesInput},
            ${colorInput},
            ${startsAtInput},
            ${localTimeInput},
            ${tzInput},
            ${durationInput},
            ${isActiveInput},
            ${occurrenceInput},
            ${frequencyInput},
            ${recurringStartsAtInput},
            ${recurringEndsAtInput},
            ${intervalInput},
            ${monthOfYearInput},
            ${dayOfMonthInput},
            ${dayOfWeekInput},
            ${hourOfDayInput},
            ${minuteOfHourInput},
            ${notificationDistanceInput},
            ${systemEventIdInput},
            ${createdAt},
            ${createdAt}
          ) RETURNING *;
        `,
          null,
          null,
          poolClient
        );
      } catch (err) {
        console.log('err', err);

        await poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          err,
          'There was a problem creating this event (may be a duplicate).',
          next
        );
      }

      let event;
      if (createEventResult && createEventResult.length) {
        // Append -0 since it will be formatted this way on GET
        event = {
          ...createEventResult[0],
          id: `${createEventResult[0].id}-0`,
        };
      }

      if (!event) {
        await poolClient.release();

        return sendBadRequest(res, 'Could not create new event.');
      }

      try {
        const startsAt = moment(startsAtInput).startOf('minute');
        const startDiffS = Math.floor(startsAt.diff(moment()) / 1000);

        const confirmOption = clientId
          ? await getSingleOptionByKey(
              clientId,
              ClientSettings.sessionConfirmed,
              poolClient
            )
          : null;

        const isTrue =
          confirmOption?.option_value === 'true' ||
          confirmOption?.option_value === true;

        // Default true
        if (clientId && (!confirmOption || isTrue) && startDiffS >= 0) {
          // Cache client id to send confirmation email during cron process
          await cacheData(
            CacheKeys.calendarEventForClientScheduled(event.id),
            true,
            Math.max(startDiffS, 3600) // cache until event starts
          );
        }
      } catch (err) {
        await poolClient.release();

        logger.error(err);
        Sentry.captureException(err);
      }

      await poolClient.release();

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.calendarEventsKey(user.id));
      await deleteCachedData(CacheKeys.calendarEventsKey(user.id, '0', '0'));
      await deleteCachedData(CacheKeys.pgCalendarEventsKey(user.id));
      // await deleteCachedData(CacheKeys.calendarEventKey(event.id));
      if (event.client_id) {
        await deleteCachedData(
          CacheKeys.calendarEventsForClientKey(user.id, event.client_id)
        );
        await deleteCachedData(
          CacheKeys.pgCalendarEventsForClientKey(user.id, event.client_id)
        );
      }
      await deleteCachedData(CacheKeys.dashboard.nextEvents(user.id));

      return res.json({
        success: true,
        message: 'New event was added.',
        data: omit(event, OmitProps.calendarEvent),
      });
    }
  );

router
  .route('/v2')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { startDate, endDate } = req.query;

      logger.info(`Get calendar v2 (${user.id})`);

      try {
        const poolClient = await pool.connect();

        const { events, pgEventsById } = await getCalendarEvents(
          user,
          startDate && moment(startDate).toISOString(),
          endDate && moment(endDate).toISOString(),
          poolClient
        );

        await poolClient.release();

        return res.json({
          success: true,
          data: {
            events,
            pgEventsById,
          },
        });
      } catch (error) {
        logger.error(error);
      }
    }
  );

router
  .route('/processed')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Get processed events (${user.id})`);

      const resultCacheKey = CacheKeys.calendarProcessedEventsKey(user.id);
      const existingData = await getDataFromCache(resultCacheKey);

      // console.log('existingData', existingData);

      // Return cached data
      if (existingData) {
        return res.json({
          success: true,
          data: existingData,
        });
      }

      // Scan keys that match starting pattern
      const tempKey = CacheKeys.cronClientEventSessionAdded(
        user.id,
        '*',
        '*',
        '*'
      );
      const pattern = tempKey.substr(0, tempKey.length - 6); // remove __*__*
      const count = '10';
      let scanResults = [];
      let nextCursor = '0';
      const poolClient = await pool.connect();

      do {
        /* eslint-disable */
        const [_nextCursor, _scanResults] = await scanCache(
          nextCursor,
          pattern,
          count
        );
        /* eslint-enable */

        nextCursor = _nextCursor;
        scanResults = scanResults.concat(_scanResults);
      } while (nextCursor !== '0');

      // console.log('scanResults', scanResults);

      const cacheIds = scanResults.map(
        result => result.replace(pattern.substr(0, pattern.length - 1), '') // remove *
      );
      const sessionPromises = [];
      const eventPromises = [];

      // console.log('cacheIds', cacheIds);

      for (let i = 0; i < cacheIds.length; i++) {
        const [clientId, eventId, sessionId] = cacheIds[i]
          .split('__')
          .filter(c => !!c);

        sessionPromises.push(getSession(clientId, sessionId, poolClient));
        eventPromises.push(getCalendarEvent(eventId, user.tz, poolClient));
      }

      const sessionResults = await Promise.all(sessionPromises);
      const eventResults = await Promise.all(eventPromises);

      // console.log('sessionResults', sessionResults.map(s => s.id));
      // console.log('eventResults', eventResults.map(e => e.id));

      const data = sessionResults
        // Events may have been manually deleted
        .filter(s => !!(s && s.used_at))
        .map((s, i) => [s, eventResults[i]]);

      // console.log('caching data', data);

      // 2 min
      await cacheData(resultCacheKey, data, Options.defaultCacheTimeS * 2);

      // Finished
      await poolClient.release();

      return res.json({
        success: true,
        data,
      });
    }
  );

router
  .route('/clear')
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Clear processed events (${user.id})`);

      // Scan keys that match starting pattern
      const tempKey = CacheKeys.cronClientEventSessionAdded(
        user.id,
        '*',
        '*',
        '*'
      );
      const pattern = tempKey.substr(0, tempKey.length - 6); // remove __*__*
      const count = '10';
      let scanResults = [];
      let nextCursor = '0';

      do {
        /* eslint-disable */
        const [_nextCursor, _scanResults] = await scanCache(
          nextCursor,
          pattern,
          count
        );
        /* eslint-enable */

        nextCursor = _nextCursor;
        scanResults = scanResults.concat(_scanResults);
      } while (nextCursor !== '0');

      // console.log('scanResults', scanResults);

      const cacheIds = scanResults.map(
        result => result.replace(pattern.substr(0, pattern.length - 1), '') // remove *
      );

      // console.log('cacheIds', cacheIds);

      const processedEventsKey = CacheKeys.calendarProcessedEventsKey(user.id);
      let shouldUpdate = false;

      /* eslint-disable */
      for (let i = 0; i < cacheIds.length; i++) {
        const [clientId, eventId, sessionId] = cacheIds[i]
          .split('__')
          .filter(c => !!c);

        if (clientId && eventId && sessionId) {
          const cacheKey = CacheKeys.cronClientEventSessionAdded(
            user.id,
            clientId,
            eventId,
            sessionId
          );

          await deleteCachedData(cacheKey);
          shouldUpdate = true;
        }
      }

      // Remove key so user can fetch new processed event list
      if (shouldUpdate) {
        await deleteCachedData(processedEventsKey);
      }
      /* eslint-enable */

      return res.json({
        success: true,
        data: cacheIds,
      });
    }
  );

router
  .route('/clear/:cacheId')
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { cacheId } = req.params;

      logger.info(`Clear single processed event (${user.id}-${cacheId})`);

      const [clientId, eventId, sessionId] = cacheId
        .split('__')
        .filter(c => !!c);

      if (!clientId || !eventId || !sessionId)
        return sendBadRequest(res, 'Invalid cacheId');

      const cacheKey = CacheKeys.cronClientEventSessionAdded(
        user.id,
        clientId,
        eventId,
        sessionId
      );

      await deleteCachedData(cacheKey);
      await deleteCachedData(CacheKeys.calendarProcessedEventsKey(user.id));

      return res.json({
        success: true,
        data: cacheKey,
      });
    }
  );

router
  .route('/:eventIdRaw')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { eventIdRaw } = req.params;

      logger.info(`Get calendar event (${user.id}-${eventIdRaw})`);

      // Get existing event
      let event;

      try {
        event = await getCalendarEvent(eventIdRaw, user.tz);
      } catch (error) {
        // Mask sensitive errors
        return res.sendStatus(404);
      }

      // console.log('/event', event);

      if (!event) return res.sendStatus(404);

      return res.json({
        success: true,
        data: omit(event, OmitProps.calendarEvent),
      });
    }
  )
  .patch(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { eventIdRaw } = req.params;

      logger.info(`Update calendar event (${user.id}-${eventIdRaw})`);

      const eventId = eventIdRaw.split('-')[0];
      // Ignore eventIndex and patch main event

      // console.log('eventId', eventId);

      // Get existing event
      let existingEvent;

      try {
        existingEvent = await getCalendarEvent(eventIdRaw, user.tz);
      } catch (error) {
        // Mask sensitive errors
        return res.sendStatus(404);
      }

      if (!existingEvent) return res.sendStatus(404);

      // console.log('existingEvent', existingEvent);

      // Validate
      let inputs = {};

      try {
        inputs = validatePatch(req, existingEvent);
      } catch (err) {
        console.log('err', err);

        return sendBadRequest(res, err.message || err || Strings.defaultError);
      }

      // console.log('inputs', inputs);

      const {
        error,
        startsAtInput,
        localTimeInput,
        tzInput,
        titleInput,
        clientIdInput,
        sessionTypeIdInput,
        notesInput,
        colorInput,
        durationInput,
        isActiveInput,
        occurrenceInput,
        frequencyInput,
        recurringStartsAtInput,
        recurringEndsAtInput,
        intervalInput,
        monthOfYearInput,
        dayOfMonthInput,
        dayOfWeekInput,
        hourOfDayInput,
        minuteOfHourInput,
        // sendNotificationsInput,
        notificationDistanceInput,
        systemEventIdInput,
      } = inputs;

      if (error) return sendBadRequest(res, error);

      // Update
      let event;
      let updateEventResult;

      // console.log('patch startsAtInput', startsAtInput);

      try {
        const updatedAt = moment().toISOString();

        // Update client
        updateEventResult = await runQuery(SQL`
          UPDATE calendar_events
          SET
            title = ${titleInput},
            client_id = ${clientIdInput},
            session_type_id = ${sessionTypeIdInput},
            starts_at = ${startsAtInput},
            local_time = ${localTimeInput},
            tz = ${tzInput},
            duration = ${durationInput},
            notes = ${notesInput},
            color = ${colorInput},
            is_active = ${isActiveInput},
            occurrence = ${occurrenceInput},
            frequency = ${frequencyInput},
            recurring_starts_at = ${recurringStartsAtInput},
            recurring_ends_at = ${recurringEndsAtInput},
            interval = ${intervalInput},
            month_of_year = ${monthOfYearInput},
            day_of_month = ${dayOfMonthInput},
            day_of_week = ${dayOfWeekInput},
            hour_of_day = ${hourOfDayInput},
            minute_of_hour = ${minuteOfHourInput},
            notification_distance = ${notificationDistanceInput},
            system_event_id = ${systemEventIdInput},
            updated_at = ${updatedAt}
          WHERE id = ${eventId}
          AND user_id = ${user.id}
          RETURNING *;
      `);

        event =
          updateEventResult && updateEventResult.length
            ? updateEventResult[0]
            : null;
      } catch (updateError) {
        // Mask sensitive errors
        return sendMaskedError(
          updateError,
          'There was a problem updating this session.',
          next
        );
      }

      // console.log('2 event', event);

      if (!event) return sendBadRequest(res, 'Could not update this event.');

      try {
        // Keep original id if it repeats
        event = {
          ...event,
          id: !frequencyInput ? `${eventId}-0` : eventIdRaw,
        };

        // Reset notification status if distance changes
        if (notificationDistanceInput !== existingEvent.notification_distance)
          await deleteCachedData(CacheKeys.cronEventIdPushSent(eventIdRaw));

        // Invalidate cache so user can fetch new data
        await deleteCachedData(CacheKeys.calendarEventsKey(user.id));
        await deleteCachedData(CacheKeys.pgCalendarEventsKey(user.id));
        await deleteCachedData(CacheKeys.calendarEventKey(eventId));
        await deleteCachedData(CacheKeys.calendarEventKey(eventIdRaw));
        await deleteCachedData(CacheKeys.pgCalendarEventKey(eventId));
        await deleteCachedData(CacheKeys.pgCalendarEventKey(eventIdRaw));
        await deleteCachedData(CacheKeys.dashboard.nextEvents(user.id));
        if (event.client_id) {
          await deleteCachedData(
            CacheKeys.calendarEventsForClientKey(user.id, event.client_id)
          );
          await deleteCachedData(
            CacheKeys.pgCalendarEventsForClientKey(user.id, event.client_id)
          );
        }
      } catch (error2) {
        Sentry.captureException(error2);
        logger.error(error2);
      }

      // Honestly, I don't think any client is directly setting 'is_active' to false
      // Web and mobile should be creating a calendar edit instead
      // But it's probably safer to put this in both places
      const wasCancelled = existingEvent.is_active && !isActiveInput;

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

      res.json({
        success: true,
        message: 'Event was updated.',
        data: omit(event, OmitProps.calendarEvent),
      });
    }
  )
  .delete(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { eventIdRaw } = req.params;

      const eventId = eventIdRaw.split('-')[0];

      logger.info(`Delete calendar event (${user.id}-${eventIdRaw})`);

      // const updatedAt = moment().toISOString();
      // const isActive = false;

      const poolClient = await pool.connect();

      try {
        // Perform query
        const rows = await runQuery(
          SQL`
            DELETE FROM calendar_events
            WHERE id = ${eventId}
            AND user_id = ${user.id}
            RETURNING *;`,
          null,
          null,
          poolClient
        );

        if (!rows.length) {
          poolClient.release();

          return sendBadRequest(res, 'Event was not found.');
        }

        // Invalidate cache items
        await deleteCachedData(CacheKeys.calendarEventsKey(user.id));
        await deleteCachedData(CacheKeys.pgCalendarEventsKey(user.id));
        await deleteCachedData(CacheKeys.calendarEventKey(eventId));
        await deleteCachedData(CacheKeys.pgCalendarEventKey(eventId));
        await deleteCachedData(CacheKeys.calendarEventKey(eventIdRaw));
        await deleteCachedData(CacheKeys.pgCalendarEventKey(eventIdRaw));
        await deleteCachedData(CacheKeys.dashboard.nextEvents(user.id));
        // And cron tasks?
        // deleteCachedData(CacheKeys.cronEventIdPushSent(eventId));
        // deleteCachedData(CacheKeys.cronEventIdEnded(eventId));
        // deleteCachedData(CacheKeys.cronClientEventProcessed(user.id, eventId));
        // deleteCachedData(CacheKeys.cronClientEventSessionAdded(user.id, clientId, eventId, sessionId));

        poolClient.release();

        // Success
        return res.json({
          success: true,
          message: 'Event was removed.',
        });
      } catch (error) {
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem deleting this event.',
          next
        );
      }
    }
  );

export default router;
