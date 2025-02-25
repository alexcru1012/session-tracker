import express from 'express';
import SQL from 'sql-template-strings';
import validator from 'validator';
import moment from 'moment';
import * as Sentry from '@sentry/node';

import {
  omit,
  runQuery,
  sendBadRequest,
  sendMaskedError,
  s3Upload,
} from '@/helpers';
import { cacheData, deleteCachedData, getDataFromCache } from '@/redis/helpers';
import { getMe, getPassports } from '@/models/me';
import passport from '@/passport';
import { CacheKeys, OmitProps, APP_VERSION, S3Buckets } from '@/constants';
import { CurrencyOptions } from '@/constants/currencies';
import { TimezoneOptions } from '@/constants/timezones';
import pool from '@/postgres';
import visitor from '@/analytics';
import logger from '@/logger';
import {
  attachUserSubscription,
  requireSubscriptionTier,
} from '@/helpers/userSubscriptions';
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

      let me = null;

      const cacheKey = CacheKeys.meKey(user.id);
      const existingData = await getDataFromCache(cacheKey);

      logger.info(`Get me (${user.id})`);

      if (existingData) {
        return res.json({
          success: true,
          data: existingData,
        });
      }

      const poolClient = await pool.connect();

      try {
        me = await getMe(user.id, poolClient);
      } catch (error) {
        Sentry.captureException(error);

        if (poolClient) poolClient.release();

        return sendMaskedError(
          error,
          'There was a problem fetching your account.',
          next
        );
      }

      if (!me) {
        if (poolClient) poolClient.release();

        return sendBadRequest(res, 'User was not found.');
      }

      me = await attachUserSubscription(me, poolClient);

      // Update usage stats
      bumpUsageForUser(user.id);

      if (poolClient) poolClient.release();

      // Attach app version constant
      me = {
        ...me,
        available_app_version: APP_VERSION,
      };

      const data = omit(me, OmitProps.me);

      cacheData(cacheKey, data);

      return res.json({
        success: true,
        data,
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
      const {
        name,
        company,
        industry,
        slug,
        contactEmail,
        contact_email,
        contactPhone,
        contact_phone,
        hasAcceptedTerms,
        has_accepted_terms,
        expo_push_token,
        app_version,
        tz,
        currency,
      } = req.body;

      logger.info(`Update me (${user.id})`);

      // Missing required fields
      // if (!name) return sendBadRequest(res, 'Missing required input.');

      // Cannot remove
      const nameInput = name ? validator.escape(String(name)) : user.name;
      const slugInput = slug ? validator.escape(String(slug)) : user.slug;
      const expoPushTokenInput = expo_push_token
        ? validator.escape(String(expo_push_token))
        : user.expo_push_token;
      const appVersionInput = app_version
        ? validator.escape(String(app_version))
        : user.app_version;
      let tzInput = tz ? validator.escape(String(tz)) : user.tz;
      // Put back slash character
      if (tzInput) tzInput = tzInput.replace(/&#x2F;/g, '/');

      const hasAcceptedTermsInput =
        hasAcceptedTerms || has_accepted_terms ? true : user.has_accepted_terms;
      const currencyInput = currency
        ? validator.escape(String(currency))
        : user.currency;

      // Can remove
      const companyInput = company ? validator.escape(String(company)) : '';
      const industryInput = industry ? validator.escape(String(industry)) : '';
      const contactEmailInput =
        contactEmail || contact_email
          ? validator.escape(String(contactEmail || contact_email))
          : null;
      const contactPhoneInput =
        contactPhone || contact_phone
          ? validator.escape(contactPhone || contact_phone)
          : null;

      try {
        // Validate

        if (!validator.isLength(nameInput, { min: 2, max: 100 }))
          return sendBadRequest(res, 'Invalid name input.');

        if (slugInput && !validator.isLength(slugInput, { min: 2, max: 100 }))
          return sendBadRequest(res, 'Invalid slug input.');

        if (
          companyInput &&
          !validator.isLength(companyInput, { min: 2, max: 100 })
        )
          return sendBadRequest(res, 'Invalid company input.');

        if (
          industryInput &&
          !validator.isLength(industryInput, { min: 2, max: 100 })
        )
          return sendBadRequest(res, 'Invalid industry input.');

        if (!!contactEmailInput && !validator.isEmail(contactEmailInput))
          return sendBadRequest(res, 'Invalid contact_email input.');

        if (
          !!contactPhoneInput &&
          !validator.isNumeric(contactPhoneInput) &&
          !validator.isMobilePhone(contactPhoneInput)
        )
          return sendBadRequest(res, 'Invalid contact_phone input.');

        if (
          expoPushTokenInput &&
          (!validator.isLength(expoPushTokenInput, { min: 30, max: 100 }) ||
            expoPushTokenInput.indexOf('ExponentPushToken') !== 0)
        ) {
          logger.info(`expoPushTokenInput ${expoPushTokenInput}`);

          return sendBadRequest(res, 'Invalid expo_push_token input.');
        }

        if (
          appVersionInput &&
          !validator.isLength(appVersionInput, { min: 5, max: 11 })
        )
          return sendBadRequest(res, 'Invalid app_version input.');

        if (tzInput) {
          const match = TimezoneOptions.findIndex(t => t.value === tzInput);

          // TODO add match when app is updated
          if (match === -1 || !validator.isLength(tzInput, { min: 1, max: 50 }))
            return sendBadRequest(res, 'Invalid tz input.');
        }

        if (currencyInput) {
          const match = CurrencyOptions.findIndex(
            c => c.value === currencyInput
          );

          if (match === -1 || currencyInput.length !== 3)
            return sendBadRequest(res, 'Invalid currency input.');
        }
      } catch (error) {
        Sentry.captureException(error);

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem updating your account.',
          next
        );
      }

      // Update

      const poolClient = await pool.connect();

      try {
        const updatedAt = moment().toISOString();
        // Update user
        const rows = await runQuery(
          SQL`
          UPDATE users
            SET
              name = ${nameInput},
              slug = ${slugInput},
              company = ${companyInput},
              industry = ${industryInput},
              contact_email = ${contactEmailInput},
              contact_phone = ${contactPhoneInput},
              has_accepted_terms = ${hasAcceptedTermsInput},
              expo_push_token = ${expoPushTokenInput},
              app_version = ${appVersionInput},
              tz = ${tzInput},
              currency = ${currencyInput},
              updated_at = ${updatedAt}
            WHERE id = ${user.id}
            RETURNING *;
        `,
          null,
          null,
          poolClient
        );

        let updatedUser = {
          ...rows[0],
          available_app_version: APP_VERSION,
        };

        updatedUser = await attachUserSubscription(updatedUser, poolClient);

        await deleteCachedData(CacheKeys.meKey(user.id));
        await deleteCachedData(CacheKeys.userKey(user.id));
        await deleteCachedData(CacheKeys.userEmailKey(user.email));
        await deleteCachedData(CacheKeys.userSlugKey(user.slug));

        if (poolClient) poolClient.release();

        return res.json({
          success: true,
          message: 'Profile was updated.',
          data: omit(updatedUser, OmitProps.me),
        });
      } catch (error) {
        Sentry.captureException(error);

        if (poolClient) poolClient.release();

        let message = 'There was a problem updating your account.';
        if (error.message.indexOf('duplicate') > -1)
          message = 'Chosen slug is already taken.';

        // Mask sensitive errors
        return sendMaskedError(error, message, next);
      }
    }
  );

router
  .route('/avatar')
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Update my avatar (${user.id})`);

      const imageUpload = s3Upload(S3Buckets.avatars, `${user.id}`).single(
        'image'
      );

      imageUpload(req, res, async err => {
        if (err) {
          console.log('image upload error', err);

          return res.status(422).json({
            success: false,
            error: 'Image Upload Error',
            message: err.message,
          });
        }

        const updatedAt = moment().toISOString();

        const poolClient = await pool.connect();

        // Update user
        try {
          const rows = await runQuery(
            SQL`
            UPDATE users
              SET
                avatar = ${req.file.location},
                updated_at = ${updatedAt}
              WHERE id = ${user.id}
              RETURNING *;
          `,
            null,
            null,
            poolClient
          );

          let updatedUser = {
            ...rows[0],
            available_app_version: APP_VERSION,
          };

          updatedUser = await attachUserSubscription(updatedUser, poolClient);

          await deleteCachedData(CacheKeys.userKey(user.id));

          if (poolClient) poolClient.release();

          return res.json({
            success: true,
            message: 'User avatar was updated.',
            data: omit(updatedUser, OmitProps.me),
          });
        } catch (error) {
          if (poolClient) poolClient.release();

          // Mask sensitive errors
          return sendMaskedError(
            error,
            'There was a problem updating your avatar.',
            next
          );
        }
      });
    }
  );

router
  .route('/passports')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Get my passports (${user.id})`);
      visitor
        .event({
          ec: 'me',
          ea: 'get /passports',
        })
        .send();

      const poolClient = await pool.connect();
      let data;

      // Check if google passport exists
      try {
        data = await getPassports(user.id, poolClient);
      } catch (err) {
        if (poolClient) poolClient.release();

        return sendMaskedError(err, 'Could not fetch user passports', next);
      }

      if (poolClient) poolClient.release();

      return res.json({
        success: true,
        data,
      });
    }
  );

export default router;
