import SQL from 'sql-template-strings';
import format from 'pg-format';
import moment from 'moment';

// import logger from '@/logger';
import { runQuery } from '@/helpers';
import { Attendance, CacheKeys, Options } from '@/constants';
import { getSessionType } from './sessionTypes';

export const getSessions = (clientId, poolClient) => {
  const cacheKey = CacheKeys.sessionsKey(clientId);

  return runQuery(
    SQL`
      SELECT * FROM sessions
        WHERE client_id = ${clientId}
        ORDER BY used_at DESC;
    `,
    cacheKey,
    null,
    poolClient
  );
};

export const getAvailableSessionIds = (clientId, poolClient) => {
  const cacheKey = CacheKeys.availableSessionsKey(clientId);

  // Yes, id and price
  return runQuery(
    SQL`
      SELECT id, price FROM sessions s
        WHERE s.client_id = ${clientId}
        AND s.used_at IS NULL;
    `,
    cacheKey,
    null,
    poolClient
  );
};

export const getUsedSessionCount = (clientId, poolClient) => {
  const cacheKey = CacheKeys.usedSessionCountKey(clientId);

  return runQuery(
    SQL`
      SELECT COUNT(used_at) FROM sessions s
        WHERE s.client_id = ${clientId}
        AND s.used_at IS NOT NULL;
    `,
    cacheKey,
    null,
    poolClient
  );
};

export const getUsedSessions = (clientId, start, end, poolClient) => {
  const cacheKey = CacheKeys.usedSessionsKey(clientId);

  const startDate = start
    ? moment(start).toISOString()
    : moment()
      .subtract(1, 'years')
      .toISOString();
  const endDate = end ? moment(end).toISOString() : moment().toISOString();

  // using this line will include NULL results...
  // AND used_at IS NOT NULL
  return runQuery(
    SQL`
      SELECT * FROM sessions
        WHERE client_id = ${clientId}
        AND used_at BETWEEN SYMMETRIC ${startDate} AND ${endDate}
        ORDER BY used_at DESC;
    `,
    cacheKey,
    null,
    poolClient
  );
};

export const getUsedSessionsForAllClients = async (
  userId,
  startDate,
  endDate,
  poolClient
) => {
  const cacheKey = CacheKeys.allUsedSessionsForUser(userId); // , startDate, endDate);

  const rows = await runQuery(
    SQL`
    SELECT * FROM sessions s
      WHERE s.client_id IN (SELECT id from clients c WHERE c.user_id = ${userId})
      AND s.used_at BETWEEN SYMMETRIC ${startDate} AND ${endDate}
      ORDER BY s.used_at DESC;
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const getUsedSessionsForAllClientsMonthly = async (
  userId,
  startDate,
  endDate,
  poolClient
) => {
  const cacheKey = CacheKeys.allUsedSessionsForUserMonthly(userId);

  const rows = await runQuery(
    SQL`
    SELECT * FROM sessions s
      WHERE s.client_id IN (SELECT id from clients c WHERE c.user_id = ${userId})
      AND s.used_at BETWEEN SYMMETRIC ${startDate} AND ${endDate}
      ORDER BY s.used_at DESC;
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const getSession = async (clientId, sessionId, poolClient) => {
  const cacheKey = CacheKeys.sessionKey(sessionId);

  // logger.info(`getSession: ${clientId} / ${sessionId}`);

  const rows = await runQuery(
    SQL`
      SELECT * FROM sessions WHERE id = ${sessionId} AND client_id = ${clientId};
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const createNewSession = async (clientId, poolClient) => {
  const createdAt = moment().toISOString();

  let rows = '';

  rows = await runQuery(
    SQL`
      INSERT INTO sessions (client_id, created_at, updated_at)
        VALUES (${clientId}, ${createdAt}, ${createdAt})
        RETURNING *;
    `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const useSession = (sessionId, inputs, poolClient) => {
  const {
    usedAtInput,
    attendanceInput,
    notesInput,
    priceInput,
    paidInput,
    durationInput,
    sessionTypeIdInput,
    updatedAt,
  } = inputs;

  return runQuery(
    SQL`
      UPDATE sessions
        SET
          used_at = ${usedAtInput},
          attendance = ${attendanceInput},
          notes = ${notesInput},
          price = ${priceInput},
          paid = ${paidInput},
          duration = ${durationInput || Options.defaultSessionDurationS},
          session_type_id = ${sessionTypeIdInput},
          updated_at = ${updatedAt}
        WHERE id = ${sessionId}
        RETURNING *;
    `,
    null,
    null,
    poolClient
  );
};

export const useSessionFromCalendarEvent = async (
  clientId,
  event,
  session,
  _sessionType,
  poolClient
) => {
  const paidInput = true;
  const attendanceInput = Attendance.present;

  let sessionType = _sessionType;
  if (!sessionType && event && event.session_type_id) {
    sessionType = await getSessionType(
      event.user_id,
      event.session_type_id,
      poolClient
    );
  }

  const priceInput = sessionType && sessionType.price ? sessionType.price : 0.0;
  const durationInput = event.duration || Options.defaultSessionDurationS;
  const updatedAt = moment().toISOString();

  // Update client
  const rows = await runQuery(
    SQL`
    UPDATE sessions
      SET
        used_at = ${event.starts_at},
        attendance = ${attendanceInput},
        notes = ${event.notes || ''},
        price = ${priceInput},
        paid = ${paidInput},
        duration = ${durationInput},
        session_type_id = ${event.session_type_id},
        updated_at = ${updatedAt}
      WHERE id = ${session.id}
      AND client_id = ${clientId}
      RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const getAllSessionNotes = (clientId, poolClient) => {
  const cacheKey = CacheKeys.allSessionNotesKey(clientId);

  return runQuery(
    SQL`
      SELECT id as session_id, notes, used_at FROM sessions
        WHERE client_id = ${clientId}
        AND notes IS NOT NULL
        AND notes <> ''
        ORDER BY used_at DESC;
    `,
    cacheKey,
    null,
    poolClient
  );
};

export const resetClientSessionToPaid = async (clientId, poolClient) => {
  const updatedAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
    UPDATE sessions
    SET
    paid = true,
    updated_at = ${updatedAt}
    WHERE client_id = ${clientId}
      RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const getLoggedSessionsCountByUser = async (
  userId,
  start,
  end,
  poolClient
) => {
  const startDate = moment(start).toISOString();
  const endDate = moment(end).toISOString();

  const rows = await runQuery(
    SQL`
      SELECT count(s.id)::int as value, s.used_at AS date FROM sessions s
      WHERE s.client_id IN (SELECT id from clients c WHERE c.user_id = ${userId})
      AND s.used_at BETWEEN SYMMETRIC ${startDate} AND ${endDate}
	    GROUP BY s.used_at
      ORDER BY s.used_at DESC;
    `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const addSessionsForClient = async (
  numSessions,
  clientId,
  poolClient
) => {
  const createdAt = moment().toISOString();

  const values = [];

  // Add sessions
  for (let i = 0; i < numSessions; i++)
    values.push([clientId, createdAt, createdAt]);

  const rows = await runQuery(
    format(
      'INSERT INTO sessions (client_id, created_at, updated_at) VALUES %L',
      values
    ),
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const removeSessionsForClient = async (
  numSessions,
  clientId,
  poolClient
) => {
  const rows = await runQuery(
    SQL`
      DELETE FROM sessions
        WHERE id IN (
          SELECT id FROM sessions WHERE client_id = ${clientId} AND used_at IS NULL
            ORDER BY id ASC
            LIMIT ${Math.abs(numSessions)}
        )
        RETURNING *;
    `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export default {};
