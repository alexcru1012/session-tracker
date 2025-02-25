import SQL from 'sql-template-strings';

import { CacheKeys } from '@/constants';
import { runQuery } from '@/helpers';

export const getChat = (chatId, poolClient) => {
  const cacheKey = CacheKeys.chat(chatId);

  return runQuery(
    SQL`
      SELECT c.*, array_agg(user_id) AS "users"
      FROM chats c
      INNER JOIN chat_users cu
      ON c.id = chat_id
      WHERE chat_id = ${chatId}
      GROUP BY c.id, chat_id;
    `,
    cacheKey,
    null,
    poolClient
  );
};

export const getChats = (userId, poolClient) => {
  const cacheKey = CacheKeys.chats(userId);

  return runQuery(
    SQL`
      SELECT c.*, array_agg(user_id) AS "users"
      FROM chats c
      INNER JOIN chat_users cu
      ON c.id = chat_id
      WHERE chat_id in (
        SELECT chat_id
        FROM chat_users 
        WHERE user_id = ${userId}
      )
      GROUP BY c.id, chat_id;
    `,
    cacheKey,
    null,
    poolClient
  );
};

export const createChat = poolClient =>
  runQuery(
    SQL`
      INSERT INTO chats
        DEFAULT VALUES
        RETURNING *;
    `,
    null,
    null,
    poolClient
  );

export default {};
