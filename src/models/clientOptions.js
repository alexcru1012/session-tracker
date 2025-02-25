import SQL from 'sql-template-strings';
import moment from 'moment-timezone';

import { runQuery } from '@/helpers';
import { CacheKeys } from '@/constants';

export const getClientOptions = async (clientId, poolClient) => {
  const cacheKey = CacheKeys.clientOptionsKey(clientId);

  const rows = await runQuery(
    SQL`
      SELECT * FROM client_options
      WHERE client_id = ${clientId};
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const getSingleOption = async (clientId, optionId, poolClient) => {
  const cacheKey = CacheKeys.clientOptionKey(clientId, optionId);

  const rows = await runQuery(
    SQL`
      SELECT * FROM client_options
      WHERE id = ${optionId} AND client_id = ${clientId};
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const getSingleOptionByKey = async (clientId, optionKey, poolClient) => {
  // Use key as optionId
  const cacheKey = CacheKeys.clientOptionKey(clientId, optionKey);

  const rows = await runQuery(
    SQL`
      SELECT * FROM client_options
      WHERE option_key = ${optionKey} AND client_id = ${clientId};
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const createClientOption = async (
  clientId,
  optionKey,
  optionValue,
  poolClient
) => {
  const createdAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
      INSERT INTO client_options (client_id, option_key, option_value, created_at, updated_at)
      VALUES (${clientId}, ${optionKey}, ${optionValue}, ${createdAt}, ${createdAt})
      RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const updateClientOption = async (optionId, optionValue, poolClient) => {
  const updatedAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
    UPDATE client_options
    SET
    option_value = ${optionValue},
    updated_at = ${updatedAt}
    WHERE id = ${optionId}
      RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export default {};
