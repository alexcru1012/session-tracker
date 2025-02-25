import express from 'express';
import validator from 'validator';

import passport from '@/passport';

import { sendMaskedError, sendBadRequest, doesUserHaveClient } from '@/helpers';
import { deleteCachedData } from '@/redis/helpers';
import {
  getClientOptions,
  getSingleOption,
  getSingleOptionByKey,
  createClientOption,
  updateClientOption,
} from '@/models/clientOptions';
import logger from '@/logger';
import pool from '@/postgres';
import { CacheKeys, PossibleClientSettings } from '@/constants';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';

const router = express.Router();

router
  .route('/:clientId')
  // Get all options for a client
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;

      logger.info(`Get clientOptions for client ${user.id}-${clientId}`);

      // Missing required fields
      if (!clientId || clientId === 'undefined')
        return sendBadRequest(res, 'Missing required input.');

      const poolClient = await pool.connect();

      // First see if user owns this client
      let doesUserHaveClientResponse;

      try {
        doesUserHaveClientResponse = await doesUserHaveClient(
          user.id,
          clientId,
          poolClient
        );
      } catch (error) {
        poolClient.release();

        return sendBadRequest(res, error.message, 401);
      }
      if (doesUserHaveClientResponse !== true) {
        poolClient.release();

        return sendBadRequest(res, doesUserHaveClientResponse, 401);
      }

      try {
        // Perform query
        const data = await getClientOptions(clientId, poolClient);

        // Release client
        poolClient.release();

        // Success
        return res.json({
          success: true,
          data,
        });
      } catch (error) {
        // Release client
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this option.',
          next
        );
      }
    }
  )
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;
      const { optionKey, optionValue } = req.body;

      logger.info(
        `Create clientOption for client ${user.id
        }-${clientId}`
      );

      // Missing required fields
      if (
        !clientId ||
        !optionKey ||
        (optionValue === undefined || optionValue === null)
      )
        return sendBadRequest(res, 'Missing required input.');

      let optionKeyInput = validator.escape(String(optionKey));

      optionKeyInput = optionKeyInput.substring(0, 500);

      let optionValueInput = validator.escape(String(optionValue));

      optionValueInput = optionValueInput.substring(0, 500);

      if (!PossibleClientSettings.includes(optionKeyInput))
        return sendBadRequest(res, 'Invalid option key input.');

      const poolClient = await pool.connect();

      // First see if user owns this client
      let doesUserHaveClientResponse;

      try {
        doesUserHaveClientResponse = await doesUserHaveClient(
          user.id,
          clientId,
          poolClient
        );
      } catch (error) {
        poolClient.release();

        return sendBadRequest(res, error.message, 401);
      }
      if (doesUserHaveClientResponse !== true) {
        poolClient.release();

        return sendBadRequest(res, doesUserHaveClientResponse, 401);
      }

      let existingOption;

      try {
        existingOption = await getSingleOptionByKey(
          clientId,
          optionKeyInput,
          poolClient
        );
      } catch (error) {
        // Release client
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this option.',
          next
        );
      }

      // console.log('existingOption', existingOption);

      try {
        // Perform query
        let data;
        if (existingOption && existingOption.id) {
          data = await updateClientOption(
            existingOption.id,
            optionValueInput,
            poolClient
          );
        } else {
          data = await createClientOption(
            clientId,
            optionKeyInput,
            optionValueInput,
            poolClient
          );
        }

        // Release client
        poolClient.release();

        // Invalidate cache so user can fetch new data
        await deleteCachedData(CacheKeys.clientOptionsKey(clientId));
        await deleteCachedData(
          CacheKeys.clientOptionKey(clientId, optionKeyInput)
        );

        // Success
        return res.json({
          success: true,
          data,
        });
      } catch (error) {
        // Release client
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem setting this option.',
          next
        );
      }
    }
  );

router
  .route('/:clientId/:optionId')
  // Get single option for a client
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { clientId, optionId } = req.params;

      logger.info(
        `Get single clientOption for client ${user.id
        }-${clientId}-${optionId}`
      );

      // Missing required fields
      if (!clientId) return sendBadRequest(res, 'Missing required input.');

      let option;

      try {
        // Perform query
        option = await getSingleOption(clientId, optionId);
      } catch (error) {
        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this option.',
          next
        );
      }

      if (!option) return sendBadRequest(res, 'Client option was not found.');

      // Success
      return res.json({
        success: true,
        data: option,
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
      const { clientId, optionId } = req.params;
      const { optionValue } = req.body;

      logger.info(
        `Update clientOption for client ${user.id
        }-${clientId}-${optionId}`
      );

      // Missing required fields
      if (
        !clientId ||
        !optionId ||
        (optionValue === undefined || optionValue === null)
      )
        return sendBadRequest(res, 'Missing required input.');

      let optionValueInput = validator.escape(String(optionValue));

      optionValueInput = optionValueInput.substring(0, 500);

      const poolClient = await pool.connect();

      // First see if user owns this client
      let doesUserHaveClientResponse;

      try {
        doesUserHaveClientResponse = await doesUserHaveClient(
          user.id,
          clientId,
          poolClient
        );
      } catch (error) {
        poolClient.release();

        return sendBadRequest(res, error.message, 401);
      }
      if (doesUserHaveClientResponse !== true) {
        poolClient.release();

        return sendBadRequest(res, doesUserHaveClientResponse, 401);
      }

      let existingOption;

      try {
        existingOption = await getSingleOption(clientId, optionId, poolClient);
      } catch (error) {
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this Option.',
          next
        );
      }

      if (!existingOption) {
        poolClient.release();

        return sendBadRequest(res, 'Could not find this Option.');
      }

      let clientOption;

      try {
        // update client Option...
        clientOption = await updateClientOption(
          optionId,
          optionValueInput,
          poolClient
        );
      } catch (error) {
        poolClient.release();

        return sendMaskedError(error, 'Unable to update client Option', next);
      }

      if (!clientOption) {
        poolClient.release();

        return sendBadRequest(res, 'Could not update client Option.');
      }

      // Release client
      poolClient.release();

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.clientOptionsKey(clientId));
      await deleteCachedData(CacheKeys.clientOptionKey(clientId, optionId));

      return res.json({
        success: true,
        message: 'Client option was set.',
        data: clientOption,
      });
    }
  );

export default router;
