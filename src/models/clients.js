import SQL from 'sql-template-strings';
import moment from 'moment';
import format from 'pg-format';

import { CacheKeys } from '@/constants';
import { runQuery } from '@/helpers';

export const getClientsSimple = async (userId, poolClient) => {
  const cacheKey = CacheKeys.clientsSimpleKey(userId);

  const rows = await runQuery(
    SQL`
    SELECT * 
      FROM clients
      WHERE user_id = ${userId};
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const getClients = async (userId, poolClient) => {
  const cacheKey = CacheKeys.clientsKey(userId);

  const rows = await runQuery(
    SQL`
      SELECT c.*, (
        SELECT count(*)
        FROM sessions s
        WHERE s.used_at IS NULL
        AND s.client_id = c.id
      ) as sessions_left,
      (
        SELECT max(max_used_at)
        FROM (
          SELECT id, client_id, used_at, max(used_at)
          OVER (partition by used_at) as max_used_at
          FROM sessions s
          WHERE s.used_at IS NOT NULL
          AND s.used_at <= NOW() AT TIME ZONE 'UTC'
          AND s.client_id = c.id
        ) s2
      ) as last_session_used_at
      FROM clients c
      LEFT OUTER JOIN sessions s
        ON s.client_id = c.id
      WHERE c.user_id = ${userId}
      AND c.is_active = true
      GROUP BY c.id
      ORDER BY c.name_alias ASC;
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const getArchivedClients = async (userId, poolClient) => {
  const cacheKey = CacheKeys.archivedClientsKey(userId);

  const rows = await runQuery(
    SQL`
      SELECT c.*, (
        SELECT count(*)
        FROM sessions s
        WHERE s.used_at IS NULL
        AND s.client_id = c.id
      ) as sessions_left,
      (
        SELECT max(max_used_at)
        FROM (
          SELECT id, client_id, used_at, max(used_at)
          OVER (partition by used_at) as max_used_at
          FROM sessions s
          WHERE s.used_at IS NOT NULL
          AND s.used_at <= NOW() AT TIME ZONE 'UTC'
          AND s.client_id = c.id
        ) s2
      ) as last_session_used_at
      FROM clients c
      LEFT OUTER JOIN sessions s
        ON s.client_id = c.id
      WHERE c.user_id = ${userId}
      AND c.is_active = false
      GROUP BY c.id
      ORDER BY c.name_alias ASC;
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const getClient = async (userId, clientId, poolClient) => {
  const cacheKey = CacheKeys.clientKey(userId, clientId);

  const rows = await runQuery(
    SQL`
      SELECT c.*, (
        SELECT count(*)
        FROM sessions s
        WHERE s.used_at IS NULL
        AND s.client_id = c.id
      ) as sessions_left,
      (
        SELECT max(max_used_at)
        FROM (
          SELECT id, client_id, used_at, max(used_at)
          OVER (partition by used_at) as max_used_at
          FROM sessions s
          WHERE s.used_at IS NOT NULL
          AND s.used_at <= NOW() AT TIME ZONE 'UTC'
          AND s.client_id = c.id
        ) s2
      ) as last_session_used_at
      FROM clients c
      LEFT OUTER JOIN sessions s
        ON s.client_id = c.id
      WHERE c.id = ${clientId}
      AND c.user_id = ${userId}
      GROUP BY c.id
      LIMIT 1;
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const getClientSimple = async (userId, clientId, poolClient) => {
  const cacheKey = CacheKeys.clientSimpleKey(userId, clientId);

  const rows = await runQuery(
    SQL`
      SELECT *
      FROM clients
      WHERE id = ${clientId}
      AND user_id = ${userId}
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

// Not sure why but the missing `AND user_id` makes strange results
// appear in peoples client lists
export const getClientSimpleDANGER = async (clientId, poolClient) => {
  const cacheKey = CacheKeys.clientSimpleKeyDANGER(clientId);

  const rows = await runQuery(
    SQL`
      SELECT *
      FROM clients
      WHERE id = ${clientId}
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

// export const getClientEvents = async (userId, clientId) => {
//   const cacheKey = CacheKeys.myClientEventsKey(userId, clientId);

//   const rows = await runQuery(
//     SQL`
//     SELECT c.id, res.event_ids
//     FROM clients c
//     INNER JOIN (
//       SELECT e.client_id as id, array_agg(e.id) as event_ids
//       FROM calendar_events e
//       WHERE e.client_id = ${clientId}
//       AND e.user_id = ${userId}
//       AND e.is_active = true
//       GROUP BY e.client_id
//     ) res USING (id);
//   `,
//     cacheKey
//   );

//   return rows && rows.length ? rows[0].event_ids : [];
// };

export const getTempSessionsLeft = async (userId, clientId, poolClient) => {
  const rows = await runQuery(
    SQL`
    SELECT temp_sessions_left
    FROM clients
    WHERE id = ${clientId}
    AND user_id = ${userId};
  `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const addNewClient = async (userId, inputs, poolClient) => {
  const {
    nameAliasInput,
    emailAliasInput,
    phone1Input,
    phone2Input,
    address1Input,
    address2Input,
    notesInput,
    ageInput,
    dobInput,
    genderInput,
  } = inputs;

  const createdAt = moment().toISOString();

  const result = await runQuery(
    SQL`
      INSERT INTO clients (user_id, name_alias, email_alias, phone_number_1, phone_number_2, address_1, address_2, notes, age, dob, gender, created_at, updated_at)
        VALUES (${userId}, ${nameAliasInput}, ${emailAliasInput}, ${phone1Input}, ${phone2Input}, ${address1Input}, ${address2Input}, ${notesInput}, ${ageInput}, ${dobInput}, ${genderInput}, ${createdAt}, ${createdAt})
        RETURNING *;
    `,
    null,
    null,
    poolClient
  );

  return result && result.length ? result[0] : null;
};

export const addNewClients = async (userId, inputs, poolClient) => {
  const createdAt = moment().toISOString();

  const data = inputs.map(client => [
    userId,
    client.nameAliasInput,
    client.emailAliasInput,
    client.phone1Input,
    client.phone2Input,
    client.address1Input,
    client.address2Input,
    client.notesInput,
    client.ageInput,
    client.dobInput,
    createdAt,
    createdAt,
  ]);

  const sql = format(
    'INSERT INTO clients (user_id, name_alias, email_alias, phone_number_1, phone_number_2, address_1, address_2, notes, age, dob, created_at, updated_at) VALUES %L ON CONFLICT DO NOTHING RETURNING *',
    data
  );

  return runQuery(sql, null, null, poolClient);
};

export const writeTempSessionsLeft = async (
  userId,
  clientId,
  count,
  poolClient
) => {
  const updatedAt = moment().toISOString();

  const result = await runQuery(
    SQL`
    UPDATE clients
      SET
        temp_sessions_left = ${count},
        updated_at = ${updatedAt}
      WHERE id = ${clientId}
      AND user_id = ${userId}
      RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  return result && result.length ? result[0] : null;
};

export const deleteUnusedSessions = async (clientId, poolClient) =>
  runQuery(
    SQL`
    DELETE 
    FROM 
    sessions
     WHERE client_id = ${clientId} 
     AND used_at is NULL
      RETURNING *
  `,
    null,
    null,
    poolClient
  );

export const setIsActive = async (userId, clientId, isActive, poolClient) => {
  const updatedAt = moment().toISOString();

  return runQuery(
    SQL`
    UPDATE clients
      SET
        is_active = ${isActive},
        updated_at = ${updatedAt}
      WHERE id = ${clientId}
      AND user_id = ${userId}
      RETURNING *;
  `,
    null,
    null,
    poolClient
  );
};

export const getClientCountAndUserTier = async (userId, poolClient) => {
  const rows = await runQuery(
    SQL`
      SELECT COUNT(id) AS clients_count,
      (SELECT tier FROM user_subscriptions WHERE user_id = ${userId} AND is_active = true LIMIT 1 ) AS tier
      FROM clients
      WHERE user_id = ${userId} AND is_active = true
    `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export default {};
