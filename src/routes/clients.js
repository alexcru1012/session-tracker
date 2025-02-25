import express from 'express';
import SQL from 'sql-template-strings';
import validator from 'validator';
import moment from 'moment';
import * as Sentry from '@sentry/node';
import createError from 'http-errors';

import pool from '@/postgres';
import passport from '@/passport';
import { OmitProps, CacheKeys, Strings, S3Buckets } from '@/constants';
import {
  getClients,
  getClient,
  getArchivedClients,
  addNewClient,
  addNewClients,
  setIsActive,
  writeTempSessionsLeft,
  deleteUnusedSessions,
  getClientSimpleDANGER,
} from '@/models/clients';
import { getAllSessionNotes, addSessionsForClient } from '@/models/sessions';
import { getCalendarEventIdsForClient } from '@/models/calendar';
import { sendExportClientCSV } from '@/emails/clients';
import {
  omit,
  runQuery,
  sendMaskedError,
  sendBadRequest,
  doesUserHaveClient,
  s3Upload,
} from '@/helpers';
import { deleteCachedData } from '@/redis/helpers';
import logger from '@/logger';
import { validateClient } from '@/helpers/clients';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';
import { bumpUsageForUser, getOrCreateUserMeta } from '@/mongo/helpers';
import { canUserAddClient, getUser } from '@/models/users';

const router = express.Router();

router
  .route('/')
  // Get client list
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Get clients (${user.id})`);

      const poolClient = await pool.connect();

      try {
        // Perform query
        const rows = await getClients(user.id, poolClient);

        if (poolClient) poolClient.release();

        // Update usage stats
        bumpUsageForUser(user.id);

        // Success
        return res.json({
          success: true,
          data: rows.map(row => omit(row, OmitProps.client)),
        });
      } catch (error) {
        if (poolClient) poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this list.',
          next
        );
      }
    }
  )
  // Add new client
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const {
        nameAlias,
        emailAlias,
        phone1,
        phone2,
        address1,
        address2,
        notes,
        age,
        dob,
        numSessions,
        gender,
      } = req.body;

      // Missing required fields
      if (!nameAlias) return sendBadRequest(res, 'Missing required input.');

      logger.info(`Create client (${user.id})`);

      // Validate
      let inputs = {};

      try {
        inputs = validateClient({
          nameAlias,
          emailAlias,
          phone1,
          phone2,
          address1,
          address2,
          notes,
          age,
          dob,
          gender,
        });
      } catch (err) {
        console.log('err', err);

        return sendBadRequest(res, err.message || err || Strings.defaultError);
      }

      // console.log('inputs', inputs);

      // Additional inputs for this endpoint
      const numSessionsNumber = numSessions || 0;
      const numSessionsInput = validator.escape(numSessionsNumber.toString());

      if (!validator.isNumeric(numSessionsInput.toString()))
        return sendBadRequest(res, 'Invalid numSessions input.');

      if (inputs.error) return sendBadRequest(res, inputs.error);

      const poolClient = await pool.connect();

      const canUserAdd = await canUserAddClient(user.id, poolClient);

      if (!canUserAdd) {
        poolClient.release();

        return res.status(400).json({
          success: false,
          message: 'Client limit reached. Please upgrade plans!',
        });
      }

      const handleRollback = async () => {
        // Rollback transaction
        await poolClient.query('ROLLBACK');
        // Release client
        poolClient.release();
      };

      // Begin transaction
      await poolClient.query('BEGIN');

      let client;

      try {
        client = await addNewClient(user.id, inputs, poolClient);
      } catch (error) {
        // Unique constraint
        const message =
          error && error.code && error.code === '23505'
            ? 'A client already exists with that name.'
            : 'There was a problem creating this client.';

        handleRollback();

        // Mask sensitive errors
        return sendMaskedError(error, message, next);
      }

      if (!client) {
        handleRollback();

        return sendBadRequest(res, 'Could not create new client.');
      }

      // Also add sessions if requested...
      if (numSessionsInput > 0) {
        try {
          await addSessionsForClient(numSessionsInput, client.id, poolClient);
        } catch (error) {
          handleRollback();

          // Mask sensitive errors
          return sendMaskedError(
            error,
            'There was a problem adding sessions.',
            next
          );
        }

        client.sessions_left = numSessionsInput;
      }

      try {
        // Commit transaction
        await poolClient.query('COMMIT');
      } catch (error) {
        handleRollback();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem handling this transaction.',
          next
        );
      }

      // Release client
      if (poolClient) poolClient.release();

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.clientsKey(user.id));

      // Success
      return res.json({
        success: true,
        message: 'New client was added.',
        data: omit(client, OmitProps.client),
      });
    }
  );

router
  .route('/archived')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      logger.info(`Get archived clients (${user.id})`);

      const poolClient = await pool.connect();

      try {
        // Perform query
        const rows = await getArchivedClients(user.id, poolClient);

        if (poolClient) poolClient.release();

        // Success
        return res.json({
          success: true,
          data: rows.map(row => omit(row, OmitProps.client)),
        });
      } catch (error) {
        if (poolClient) poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this list.',
          next
        );
      }
    }
  );

router
  .route('/export-csv')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      if (!user || !user.email) return next(createError(401));

      logger.info(`Export clients CSV (${user.id})`);

      const poolClient = await pool.connect();

      let clients;

      try {
        // Perform query
        const raw = await getClients(user.id, poolClient);

        clients = raw.map(r => ({
          name: r.name_alias,
          email: r.email_alias,
          ...omit(r, OmitProps.clientCSV),
        }));
      } catch (error) {
        // Mask sensitive errors
        logger.error(`export-csv getClients ${error}`);

        if (poolClient) poolClient.release();

        return sendMaskedError(
          error,
          error.message || 'There was a problem exporting clients data.',
          next
        );
      }

      // Send email
      let sendErr;

      try {
        sendErr = await sendExportClientCSV(user, clients).catch(err => {
          logger.error(`sendExportClientCSV ${err}`);
          Sentry.captureException(err);

          if (poolClient) poolClient.release();

          return res.json({
            success: !err,
            error: err,
            message: !err
              ? 'There was a problem exporting clients data.'
              : err.message || err || Strings.defaultError,
          });
        });
      } catch (err) {
        Sentry.captureException(err);
        logger.error(`export-csv sendExportClientCSV: ${err}`);
      }

      if (poolClient) poolClient.release();

      // Email sent
      return res.json({
        success: !sendErr,
        error: sendErr,
        message: !sendErr
          ? 'CSV was sucessfully generated.'
          : sendErr.message || sendErr || Strings.defaultError,
      });
    }
  );

router
  .route('/import')
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res) => {
      const { user } = req;
      const { clients } = req.body;

      if (!clients) return sendBadRequest(res, 'Missing required input.');

      logger.info(`Import clients (${user.id})`);

      const poolClient = await pool.connect();

      const clientsToAdd = [];

      // Validate all
      try {
        for (let i = 0; i < clients.length; i++) {
          const client = validateClient(clients[i]);

          // Maybe let the user know one/more were skipped
          if (!client.error) clientsToAdd.push(client);
        }
      } catch (err) {
        logger.error(err);

        return sendBadRequest(res, err.message || err || Strings.defaultError);
      }

      let results = [];

      try {
        results = await addNewClients(user.id, clientsToAdd, poolClient);
      } catch (err) {
        logger.error(err);
        Sentry.captureException(err);

        if (poolClient) poolClient.release();

        return sendBadRequest(res, err.message || err || Strings.defaultError);
      }

      const message = results.length
        ? `Successfully imported ${results.length} client${
            results.length === 1 ? '' : 's'
          }.`
        : 'No clients were imported (maybe duplicates).';

      // Invalidate cache items
      await deleteCachedData(CacheKeys.clientsKey(user.id));

      if (poolClient) poolClient.release();

      res.json({
        success: results.length,
        data: results.map(c => omit(c, OmitProps.client)),
        message,
      });
    }
  );

/*
 * Needs to be near the bottom
 */

router
  .route('/:clientId')
  // Get client
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;

      logger.info(`Get single client (${user.id}-${clientId})`);

      // Get client
      let client;
      const poolClient = await pool.connect();

      try {
        client = await getClient(user.id, clientId, poolClient);
      } catch (error) {
        if (poolClient) poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this client.',
          next
        );
      }

      if (!client) return sendBadRequest(res, 'Client was not found.');

      if (poolClient) poolClient.release();

      // Success
      return res.json({
        success: true,
        data: omit(client, OmitProps.client),
      });
    }
  )
  // Update client
  .patch(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;
      const {
        emailAlias,
        nameAlias,
        phone1,
        phone2,
        address1,
        address2,
        notes,
        age,
        dob,
        gender,
      } = req.body;

      logger.info(`Update client (${user.id}-${clientId})`);

      const poolClient = await pool.connect();

      // Get client
      let client;

      try {
        client = await getClient(user.id, clientId, poolClient);
      } catch (error) {
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this client.',
          next
        );
      }

      if (!client) {
        poolClient.release();

        return sendBadRequest(res, 'Client was not found.');
      }

      // Escape required inputs
      const nameAliasInput = nameAlias
        ? validator.escape(nameAlias)
        : client.name_alias;
      // Escape optional inputs
      const emailAliasInput = emailAlias ? validator.escape(emailAlias) : null;
      const phone1Input = phone1 ? validator.escape(phone1) : null;
      const phone2Input = phone2 ? validator.escape(phone2) : null;
      const address1Input = address1 ? validator.escape(address1) : null;
      const address2Input = address2 ? validator.escape(address2) : null;
      let notesInput = notes ? validator.escape(notes) : '';
      let ageInput = age ? validator.escape(String(age)) : null;
      const dobInput = dob ? moment(dob).format('YYYY-MM-DD') : null;
      const genderInput = gender ? validator.escape(gender) : null;

      // Because someone keeps crashing the server with long notes
      notesInput = notesInput.substring(0, 501);
      ageInput = age
        ? Math.min(Math.max(parseInt(ageInput, 10), 1), 100)
        : null;

      // Validate required nameAlias input
      if (
        !nameAliasInput ||
        !validator.isLength(nameAliasInput, { min: 2, max: 100 })
      ) {
        poolClient.release();

        return sendBadRequest(res, 'Invalid name input.');
      }

      // Validate optional emailAlias input
      if (!!emailAliasInput && !validator.isEmail(emailAliasInput)) {
        poolClient.release();

        return sendBadRequest(res, 'Invalid email input.');
      }

      if (
        !!phone1Input &&
        !validator.isNumeric(phone1Input) &&
        !validator.isMobilePhone(phone1Input)
      ) {
        poolClient.release();

        return sendBadRequest(res, 'Invalid phone1 input.');
      }

      if (
        !!phone2Input &&
        !validator.isNumeric(phone2Input) &&
        !validator.isMobilePhone(phone2Input)
      ) {
        poolClient.release();

        return sendBadRequest(res, 'Invalid phone2 input.');
      }

      if (
        !!notesInput &&
        !validator.isLength(notesInput, { min: 1, max: 500 })
      ) {
        poolClient.release();

        return sendBadRequest(res, 'Invalid notes input. (too long)');
      }

      if (!!ageInput && !validator.isNumeric(String(ageInput))) {
        poolClient.release();

        return sendBadRequest(res, 'Invalid age input.');
      }

      if (
        !!genderInput &&
        !validator.isLength(genderInput, { min: 1, max: 100 })
      ) {
        poolClient.release();

        return sendBadRequest(res, 'Invalid gender input. (too long)');
      }

      let updateProClientResult;
      let updatedClient;

      try {
        const updatedAt = moment().toISOString();

        // Update client
        updateProClientResult = await runQuery(
          SQL`
        UPDATE clients
          SET
            name_alias = ${nameAliasInput},
            email_alias = ${emailAliasInput},
            phone_number_1 = ${phone1Input},
            phone_number_2 = ${phone2Input},
            address_1 = ${address1Input},
            address_2 = ${address2Input},
            notes = ${notesInput},
            age = ${ageInput},
            dob = ${dobInput},
            gender = ${genderInput},
            updated_at = ${updatedAt}
          WHERE id = ${clientId}
          RETURNING *;
      `,
          null,
          null,
          poolClient
        );
      } catch (error) {
        poolClient.release();
        // Unique constraint
        const message =
          error && error.code && error.code === '23505'
            ? 'A client already exists with that name.'
            : 'There was a problem updating this client.';

        // Mask sensitive errors
        return sendMaskedError(error, message, next);
      }

      // Finished
      poolClient.release();

      if (updateProClientResult && updateProClientResult.length)
        updatedClient = updateProClientResult[0];

      if (!updatedClient)
        return sendBadRequest(res, 'Could not update this client.');

      // Update the original object with calculated num_session
      client = {
        ...client,
        name_alias: updatedClient.name_alias,
        email_alias: updatedClient.email_alias,
        phone_number_1: updatedClient.phone_number_1,
        phone_number_2: updatedClient.phone_number_2,
        address_1: updatedClient.address_1,
        address_2: updatedClient.address_2,
        notes: updatedClient.notes,
        age: updatedClient.age,
        dob: updatedClient.dob,
        gender: updatedClient.gender,
        updated_at: updatedClient.updated_at,
      };

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.clientsKey(user.id));
      await deleteCachedData(CacheKeys.clientKey(user.id, clientId));

      // Success
      return res.json({
        success: true,
        message: 'Client was updated.',
        data: omit(client, OmitProps.client),
      });
    }
  )
  // Delete client
  .delete(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;

      logger.info(`Delete client for ${user.id}-${clientId}`);

      const poolClient = await pool.connect();

      let rows;

      try {
        // Perform query
        rows = await runQuery(
          SQL`DELETE from clients WHERE id = ${clientId} AND user_id = ${user.id} RETURNING *;`,
          null,
          null,
          poolClient
        );
      } catch (error) {
        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem deleting this client.',
          next
        );
      }

      if (poolClient) poolClient.release();

      if (!rows.length) return sendBadRequest(res, 'Client was not found.');

      // Invalidate cache items
      await deleteCachedData(CacheKeys.clientsKey(user.id));
      await deleteCachedData(CacheKeys.clientKey(user.id, clientId));
      await deleteCachedData(CacheKeys.clientOptionsKey(clientId));

      // Success
      return res.json({
        success: true,
        message: 'Client was removed.',
      });
    }
  );

router
  .route('/:clientId/eventIds')
  // Get eventIds with client
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;
      const { startDate, endDate } = req.query;

      let eventIds = [];

      logger.info(`Get client eventIds (${user.id}-${clientId})`);

      const poolClient = await pool.connect();

      try {
        eventIds = await getCalendarEventIdsForClient(
          user,
          clientId,
          startDate && moment(startDate).toISOString(),
          endDate && moment(endDate).toISOString(),
          poolClient
        );
      } catch (error) {
        if (poolClient) poolClient.release();

        return sendMaskedError(
          error,
          "There was a problem finding this client's schedule.",
          next
        );
      }

      if (poolClient) poolClient.release();

      return res.json({
        success: true,
        data: eventIds,
      });
    }
  );

router
  .route('/:clientId/archive')
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;

      const poolClient = await pool.connect();

      logger.info(`Archive single client (${user.id}-${clientId})`);

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

        return sendMaskedError(
          error,
          'There was a problem finding this client.',
          next
        );
      }

      if (doesUserHaveClientResponse !== true) {
        poolClient.release();

        return sendBadRequest(res, doesUserHaveClientResponse, 401);
      }

      let client;

      try {
        const clientResult = await setIsActive(
          user.id,
          clientId,
          false,
          poolClient
        );

        client = clientResult ? clientResult[0] : null;
      } catch (error) {
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem archiving this client.',
          next
        );
      }

      // Finished
      if (poolClient) poolClient.release();

      if (!client) {
        return sendMaskedError(
          null,
          'There was a problem archiving this client.',
          next
        );
      }

      // Invalidate cache items
      await deleteCachedData(CacheKeys.clientsKey(user.id));
      await deleteCachedData(CacheKeys.clientKey(user.id, clientId));
      await deleteCachedData(CacheKeys.archivedClientsKey(user.id));

      // This client doesn't have num_sessions subquery
      res.json({
        success: true,
        data: omit(client, OmitProps.client),
      });
    }
  );

router
  .route('/:clientId/restore')
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;

      logger.info(`Restore single client (${user.id}-${clientId})`);

      const poolClient = await pool.connect();

      // console.log('user.id', user.id);
      // console.log('clientId', clientId);

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

        return sendMaskedError(
          error,
          'There was a problem finding this client.',
          next
        );
      }

      if (doesUserHaveClientResponse !== true) {
        poolClient.release();

        return sendBadRequest(res, doesUserHaveClientResponse, 401);
      }

      let client;

      try {
        const clientResult = await setIsActive(
          user.id,
          clientId,
          true,
          poolClient
        );

        client = clientResult ? clientResult[0] : null;
      } catch (error) {
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem restoring this client.',
          next
        );
      }

      // Finished
      poolClient.release();

      if (!client) {
        return sendMaskedError(
          null,
          'There was a problem restoring this client.',
          next
        );
      }

      // Invalidate cache items
      await deleteCachedData(CacheKeys.clientsKey(user.id));
      await deleteCachedData(CacheKeys.clientKey(user.id, clientId));
      await deleteCachedData(CacheKeys.archivedClientsKey(user.id));

      // This client doesn't have num_sessions subquery
      res.json({
        success: true,
        data: omit(client, OmitProps.client),
      });
    }
  );

router
  .route('/:clientId/notes')
  // Get notes for client
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;

      logger.info(`Get all client notes (${user.id}-${clientId})`);

      let notes = [];

      const poolClient = await pool.connect();

      try {
        notes = await getAllSessionNotes(clientId, poolClient);
      } catch (error) {
        poolClient.release();

        return sendMaskedError(
          error,
          "There was a problem finding this client's notes.",
          next
        );
      }

      poolClient.release();

      return res.json({
        success: true,
        data: notes,
      });
    }
  );

// Update client temp_sessions_left
router
  .route('/:clientId/temp-sessions')
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;
      const { tempSessionsLeft } = req.body;

      logger.info(
        `Update client temp sessions for user ${user.id}-${clientId}`
      );

      // Missing required fields
      if (!tempSessionsLeft)
        return sendBadRequest(res, 'Missing required input.');
      if (!clientId) return sendBadRequest(res, 'Missing required input.');
      if (parseInt(tempSessionsLeft, 10) && parseInt(tempSessionsLeft, 10) > 0)
        return sendBadRequest(res, 'Value must be negative.');

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

      let clientTempSessions;
      let deleteClientSessions;
      let getClientData;

      try {
        // Update client tempSessionsLeft
        clientTempSessions = await writeTempSessionsLeft(
          user.id,
          clientId,
          tempSessionsLeft,
          poolClient
        );

        if (!clientTempSessions) {
          handleRollback();

          // Mask sensitive errors
          return sendMaskedError(
            null,
            'Unable to write negative sessions',
            next
          );
        }

        deleteClientSessions = await deleteUnusedSessions(clientId);

        if (!deleteClientSessions) {
          handleRollback();

          // Mask sensitive errors
          return sendMaskedError(
            null,
            'Unable to remove unused sessions',
            next
          );
        }

        await deleteCachedData(CacheKeys.clientsKey(user.id));
        await deleteCachedData(CacheKeys.clientKey(user.id, clientId));

        getClientData = await getClient(user.id, clientId, poolClient);

        if (!getClientData) {
          handleRollback();

          // Mask sensitive errors
          return sendMaskedError(null, 'Unable to retrieve client', next);
        }
      } catch (error) {
        handleRollback();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'Unable to update client negative sessions',
          next
        );
      }

      if (!clientTempSessions) {
        handleRollback();

        return sendBadRequest(
          res,
          'Could not update client negative sessions.'
        );
      }

      try {
        // Commit transaction
        await poolClient.query('COMMIT');
      } catch (error) {
        handleRollback();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem handling this transaction.',
          next
        );
      }

      // Release client
      poolClient.release();
      // // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.clientsKey(user.id));
      await deleteCachedData(CacheKeys.clientKey(user.id, clientId));
      await deleteCachedData(CacheKeys.sessionsKey(clientId));
      await deleteCachedData(CacheKeys.usedSessionCountKey(clientId));
      await deleteCachedData(CacheKeys.availableSessionsKey(clientId));
      await deleteCachedData(CacheKeys.usedSessionsKey(clientId));

      return res.json({
        success: true,
        message: 'Session count was updated.',
        data: getClientData,
      });
    }
  );

router
  .route('/:clientId/avatar')
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;

      logger.info(`Update client avatar (${user.id}-${clientId})`);

      const imageUpload = s3Upload(
        S3Buckets.clientAvatars,
        `${clientId}`
      ).single('image');

      const poolClient = await pool.connect();

      imageUpload(req, res, async err => {
        if (err) {
          return res.status(422).json({
            success: false,
            error: 'Image Upload Error',
            message: err.message,
          });
        }

        const updatedAt = moment().toISOString();
        let rows;

        try {
          rows = await runQuery(
            SQL`
            UPDATE clients
              SET
                avatar = ${req.file.location},
                updated_at = ${updatedAt}
              WHERE id = ${clientId}
              RETURNING *;
          `,
            null,
            null,
            poolClient
          );
        } catch (error) {
          if (poolClient) poolClient.release();

          // Mask sensitive errors
          return sendMaskedError(
            error,
            'There was a problem updating your avatar.',
            next
          );
        }

        const updatedUser = {
          ...rows[0],
        };

        if (poolClient) poolClient.release();

        await deleteCachedData(CacheKeys.clientsKey(user.id));
        await deleteCachedData(CacheKeys.clientKey(user.id, clientId));

        return res.json({
          success: true,
          message: 'Client avatar was updated.',
          data: omit(updatedUser, OmitProps.client),
        });
      });
    }
  );

/* Allow anyone to unsubscribe */
router.route('/:clientId/unsubscribe').get(
  [
    // passport.authenticate('jwt', { session: false }),
    // requireSubscriptionTier(1),
  ],
  async (req, res, next) => {
    // const { user } = req;
    const { clientId } = req.params;

    logger.info(`Unsubscribe single client from email ${clientId}`);

    const poolClient = await pool.connect();

    const client = await getClientSimpleDANGER(clientId, poolClient);

    if (!client) {
      poolClient.release();

      return sendBadRequest(res, 'Could not find this client');
    }

    const user = await getUser(client.user_id, poolClient);

    if (!user) {
      poolClient.release();

      return sendBadRequest(res, 'Could not find this user');
    }

    const userMeta = await getOrCreateUserMeta(user.id);

    let message = 'Successfully unsubscribed';

    if (userMeta.clientIdsWhoHaveUnsubscribed.includes(String(client.id)))
      message = 'User has already been unsubscribed';
    else userMeta.unsubscribeClient(client.id);

    poolClient.release();

    return res.json({
      success: true,
      data: userMeta,
      message,
    });
  }
);

/* Allow anyone to resubscribe */
router.route('/:clientId/unsubscribe-mistake').get(
  [
    // passport.authenticate('jwt', { session: false }),
    // requireSubscriptionTier(1),
  ],
  async (req, res, next) => {
    // const { user } = req;
    const { clientId } = req.params;

    logger.info(`Re-subscribe single client from email ${clientId}`);

    const poolClient = await pool.connect();

    const client = await getClientSimpleDANGER(clientId, poolClient);

    if (!client) {
      poolClient.release();

      return sendBadRequest(res, 'Could not find this client');
    }

    const user = await getUser(client.user_id, poolClient);

    if (!user) {
      poolClient.release();

      return sendBadRequest(res, 'Could not find this user');
    }

    const userMeta = await getOrCreateUserMeta(user.id);

    let message = 'Successfully resubscribed';

    if (!userMeta.clientIdsWhoHaveUnsubscribed.includes(String(client.id)))
      message = 'User has not unsubscribed';
    else userMeta.unsubscribeClientMistake(client.id);

    poolClient.release();

    return res.json({
      success: true,
      data: userMeta,
      message,
    });
  }
);

export default router;
