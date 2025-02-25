import express from 'express';
import SQL from 'sql-template-strings';
import validator from 'validator';
import moment from 'moment';
import * as Sentry from '@sentry/node';

import {
  omit,
  runQuery,
  sendMaskedError,
  sendBadRequest,
  doesUserHaveClient,
  parseBoolean,
} from '@/helpers';
import { deleteCachedData } from '@/redis/helpers';
import { sendSessionReceipt } from '@/emails/sessions';
import {
  getSessions,
  getSession,
  createNewSession,
  useSession,
  resetClientSessionToPaid,
  addSessionsForClient,
  removeSessionsForClient,
} from '@/models/sessions';
import pool from '@/postgres';
import passport from '@/passport';
import {
  OmitProps,
  CacheKeys,
  Attendance,
  Attendances,
  TierLimits,
} from '@/constants';
import logger from '@/logger';
import {
  getClientSimple,
  // getTempSessionsLeft,
  getClientCountAndUserTier,
  writeTempSessionsLeft,
} from '@/models/clients';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';

const router = express.Router();

router
  .route('/:clientId')
  // Get client sessions
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;

      logger.info(`Get client sessions (${user.id}-${clientId})`);

      // Connect to pool to handle transaction (no need to try/catch here)
      const poolClient = await pool.connect();

      // First see if user owns this client
      const doesUserHaveClientResponse = await doesUserHaveClient(
        user.id,
        clientId,
        poolClient
      );

      if (doesUserHaveClientResponse !== true) {
        poolClient.release();

        return sendBadRequest(res, doesUserHaveClientResponse, 401);
      }

      // Get client
      try {
        const rows = await getSessions(clientId, poolClient);

        const used = rows
          .filter(row => !!row.used_at)
          .map(row => omit(row, OmitProps.session));
        const available = rows.filter(row => !row.used_at).map(row => row.id);
        const unpaid = rows.filter(row => !row.paid).map(row => row.id);

        poolClient.release();

        return res.json({
          success: true,
          data: {
            used_sessions: used,
            available_sessionIds: available,
            unpaid_sessionIds: unpaid,
          },
        });
      } catch (error) {
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          "There was a problem finding this client's sessions.",
          next
        );
      }
    }
  )
  // Create client session
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;
      const { availableSessions } = req.body;

      // Missing required input
      if (availableSessions === undefined || availableSessions === null)
        return sendBadRequest(res, 'Missing required input.');

      logger.info(`Create client session (${user.id}-${clientId})`);

      // Escape optional fields
      let availableSessionsInput = validator.escape(String(availableSessions));
      if (parseInt(availableSessions, 10) <= 0 || availableSessionsInput <= 0)
        availableSessionsInput = 0;
      else if (availableSessionsInput > 100) availableSessionsInput = 100;

      // Validate
      if (!validator.isNumeric(String(availableSessionsInput)))
        return sendBadRequest(res, 'Invalid availableSessions input.');

      // Connect to pool to handle transaction (no need to try/catch here)
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

      // Start transaction
      const handleRollback = async () => {
        // Rollback transaction
        await poolClient.query('ROLLBACK');
        // Release client
        poolClient.release();
      };

      // Begin transaction
      await poolClient.query('BEGIN');

      let numRowsAvailable;

      try {
        const numRowsAvailableResponse = await poolClient.query(
          SQL`SELECT COUNT(*) FROM sessions WHERE client_id = ${clientId} AND used_at IS NULL;`
        );

        numRowsAvailable = numRowsAvailableResponse.rows[0].count;
      } catch (error) {
        handleRollback();

        // Mask sensitive errors
        return sendMaskedError(error, 'Could not fetch sessions.', next);
      }

      const difference =
        parseInt(availableSessionsInput, 10) - parseInt(numRowsAvailable, 10);

      // Create or remove sessions
      if (difference !== 0) {
        try {
          if (difference > 0)
            await addSessionsForClient(difference, clientId, poolClient);
          else await removeSessionsForClient(difference, clientId, poolClient);
        } catch (error) {
          handleRollback();

          // Mask sensitive errors
          return sendMaskedError(
            error,
            'There was a problem updating sessions.',
            next
          );
        }
      }

      let client;

      try {
        // const client = await getClientSimple(user.id, clientId, poolClient);

        // Reset temp_sessions_left on the client
        // Cannot add new sessions unless sessions_left is at least 0
        // not sure if its necessary to always match temp_sessions_left and sessions_left
        // since temp_sessions_left is just for tracking negative numbers
        client = await writeTempSessionsLeft(
          user.id,
          clientId,
          0, // (client.temp_sessions_left || 0) + difference,
          poolClient
        );
      } catch (error) {
        handleRollback();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem updating client temp session count.',
          next
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

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.allUsedSessionsForUser(user.id));
      await deleteCachedData(CacheKeys.allUsedSessionsForUserMonthly(user.id));
      await deleteCachedData(CacheKeys.usedSessionsKey(clientId));
      await deleteCachedData(CacheKeys.sessionsKey(clientId));
      await deleteCachedData(CacheKeys.allSessionNotesKey(clientId));
      await deleteCachedData(CacheKeys.clientsKey(user.id));
      await deleteCachedData(CacheKeys.clientKey(user.id, clientId));
      await deleteCachedData(CacheKeys.clientSimpleKey(user.id, clientId));
      await deleteCachedData(CacheKeys.dashboard.weeklySummary(user.id));
      await deleteCachedData(CacheKeys.dashboard.monthlySummary(user.id));

      try {
        const rows = await getSessions(clientId, poolClient);

        const used = rows
          .filter(row => !!row.used_at)
          .map(row => omit(row, OmitProps.session));
        const available = rows.filter(row => !row.used_at).map(row => row.id);
        const unpaid = rows.filter(row => !row.paid).map(row => row.id);

        // Release client
        poolClient.release();

        return res.json({
          success: true,
          message: 'Sessions were updated.',
          data: {
            client: omit(client, OmitProps.client),
            used_sessions: used,
            available_sessionIds: available,
            unpaid_sessionIds: unpaid,
          },
        });
      } catch (error) {
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem updating these sessions.',
          next
        );
      }
    }
  );

router
  .route('/:clientId/:sessionId')
  // Get client session
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId, sessionId } = req.params;

      logger.info(
        `Get single client session (${user.id}-${clientId}-${sessionId})`
      );

      // First see if user owns this client
      let doesUserHaveClientResponse;

      // Connect to pool to handle transaction (no need to try/catch here)
      const poolClient = await pool.connect();

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

      // Get client
      try {
        const session = await getSession(clientId, sessionId, poolClient);

        poolClient.release();

        return res.json({
          success: true,
          data: omit(session, OmitProps.session),
        });
      } catch (error) {
        logger.error(
          `ERROR! get /:clientId/:sessionId clientId: ${clientId}, sessionId: ${sessionId}`
        );

        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this session.',
          next
        );
      }
    }
  )
  // Update client session
  .patch(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId, sessionId: _sId } = req.params;
      const {
        usedAt,
        clientWasPresent, // TODO: deprecated
        attendance,
        notes,
        price,
        paid,
        sessionTypeId,
        sendReceipt,
        message,
        duration,
        ccMe,
      } = req.body;

      logger.info(`Update client session (${user.id}-${clientId}-${_sId})`);

      const poolClient = await pool.connect();

      // Begin transaction
      await poolClient.query('BEGIN');

      const handleRollback = async () => {
        // Rollback transaction
        await poolClient.query('ROLLBACK');
        // Release client
        poolClient.release();
      };

      // Find current client
      let client;

      try {
        client = await getClientSimple(user.id, clientId, poolClient);
      } catch (error) {
        handleRollback();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this client.',
          next
        );
      }
      if (!client) {
        handleRollback();

        // Mask sensitive errors
        return sendMaskedError(
          null,
          'There was a problem finding this client.',
          next
        );
      }

      let sessionId = _sId;

      // Session may not exist
      let session;
      // let wasTakenFromAvailable;
      let availableSessions;

      try {
        const availableSessionsResponse = await poolClient.query(
          SQL`SELECT id FROM sessions WHERE client_id = ${clientId} AND used_at IS NULL;`
        );

        availableSessions = availableSessionsResponse.rows;
      } catch (error) {
        handleRollback();

        // Mask sensitive errors
        return sendMaskedError(error, 'Could not fetch sessions.', next);
      }

      // Ignore special input
      if (sessionId !== '-1') {
        try {
          session = await getSession(clientId, sessionId, poolClient);
        } catch (error) {
          logger.error(
            `ERROR! patch1 /:clientId/:sessionId clientId: ${clientId}, sessionId: ${sessionId}`
          );

          handleRollback();

          // Mask sensitive errors
          return sendMaskedError(
            error,
            'There was a problem finding this session.',
            next
          );
        }
      } else if (availableSessions && availableSessions.length) {
        // wasTakenFromAvailable = true;
        // Pick one
        session = availableSessions[0];
        sessionId = session?.id;
        // Find it again
        try {
          session = await getSession(clientId, sessionId, poolClient);

          // Set tempSessions to 0 just incase
          client = await writeTempSessionsLeft(
            user.id,
            clientId,
            0,
            poolClient
          );
        } catch (error) {
          handleRollback();

          logger.error(
            `ERROR! patch2 /:clientId/:sessionId clientId: ${clientId}, sessionId: ${sessionId}`
          );

          // Mask sensitive errors
          return sendMaskedError(
            error,
            'There was a problem finding this session.',
            next
          );
        }
      } else {
        // Create one
        try {
          session = await createNewSession(clientId, poolClient);
          sessionId = session ? session.id : null;

          // Display a temporary negative number to the user
          let tempSessionsLeft = client ? client.temp_sessions_left : 0;

          tempSessionsLeft--;

          // smallint max?
          if (tempSessionsLeft < -32768) {
            handleRollback();

            return sendBadRequest(
              res,
              'There was a problem updating temp session count.'
            );
          }

          // Subtract one from tempSessions
          client = await writeTempSessionsLeft(
            user.id,
            clientId,
            tempSessionsLeft,
            poolClient
          );
        } catch (error) {
          handleRollback();

          // Mask sensitive errors
          return sendMaskedError(
            error,
            'There was a problem creating a new session.',
            next
          );
        }
      }

      if (!session) {
        handleRollback();

        return sendMaskedError(
          null,
          'There was a problem finding a session to use.',
          next
        );
      }

      const sessionWasUsed = session.id && !session.used_at;

      // First see if user owns this client
      try {
        const doesUserHaveClientResponse = await doesUserHaveClient(
          user.id,
          clientId,
          poolClient
        );

        if (doesUserHaveClientResponse !== true) {
          handleRollback();

          return sendBadRequest(res, doesUserHaveClientResponse, 401);
        }
      } catch (error) {
        handleRollback();

        return sendBadRequest(res, error.message, 401);
      }

      // Annoy early users who have more than 3 clients and are still logging sessions
      // Get clients limit based on user's tier level
      try {
        const countAndTierRes = await getClientCountAndUserTier(
          user.id,
          poolClient
        );
        const { tier, clients_count } = countAndTierRes;
        // If user has more than allowed num clients
        if (sessionWasUsed && tier < 2 && clients_count > TierLimits[tier]) {
          // Error, b*tch!
          handleRollback();

          return res.status(400).json({
            success: false,
            message:
              'Client limit reached! Please archive some clients or upgrade plans to continue.',
            data: {
              tier,
              clients_count,
            },
          });
        }
      } catch (error) {
        // continue...
      }

      // Set optional fields
      let paidInput = session ? session.paid : null;

      paidInput = parseBoolean(paid);
      if (paidInput === null) paidInput = true;

      // Required
      let attendanceInput = !!attendance ? validator.escape(attendance) : null;

      // TODO remove
      if (!attendanceInput) {
        attendanceInput = clientWasPresent
          ? Attendance.present
          : Attendance.absent;
      }

      if (!attendanceInput || !Attendances.includes(attendanceInput)) {
        handleRollback();

        return sendBadRequest(res, 'Invalid attendance input.');
      }

      let usedAtInput = !!usedAt ? validator.escape(usedAt) : null;
      if (usedAtInput === null)
        usedAtInput = session ? session.used_at : moment().toISOString();

      const sessionTypeIdInput = !!sessionTypeId
        ? validator.escape(String(sessionTypeId))
        : null;
      let notesInput = notes ? validator.escape(notes) : '';

      // Because someone keeps crashing the server with long notes
      notesInput = notesInput.substring(0, 501);
      const priceInput = price
        ? Math.min(Math.max(parseFloat(price) || 0.0, 0.0), 999999.9999)
        : null;

      const durationInput = duration
        ? validator.escape(String(duration))
        : null;

      // Validate
      if (!!usedAtInput && !validator.isISO8601(usedAtInput)) {
        handleRollback();

        return sendBadRequest(res, 'Invalid usedAt input.');
      }

      // Why doesn't this detect long notes?
      if (
        !!notesInput &&
        !validator.isLength(notesInput, { min: 1, max: 500 })
      ) {
        handleRollback();

        return sendBadRequest(res, 'Invalid notes input. (too long)');
      }

      if (
        !!sessionTypeIdInput &&
        !validator.isNumeric(sessionTypeIdInput, { no_symbols: true })
      ) {
        handleRollback();

        return sendBadRequest(res, 'Invalid sessionTypeId input.');
      }

      // Validate price
      if (
        !!priceInput &&
        (priceInput > 999999.9999 ||
          priceInput < 0 ||
          !validator.isNumeric(String(priceInput)))
      ) {
        handleRollback();

        return sendBadRequest(res, 'Invalid price input. (numbers only)');
      }
      if (
        !!durationInput &&
        !validator.isNumeric(String(durationInput), {
          no_symbols: true,
          min: 1, // 1 second
          max: 86400, // 1 day
        })
      )
        return sendBadRequest(res, 'Invalid duration input.');

      if (!session || !sessionId)
        return sendBadRequest(res, 'Session was not found.');

      // Update
      let updateSessionResult;

      try {
        const updatedAt = moment().toISOString();

        // Update session
        updateSessionResult = await useSession(
          sessionId,
          {
            usedAtInput,
            attendanceInput,
            notesInput,
            priceInput,
            paidInput,
            sessionTypeIdInput,
            durationInput,
            updatedAt,
          },
          poolClient
        );
        // Update
        if (updateSessionResult && updateSessionResult.length)
          session = updateSessionResult[0];
      } catch (error) {
        handleRollback();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem updating this session.',
          next
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

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.allUsedSessionsForUser(user.id));
      await deleteCachedData(CacheKeys.allUsedSessionsForUserMonthly(user.id));
      await deleteCachedData(CacheKeys.usedSessionsKey(clientId));
      await deleteCachedData(CacheKeys.clientsKey(user.id));
      await deleteCachedData(CacheKeys.clientKey(user.id, clientId));
      await deleteCachedData(CacheKeys.clientSimpleKey(user.id, clientId));
      await deleteCachedData(CacheKeys.sessionsKey(clientId));
      await deleteCachedData(CacheKeys.sessionKey(sessionId));
      await deleteCachedData(CacheKeys.availableSessionsKey(clientId));
      await deleteCachedData(CacheKeys.usedSessionCountKey(clientId));
      await deleteCachedData(CacheKeys.allSessionNotesKey(clientId));
      await deleteCachedData(CacheKeys.dashboard.weeklySummary(user.id));
      await deleteCachedData(CacheKeys.dashboard.monthlySummary(user.id));

      const rows = await getSessions(clientId, poolClient);
      const used = rows
        .filter(row => !!row.used_at)
        .map(row => omit(row, OmitProps.session));
      const available = rows.filter(row => !row.used_at).map(row => row.id);
      const unpaid = rows.filter(row => !row.paid).map(row => row.id);

      // Remove used sessionId from availableIds
      // const available_sessionIds = (
      //   (wasTakenFromAvailable
      //     ? availableSessions.slice(1)
      //     : availableSessions) || []
      // )
      //   .map(s => s.id)
      //   .filter(sId => sId !== session.id);

      // Use patch params here instead of reading client settings
      // Incase the user doesn't want to send an email this time only
      if (sessionWasUsed && sendReceipt && client && client.email_alias) {
        try {
          // Send email
          await sendSessionReceipt(
            user.id,
            clientId,
            sessionId,
            message,
            ccMe,
            poolClient
          );
        } catch (err) {
          Sentry.captureException(err);
          logger.error(err);
        }
      }

      // Release client
      if (poolClient) poolClient.release();

      return res.json({
        success: true,
        message: 'Session was updated.',
        data: omit(session, OmitProps.session),
        // TODO eventually refactor these into a data object...
        client: omit(client, OmitProps.client),
        session: omit(session, OmitProps.session),
        used_sessions: used,
        available_sessionIds: available,
        unpaid_sessionIds: unpaid,
      });
    }
  )
  // Delete session
  .delete(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId, sessionId } = req.params;

      logger.info(
        `Delete client session (${user.id}-${clientId}-${sessionId})`
      );

      // Connect to pool to handle transaction (no need to try/catch here)
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

      // let tempSessionsLeftResponse;

      // try {
      //   tempSessionsLeftResponse = await getTempSessionsLeft(
      //     user.id,
      //     clientId,
      //     poolClient
      //   );
      // } catch (error) {
      //   // Allow error
      //   Sentry.captureException(error);
      // }

      // const tempSessionsLeft = tempSessionsLeftResponse
      //   ? tempSessionsLeftResponse.temp_sessions_left
      //   : 0;

      let updatedSession;

      try {
        const updatedAt = moment().toISOString();
        // Perform query
        const result = await runQuery(
          SQL`
          UPDATE sessions
            SET
              used_at = NULL,
              notes = NULL,
              price = 0.00,
              paid = true,
              session_type_id = NULL,
              updated_at = ${updatedAt}
            WHERE id = ${sessionId} AND used_at IS NOT NULL
            RETURNING *;
        `,
          null,
          null,
          poolClient
        );

        updatedSession = result && result.length ? result[0] : null;
      } catch (error) {
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem deleting this session.',
          next
        );
      }

      if (!updatedSession) {
        poolClient.release();

        return sendBadRequest(res, 'Session was not found.');
      }

      // Increment whatever the number was
      // User will have 1 session now, so reset temp sessions
      let client;

      try {
        client = await writeTempSessionsLeft(
          user.id,
          clientId,
          0, // tempSessionsLeft + 1,
          poolClient
        );
      } catch (err) {
        Sentry.captureException(err);
      }

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.allUsedSessionsForUser(user.id));
      await deleteCachedData(CacheKeys.allUsedSessionsForUserMonthly(user.id));
      await deleteCachedData(CacheKeys.usedSessionsKey(clientId));
      await deleteCachedData(CacheKeys.clientKey(user.id, clientId));
      await deleteCachedData(CacheKeys.clientsKey(user.id));
      await deleteCachedData(CacheKeys.clientSimpleKey(user.id, clientId));
      await deleteCachedData(CacheKeys.sessionsKey(clientId));
      await deleteCachedData(CacheKeys.sessionKey(sessionId));
      await deleteCachedData(CacheKeys.availableSessionsKey(clientId));
      await deleteCachedData(CacheKeys.usedSessionCountKey(clientId));
      await deleteCachedData(CacheKeys.allSessionNotesKey(clientId));
      await deleteCachedData(CacheKeys.dashboard.weeklySummary(user.id));
      await deleteCachedData(CacheKeys.dashboard.monthlySummary(user.id));
      // We should also delete any cronClientEventSessionAdded that reference this session

      const rows = await getSessions(clientId, poolClient);
      const used = rows
        .filter(row => !!row.used_at)
        .map(row => omit(row, OmitProps.session));
      const available = rows.filter(row => !row.used_at).map(row => row.id);
      const unpaid = rows.filter(row => !row.paid).map(row => row.id);

      poolClient.release();

      // Success
      return res.json({
        success: true,
        message: 'Session was removed.',
        data: {
          client,
          sessionId,
          used_sessions: used,
          available_sessionIds: available,
          unpaid_sessionIds: unpaid,
        },
      });
    }
  );

router
  .route('/:clientId/reset-paid')
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId } = req.params;

      logger.info(`Reset client session to paid (${user.id}-${clientId})`);

      const poolClient = await pool.connect();
      let clientResetPaid;

      try {
        // update client reset-paid
        clientResetPaid = await resetClientSessionToPaid(clientId, poolClient);
      } catch (error) {
        poolClient.release();

        return sendMaskedError(
          error,
          'Unable to reset client session to paid',
          next
        );
      }
      if (!clientResetPaid) {
        poolClient.release();

        return sendBadRequest(res, 'Could not reset client session to paid.');
      }
      poolClient.release();

      await deleteCachedData(CacheKeys.allUsedSessionsForUser(user.id));
      await deleteCachedData(CacheKeys.allUsedSessionsForUserMonthly(user.id));
      await deleteCachedData(CacheKeys.usedSessionsKey(clientId));

      return res.json({
        success: true,
        message: 'Client sessions are reset.',
        data: clientResetPaid,
      });
    }
  );
export default router;
