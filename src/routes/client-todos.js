import express from 'express';
import validator from 'validator';

import passport from '@/passport';
import { CacheKeys } from '@/constants';
import { sendMaskedError, sendBadRequest } from '@/helpers';
import { deleteCachedData } from '@/redis/helpers';
import {
  getClientTodo,
  getClientTodos,
  createNewClientTodo,
  updateClientTodo,
  deleteClientTodo,
} from '@/models/clientTodos';
import logger from '@/logger';
import pool from '@/postgres';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';

const router = express.Router();

router
  .route('/:clientId')
  // Get todos list for particular client
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { clientId } = req.params;

      try {
        // Perform query
        const rows = await getClientTodos(clientId);

        // Success
        return res.json({
          success: true,
          data: rows,
        });
      } catch (error) {
        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this list.',
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
      const { todo, isComplete } = req.body;

      // Missing required fields
      if (!todo) return sendBadRequest(res, 'Missing required input.');
      if (!clientId) return sendBadRequest(res, 'Missing required input.');

      logger.info(`Create client todo (${user.id}-${clientId})`);

      // Escape optional fields
      const todoInput = validator.escape(todo.toString());
      const isCompleteInput =
        validator.escape(String(isComplete)).toLowerCase() === 'true';

      // Connect to pool to handle transaction (no need to try/catch here)
      const poolClient = await pool.connect();

      const handleRollback = async () => {
        // Rollback transaction
        await poolClient.query('ROLLBACK');
        // Release client
        poolClient.release();
      };

      try {
        // Begin transaction
        await poolClient.query('BEGIN');
      } catch (error) {
        // Release client
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(error, 'Could not connect to database.', next);
      }
      let clientTodo;

      try {
        // Create client todo
        clientTodo = await createNewClientTodo(
          {
            clientId,
            todo: todoInput,
            isComplete: isCompleteInput,
          },
          poolClient
        );
      } catch (error) {
        handleRollback();

        // Mask sensitive errors
        return sendMaskedError(error, 'Unable to create client todo', next);
      }

      if (!clientTodo) {
        handleRollback();

        return sendBadRequest(res, 'Could not create new client todo.');
      }

      // Release client
      poolClient.release();

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.clientTodosKey('all'));
      await deleteCachedData(CacheKeys.clientTodosKey(clientId));

      return res.json({
        success: true,
        message: 'New client todo was added.',
        data: clientTodo,
      });
    }
  );

router
  .route('/:clientId/:todoId')
  .patch(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId, todoId } = req.params;
      const { todo, isComplete } = req.body;

      // Missing required fields
      if (!todoId) return sendBadRequest(res, 'Missing required input.');
      if (!todo) return sendBadRequest(res, 'Missing required input.');

      logger.info(`Update client todo for user ${user.id} and todo  ${todoId}`);

      const todoInput = validator.escape(todo.toString());
      const isCompleteInput =
        validator.escape(String(isComplete)).toLowerCase() === 'true';

      // Connect to pool to handle transaction (no need to try/catch here)
      const poolClient = await pool.connect();

      // Todo may not exist
      let existingTodo;

      try {
        existingTodo = await getClientTodo(clientId, todoId, poolClient);
      } catch (error) {
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this todo.',
          next
        );
      }

      if (!existingTodo) {
        poolClient.release();

        return sendBadRequest(res, 'Could not find this todo.');
      }

      let clientTodo;
      const inputs = {
        todo: todoInput,
        isComplete: isCompleteInput,
      };

      try {
        // update client todo
        clientTodo = await updateClientTodo(todoId, inputs, poolClient);
      } catch (error) {
        poolClient.release();

        return sendMaskedError(error, 'Unable to update client todo', next);
      }

      if (!clientTodo) {
        poolClient.release();

        return sendBadRequest(res, 'Could not update client todo.');
      }

      // Release client
      poolClient.release();

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.clientTodosKey('all'));
      await deleteCachedData(CacheKeys.clientTodosKey(clientId));
      await deleteCachedData(CacheKeys.clientTodoKey(clientId, todoId));

      return res.json({
        success: true,
        message: 'Client todo was updated.',
        data: clientTodo,
      });
    }
  )
  // Delete client todo
  .delete(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { clientId, todoId } = req.params;

      if (!todoId) return sendBadRequest(res, 'Missing required input.');

      logger.info(`Delete client todo for user ${user.id} and todo ${todoId}`);

      // Connect to pool to handle transaction (no need to try/catch here)
      const poolClient = await pool.connect();

      // Todo may not exist
      let existingTodo;

      try {
        existingTodo = await getClientTodo(clientId, todoId, poolClient);
      } catch (error) {
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(
          error,
          'There was a problem finding this todo.',
          next
        );
      }

      if (!existingTodo) {
        poolClient.release();

        return sendBadRequest(res, 'Could not find this todo.');
      }

      let clientTodo;

      try {
        // delete client todo
        clientTodo = await deleteClientTodo(todoId, poolClient);
      } catch (error) {
        poolClient.release();

        // Mask sensitive errors
        return sendMaskedError(error, 'Unable to delete client todo', next);
      }

      // Release client
      poolClient.release();

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.clientTodosKey('all'));
      await deleteCachedData(CacheKeys.clientTodosKey(clientId));
      await deleteCachedData(CacheKeys.clientTodoKey(clientId, todoId));

      return res.json({
        success: true,
        message: 'Client todo was deleted.',
        data: clientTodo,
      });
    }
  );

export default router;
