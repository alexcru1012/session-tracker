import express from 'express';
import createError from 'http-errors';
import * as Sentry from '@sentry/node';

import passport from '@/passport';
import { omit, sendMaskedError } from '@/helpers';
import { getChat, getChats } from '@/models/chats';
import { getChatUser, getChatUsers } from '@/models/chatUsers';
import { getMessagesForChat } from '@/models/chatMessages';
import { getUser } from '@/models/users';
import { OmitProps } from '@/constants';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';

const router = express.Router();

router
  .route('/')
  // Get my chats
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { include } = req.query;

      const isArr = Array.isArray(include);
      const getUsers = isArr ? include.includes('users') : include === 'users';
      const getMessages = isArr
        ? include.includes('messages')
        : include === 'messages';

      try {
        const chats = await getChats(user.id);

        const included = {};
        // Also fetch users
        if (getUsers) {
          included.users = {};
          for (let i = 0; i < chats.length; i++) {
            const chat = chats[i];
            const users = {};

            if (chat && chat.users) {
              for (let j = 0; j < chat.users.length; j++) {
                const user_id = chat.users[j];
                const chatUser = await getUser(user_id); // eslint-disable-line

                if (chatUser) users[user_id] = omit(chatUser, OmitProps.user);
              }
            }

            included.users[chat.id] = users;
          }
        }
        // Also fetch messages
        if (getMessages) {
          included.messages = {};
          for (let i = 0; i < chats.length; i++) {
            const chat = chats[i];
            const messages = await getMessagesForChat(chat.id); // eslint-disable-line

            if (messages) {
              included.messages[chat.id] = messages.map(m =>
                omit(m, OmitProps.chatMessage)
              );
            }
          }
        }

        return res.json({
          success: true,
          data: chats,
          included,
        });
      } catch (error) {
        Sentry.captureException(error);

        return sendMaskedError(
          error,
          "There was a problem fetching this user's chats.",
          next
        );
      }
    }
  );

router
  .route('/:chatId')
  // Get single chat
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { chatId } = req.params;
      const { include } = req.query;

      const isArr = Array.isArray(include);
      const getUsers = isArr ? include.includes('users') : include === 'users';
      const getMessages = isArr
        ? include.includes('messages')
        : include === 'messages';

      try {
        const chat = await getChat(chatId);

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

        const included = {};
        // Also fetch users
        if (getUsers) {
          included.users = {};
          const users = await getChatUsers(chat.id); // eslint-disable-line

          included.users[chat.id] = users;
        }
        // Also fetch messages
        if (getMessages) {
          included.messages = {};
          const messages = await getMessagesForChat(chat.id); // eslint-disable-line

          included.messages[chat.id] = messages;
        }

        return res.json({
          success: true,
          data: chat,
          included,
        });
      } catch (error) {
        Sentry.captureException(error);

        return sendMaskedError(
          error,
          'There was a problem fetching this chat.',
          next
        );
      }
    }
  );

export default router;
