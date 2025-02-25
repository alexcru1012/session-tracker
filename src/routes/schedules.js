import express from 'express';
import validator from 'validator';
import moment from 'moment-timezone';
import * as Sentry from '@sentry/node';
import { RRule, RRuleSet, rrulestr } from 'rrule';

import pool from '@/postgres';
import passport from '@/passport';
import logger from '@/logger';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';
import { getTimezone, omit, sendBadRequest } from '@/helpers';
import {
  getSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from '@/models/schedules';
import { getSessionType, setSchedule } from '@/models/sessionTypes';
import { deleteCachedData } from '@/redis/helpers';
import { CacheKeys, OmitProps } from '@/constants';

const router = express.Router();

// const ONE_HOUR = 3600000;
// const ICAL_OBJ =
//   'BEGIN:VEVENT\nDTSTART:20220823T090000\nDURATION:PT1H\nRRULE:FREQ=HOURLY;UNTIL=20220823T160000\nRRULE:FREQ=HOURLY;UNTIL=20220824T160000\nRRULE:FREQ=HOURLY;UNTIL=20220825T160000\nEND:VEVENT\n';
// const ICAL_OBJ_2 =
//   'DTSTART:20220823T090000\nRRULE:FREQ=HOURLY;UNTIL=20220823T160000\nRRULE:FREQ=HOURLY;UNTIL=20220824T160000\nRRULE:FREQ=HOURLY;UNTIL=20220825T160000\n';
// const ICAL_OBJ_3 =
//   'DTSTART:20220823T000000\nRRULE:FREQ=HOURLY;BYHOUR=9,10,11,12,13,14,15,16;BYDAY=MO\nRRULE:FREQ=HOURLY;BYHOUR=9,10,11,12,13,14,15,16;BYDAY=WE\nRRULE:FREQ=HOURLY;BYHOUR=9,10,11,12;BYDAY=FR\n';
// const ERROR_ICAL_OBJ =
//   'BEGIN:VEVENT\nRRULE:FREQ=HOURLY;UNTIL=20220823T160000\nRRULE:FREQ=HOURLY;UNTIL=20220824T160000\nRRULE:FREQ=HOURLY;UNTIL=20220825T160000\nEND:VEVENT\n';

// const timezone = getTimezone(tz);

// const schedule = new VEvent({
//   start: moment('2022-08-22'),
//   timezone,
//   rrules: [
//     {
//       start: moment('2022-08-22'),
//       duration: ONE_HOUR,
//       frequency: 'HOURLY',
//       byHourOfDay: [9, 10, 11, 12, 13, 14, 15, 16],
//       byDayOfWeek: ['MO'],
//     },
//     {
//       start: moment('2022-08-24'),
//       duration: ONE_HOUR,
//       frequency: 'HOURLY',
//       byHourOfDay: [9, 10, 11, 12, 13, 14, 15, 16],
//       byDayOfWeek: ['WE'],
//     },
//     {
//       start: moment('2022-08-26'),
//       duration: ONE_HOUR,
//       frequency: 'HOURLY',
//       byHourOfDay: [9, 10, 11, 12],
//       byDayOfWeek: ['FR'],
//     },
//   ],
// });

// const dates = schedule
//   .occurrences({ take: 20, start: moment('2022-08-23') })
//   .toArray()
//   .map(date => date.toISOString());

router
  .route('/')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Get schedules (${user.id})`);

      const poolClient = await pool.connect();

      let schedules = [];

      try {
        schedules = await getSchedules(user.id, poolClient);
      } catch (error) {
        Sentry.captureException(error);
      }

      if (poolClient) poolClient.release();

      return res.json({
        success: true,
        data: {
          schedules: schedules.map(row => omit(row, OmitProps.schedule)),
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
      const { name, ical, tz } = req.body;

      logger.info(`Create schedule (${user.id})`);

      if (!name || !tz)
        return sendBadRequest(res, 'Missing required input.');

      let error;

      const nameInput = name ? validator.escape(name) : null;
      const icalInput = ical ? validator.escape(ical) : '';
      const timezone = getTimezone(tz);

      if (!nameInput || !validator.isLength(nameInput, { min: 2, max: 100 }))
        error = 'Invalid name input.';

      let rules;
      let schedule;

      try {
        rules = rrulestr(icalInput);
      } catch (err) {
        logger.error(`Create rrulestr: ${err}`);
      }
      if (!rules) error = 'Invalid ical input.';

      if (error) return sendBadRequest(res, error);

      const poolClient = await pool.connect();

      try {
        schedule = await createSchedule(
          { userId: user.id, name: nameInput, ical: icalInput, tz: timezone },
          poolClient
        );
      } catch (err) {
        logger.error(`Create schedule: ${err}`);
      }

      poolClient.release();

      deleteCachedData(CacheKeys.schedule.userSchedules(user.id));

      return res.json({
        success: true,
        data: {
          schedule: omit(schedule, OmitProps.schedule),
        },
      });
    }
  );

router
  .route('/:scheduleId')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { scheduleId } = req.params;

      logger.info(`Get schedule (${user.id})`);

      const poolClient = await pool.connect();

      let schedule;

      try {
        schedule = await getSchedule(user.id, scheduleId, poolClient);
      } catch (err) {
        logger.error(`Get schedule: ${err}`);
      }

      if (poolClient) poolClient.release();

      return res.json({
        success: !!schedule,
        data: {
          schedule: omit(schedule, OmitProps.schedule),
        },
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
      const { scheduleId } = req.params;
      const { name, ical, tz } = req.body;

      logger.info(`Update schedule (${user.id})`);

      if (!name || !tz) return sendBadRequest(res, 'Missing required input.');

      let error;

      const nameInput = name ? validator.escape(name) : null;
      const icalInput = ical ? validator.escape(ical) : '';
      const timezone = getTimezone(tz);

      if (!nameInput || !validator.isLength(nameInput, { min: 2, max: 100 }))
        error = 'Invalid name input.';

      let rules;

      try {
        rules = rrulestr(icalInput);
      } catch (err) {
        logger.error(`Create schedule: ${err}`);
      }
      if (!rules) error = 'Invalid ical input.';

      if (error) return sendBadRequest(res, error);

      const poolClient = await pool.connect();

      let schedule;

      try {
        schedule = await updateSchedule(
          user.id,
          scheduleId,
          {
            name: nameInput,
            ical: icalInput,
            tz: timezone,
          },
          poolClient
        );
      } catch (err) {
        logger.error(`Update schedule ${err}`);
      }

      if (poolClient) poolClient.release();

      deleteCachedData(CacheKeys.schedule.userSchedules(user.id));
      deleteCachedData(CacheKeys.schedule.userSchedule(user.id, scheduleId));

      return res.json({
        success: !!schedule,
        data: {
          schedule: omit(schedule, OmitProps.schedule),
        },
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
      const { scheduleId } = req.params;

      logger.info(`Delete schedule (${user.id})`);

      const poolClient = await pool.connect();

      try {
        deleteSchedule(user.id, scheduleId, poolClient);
      } catch (err) {
        logger.error(`Delete schedule: ${err}`);
      }

      if (poolClient) poolClient.release();

      deleteCachedData(CacheKeys.schedule.userSchedules(user.id));
      deleteCachedData(CacheKeys.schedule.userSchedule(user.id, scheduleId));
      deleteCachedData(CacheKeys.sessionTypesKey(user.id));

      return res.json({
        success: true,
        message: 'Schedule was removed.',
      });
    }
  );

// Attach schedule to session-types
router
  .route('/:scheduleId/attach')
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { scheduleId } = req.params;
      const { sessionTypeIds } = req.body;

      const results = [];

      logger.info(`Attach schedules (${user.id})`);

      if (!sessionTypeIds || !Array.isArray(sessionTypeIds))
        return sendBadRequest(res, 'Missing required input.');

      const poolClient = await pool.connect();

      for (let i = 0; i < sessionTypeIds.length; i++) {
        const id = sessionTypeIds[i];

        try {
          const st = await setSchedule(user.id, id, scheduleId, poolClient);

          if (st) results.push(omit(st, OmitProps.sessionType));
        } catch (error) {
          logger.error(`Attach schedule error: ${error}`);
        }

        deleteCachedData(CacheKeys.sessionTypeKey(user.id, id));
      }

      if (poolClient) poolClient.release();

      deleteCachedData(CacheKeys.sessionTypesKey(user.id));
      deleteCachedData(CacheKeys.schedule.userSchedules(user.id));
      deleteCachedData(CacheKeys.schedule.userSchedule(user.id, scheduleId));

      return res.json({
        success: true,
        message: '',
        data: {
          sessionTypes: results,
        },
      });
    }
  );

export default router;
