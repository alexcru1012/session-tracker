import express from 'express';
import validator from 'validator';
import * as Sentry from '@sentry/node';
import createError from 'http-errors';

import passport from '@/passport';
import { sendBadRequest, sendMaskedError, omit } from '@/helpers';
import { deleteCachedData } from '@/redis/helpers';
import { getMessagesForChat, addMessageToChat } from '@/models/chatMessages';
import { addUserToChat, getChatUser } from '@/models/chatUsers';
import { createChat, getChats } from '@/models/chats';
import { CacheKeys, OmitProps } from '@/constants';
import pool from '@/postgres';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';

const router = express.Router();

router
  .route('/')
  // Send message to recipient (without a known chatId)
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { recipientId: _rId, message } = req.body;

      let recipientId = _rId ? validator.escape(String(_rId) || '') : null;
      let messageInput = validator.escape(message || '');

      messageInput = messageInput.substring(0, 1001);
      recipientId = recipientId ? parseInt(recipientId, 10) : null;

      if (!recipientId || !messageInput)
        return sendBadRequest(res, 'Missing required input.');

      // Validate
      if (!validator.isLength(messageInput, { min: 1, max: 1000 }))
        return sendBadRequest(res, 'Invalid message input. (too long)');

      // Find or create chat between the user and recipient
      let chat;
      const chats = await getChats(user.id);

      for (let i = 0; i < chats.length; i++) {
        const c = chats[i];

        // Found chat between the 2 users
        if (
          c &&
          c.users &&
          c.users.length === 2 &&
          c.users.includes(user.id) &&
          c.users.includes(recipientId)
        )
          chat = c;
      }

      // Connect to pool to handle transaction (no need to try/catch here)
      const poolClient = await pool.connect();

      const handleRollback = async () => {
        console.log('ROLLBACK');
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

        return sendMaskedError(error, 'Could not connect to database.', next);
      }

      // Create new chat
      if (!chat) {
        try {
          chat = await createChat(poolClient);

          await addUserToChat(chat.id, user.id, poolClient);
          await addUserToChat(chat.id, recipientId, poolClient);
        } catch (error) {
          console.log('new chat error', error);
          Sentry.captureException(error);
          handleRollback();

          return sendMaskedError(error, 'Could not create new chat.', next);
        }
      }

      // Send message
      let messageResult;

      try {
        messageResult = await addMessageToChat(
          chat.id,
          user.id,
          message,
          poolClient
        );
      } catch (error) {
        console.log('message error', error);
        Sentry.captureException(error);
        handleRollback();

        return sendMaskedError(
          error,
          'There was a problem sending this chat message.',
          next
        );
      }

      try {
        // Commit transaction
        await poolClient.query('COMMIT');
      } catch (error) {
        console.log('commit error', error);
        Sentry.captureException(error);
        handleRollback();

        return sendMaskedError(
          error,
          'There was a problem handling this transaction.',
          next
        );
      }

      // Release client
      poolClient.release();

      // Invalidate cache so user can fetch new data
      await deleteCachedData(CacheKeys.chats(user.id));
      await deleteCachedData(CacheKeys.chats(recipientId));
      await deleteCachedData(CacheKeys.messagesForChat(chat.id));

      return res.json({
        success: !!messageResult,
        data: omit(messageResult, OmitProps.chatMessage),
      });
    }
  );

router
  .route('/:chatId')
  // Get messages for chat
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { chatId } = req.params;

      let chatUser;

      // Make sure auth user exists within this chat, otherwise 401
      try {
        chatUser = await getChatUser(chatId, user.id);
      } catch (error) {
        Sentry.captureException(error);

        return sendMaskedError(
          error,
          'There was a problem fetching this chat.',
          next
        );
      }

      if (!chatUser) return next(createError(401));

      try {
        const messages = await getMessagesForChat(chatId, user.id);

        return res.json({
          success: true,
          data: messages.map(m => omit(m, OmitProps.chatMessage)),
        });
      } catch (error) {
        Sentry.captureException(error);

        return sendMaskedError(
          error,
          "There was a problem fetching this chat's messages.",
          next
        );
      }
    }
  );

export default router;
