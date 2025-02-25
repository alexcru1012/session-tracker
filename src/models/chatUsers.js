import SQL from 'sql-template-strings';

import { CacheKeys } from '../constants';
import { runQuery } from '../helpers';

export const getChatUsers = (chatId, poolClient) => {
  const cacheKey = CacheKeys.usersForChat(chatId);

  return runQuery(
    SQL`
      SELECT * FROM chat_users
        WHERE chat_id = ${chatId};
    `,
    cacheKey,
    null,
    poolClient
  );
};

export const getChatUser = async (chatId, userId, poolClient) => {
  const cacheKey = CacheKeys.chatUser(chatId, userId);

  const result = await runQuery(
    SQL`
      SELECT * from chat_users
      WHERE chat_id = ${chatId}
      AND user_id = ${userId};
    `,
    cacheKey,
    null,
    poolClient
  );

  return result && result.length ? result[0] : null;
};

export const addUserToChat = (chatId, userId, poolClient) =>
  runQuery(
    SQL`
      INSERT INTO chat_users (chat_id, user_id)
        VALUES (${chatId}, ${userId})
        RETURNING *;
    `,
    null,
    null,
    poolClient
  );

export default {};
