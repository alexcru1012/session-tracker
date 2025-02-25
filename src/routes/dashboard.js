import express from 'express';
import * as Sentry from '@sentry/node';

import passport from '@/passport';
import { sendMaskedError } from '@/helpers';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';
import logger from '@/logger';
import pool from '@/postgres';
import {
  getUsage,
  getWeekly,
  getMonthly,
  getNextEvents,
} from '@/helpers/dashboard';

const router = express.Router();

// Combine all endpoints into one to simplify fetches
router
  .route('/')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Get Dashboard (${user.id})`);

      const poolClient = await pool.connect();

      let usage;
      let weekly;
      let monthly;
      let nextEvents;

      try {
        usage = await getUsage(user, poolClient);
        weekly = await getWeekly(user, poolClient);
        monthly = await getMonthly(user, poolClient);
        nextEvents = await getNextEvents(user, poolClient);
      } catch (error) {
        Sentry.captureException(error);
        logger.error(`dashboard / ERROR: ${error}`);

        return sendMaskedError(
          error,
          'There was a problem fetching dashboard data.',
          next
        );
      } finally {
        poolClient.release();
      }

      const data = {
        usage,
        weekly,
        monthly,
        nextEvents,
      };

      return res.json({
        success: true,
        data,
      });
    }
  );

// Days logged in
router
  .route('/usage')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Get Usage (${user.id})`);

      const poolClient = await pool.connect();

      try {
        const data = await getUsage(user, poolClient);

        return res.json({
          success: true,
          data,
        });
      } catch (error) {
        Sentry.captureException(error);
        logger.error(`dashboard /usage ERROR: ${error}`);

        return sendMaskedError(
          error,
          'There was a problem finding usage data.',
          next
        );
      } finally {
        poolClient.release();
      }
    }
  );

// Get total logged hours for the last 7 days, per client
router
  .route('/weekly-summary')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Get weekly summary (${user.id})`);
      const poolClient = await pool.connect();

      try {
        const data = await getWeekly(user, poolClient);

        return res.json({
          success: true,
          data,
        });
      } catch (error) {
        Sentry.captureException(error);
        logger.error(`dashboard /weekly-summary ERROR: ${error}`);

        return sendMaskedError(
          error,
          'There was a problem finding weekly data.',
          next
        );
      } finally {
        poolClient.release();
      }
    }
  );

// Get number of sessions tracked for the last 4 weeks
router
  .route('/monthly-summary')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Get monthly summary (${user.id})`);
      const poolClient = await pool.connect();

      try {
        const data = await getMonthly(user, poolClient);

        return res.json({
          success: true,
          data,
        });
      } catch (error) {
        Sentry.captureException(error);
        logger.error(`dashboard /monthly-summary ERROR: ${error}`);

        return sendMaskedError(
          error,
          'There was a problem finding monthly data.',
          next
        );
      } finally {
        poolClient.release();
      }
    }
  );

// Get next 3 upcoming events
router
  .route('/next-events')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Get next events (${user.id})`);
      const poolClient = await pool.connect();

      try {
        const data = await getNextEvents(user, poolClient);

        return res.json({
          success: true,
          data,
        });
      } catch (error) {
        Sentry.captureException(error);
        logger.error(`dashboard /next-events ERROR: ${error}`);

        return sendMaskedError(
          error,
          'There was a problem finding next events data.',
          next
        );
      } finally {
        poolClient.release();
      }
    }
  );

export default router;
