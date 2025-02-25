import express from 'express';
import validator from 'validator';
import passport from '@/passport';

import { sendMaskedError, sendBadRequest, doesUserHaveClient } from '@/helpers';
import { deleteCachedData } from '@/redis/helpers';
import {
  getClientMeta,
  getSingleMeta,
  createClientMeta,
  updateClientMeta,
  deleteClientMeta,
} from '@/models/clientMeta';
import logger from '@/logger';
import pool from '@/postgres';
import { CacheKeys } from '@/constants';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';

const router = express.Router();

router
  .route('/:clientId')
  // Get all Meta for a client
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;

      const poolClient = await pool.connect();

      logger.info(`Get clientMeta for client ${user.id}-${clientId}`);

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

      let clientMeta;

      try {
        // Perform query
        clientMeta = await getClientMeta(clientId, poolClient);
      } catch (error) {
        // Release client
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this meta.',
          next
        );
      }

      // Release client
      poolClient.release();

      // Success
      return res.json({
        success: true,
        data: {
          clientMeta,
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
      const { clientId } = req.params;
      const { metaKey, metaValue } = req.body;

      logger.info(`Create clientMeta for client ${user.id}-${clientId}`);

      // Missing required fields
      if (
        !clientId ||
        !metaKey ||
        (metaValue === undefined || metaValue === null)
      )
        return sendBadRequest(res, 'Missing required input.');

      let metaKeyInput = validator.escape(metaKey);

      metaKeyInput = metaKeyInput.substring(0, 500);

      let metaValueInput = validator.escape(metaValue);

      metaValueInput = metaValueInput.substring(0, 500);

      const poolClient = await pool.connect();

      // First see if user owns this client
      try {
        const doesUserHaveClientResponse = await doesUserHaveClient(
          user.id,
          clientId,
          poolClient
        );

        if (doesUserHaveClientResponse !== true) {
          poolClient.release();

          return sendBadRequest(res, doesUserHaveClientResponse, 401);
        }
      } catch (error) {
        poolClient.release();

        return sendBadRequest(res, error.message, 401);
      }

      logger.info(
        `Create client Meta for Client ${clientId} metaKey ${metaKeyInput}`
      );

      // Perform query
      let clientMeta;

      try {
        clientMeta = await createClientMeta(
          clientId,
          metaKeyInput,
          metaValueInput,
          poolClient
        );
      } catch (error) {
        // Release client
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem setting this meta.',
          next
        );
      }

      // Release client
      poolClient.release();

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.clientMetasKey(clientId));
      await deleteCachedData(CacheKeys.clientMetaKey(clientId, metaKeyInput));

      // Success
      return res.json({
        success: true,
        data: {
          clientMeta,
        },
      });
    }
  );

router
  .route('/:clientId/:metaId')
  // Get single meta for a client
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId, metaId } = req.params;

      logger.info(`Get single clientMeta for client ${user.id}-${clientId}-${metaId}`);

      // Missing required fields
      if (!clientId || !metaId)
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

      let clientMeta;

      try {
        // Perform query
        clientMeta = await getSingleMeta(clientId, metaId, poolClient);
      } catch (error) {
        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this meta.',
          next
        );
      }

      if (!clientMeta) return sendBadRequest(res, 'Client meta was not found.');

      // Success
      return res.json({
        success: true,
        message: `Client ${metaId} was added.`,
        data: {
          clientMeta,
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
      const { clientId, metaId } = req.params;
      const { metaKey, metaValue } = req.body;

      logger.info(`Update clientMeta for client ${user.id}-${clientId}-${metaId}`);

      // Missing required fields
      if (
        !clientId ||
        !metaId ||
        !metaKey ||
        (metaValue === undefined || metaValue === null)
      )
        return sendBadRequest(res, 'Missing required input.');

      let metaKeyInput = validator.escape(metaKey);

      metaKeyInput = metaKeyInput.substring(0, 500);

      let metaValueInput = validator.escape(String(metaValue));

      metaValueInput = metaValueInput.substring(0, 500);

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

      logger.info(`Update client Meta for Client ${clientId} metaId ${metaId}`);

      let existingMeta;

      try {
        existingMeta = await getSingleMeta(clientId, metaId, poolClient);
      } catch (error) {
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this Meta.',
          next
        );
      }

      if (!existingMeta) {
        poolClient.release();

        return sendBadRequest(res, 'Could not find this Meta.');
      }

      let clientMeta;

      try {
        // update client Meta...
        clientMeta = await updateClientMeta(
          clientId,
          metaId,
          metaKeyInput,
          metaValueInput,
          poolClient
        );
      } catch (error) {
        poolClient.release();

        return sendMaskedError(error, 'Unable to update client Meta', next);
      }

      if (!clientMeta) {
        poolClient.release();

        return sendBadRequest(res, 'Could not update client Meta.');
      }

      // Release client
      poolClient.release();

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.clientMetasKey(clientId));
      await deleteCachedData(CacheKeys.clientMetaKey(clientId, metaId));

      return res.json({
        success: true,
        message: `Meta ${metaId} was updated.`,
        data: {
          clientMeta,
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
      const { clientId, metaId } = req.params;

      // Missing required fields
      if (!clientId || !metaId)
        return sendBadRequest(res, 'Missing required input.');

      logger.info(`Delete client Meta for Client ${clientId}-${metaId}`);

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
        // update client Meta...
        await deleteClientMeta(clientId, metaId, poolClient);
      } catch (error) {
        poolClient.release();

        return sendMaskedError(error, 'Unable to delete client Meta', next);
      }

      // Release client
      poolClient.release();

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.clientMetasKey(clientId));
      await deleteCachedData(CacheKeys.clientMetaKey(clientId, metaId));

      return res.json({
        success: true,
        message: `Meta ${metaId} was removed.`,
        data: {
          metaId,
        },
      });
    }
  );

export default router;
