import SQL from 'sql-template-strings';
import moment from 'moment';

import { runQuery } from '@/helpers';
import { CacheKeys } from '@/constants';

export const getClientMeta = async (clientId, poolClient) => {
  const cacheKey = CacheKeys.clientMetasKey(clientId);

  const rows = await runQuery(
    SQL`
      SELECT * FROM client_meta
      WHERE client_id = ${clientId};
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const getSingleMeta = async (clientId, metaId, poolClient) => {
  const cacheKey = CacheKeys.clientMetaKey(clientId, metaId);

  const rows = await runQuery(
    SQL`
      SELECT * FROM client_meta
      WHERE id = ${metaId} AND client_id = ${clientId};
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const getSingleMetaByKey = async (clientId, metaKey, poolClient) => {
  // Use key as metaId
  const cacheKey = CacheKeys.clientMetaKey(clientId, metaKey);

  const rows = await runQuery(
    SQL`
      SELECT * FROM client_meta
      WHERE meta_key = ${metaKey} AND client_id = ${clientId};
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const createClientMeta = async (
  clientId,
  metaKey,
  metaValue,
  poolClient
) => {
  const createdAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
      INSERT INTO client_meta (client_id, meta_key, meta_value, created_at, updated_at)
      VALUES (${clientId}, ${metaKey}, ${metaValue}, ${createdAt}, ${createdAt})
      RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const updateClientMeta = async (
  clientId,
  metaId,
  metaKey,
  metaValue,
  poolClient
) => {
  const updatedAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
    UPDATE client_meta
    SET
    meta_key = ${metaKey},
    meta_value = ${metaValue},
    updated_at = ${updatedAt}
    WHERE id = ${metaId}
    AND client_id = ${clientId}
      RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const deleteClientMeta = async (clientId, metaId, poolClient) =>
  runQuery(
    SQL`
    DELETE FROM client_meta
    WHERE id = ${metaId}
    AND client_id = ${clientId}
    RETURNING *;
  `,
    null,
    null,
    poolClient
  );

export default {};
