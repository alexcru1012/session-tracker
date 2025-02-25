import express from 'express';
import passport from 'passport';
import async from 'async';
import validator from 'validator';
import SQL from 'sql-template-strings';
import moment from 'moment-timezone';
import * as Sentry from '@sentry/node';
import createError from 'http-errors';
import { OAuth2Client } from 'google-auth-library';

import pool from '@/postgres';
import logger from '@/logger';
import { OmitProps, Options, CacheKeys, HomeUrls } from '@/constants';
import {
  omit,
  runQuery,
  generateHash,
  sendMaskedError,
  sendBadRequest,
  isPasswordValid,
  generateJWTToken,
  generateRandomCode,
} from '@/helpers';
import {
  sendActivationEmail,
  sendForgotPasswordEmail,
  sendPasswordChangedEmail,
  sendWelcomeEmail,
  sendOTPasswordEmail,
} from '@/emails/auth';
import visitor from '@/analytics';
import {
  changePassword,
  bumpUpdatedAt,
  activateMe,
  deactivateMe,
  deletePassport,
  resetActivationToken,
} from '@/models/me';
import {
  requireSubscriptionTier,
  attachUserSubscription,
} from '@/helpers/userSubscriptions';
import { getUserByEmail, updateUserOTPassword } from '@/models/users';
import { deleteCachedData } from '@/redis/helpers';
import { bumpUsageForUser } from '@/mongo/helpers';

const router = express.Router();

const generateJWTAndUpdateUser = () => async (user, done) => {
  logger.info(`generateJWTAndUpdateUser, ${user && user.id}`);
  // Generate jwt token
  const token = generateJWTToken(user);

  let newUser;

  const poolClient = await pool.connect();

  try {
    // Update login timestamp
    newUser = await bumpUpdatedAt(user.id, poolClient);
    // Attach subscription
    newUser = await attachUserSubscription(user, poolClient);
    // Update usage stats
    bumpUsageForUser(user.id);
  } catch (error) {
    logger.error(`generateJWTAndUpdateUser error: ${error.stack || error}`);
    Sentry.captureException(error);

    // Keep going...
    // return done(error, user);
  }

  if (poolClient) poolClient.release();

  done(null, newUser || user, token);
};

const processNewUserActivationEmail = () => async (user, token, done) => {
  // Send activation email
  if (
    user &&
    user.email &&
    !user.is_activated &&
    (!user.activation_token ||
      !user.activation_token ||
      moment().isBefore(user.activation_token_expires))
  ) {
    try {
      const activationTokenExpires = moment().add(2, 'days').toISOString();
      const activationToken = await generateRandomCode();

      // Update activation_token
      user = await resetActivationToken(
        user.id,
        activationToken,
        activationTokenExpires
        // poolClient
      );
      sendActivationEmail(user.email, activationToken);

      return done(null, user, token);
    } catch (error) {
      logger.error(
        `processNewUserActivationEmail error: ${error.stack || error}`
      );
      Sentry.captureException(error);

      // Just continue...
      // done(
      //   error.message || 'There was a problem sending an activation email.',
      //   null
      // );
    }
  }

  return done(null, user, token);
};

// =====================================
// LOCAL ===============================
// =====================================

router
  .route('/login')
  // process the login form
  .post((req, res, next) => {
    const { email, password } = req.body;

    // Missing fields
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: 'Missing required input.' });
    }

    logger.info(`Local login: ${JSON.stringify(email)}`);

    visitor
      .event({
        ec: 'connect',
        ea: 'post /login',
        el: JSON.stringify({ email }),
      })
      .send();

    return async.waterfall(
      [
        done =>
          // Attempt passport authentication
          passport.authenticate('local-login', (err, user, info) => {
            // Some error happened
            if (err) {
              logger.error(`login error: ${err.stack || err}`);
              Sentry.captureException(err);

              return sendBadRequest(res, info || err, 401);
            }
            if (!user) return sendMaskedError(err, info || err, next);

            // Passport login
            return req.logIn(user, { session: false }, err2 => {
              if (err2) return sendMaskedError(err2, null, next);

              // Return successful user
              return done(null, user);
            });
          })(req, res, next),
        generateJWTAndUpdateUser(),
        processNewUserActivationEmail(),
      ],
      (err, user, token) => {
        if (err) {
          logger.error(`login error: ${err.stack || err}`);
          Sentry.captureException(err);

          return sendBadRequest(
            res,
            (err && err.message) || 'There was a problem logging in',
            401
          );
        }

        // if (!user.is_activated) {
        //   return res.json({
        //     success: true,
        //     message:
        //       'Account must be activated. Please click on the link sent to your email address.',
        //   });
        // }

        return res.json({
          success: true,
          message: 'Successfully logged in.',
          data: {
            me: omit(user, OmitProps.me),
            token: `${token}`,
          },
        });
      }
    );
  });

// =====================================
// SIGNUP ==============================
// =====================================

router
  .route('/signup')
  // process the signup form
  .post((req, res, next) => {
    const { name, email, industry, company, password, confirmPassword } =
      req.body;

    // Missing fields
    if (!name || !email || !password || !confirmPassword)
      return sendMaskedError(null, 'Missing required input.', next);

    logger.info(`Local signup: ${JSON.stringify(email)}`);
    visitor
      .event({
        ec: 'connect',
        ea: 'post /signup',
        el: JSON.stringify({ email }),
      })
      .send();

    return async.waterfall(
      [
        done => {
          // Attempt passport authentication
          passport.authenticate('local-signup', (err, user, info) => {
            // Some error happened
            if (err) return sendBadRequest(res, info || err, 401);
            if (!user) return sendMaskedError(err, info || err, next);

            // Passport login
            return req.logIn(user, { session: false }, err2 => {
              if (err2) return sendMaskedError(err2, null, next);

              // Return successful user
              return done(null, user);
            });
          })(req, res, next);
        },
        generateJWTAndUpdateUser(),
        processNewUserActivationEmail(),
      ],
      (err, user, token) => {
        if (err) {
          logger.error(`signup error: ${err.stack || err}`);
          Sentry.captureException(err);

          return sendBadRequest(
            res,
            err || 'There was a problem creating this account.',
            401
          );
        }

        return res.json({
          success: true,
          message:
            user && user.is_activated
              ? 'Successfully reconnected this account.'
              : 'Successfully signed up. Please check your email for an activation link.',
          // Send user info anyway...
          data: {
            me: omit(user, OmitProps.me),
            token: `${token}`,
          },
        });
      }
    );
  });

// disconnect local -----------------------------------
// router.get('/disconnect/local', [passport.authenticate('jwt', { session: false }), requireSubscriptionTier(1)], (req, res) => {
//     var authedUser = req.user
//
//     // for local account, remove email and password
//     authedUser.passport.local.email = null
//     authedUser.passport.local.password = null
//     authedUser.passport.local.connected = false
//
//     // If there are no other connected social accounts,
//     // remove all user content?
//
//     authedUser.save(function(err) {
//         if (err)
//             return sendMaskedError(err, null, next)
//
//         // Set session user
//         // req.session.user = authedUser._id
//
//         // Success
//         return res.redirect(process.env.HOME_BASE +'/activate?success=1&message='+ encodeURIComponent('Successfully disconnected your local account.'))
//         // return res.json({
//         //     success: true,
//         //     user: authedUser.toJSON()
//         // })
//     })
// })

// =====================================
// CONNECT LOCAL (update password) =====
// =====================================

router
  .route('/local')
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { password, confirmPassword, oldPassword } = req.body;

      logger.info(`Update my password: (${user.id})`);

      if (!user || !user.is_activated) return next(createError(401));

      const oldPasswordInput = oldPassword ? validator.escape(oldPassword) : '';
      const passwordInput = password ? validator.escape(password) : '';
      const confirmPasswordInput = confirmPassword
        ? validator.escape(confirmPassword)
        : '';

      // Missing fields (allow empty oldPassword incase user never had one)
      if (!passwordInput || !confirmPasswordInput)
        // || !oldPasswordInput
        return sendMaskedError(null, 'Missing required input.', next);

      // Validate Password length
      if (!validator.isLength(password, { min: 6, max: 100 }))
        return sendBadRequest(res, 'Invalid password input.', 401);

      // Password confirm check
      if (!validator.equals(password, confirmPassword))
        return sendBadRequest(res, 'Passwords do not match.', 401);

      // Invalid password
      if (user.password && !isPasswordValid(oldPasswordInput, user.password))
        return sendBadRequest(res, 'Old password is incorrect.', 401);

      // Using same password
      if (user.password && isPasswordValid(passwordInput, user.password))
        return sendBadRequest(res, 'Cannot use the same password.', 401);

      const poolClient = await pool.connect();

      try {
        const result = await changePassword(user.id, passwordInput, poolClient);

        deleteCachedData(CacheKeys.getPassports(user.id));

        if (poolClient) poolClient.release();

        if (result) {
          return res.json({
            success: true,
            message: 'Password successfully updated.',
            // no data, force user to login to fetch new data
          });
        }
      } catch (error) {
        logger.error(`connect-local error: ${error.stack || error}`);
        Sentry.captureException(error);

        if (poolClient) poolClient.release();

        // continue
        return sendMaskedError(
          error,
          'There was a problem updating this password.',
          next
        );
      }
    }
  );

// =====================================
// APPLE ===============================
// =====================================

// Apple doesn't use the typical token-based authentication with passport
// Credentials are generated on the front-end and passed to server

router
  .route('/apple-login')
  // process the signup form
  .post(async (req, res, next) => {
    const { credentials } = req.body;

    // Missing fields
    if (!credentials)
      return sendMaskedError(null, 'Missing required input.', next);

    logger.info('Apple login');
    visitor
      .event({
        ec: 'connect',
        ea: 'post /apple-login',
      })
      .send();

    let { email } = credentials;
    const {
      user: appleUserId,
      fullName,
      identityToken,
      authorizationCode,
    } = credentials;
    const { givenName = '', familyName = '' } = fullName || {};
    const name = `${givenName} ${familyName}`;

    // console.log('credentials', credentials);
    // console.log('appleUserId', appleUserId);

    // identityToken is a JWT that needs to be verified by
    // some apple public_key... (https://appleid.apple.com/auth/keys)
    // jwt.verify(identityToken, publicKey);

    // Connect to pool to handle transaction (no need to try/catch here)
    const poolClient = await pool.connect();

    let existingPassport;
    let existingUser;

    try {
      // Find user
      if (email) {
        existingUser = await getUserByEmail(
          String(email).toLowerCase(),
          poolClient
        );
      }

      // Find passport
      const pRows = await runQuery(
        SQL`SELECT * FROM apple_passports WHERE apple_id = ${appleUserId};`,
        null,
        null,
        poolClient
      );

      if (pRows && pRows.length) existingPassport = pRows[0];
      // else {
      //   // identityToken was tracked as apple_id but was renamed to apple_id_token
      //   // TODO remove this eventually...
      //   pRows = await runQuery(
      //     SQL`SELECT * FROM apple_passports WHERE apple_id_token = ${identityToken};`,
      //     null,
      //     null,
      //     poolClient
      //   );

      //   if (pRows && pRows.length) existingPassport = pRows[0];
      // }

      // Email was not provided by apple but we can find user
      if (!email && existingPassport) {
        logger.info('no email from apple');

        const uRows = await runQuery(
          SQL`SELECT * FROM users WHERE id = ${existingPassport.user_id};`,
          null,
          null,
          poolClient
        );

        if (uRows && uRows.length) {
          logger.info('found user via apple passport');
          existingUser = uRows[0];
          email = existingUser.email; // eslint-disable-line
        }
      }
    } catch (error) {
      // No passport
      logger.error(`Apple login error: ${error.stack || error}`);
    }

    // console.log('existingUser', existingUser);
    // console.log('existingPassport', existingPassport);

    let user = existingUser;
    let _passport = existingPassport; // eslint-disable-line

    logger.info(`existingUser: ${existingUser && existingUser.id}`);
    logger.info(`existingPassport: ${existingPassport && existingPassport.id}`);

    if (!user || !_passport) {
      const handleRollback = async () => {
        // Rollback transaction
        await poolClient.query('ROLLBACK');
        // Release client
        if (poolClient) poolClient.release();
      };

      // Begin transaction
      await poolClient.query('BEGIN');

      // For multiple inserts
      const createdAt = moment().toISOString();

      // Create a new user
      if (!user && email) {
        logger.info('Create new user from Apple login');

        // Need an activation token
        const activationTokenExpires = moment().add(2, 'days').toISOString();
        const activationToken = await generateRandomCode();

        if (!activationToken) {
          handleRollback();

          return sendMaskedError(
            null,
            'There was a problem generating an activation token.',
            next
          );
        }

        try {
          const result = await poolClient.query(SQL`
              INSERT INTO users (email, name, activation_token, activation_token_expires, created_at, updated_at, last_login_at)
              VALUES (${String(email).toLowerCase()}, ${name},
                ${activationToken}, ${activationTokenExpires},
                ${createdAt}, ${createdAt}, ${createdAt})
              RETURNING *;
            `);

          if (result && result.rows && result.rows.length)
            user = result.rows[0];
        } catch (error) {
          logger.error(`apple login error: ${error.stack || error}`);
          handleRollback();

          return sendMaskedError(
            null,
            'A user already exists with that email address.',
            next
          );
        }
      }

      // console.log('user', user);

      if (!user) {
        handleRollback();

        return sendMaskedError(
          null,
          'There was a problem creating a new user.',
          next
        );
      }

      // Find OTHER passport (apple may send multiple idTokens)
      // try {
      //   const pRows = await runQuery(
      //     SQL`SELECT * FROM apple_passports WHERE user_id = ${user.id};`,null, null, poolClient
      //   );

      //   if (pRows && pRows.length) _passport = pRows[0];

      //   // Update apple_passport with new idToken
      //   const result = await poolClient.query(SQL`
      //     UPDATE apple_passports
      //       SET
      //         apple_id = ${appleUserId}
      //         apple_id_token = ${identityToken}
      //       WHERE user_id = ${user.id}
      //       RETURNING *;
      //   `);

      //   if (result && result.length) _passport = result[0];
      // } catch (error) {
      //   logger.error(`apple login error: ${error.stack || error}`);
      //   handleRollback();

      //   return sendMaskedError(
      //     null,
      //     'There was a problem connecting with Apple id.',
      //     next
      //   );
      // }

      // Create new passport
      if (!_passport) {
        try {
          // Try once more (with userId)...
          const pRows = await runQuery(
            SQL`SELECT * FROM apple_passports WHERE user_id = ${user.id};`,
            null,
            null,
            poolClient
          );

          if (pRows && pRows.length) _passport = pRows[0];

          // Ok, create...
          if (!_passport) {
            logger.info('Create New Passport via Apple login');

            const result = await poolClient.query(SQL`
                INSERT INTO apple_passports (user_id, apple_id, apple_id_token, authorization_code, connected, created_at, updated_at)
                VALUES (${user.id}, ${appleUserId}, ${identityToken}, ${authorizationCode}, true, ${createdAt}, ${createdAt})
                RETURNING *;
              `);

            if (result && result.rows && result.rows.length)
              _passport = result.rows[0];
          }
        } catch (error) {
          logger.error(`apple login error: ${error.stack || error}`);
          handleRollback();

          return sendMaskedError(
            error,
            'There was a problem connecting with Apple.',
            next
          );
        }
      } else if (
        (_passport && _passport.apple_id !== appleUserId) ||
        _passport.apple_id_token !== identityToken
      ) {
        // Update apple passport to ensure appleUserId is saved
        const result = await poolClient.query(SQL`
          UPDATE apple_passports
            SET
              apple_id = ${appleUserId}
              apple_id_token = ${identityToken}
            WHERE user_id = ${user.id}
            RETURNING *;
        `);

        // if (result && result.length) _passport = result[0];
        if (result && result.rows?.length) _passport = result.rows[0];
      }

      if (!_passport) {
        handleRollback();

        return sendMaskedError(
          null,
          'There was a problem connecting new user to Apple.',
          next
        );
      }

      try {
        // Commit transaction
        await poolClient.query('COMMIT');
      } catch (error) {
        logger.error(`apple login error: ${error.stack || error}`);
        handleRollback();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem handling this transaction.',
          next
        );
      }
    }

    // Release client
    if (poolClient) poolClient.release();

    // Passport login
    try {
      await req.logIn(user, { session: false });
    } catch (err) {
      logger.error(err);
    }

    deleteCachedData(CacheKeys.getPassports(user.id));

    return async.waterfall(
      [
        done => {
          done(null, user);
        },
        generateJWTAndUpdateUser(),
        processNewUserActivationEmail(),
      ],
      (err, _user, token) => {
        if (err) return sendMaskedError(err, null, next);

        return res.json({
          success: true,
          message: 'Successfully logged in.',
          data: {
            me: omit(_user, OmitProps.me),
            token: `${token}`,
          },
        });
      }
    );
  });

router.post(
  '/apple-disconnect',
  [
    passport.authenticate('jwt', { session: false }),
    requireSubscriptionTier(1),
  ],
  (req, res) => {
    const { user } = req;

    logger.info(`Disconnect apple (${user.id})`);
    visitor
      .event({
        ec: 'connect',
        ea: 'get /apple-disconnect',
      })
      .send();

    const rows = deletePassport(user.id, 'apple');

    deleteCachedData(CacheKeys.getPassports(user.id));

    return res.json({
      success: true,
      data: {
        rows,
      },
    });
  }
);

// =====================================
// FACEBOOK COMMON =====================
// =====================================

const doFacebookLogin = async credentials => {
  const { facebookId, accessToken, email, name, photoURL } = credentials;

  let existingPassport;
  let existingUser;

  logger.info('Handle Facebook login');

  // Connect to pool to handle transaction (no need to try/catch here)
  const poolClient = await pool.connect();

  try {
    // Find user
    existingUser = await getUserByEmail(
      String(email).toLowerCase(),
      poolClient
    );

    // Find passport
    const pRows = await runQuery(
      SQL`SELECT * FROM facebook_passports WHERE facebook_id = ${facebookId};`,
      null,
      null,
      poolClient
    );

    if (pRows && pRows.length) existingPassport = pRows[0];
  } catch (error) {
    // No passport
    logger.error(`Facebook login error: ${error.stack || error}`);
  }

  let user = existingUser;
  let passport = existingPassport; // eslint-disable-line

  if (!user || !passport) {
    const handleRollback = async () => {
      // Rollback transaction
      await poolClient.query('ROLLBACK');
      // Release client
      if (poolClient) poolClient.release();
    };

    // Begin transaction
    await poolClient.query('BEGIN');

    // For multiple inserts
    const createdAt = moment().toISOString();

    // Create a new user
    if (!user) {
      logger.info('Create New User via Facebook login');

      // Need an activation token
      const activationTokenExpires = moment().add(2, 'days').toISOString();
      const activationToken = await generateRandomCode();
      if (!activationToken)
        throw new Error('There was a problem generating an activation token.');

      try {
        const result = await poolClient.query(SQL`
          INSERT INTO users (email, name, avatar, activation_token, activation_token_expires, created_at, updated_at, last_login_at)
          VALUES (${email}, ${name}, ${photoURL},
            ${activationToken}, ${activationTokenExpires},
            ${createdAt}, ${createdAt}, ${createdAt})
          RETURNING *;
        `);

        if (result && result.rows && result.rows.length) user = result[0];
      } catch (error) {
        logger.error(`Facebook login error: ${error.stack || error}`);
        handleRollback();

        throw error;
      }
    }

    if (!user) {
      handleRollback();

      throw new Error('There was a problem creating a new user.');
    }

    // Create new passport
    if (!passport) {
      try {
        // Try once more (by userId)...
        const pRows = await runQuery(
          SQL`SELECT * FROM facebook_passports WHERE user_id = ${user.id};`,
          null,
          null,
          poolClient
        );

        if (pRows && pRows.length) passport = pRows[0];

        // Ok, create...
        if (!passport) {
          logger.info('Create New Passport via Facebook login');

          const result = await poolClient.query(SQL`
            INSERT INTO facebook_passports (user_id, facebook_id, access_token, refresh_token, connected, created_at, updated_at)
            VALUES (${
              user.id
            }, ${facebookId}, ${accessToken}, ${null}, true, ${createdAt}, ${createdAt})
            RETURNING *;
          `);

          if (result && result.rows && result.rows.length)
            passport = result.rows[0];
        }
      } catch (error) {
        logger.error(`Facebook login error: ${error.stack || error}`);
        handleRollback();

        throw error;
      }
    }

    if (!passport) {
      handleRollback();

      throw new Error('There was a problem connecting new user to Facebook.');
    }

    try {
      // Commit transaction
      await poolClient.query('COMMIT');
    } catch (error) {
      logger.error(`Facebook login error: ${error.stack || error}`);
      handleRollback();

      throw error;
    }
  }

  // Release client
  if (poolClient) poolClient.release();

  deleteCachedData(CacheKeys.getPassports(user.id));

  return { user, facebookPassport: passport };
};

// =====================================
// FACEBOOK WEB ========================
// =====================================

router
  .route('/facebook')
  // process the signup form
  .post(async (req, res, next) => {
    const { credentials } = req.body;

    // Missing fields
    if (!credentials)
      return sendMaskedError(null, 'Missing required input.', next);

    logger.info('Facebook Web login');
    visitor
      .event({
        ec: 'connect',
        ea: 'post /facebook',
      })
      .send();

    const { facebookId, email } = credentials;

    if (!facebookId || !email) {
      return sendBadRequest(
        res,
        'Email address was not provided by Facebook but is required for signup. Please visit your "Facebook ID Logins" settings to remove this app, then try again.'
      );
    }

    let user;
    let facebookPassport;

    try {
      const result = await doFacebookLogin(credentials);

      // console.log('result', result);

      if (result) {
        user = result.user; // eslint-disable-line
        facebookPassport = result.facebookPassport; // eslint-disable-line
      }
    } catch (error) {
      return sendMaskedError(
        error,
        'There was a problem connecting to Facebook.',
        next
      );
    }

    if (!user || !facebookPassport)
      return sendBadRequest(res, 'There was a problem connecting to Facebook.');

    // Passport login
    try {
      await req.logIn(user, { session: false });
    } catch (err) {
      logger.error(err);
    }

    deleteCachedData(CacheKeys.getPassports(user.id));

    return async.waterfall(
      [
        done => {
          done(null, user);
        },
        generateJWTAndUpdateUser(),
        processNewUserActivationEmail(),
      ],
      (err, _user, token) => {
        if (err) return sendMaskedError(err, null, next);

        return res.json({
          success: true,
          message: 'Successfully logged in with Facebook.',
          data: {
            me: omit(_user, OmitProps.me),
            token: `${token}`,
          },
        });
      }
    );
  });

// =====================================
// FACEBOOK MOBILE =====================
// =====================================

router
  .route('/facebook-login')
  // process the signup form
  .post((req, res, next) => {
    const { access_token } = req.body;

    // Missing fields
    if (!access_token)
      return sendMaskedError(null, 'Missing required input.', next);

    logger.info('Facebook Mobile login');
    visitor
      .event({
        ec: 'connect',
        ea: 'post /facebook-login',
      })
      .send();

    return async.waterfall(
      [
        done => {
          // Attempt passport authentication
          passport.authenticate('facebook-token', (err, user, info) => {
            // Some error happened
            if (err) return sendBadRequest(res, info || err, 401);
            if (!user) return sendMaskedError(err, info || err, next);

            // Passport login
            return req.logIn(user, { session: false }, err2 => {
              if (err2) return sendMaskedError(err2, null, next);

              // Return successful user
              return done(null, user);
            });
          })(req, res, next);
        },
        generateJWTAndUpdateUser(),
        processNewUserActivationEmail(),
      ],
      (err, user, token) => {
        if (err) return sendMaskedError(err, null, next);

        return res.json({
          success: true,
          message: 'Successfully logged in.',
          data: {
            me: omit(user, OmitProps.me),
            token: `${token}`,
          },
        });
      }
    );
  });

router.post(
  '/facebook-disconnect',
  [
    passport.authenticate('jwt', { session: false }),
    requireSubscriptionTier(1),
  ],
  (req, res) => {
    const { user } = req;

    logger.info(`Disconnect Facebook (${user.id})`);
    visitor
      .event({
        ec: 'connect',
        ea: 'get /facebook-disconnect',
      })
      .send();

    const rows = deletePassport(user.id, 'facebook');

    deleteCachedData(CacheKeys.getPassports(user.id));

    return res.json({
      success: true,
      data: {
        rows,
      },
    });
  }
);

// =====================================
// GOOGLE COMMON =======================
// =====================================

const doGoogleLogin = async credentials => {
  const {
    idToken,
    accessToken,
    refreshToken,
    googleId,
    email,
    displayName,
    photoURL,
  } = credentials;

  let existingPassport;
  let existingUser;

  logger.info('Handle Google login');

  // Verify credentials with google
  const client = new OAuth2Client(process.env.GOOGLE_APP_ID);
  const audience = [
    process.env.GOOGLE_WEB_APP_ID,
    process.env.GOOGLE_IOS_PROD_APP_ID,
    process.env.GOOGLE_IOS_DEV_APP_ID,
    process.env.GOOGLE_ANDROID_DEV_APP_ID,
    process.env.GOOGLE_ANDROID_PROD_APP_ID,
  ];

  // https://developers.google.com/identity/sign-in/web/backend-auth
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      // CLIENT_IDs of the apps that access the backend
      audience,
    });
    const payload = ticket.getPayload();
    const { aud, sub } = payload;
    // Aud claim
    if (!audience.includes(aud)) {
      logger.error('malicious app alert?', payload);

      throw new Error('Invalid Google verification.');
    }

    // Success, sub is the verified users google id
    if (googleId !== sub) throw new Error('Verification with Google failed.');
  } catch (error) {
    logger.error(error);
    Sentry.captureException(error);

    throw error;
  }

  // Connect to pool to handle transaction (no need to try/catch here)
  const poolClient = await pool.connect();

  try {
    // Find user
    existingUser = await getUserByEmail(
      String(email).toLowerCase(),
      poolClient
    );

    // Find passport
    const pRows = await runQuery(
      SQL`SELECT * FROM google_passports WHERE google_id = ${googleId};`,
      null,
      null,
      poolClient
    );

    if (pRows && pRows.length) existingPassport = pRows[0];
  } catch (error) {
    // No passport
    logger.error(`Google login warning: ${error.stack || error}`);
  }

  let user = existingUser;
  let passport = existingPassport; // eslint-disable-line

  if (!user || !passport) {
    const handleRollback = async () => {
      // Rollback transaction
      await poolClient.query('ROLLBACK');
      // Release client
      poolClient.release();
    };

    // Begin transaction
    await poolClient.query('BEGIN');

    // For multiple inserts
    const createdAt = moment().toISOString();

    // Create a new user
    if (!user) {
      logger.info('Create New User via Google login');

      // Need an activation token
      const activationTokenExpires = moment().add(2, 'days').toISOString();
      const activationToken = await generateRandomCode();
      if (!activationToken)
        throw new Error('There was a problem generating an activation token.');

      try {
        const result = await poolClient.query(SQL`
          INSERT INTO users (email, name, avatar, activation_token, activation_token_expires, created_at, updated_at, last_login_at)
          VALUES (${String(email).toLowerCase()}, ${displayName}, ${photoURL},
            ${activationToken}, ${activationTokenExpires},
            ${createdAt}, ${createdAt}, ${createdAt})
          RETURNING *;
        `);

        if (result && result.rows && result.rows.length) user = result.rows[0];
      } catch (error) {
        logger.error(`Google login error: ${error.stack || error}`);
        handleRollback();

        throw error;
      }
    }

    if (!user) {
      handleRollback();

      throw new Error('There was a problem creating a new user.');
    }

    // Create new passport
    if (!passport) {
      try {
        // Try once more (with userId)...
        const pRows = await runQuery(
          SQL`SELECT * FROM google_passports WHERE user_id = ${user.id};`,
          null,
          null,
          poolClient
        );

        if (pRows && pRows.length) passport = pRows[0];

        // Ok, create...
        if (!passport) {
          logger.info('Create New Passport via Google login');

          const result = await poolClient.query(SQL`
            INSERT INTO google_passports (user_id, google_id, access_token, refresh_token, connected, created_at, updated_at)
            VALUES (${user.id}, ${googleId}, ${accessToken}, ${refreshToken}, true, ${createdAt}, ${createdAt})
            RETURNING *;
          `);

          if (result && result.rows && result.rows.length)
            passport = result.rows[0];
        }
      } catch (error) {
        logger.error(`Google login error: ${error.stack || error}`);
        handleRollback();

        throw error;
      }
    }

    if (!passport) {
      handleRollback();

      throw new Error('There was a problem connecting new user to Google.');
    }

    try {
      // Commit transaction
      await poolClient.query('COMMIT');
    } catch (error) {
      logger.error(`Google login error: ${error.stack || error}`);
      handleRollback();

      throw error;
    }
  }

  deleteCachedData(CacheKeys.getPassports(user.id));

  // Release client
  poolClient.release();

  return { user, googlePassport: passport };
};

// =====================================
// GOOGLE WEB ==========================
// =====================================

router.route('/google').post(async (req, res, next) => {
  const { credentials } = req.body;

  // Missing fields
  if (!credentials)
    return sendMaskedError(null, 'Missing required input.', next);

  logger.info('Google Web login');
  visitor
    .event({
      ec: 'connect',
      ea: 'post /google',
    })
    .send();

  const { googleId, email } = credentials;

  if (!googleId || !email) {
    return sendBadRequest(
      res,
      'Email address was not provided by Google but is required for signup. Please visit your "Google ID Logins" settings to remove this app, then try again.'
    );
  }

  let user;
  let googlePassport;

  try {
    const result = await doGoogleLogin(credentials);

    // console.log('result', result);

    if (result) {
      user = result.user; // eslint-disable-line
      googlePassport = result.googlePassport; // eslint-disable-line
    }
  } catch (error) {
    return sendMaskedError(
      error,
      '0. There was a problem connecting to Google.',
      next
    );
  }

  if (!user || !googlePassport)
    return sendBadRequest(res, '1. There was a problem connecting to Google.');

  // Passport login
  try {
    await req.logIn(user, { session: false });
  } catch (err) {
    logger.error(err);
  }

  return async.waterfall(
    [
      done => {
        done(null, user);
      },
      generateJWTAndUpdateUser(),
      processNewUserActivationEmail(),
    ],
    (err, _user, token) => {
      if (err) return sendMaskedError(err, null, next);

      return res.json({
        success: true,
        message: 'Successfully logged in with Google.',
        data: {
          me: omit(_user, OmitProps.me),
          token: `${token}`,
        },
      });
    }
  );
});

// =====================================
// GOOGLE MOBILE =======================
// =====================================

router
  .route('/google-login')
  // process the signup form
  .post(async (req, res, next) => {
    const { credentials } = req.body;

    // Missing fields
    if (!credentials)
      return sendMaskedError(null, 'Missing required input.', next);

    logger.info('Google Mobile login');
    visitor
      .event({
        ec: 'connect',
        ea: 'post /google-login',
      })
      .send();

    const {
      type,
      accessToken,
      idToken,
      refreshToken,
      user: googleUser,
    } = credentials;

    const { id: googleId, name: displayName, email, photoURL } = googleUser;

    // console.log(JSON.stringify(credentials));

    if (type !== 'success')
      return sendMaskedError(null, 'Google auth not successful.', next);

    if (!googleId || !email) {
      return sendBadRequest(
        res,
        'Email address was not provided by Google but is required for signup. Please visit your "Google ID Logins" settings to remove this app, then try again.'
      );
    }

    // logger.info(`logging Google login... ${type}, ${googleId}, ${name}`);

    let user;
    let googlePassport;

    try {
      const result = await doGoogleLogin({
        idToken,
        accessToken,
        refreshToken,
        email,
        googleId,
        displayName,
        photoURL,
      });

      user = result.user; // eslint-disable-line
      googlePassport = result.googlePassport; // eslint-disable-line
    } catch (error) {
      return sendMaskedError(
        error,
        '2. There was a problem connecting to Google.',
        next
      );
    }

    // Passport login
    try {
      await req.logIn(user, { session: false });
    } catch (err) {
      logger.error(err);
    }

    return async.waterfall(
      [
        done => {
          done(null, user);
        },
        generateJWTAndUpdateUser(),
        processNewUserActivationEmail(),
      ],
      (err, _user, token) => {
        if (err) return sendMaskedError(err, null, next);

        return res.json({
          success: true,
          message: 'Successfully logged in with Google.',
          data: {
            me: omit(user, OmitProps.me),
            token: `${token}`,
          },
        });
      }
    );
  });

router.post(
  '/google-disconnect',
  [
    passport.authenticate('jwt', { session: false }),
    requireSubscriptionTier(1),
  ],
  (req, res) => {
    const { user } = req;

    logger.info(`Disconnect Google (${user.id})`);
    visitor
      .event({
        ec: 'connect',
        ea: 'get /google-disconnect',
      })
      .send();

    const rows = deletePassport(user.id, 'google');

    deleteCachedData(CacheKeys.getPassports(user.id));

    return res.json({
      success: true,
      data: {
        rows,
      },
    });
  }
);

// =====================================
// LOGOUT ==============================
// =====================================

router.get(
  '/logout',
  [
    passport.authenticate('jwt', { session: false }),
    requireSubscriptionTier(1),
  ],
  (req, res) => {
    // Passport Logout
    req.logout();
    visitor
      .event({
        ec: 'connect',
        ea: 'get /logout',
      })
      .send();

    // Success
    return res.json({
      success: true,
    });
  }
);

// =====================================
// ACTIVATE ACCOUNT =-==================
// =====================================

router.route('/activate').get(
  // [passport.authenticate('jwt', { session: false }), requireSubscriptionTier(1)],
  async (req, res, next) => {
    const { user } = req;
    const { token } = req.query;

    logger.info(`Activate account (${user?.id})`);

    // Already activated
    if (user && user.is_activated) return next(createError(401));
    // Missing token
    if (!token) return sendBadRequest(res, 'Missing required input', 401);

    // Find user
    let rows;
    const poolClient = await pool.connect();

    try {
      rows = await runQuery(
        SQL`
          SELECT *
          FROM users
          WHERE activation_token = ${token}
          AND activation_token_expires >= ${moment().toISOString()}
      `,
        null,
        null,
        poolClient
      );
    } catch (error) {
      logger.error(`activate error: ${error.stack || error}`);
      Sentry.captureException(error);

      if (poolClient) poolClient.release();

      return res.redirect(
        `${HomeUrls.activate}/?success=0&message=${encodeURIComponent(
          'Activation link is invalid or has expired. Please try signing up again.'
        )}`
      );
    }

    const existingUser = rows && rows.length ? rows[0] : null;

    // What are you trying to pull here?
    if (user && existingUser && existingUser.id !== user.id) {
      if (poolClient) poolClient.release();

      return next(createError(401));
    }

    if (!existingUser) {
      if (poolClient) poolClient.release();

      return res.redirect(
        `${HomeUrls.activate}/?success=0&message=${encodeURIComponent(
          'Activation link is invalid or has expired. Please try signing up again.'
        )}`
      );
    }

    // Ok.
    try {
      await activateMe(existingUser.id, poolClient);
    } catch (error) {
      logger.error(`activate error: ${error.stack || error}`);
      Sentry.captureException(error);

      if (poolClient) poolClient.release();

      return res.redirect(
        `${HomeUrls.activate}/?success=0&message=${encodeURIComponent(
          'There was a problem activating this user. Please try again soon.'
        )}`
      );
    }

    if (poolClient) poolClient.release();

    // Send email (await?)
    try {
      await sendWelcomeEmail(existingUser.email, {
        name: existingUser.name,
        email: existingUser.email,
      });
    } catch (error) {
      logger.error(`activate error: ${error.stack || error}`);
      Sentry.captureException(error);
    }

    // const jwtToken = generateJWTToken(existingUser);

    // Passport login
    return req.logIn(existingUser, { session: false }, async err => {
      if (err) {
        logger.error(`activate error: ${err.stack || err}`);

        return res.redirect(
          `${HomeUrls.activate}/?success=0&message=${encodeURIComponent(
            'There was a problem logging in this user.'
          )}`
        );
      }

      // Return success message and token
      // &token=${encodeURIComponent(jwtToken)}
      return res.redirect(
        `${HomeUrls.activate}/?success=1&message=${encodeURIComponent(
          'Account successfully activated.'
        )}`
      );
    });
  }
);

// =====================================
// FORGOT LOCAL PASS ===================
// =====================================

router
  .route('/forgot-password')
  // Process the forgot password form
  .post(async (req, res, next) => {
    // Missing fields check
    if (!req.body.email)
      return sendMaskedError(null, 'Missing required input.', next);

    const email = validator.escape(req.body.email);

    logger.info(`Forgot password for ${email}`);
    visitor
      .event({
        ec: 'connect',
        ea: 'post /forgot-password',
      })
      .send();

    // Generate token
    const resetPasswordToken = await generateRandomCode(4);
    const poolClient = await pool.connect();

    return async.waterfall(
      [
        done => {
          // Find user
          runQuery(
            SQL`SELECT * FROM users WHERE email ILIKE ${email};`,
            null,
            null,
            poolClient
          )
            .then(rows => {
              const user = rows[0];

              if (!user) {
                return sendMaskedError(
                  null,
                  'No account was found with that email address.',
                  next
                );
              }

              // Return successful user
              return done(null, user);
            })
            .catch(error => {
              logger.error(`forgot-pass error: ${error.stack || error}`);

              if (poolClient) poolClient.release();

              return sendMaskedError(error, null, next);
            });
        },
        (user, done) => {
          const resetPasswordExpires = moment()
            .add(Options.resetPasswordExpiresInD, 'hours')
            .toISOString();

          // Update user
          runQuery(
            SQL`
            UPDATE users
            SET
              reset_password_token = ${resetPasswordToken},
              reset_password_expires = ${resetPasswordExpires}
              WHERE id = ${user.id}
              RETURNING *;
              `,
            null,
            null,
            poolClient
          )
            .then(rows => done(null, rows && rows.length ? rows[0] : user))
            .catch(error => {
              logger.error(`forgot-pass error: ${error.stack || error}`);
              if (poolClient) poolClient.release();

              return sendMaskedError(error, null, next);
            });
        },
        (user, done) => {
          try {
            sendForgotPasswordEmail(
              user.email,
              user.name,
              resetPasswordToken
            ).then(() => {
              // complete
              done(null, user);
            });
          } catch (error) {
            logger.error(`forgot-pass error: ${error.stack || error}`);
            Sentry.captureException(error);

            if (poolClient) poolClient.release();

            done(error);
          }
        },
      ],
      (err, user) => {
        if (err) {
          logger.error(`forgot-pass error: ${err.stack || err}`);
          if (poolClient) poolClient.release();

          return sendMaskedError(err, null, next);
        }

        if (poolClient) poolClient.release();

        return res.json({
          success: true,
          message: `A reset token has been sent to ${user.email}.`,
        });
      }
    );
  });

// =====================================
// LOCAL PASSWORD RESET ================
// =====================================

router
  .route('/reset-password') // ?token=foo
  // Check validity of password reset token
  .get(async (req, res, next) => {
    // Missing fields check
    if (!req.query.token)
      return sendMaskedError(null, 'Missing token query string.', next);

    const resetPasswordToken = validator.escape(req.query.token);

    logger.info('Check reset password status');
    visitor
      .event({
        ec: 'connect',
        ea: 'get /reset-password',
      })
      .send();

    const poolClient = await pool.connect();

    // Find user
    try {
      const rows = await runQuery(
        SQL`SELECT * FROM users WHERE reset_password_token ILIKE ${resetPasswordToken};`,
        null,
        null,
        poolClient
      );

      const user = rows && rows.length ? rows[0] : null;

      if (rows.length > 1)
        logger.error('WOAH! resetPasswordToken was found on multiple users?!');

      if (!user) {
        if (poolClient) poolClient.release();

        return sendMaskedError(
          null,
          'No account was found that matches this request.',
          next
        );
      }

      // Token expired?
      if (
        !user.reset_password_expires ||
        moment(user.reset_password_expires).isBefore(moment())
      ) {
        if (poolClient) poolClient.release();

        return sendMaskedError(
          null,
          'Password reset token is invalid or has expired.',
          next
        );
      }

      if (poolClient) poolClient.release();

      // Token is valid.
      return res.json({ success: true });
    } catch (error) {
      logger.error(`reset-pass error: ${error.stack || error}`);
      if (poolClient) poolClient.release();

      return sendMaskedError(error, null, next);
    }
  })
  // Process password reset form
  .post(async (req, res, next) => {
    const {
      email: _email,
      password: _password,
      confirmPassword: _confirmPassword,
      token: _token,
    } = req.body;
    // Missing fields check
    if (!_email || !_password || !_confirmPassword || !_token)
      return sendMaskedError(null, 'Missing required input.', next);

    // Get input
    const email = validator.escape(_email);
    const password = validator.escape(_password);
    const confirmPassword = validator.escape(_confirmPassword);
    const resetPasswordToken = validator.escape(_token);

    logger.info('Process password reset');
    visitor
      .event({
        ec: 'connect',
        ea: 'post /reset-password',
      })
      .send();

    // Validate email input
    if (!validator.isEmail(email))
      return sendMaskedError(null, 'Invalid email input.', next);

    // Validate Password length
    if (!validator.isLength(password, { min: 6, max: 100 }))
      return sendMaskedError(null, 'Invalid password.', next);

    // Password confirm check
    if (!validator.equals(password, confirmPassword))
      return sendMaskedError(null, 'Passwords do not match.', next);

    const poolClient = await pool.connect();

    return async.waterfall(
      [
        done => {
          // Find user
          runQuery(
            SQL`
            SELECT * FROM users
            WHERE email = ${email}
            AND reset_password_token ILIKE ${resetPasswordToken};
          `,
            null,
            null,
            poolClient
          )
            .then(rows => {
              const user = rows[0];

              if (rows.length > 1) {
                logger.error(
                  'WOAH! resetPasswordToken was found on multiple users?!'
                );
              }

              if (!user) {
                if (poolClient) poolClient.release();

                return sendMaskedError(
                  null,
                  'No account was found that matches this request.',
                  next
                );
              }

              // Token expired?
              if (
                !user.reset_password_expires ||
                moment(user.reset_password_expires).isBefore(moment())
              ) {
                if (poolClient) poolClient.release();

                return sendMaskedError(
                  null,
                  'Password reset token is invalid or has expired.',
                  next
                );
              }

              // Return successful user
              return done(null, user);
            })
            .catch(error => {
              logger.error(`reset-pass error: ${error.stack || error}`);
              if (poolClient) poolClient.release();

              return sendMaskedError(error, null, next);
            });
        },
        (user, done) => {
          // Update user (and activate them since they successfully received an email)
          runQuery(
            SQL`
            UPDATE users
            SET
            password = ${generateHash(password)},
            is_activated = true,
            reset_password_token = NULL,
            reset_password_expires = NULL
            WHERE id = ${user.id};
            `,
            null,
            null,
            poolClient
          )
            .then(rows => done(null, user))
            .catch(error => {
              logger.error(`reset-pass error: ${error.stack || error}`);
              if (poolClient) poolClient.release();

              return sendMaskedError(error, null, next);
            });
        },
        (user, done) => {
          try {
            sendPasswordChangedEmail(user.email, user.name).then(() => {
              // complete
              done(null, user);
            });
          } catch (error) {
            logger.error(`reset-pass error: ${error.stack || error}`);
            Sentry.captureException(error);
            if (poolClient) poolClient.release();

            done(error);
          }
        },
      ],
      (error, user) => {
        if (error) {
          logger.error(`reset-pass error: ${error.stack || error}`);
          if (poolClient) poolClient.release();

          return sendMaskedError(error, null, next);
        }

        if (poolClient) poolClient.release();
        deleteCachedData(CacheKeys.getPassports(user?.id));

        return res.json({
          success: true,
          message: 'Success! Your password has been changed.',
        });
      }
    );
  });

// =====================================
// Close Account =======================
// =====================================
router
  .route('/close-account')
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Close account (${user.id})`);

      // Missing fields check
      if (!req.body.password)
        return sendMaskedError(null, 'Missing required input.', next);

      // Get input
      const password = validator.escape(req.body.password);
      // Validate Password length
      if (!validator.isLength(password, { min: 6, max: 100 }))
        return sendMaskedError(null, 'Invalid password.', next);
      // Password confirm check
      if (!isPasswordValid(password, user.password))
        return sendMaskedError(null, 'Incorrect password.', next);

      const poolClient = await pool.connect();

      try {
        // Skip if user is already inactive
        if (user.is_active) await deactivateMe(user.id, poolClient);
      } catch (error) {
        logger.error(`close-account error: ${error.stack || error}`);
        Sentry.captureException(error);

        if (poolClient) poolClient.release();

        return sendMaskedError(
          null,
          'There was a problem deactivating your account. Please contact support.',
          next
        );
      }

      if (poolClient) poolClient.release();

      return res.json({
        success: true,
        message: 'Your account is flagged for removal.',
      });
    }
  );

// =====================================
// SEND OTP =============================
// =====================================

// This otp is for if user cannot remember their password
router
  .route('/send-otp')
  // process the sendotp form
  .post(async (req, res, next) => {
    const { email } = req.body;

    logger.info(`Send OTP login to ${email}`);

    // Missing fields
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: 'Missing required input.' });
    }

    const poolClient = await pool.connect();

    const targetUser = await getUserByEmail(email, poolClient);

    if (!targetUser) {
      poolClient.release();

      return res.status(400).json({
        success: false,
        message: 'No user found with that email address.',
      });
    }

    // Generate small 8-character password OTP
    const otp = await generateRandomCode(4);

    if (!otp) {
      poolClient.release();

      return res.status(400).json({
        success: false,
        message: 'OTP not generated. Please try again.',
      });
    }

    try {
      // Send email
      await sendOTPasswordEmail(email, targetUser.name, otp);
      // Update users `ot_password` field
      await updateUserOTPassword(targetUser.id, generateHash(otp), poolClient);

      // Invalidate cached user
      deleteCachedData(CacheKeys.userEmailKey(email));
      deleteCachedData(CacheKeys.userKey(targetUser.id));

      if (poolClient) poolClient.release();

      return res.json({
        success: true,
        message: 'One-time password was sent via email.',
      });
    } catch (error) {
      logger.error(`sendOTPasswordEmail error: ${error.stack || error}`);
      Sentry.captureException(error);
    }

    if (poolClient) poolClient.release();

    return res.json({
      success: false,
      message: 'Was not able to send One-time password. Please try again.',
    });
  });

// =====================================
// LOGIN OTP =============================
// =====================================
router
  .route('/login-otp')
  // process the login form
  .post(async (req, res, next) => {
    const { email, otPassword } = req.body;

    logger.info(`Login with OTP for ${email}`);

    // Missing fields
    if (!otPassword || !email) {
      return res
        .status(400)
        .json({ success: false, message: 'Missing required input.' });
    }
    const poolClient = await pool.connect();

    return async.waterfall(
      [
        done =>
          // Attempt custom passport authentication
          passport.authenticate('custom-otp-login', (err, user, info) => {
            // Some error happened
            if (err) {
              logger.error(`login-otp error: ${err.stack || err}`);
              Sentry.captureException(err);

              if (poolClient) poolClient.release();

              return sendBadRequest(res, info || err, 401);
            }

            if (!user) {
              if (poolClient) poolClient.release();

              return sendMaskedError(err, info || err, next);
            }

            // Passport login
            return req.logIn(user, { session: false }, err2 => {
              if (err2) {
                if (poolClient) poolClient.release();

                return sendMaskedError(err2, null, next);
              }

              // Return successful user
              return done(null, user);
            });
          })(req, res, next),
        generateJWTAndUpdateUser(),
      ],
      async (err, user, token) => {
        if (err) {
          logger.error(`login-otp error: ${err.stack || err}`);
          Sentry.captureException(err);
          if (poolClient) poolClient.release();

          return sendBadRequest(
            res,
            (err && err.message) || 'There was a problem logging in',
            401
          );
        }

        try {
          await updateUserOTPassword(user.id, null, poolClient);
        } catch (error) {
          logger.error(`login-otp error: ${err.stack || err}`);
          Sentry.captureException(err);
        }

        // Invalidate cached user
        deleteCachedData(CacheKeys.userEmailKey(email));
        deleteCachedData(CacheKeys.userKey(user.id));

        if (poolClient) poolClient.release();

        return res.json({
          success: true,
          message: 'Successfully logged in.',
          data: {
            me: omit(user, OmitProps.me),
            token: `${token}`,
          },
        });
      }
    );
  });

export default router;
