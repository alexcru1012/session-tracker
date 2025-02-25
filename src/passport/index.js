import FacebookTokenStrategy from 'passport-facebook-token';
// import GoogleToken from 'passport-token-google2';
import passportLocal from 'passport-local';
import passportJWT from 'passport-jwt';
import passport from 'passport';
import passportCustom from 'passport-custom';
import async from 'async';
import validator from 'validator';
import SQL from 'sql-template-strings';
import moment from 'moment-timezone';
// import * as fs from 'fs';

import pool from '@/postgres';
import logger from '@/logger';
import {
  runQuery,
  isPasswordValid,
  generateHash,
  sendMaskedError,
  generateRandomCode,
  slugify,
} from '@/helpers';
import { Options, CacheKeys } from '@/constants';
import { getUserByEmail } from '@/models/users';
import { deleteCachedData } from '@/redis/helpers';

// import { attachUserSubscription } from '@/helpers/userSubscriptions';

// const GoogleTokenStrategy = GoogleToken.Strategy;
const LocalStrategy = passportLocal.Strategy;
const JWTStrategy = passportJWT.Strategy;
const ExtractJWT = passportJWT.ExtractJwt;
const CustomStrategy = passportCustom.Strategy;

// GoogleTokenStrategy.prototype.userProfile = function(token, done) {
//   done(null, {});
// };

// =========================================================================
// LOCAL LOGIN =============================================================
// =========================================================================
// we are using named strategies since we have one for login and one for signup
// by default, if there was no name, it would just be called 'local'

passport.use(
  'local-login',
  new LocalStrategy(
    {
      // Find these properties on request.body
      usernameField: 'email',
      passwordField: 'password',
      // passReqToCallback : true,
    },
    async (emailInput, passwordInput, done) => {
      // Get input
      const email = validator.escape(String(emailInput).toLowerCase());
      const password = validator.escape(passwordInput);

      const poolClient = await pool.connect();

      // Find user
      let user;

      try {
        user = await getUserByEmail(email, null);
      } catch (error) {
        if (poolClient) poolClient.release();
        logger.error(`local-login error', ${error.stack || error}`);
        done(error);
      } finally {
        poolClient.release();
      }

      if (!user) return done('No user found with that email address.', null);

      // Validate the password (user might not have password set)
      if (!user.password || !isPasswordValid(password, user.password))
        return done('Incorrect password.', null);

      // All is well, return successful user
      return done(null, user);
    }
  )
);

// =========================================================================
// LOCAL SIGNUP ============================================================
// =========================================================================

passport.use(
  'local-signup',
  new LocalStrategy(
    {
      // Find these properties on request.body
      usernameField: 'email',
      passwordField: 'password',
      passReqToCallback: true,
    },
    (req, emailInput, passwordInput, done) => {
      // Missing required fields
      if (
        !req.body.name ||
        !emailInput ||
        !passwordInput ||
        !req.body.confirmPassword
      )
        return done('Missing required input.', null);

      // Get input
      const name = validator.escape(req.body.name);
      const email = validator.escape(String(emailInput).toLowerCase());
      const industry = validator.escape(req.body.industry || '');
      const company = validator.escape(req.body.company || '');
      const password = validator.escape(passwordInput);
      const confirmPassword = validator.escape(req.body.confirmPassword || '');
      // const business = validator.escape(req.body.business || '');
      const hasAcceptedTerms = true; // !!req.body.hasAcceptedTerms; // TODO
      // if (!hasAcceptedTerms)
      const slug = slugify(name);

      // Validate name input
      if (!validator.isLength(name, { min: 2, max: 100 }))
        return done('Invalid name input.', null);

      // Validate email input
      if (!validator.isEmail(email)) return done('Invalid email input.', null);

      // Validate industry input
      if (industry && !validator.isLength(industry, { min: 2, max: 100 }))
        return done('Invalid industry input.', null);

      // Validate company input
      if (company && !validator.isLength(company, { min: 2, max: 100 }))
        return done('Invalid company input.', null);

      // Validate Password length
      if (!validator.isLength(password, { min: 6, max: 100 }))
        return done('Invalid password input.', null);

      // Password confirm check
      if (!validator.equals(password, confirmPassword))
        return done('Passwords do not match.', null);

      // Optional fields
      // if (business && !validator.isLength(business, { min: 2, max: 100 }))
      //   return done(null, null, 'Business is not valid');

      // Steps before authenticate
      return async.waterfall(
        [
          nextOne => {
            // Check if user already exists
            getUserByEmail(email)
              .then(existingUser => {
                nextOne(null, existingUser);
              })
              .catch(error => {
                logger.error(`local-signup error: ${error.stack || error}`);
                nextOne(error);
              });
          },
          (existingUser, nextOne) => {
            if (existingUser && existingUser.is_activated) {
              if (!isPasswordValid(password, existingUser.password))
                return nextOne('Password invalid');

              return nextOne(null, existingUser, null, null);
            }
            if (existingUser && existingUser.password) {
              if (!isPasswordValid(password, existingUser.password))
                return nextOne('Password invalid');
            } else if (existingUser) {
              logger.error(
                `Existing user has no password??? (${existingUser.id})`
              );
            }

            // Generate token
            const activationTokenExpires = moment()
              .add(Options.activationTokenExpiresInD, 'days')
              .toISOString();

            generateRandomCode()
              .then(activationToken => {
                nextOne(
                  null,
                  existingUser,
                  activationToken,
                  activationTokenExpires
                );
              })
              .catch(error => {
                logger.error(
                  `generateRandomCode error: ${error.stack || error}`
                );
                nextOne('There was a problem generating an activation token.');
              });
          },
          (existingUser, activationToken, activationTokenExpires, nextOne) => {
            // Create user
            const createdAt = moment().toISOString();

            logger.info(
              `${existingUser ? 'Update' : 'Create New'} User via local signup`
            );

            const query = existingUser
              ? SQL`
                UPDATE users
                SET
                  industry = ${industry},
                  company = ${company},
                  slug = ${slug},
                  password = ${generateHash(password)},
                  has_accepted_terms = ${hasAcceptedTerms},
                  activation_token = ${activationToken},
                  activation_token_expires = ${activationTokenExpires},
                  is_active = true,
                  updated_at = ${createdAt}
                WHERE id = ${existingUser.id}
                RETURNING *;
              `
              : SQL`
                INSERT INTO users (email, password, name, slug, industry, company, has_accepted_terms, activation_token, activation_token_expires, is_active, created_at, updated_at, last_login_at)
                VALUES (${email}, ${generateHash(password)},
                  ${name}, ${slug}, ${industry}, ${company}, ${hasAcceptedTerms},
                  ${activationToken}, ${activationTokenExpires}, ${true},
                  ${createdAt}, ${createdAt}, ${createdAt})
                RETURNING *;
              `;

            runQuery(query)
              .then(async rows => {
                const _user = rows[0];

                // Invalidate after update
                deleteCachedData(CacheKeys.meKey(_user.id));
                deleteCachedData(CacheKeys.userKey(_user.id));
                deleteCachedData(CacheKeys.userEmailKey(email));

                // Return the user
                nextOne(null, _user);
              })
              .catch(error => {
                logger.error(`local-signup error', ${error.stack || error}`);

                nextOne(error);
              });
          },
          // (user, nextOne) => {
          //   // This will update if necessary
          //   nextOne(null, updatedUser);
          // },
        ],
        (err, user) => {
          if (err) return done(typeof err === 'object' ? err.message : err);

          // All good.
          return done(null, user);
        }
      );
    }
  )
);

// =========================================================================
// JSON WEB TOKEN ==========================================================
// =========================================================================

passport.use(
  new JWTStrategy(
    {
      jwtFromRequest: ExtractJWT.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
      // passReqToCallback : true,
    },
    async (jwtPayload, done) => {
      const poolClient = await pool.connect();

      try {
        // Allowing certain routes from "home" app
        if (jwtPayload.id === process.env.HOME_SECRET_ID) {
          return done(null, {
            id: jwtPayload.id,
          });
        }

        // Find user
        const user = await getUserByEmail(jwtPayload.email, poolClient);

        if (!user) {
          if (poolClient) poolClient.release();

          return done(new Error('No user found.'), false);
        }

        // Attach subscription
        // user = await attachUserSubscription(user, poolClient);

        if (poolClient) poolClient.release();

        // All is well, return successful user
        return done(null, user);
      } catch (error) {
        logger.error(`jwt error: ${error.stack || error}`);

        if (poolClient) poolClient.release();

        return done(error, false);
      }
    }
  )
);

// =========================================================================
// Facebook Access Token ===================================================
// =========================================================================

passport.use(
  new FacebookTokenStrategy(
    {
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      enableProof: false,
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      const { id, photos, _json } = profile;
      const { name, email } = _json;

      const avatar = photos.length ? photos[0].value : null;

      let existingPassport;
      let existingUser;

      try {
        // Find user
        const uRows = await runQuery(
          SQL`SELECT * FROM users WHERE email ILIKE ${email};`
        );

        if (uRows && uRows.length) existingUser = uRows[0];

        // Find passport
        const pRows = await runQuery(
          SQL`SELECT * FROM facebook_passports WHERE facebook_id = ${id};`
        );

        if (pRows && pRows.length) existingPassport = pRows[0];
      } catch (error) {
        // No passport
        logger.error(`Facebook login error: ${error.stack || error}`);
      }

      if (existingPassport && existingUser) {
        // Success
        return done(null, existingUser);
      }

      // Connect to pool to handle transaction (no need to try/catch here)
      const poolClient = await pool.connect();

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
      let user = existingUser;
      if (!user) {
        // Need an activation token
        const activationTokenExpires = moment()
          .add(Options.activationTokenExpiresInD, 'days')
          .toISOString();
        const activationToken = await generateRandomCode();
        if (!activationToken) {
          return done(
            'There was a problem generating an activation token.',
            null
          );
        }

        logger.info('Create New User via Facebook login');

        try {
          const result = await poolClient.query(SQL`
            INSERT INTO users (email, name, avatar, activation_token, activation_token_expires, created_at, updated_at, last_login_at)
            VALUES (${email}, ${name}, ${avatar},
              ${activationToken}, ${activationTokenExpires},
              ${createdAt}, ${createdAt}, ${createdAt})
            RETURNING *;
          `);

          if (result && result.rows && result.rows.length)
            user = result.rows[0];
        } catch (error) {
          logger.error(`facebook login error: ${error.stack || error}`);
          handleRollback();

          return done('A user already exists with that email address.', null);
        }
      } else if (avatar && !user.avatar) {
        try {
          // Update user avatar
          const result = await poolClient.query(SQL`
            UPDATE users
              SET
                avatar = ${avatar}
              WHERE id = ${user.id}
              RETURNING *;
            `);

          logger.info('Update User via Facebook login');

          if (result && result.rows && result.rows.length)
            user = result.rows[0];
        } catch (error) {
          logger.error(`facebook login error: ${error.stack || error}`);
          handleRollback();

          return done('There was a problem updating this user.', null);
        }
      }

      if (!user) {
        handleRollback();

        return done('There was a problem creating a new user.', null);
      }

      // Create new passport
      let passport2 = existingPassport;
      if (!passport2) {
        logger.info('Create New Passport via Facebook login');

        try {
          const result = await poolClient.query(SQL`
        INSERT INTO facebook_passports (user_id, facebook_id, access_token, refresh_token, connected, created_at, updated_at)
        VALUES (${user.id}, ${id}, ${accessToken}, ${refreshToken}, true, ${createdAt}, ${createdAt})
        RETURNING *;
      `);

          if (result && result.rows && result.rows.length)
            passport2 = result.rows[0];
        } catch (error) {
          logger.error(`facebook login error: ${error.stack || error}`);
          handleRollback();

          return done(error);
        }
      }

      if (!passport2) {
        handleRollback();

        return done(
          'There was a problem connecting new user to Facebook.',
          null
        );
      }

      try {
        // Commit transaction
        await poolClient.query('COMMIT');
      } catch (error) {
        logger.error(`facebook login error: ${error.stack || error}`);
        handleRollback();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem handling this transaction.',
          done
        );
      }

      // Release client
      poolClient.release();

      // Success
      return done(null, user);
    }
  )
);

// =========================================================================
// Google Access Token =====================================================
// =========================================================================

// passport.use(
//   new GoogleTokenStrategy(
//     {
//       clientID: process.env.GOOGLE_APP_ID,
//       clientSecret: process.env.GOOGLE_APP_SECRET,
//       passReqToCallback: true,
//     },
//     async (req, accessToken, refreshToken, profile, done) => {
//       const { id, name, email, picture } = profile._json; // eslint-disable-line

//       let existingPassport;
//       let existingUser;

//       try {
//         // Find user
//         const uRows = await runQuery(
//           SQL`SELECT * FROM users WHERE email ILIKE ${email};`
//         );

//         if (uRows && uRows.length) existingUser = uRows[0];

//         // Find passport
//         const pRows = await runQuery(
//           SQL`SELECT * FROM google_passports WHERE google_id = ${id};`
//         );

//         if (pRows && pRows.length) existingPassport = pRows[0];
//       } catch (error) {
//         // No passport
//         logger.error(error);
//       }

//       if (existingPassport && existingUser) {
//         // Success
//         return done(null, existingUser);
//       }

//       // Connect to pool to handle transaction (no need to try/catch here)
//       const poolClient = await pool.connect();

//       const handleRollback = async () => {
//         // Rollback transaction
//         await poolClient.query('ROLLBACK');
//         // Release client
//         poolClient.release();
//       };

//       try {
//         // Begin transaction
//         await poolClient.query('BEGIN');
//       } catch (error) {
//         logger.error(`google login error: ${error.stack || error}`);

//         // Release client
//         poolClient.release();

//         // Mask sensitive errors
//         return sendMaskedError(error, 'Could not connect to database.', done);
//       }

//       // For multiple inserts
//       const createdAt = moment().toISOString();

//       // Create a new user
//       let user = existingUser;
//       if (!user) {
//         // Need an activation token
//         const activationTokenExpires = moment()
//           .add(Options.activationTokenExpiresInD, 'days')
//           .toISOString();
//         const activationToken = await generateRandomCode();
//         if (!activationToken) {
//           return done(
//             'There was a problem generating an activation token.',
//             null
//           );
//         }

//         try {
//           const result = await poolClient.query(SQL`
//             INSERT INTO users (email, name, avatar, activation_token, activation_token_expires, created_at, updated_at)
//             VALUES (${email}, ${name}, ${picture},
//               ${activationToken}, ${activationTokenExpires},
//               ${createdAt}, ${createdAt})
//             RETURNING *;
//           `);

//           if (result && result.rows && result.rows.length)
//             user = result.rows[0];
//         } catch (error) {
//           logger.error(`google login error: ${error.stack || error}`);
//           handleRollback();

//           return done('A user already exists with that email address.', null);
//         }
//       } else if (picture && !user.avatar) {
//         try {
//           // Update user avatar
//           const result = await poolClient.query(SQL`
//             UPDATE users
//               SET
//                 avatar = ${picture}
//               WHERE id = ${user.id}
//               RETURNING *;
//           `);

//           if (result && result.rows && result.rows.length)
//             user = result.rows[0];
//         } catch (error) {
//           logger.error(`google login error: ${error.stack || error}`);
//           handleRollback();

//           return done('There was a problem updating this user.', null);
//         }
//       }

//       if (!user) {
//         handleRollback();

//         return done('There was a problem creating a new user.', null);
//       }

//       // Create new passport
//       let passport2 = existingPassport;
//       if (!passport2) {
//         try {
//           const result = await poolClient.query(SQL`
//         INSERT INTO google_passports (user_id, google_id, access_token, refresh_token, connected, created_at, updated_at)
//         VALUES (${user.id}, ${id}, ${accessToken}, ${refreshToken}, true, ${createdAt}, ${createdAt})
//         RETURNING *;
//       `);

//           if (result && result.rows && result.rows.length)
//             passport2 = result.rows[0];
//         } catch (error) {
//           logger.error(`google login error: ${error.stack || error}`);
//           handleRollback();

//           return done(error);
//         }
//       }

//       if (!passport2) {
//         handleRollback();

//         return done('There was a problem connecting new user to Google.', null);
//       }

//       try {
//         // Commit transaction
//         await poolClient.query('COMMIT');
//       } catch (error) {
//         logger.error(`google login error: ${error.stack || error}`);
//         handleRollback();

//         // Mask sensitive errors
//         return sendMaskedError(
//           error,
//           'There was a problem handling this transaction.',
//           done
//         );
//       }

//       // Release client
//       poolClient.release();

//       // Success
//       return done(null, user);
//     }
//   )
// );

// =========================================================================
// LOCAL CUSTOM OTP LOGIN ==================================================
// =========================================================================

passport.use(
  'custom-otp-login',
  new CustomStrategy(async (req, done) => {
    const { email, otPassword } = req.body;

    const emailInput = validator.escape(email);
    const otPasswordInput = validator.escape(otPassword);

    // Missing required fields
    if (!emailInput || !otPasswordInput)
      return done('Missing required input.', null);

    // Validate Password length
    if (!validator.isLength(otPasswordInput, { min: 8, max: 100 }))
      return done('Invalid one time password input.', null);

    // Validate email input
    if (!validator.isEmail(emailInput))
      return done('Invalid email input.', null);

    const poolClient = await pool.connect();

    // Find user
    const user = await getUserByEmail(emailInput, poolClient);
    let isValid;

    try {
      isValid = user.ot_password
        ? isPasswordValid(otPasswordInput, user.ot_password)
        : false;
    } catch (err) {
      logger.error(`custom-otp-login error: ${err}`);
    }

    // TODO check expiration date here

    // Compare hashed pass
    if (user && user.ot_password && isValid) {
      if (poolClient) poolClient.release();

      // All is well, return successful user
      return done(null, user);
    }

    if (poolClient) poolClient.release();

    return done('One-time password has expired, please try again.', null);
  })
);

export default passport;
