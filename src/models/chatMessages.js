import SQL from 'sql-template-strings';

import { CacheKeys } from '@/constants';
import { runQuery } from '@/helpers';

export const getMessagesForChat = (chatId, limit = 20, poolClient) => {
  const cacheKey = CacheKeys.messagesForChat(chatId);

  return runQuery(
    SQL`
      SELECT * FROM chat_messages
        WHERE chat_id = ${chatId}
        ORDER BY created_at DESC
        LIMIT ${limit};
    `,
    cacheKey,
    null,
    poolClient
  );
};

export const addMessageToChat = async (chatId, userId, message, poolClient) => {
  const result = await runQuery(
    SQL`
      INSERT INTO chat_messages (chat_id, user_id, message)
        VALUES (${chatId}, ${userId}, ${message})
        RETURNING *;
    `,
    null,
    null,
    poolClient
  );

  return result && result.length ? result[0] : null;
};

export default {};
