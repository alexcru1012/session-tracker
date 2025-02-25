import express from 'express';
// import async from 'async';
import SQL from 'sql-template-strings';
import createError from 'http-errors';
// import csv from 'csv-express';
import moment from 'moment-timezone';

import passport from '@/passport';
import { CacheKeys, OmitProps } from '@/constants';
import {
  runQuery,
  generateRandomCode,
  omit,
  sendMaskedError,
  getActivationLink,
  generateJWTToken,
  slugify,
  generateRandomSlug,
} from '@/helpers';
import { getDataFromCache, cacheData } from '@/redis/helpers';
import { getUser, getUserByEmail, updateSlug } from '@/models/users';
import pool from '@/postgres';
import { sendPostgresHealthCheckAlert } from '@/emails/health';
import { attachUserSubscription } from '@/helpers/userSubscriptions';
import logger from '@/logger';
import { setSlug } from '@/models/sessionTypes';

const router = express.Router();

const ADMINS_ONLY = (req, res, next) => {
  if (req.user && req.user.is_admin) return next();

  return next(createError(404));
};

const CACHE_TIME = process.env.NODE_ENV === 'production' ? 300 : 15; // 12h, 15s

router
  .route('/')
  .get(
    [passport.authenticate('jwt', { session: false }), ADMINS_ONLY],
    (req, res, next) =>
      res.json({
        success: true,
      })
  );

// Show basic user stats
router
  .route('/dashboard')
  .get(
    [passport.authenticate('jwt', { session: false }), ADMINS_ONLY],
    async (req, res, next) => {
      // Get cached data
      try {
        const cachedData = await getDataFromCache(CacheKeys.adminDashboard);
        if (cachedData) {
          // console.log('returning cached data')
          return res.json({
            success: true,
            ...cachedData,
          });
        }
      } catch (error) {
        // Nothing found
      }

      // User count
      let user_count;

      try {
        // Perform query
        const rows = await runQuery(
          SQL`
          SELECT COUNT(*) FROM users;
        `,
          CacheKeys.adminUserCount,
          CACHE_TIME
        );

        user_count = rows && rows.length && rows[0] && rows[0].count;
      } catch (error) {
        // return next(error)
      }

      // Recent
      let recent_users;

      try {
        // Perform query
        recent_users = await runQuery(
          SQL`
        SELECT id, email, name, app_version, tz, last_login_at
        FROM users
        WHERE last_login_at IS NOT NULL
        ORDER BY last_login_at DESC
        LIMIT 50;
      `,
          CacheKeys.adminRecentUsers,
          CACHE_TIME
        );
      } catch (error) {
        // return next(error)
      }

      // Clients
      let client_count;

      try {
        const rows = await runQuery(
          SQL`
        SELECT COUNT(*) FROM clients;
      `,
          CacheKeys.adminTotalClients,
          CACHE_TIME
        );

        client_count = rows && rows.length && rows[0] && rows[0].count;
      } catch (error) {
        // return next(error)
      }

      // Concat results
      const response = {
        user_count,
        recent_users,
        client_count,
      };

      // Cache it
      cacheData(CacheKeys.adminDashboard, response, CACHE_TIME);

      return res.json({
        success: true,
        ...response,
      });
    }
  );

// Generate a CSV of user emails
router
  .route('/emails')
  .get(
    [passport.authenticate('jwt', { session: false }), ADMINS_ONLY],
    async (req, res, next) => {
      // Perform query
      try {
        const data = await runQuery(
          SQL`
        SELECT id, name, email FROM users ORDER BY id ASC;
      `,
          CacheKeys.adminEmails,
          CACHE_TIME
        );

        return res.csv(data, true, {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename=\"${moment().format(
            'YYYY-MM-DD'
          )}-mysessiontracker-users.csv\"`,
        });
      } catch (error) {
        return next(error);
      }
    }
  );

router
  .route('/regen-activation')
  .post(
    [passport.authenticate('jwt', { session: false }), ADMINS_ONLY],
    async (req, res, next) => {
      // const { user } = req;
      const { userId, email } = req.body;

      const poolClient = await pool.connect();

      try {
        // Find user
        let targetUser = userId
          ? await getUser(userId, poolClient)
          : await getUserByEmail(email, poolClient);

        if (!targetUser) {
          poolClient.release();

          return sendMaskedError(
            null,
            'No user found with that email address.',
            next
          );
        }

        // Generate token
        const activationTokenExpires = moment().add(2, 'days').toISOString();
        const activationToken = await generateRandomCode();

        const userResult = await runQuery(
          SQL`
          UPDATE users
          SET
            activation_token = ${activationToken},
            activation_token_expires = ${activationTokenExpires}
          WHERE id = ${targetUser.id}
          RETURNING *;
        `,
          null,
          null,
          poolClient
        );

        targetUser = userResult && userResult.length ? userResult[0] : null;

        poolClient.release();

        if (!targetUser)
          return sendMaskedError(null, 'Something went wrong', next);

        return res.json({
          success: true,
          message: 'User activation token was reset.',
          data: {
            user: omit(targetUser, OmitProps.user),
            link: getActivationLink(activationToken),
          },
        });
      } catch (err) {
        if (poolClient) poolClient.release();

        return next(err);
      }
    }
  );

router
  .route('/create-subscriptions')
  .get(
    [passport.authenticate('jwt', { session: false }), ADMINS_ONLY],
    async (req, res, next) => {
      const poolClient = await pool.connect();

      // Perform query
      try {
        const data = await runQuery(
          SQL`SELECT * FROM users WHERE subscription_id IS NULL ORDER BY id ASC;`,
          null,
          null,
          poolClient
        );

        if (data && data.length > 0) {
          for (let i = 0; i < data.length; i++) {
            const user = data[i];

            await attachUserSubscription(user, poolClient);
          }

          if (poolClient) poolClient.release();

          return res.json({
            success: true,
            message: 'User subscriptions were created.',
          });
        }

        if (poolClient) poolClient.release();

        return res.json({
          success: true,
          message: 'All users have a subscription attached.',
        });
      } catch (error) {
        if (poolClient) poolClient.release();

        return next(error);
      }
    }
  );

// Get detailed info about a user
// router
//   .route('/user/:userId')
//   .get(
//     [passport.authenticate('jwt', { session: false }), ADMINS_ONLY],
//     async (req, res, next) => {
//       const { userId } = req.params;

//       // Maybe get cached data
//       try {
//         const cachedData = await getDataFromCache(CacheKeys.adminUser(userId));
//         if (cachedData) {
//           console.log('returning cached data');

//           return res.json({
//             success: true,
//             ...cachedData,
//           });
//         }
//       } catch (error) {
//         // Nothing found
//       }

//       // Client count
//       let client_count = 0;

//       try {
//         const rows = await runQuery(
//           SQL`
//         SELECT COUNT(*) FROM clients WHERE user_id = ${userId};
//       `,
//           CacheKeys.adminUserClientCount(userId),
//           CACHE_TIME
//         );

//         client_count = rows && rows.length && rows[0] && rows[0].count;
//       } catch (error) {
//         return next(error);
//       }

//       // Recent clients
//       let recent_clients;
//       // try {
//       //   recent_clients = await runQuery(SQL`
//       //     SELECT id, name_alias, email_alias, (
//       //       SELECT max(max_updated_at)
//       //       FROM (
//       //         SELECT id, client_id, updated_at, max(updated_at)
//       //         OVER (partition by updated_at) as max_updated_at
//       //         FROM clients c
//       //         WHERE c.used_at IS NOT NULL
//       //         AND c.used_at <= NOW() AT TIME ZONE 'UTC'
//       //         AND c.client_id = c.id
//       //       ) s2
//       //     ) as last_client_updated
//       //     FROM clients
//       //     WHERE user_id = ${userId}
//       //     LIMIT 25;
//       //   `, CacheKeys.adminUserRecentClients, CACHE_TIME)
//       // }
//       // catch (error) {
//       //   return next(error)
//       // }

//       // Concat results
//       const response = {
//         client_count,
//         recent_clients,
//       };

//       // Cache it
//       cacheData(CacheKeys.adminUser(userId), response, CACHE_TIME);

//       return res.json({
//         success: true,
//         ...response,
//       });
//     }
//   );

router
  .route('/home-token')
  .get(
    [passport.authenticate('jwt', { session: false }), ADMINS_ONLY],
    async (req, res, next) => {
      const token = await generateJWTToken({ id: process.env.HOME_SECRET_ID });

      return res.json({
        success: true,
        data: {
          token,
        },
      });
    }
  );

router
  .route('/test-postgres-health')
  .get(
    [passport.authenticate('jwt', { session: false }), ADMINS_ONLY],
    async (req, res, next) => {
      try {
        await sendPostgresHealthCheckAlert([
          { pid: '123', state: 'idle', backend_start: '2022-01-01', query: '' },
          { pid: '234', state: 'idle', backend_start: '2022-01-01', query: '' },
          {
            pid: '345',
            state: 'idle',
            backend_start: '',
            query: 'SELECT something from fake table',
          },
          { pid: '456', state: 'idle', backend_start: '', query: '' },
        ]);
      } catch (err) {
        return res.json({
          success: false,
          data: 'there was an error',
          message: err.message,
        });
      }

      return res.json({
        success: true,
        data: 'email was sent',
      });
    }
  );

router
  .route('/slugify-users')
  .post(
    [passport.authenticate('jwt', { session: false }), ADMINS_ONLY],
    async (req, res, next) => {
      const poolClient = await pool.connect();

      // Perform query
      const data = await runQuery(
        SQL`SELECT * FROM users WHERE slug IS NULL ORDER BY id ASC;`,
        null,
        null,
        poolClient
      );

      let updated = 0;
      let problems = 0;

      if (data && data.length > 0) {
        for (let i = 0; i < data.length; i++) {
          const user = data[i];
          let oops = false;

          try {
            const slug = slugify(user.name);

            await updateSlug(user.id, slug, poolClient);
            updated++;
          } catch (error) {
            logger.error(error);
            oops = true;
          }

          // Try again
          if (oops) {
            try {
              const slug = generateRandomSlug();

              await updateSlug(user.id, slug, poolClient);
              updated++;
            } catch (error) {
              logger.error(error);
              problems++;
            }
          }
        }
      }

      if (poolClient) poolClient.release();

      return res.json({
        success: true,
        message: `${updated} user slugs were updated. ${problems} problems.`,
      });
    }
  );

router
  .route('/slugify-session-types')
  .post(
    [passport.authenticate('jwt', { session: false }), ADMINS_ONLY],
    async (req, res, next) => {
      const poolClient = await pool.connect();

      // Perform query
      const data = await runQuery(
        SQL`SELECT * FROM session_types WHERE slug IS NULL ORDER BY id ASC;`,
        null,
        null,
        poolClient
      );

      let updated = 0;
      let problems = 0;

      if (data && data.length > 0) {
        for (let i = 0; i < data.length; i++) {
          const sessionType = data[i];
          let oops = false;

          try {
            const slug = slugify(sessionType.name);

            await setSlug(sessionType.id, slug, poolClient);
            updated++;
          } catch (error) {
            logger.error(error);
            oops = true;
            problems++;
          }

          // Try again
          if (oops) {
            try {
              const slug = generateRandomSlug();

              await setSlug(sessionType.id, slug, poolClient);
              updated++;
            } catch (error) {
              logger.error(error);
              problems++;
            }
          }
        }
      }

      if (poolClient) poolClient.release();

      return res.json({
        success: true,
        message: `${updated} sessionType slugs were updated. ${problems} problems.`,
      });
    }
  );

export default router;
