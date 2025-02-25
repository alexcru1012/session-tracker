import SQL from 'sql-template-strings';
import moment from 'moment';
// import * as Sentry from '@sentry/node';
// import validator from 'validator';

// import pool from '@/postgres';
import { CacheKeys } from '@/constants';
import { runQuery } from '@/helpers';

export const getEventEditsForUser = (userId, poolClient) => {
  const cacheKey = CacheKeys.calendarEventEditsForUserKey(userId);

  return runQuery(
    SQL`
    SELECT * FROM calendar_event_edits
      WHERE user_id = ${userId}
      ORDER BY event_index ASC;
  `,
    cacheKey,
    null,
    poolClient
  );
};

export const getEventEditsForEvent = (userId, eventId, poolClient) => {
  const cacheKey = CacheKeys.calendarEventEditsKey(userId, eventId);

  return runQuery(
    SQL`
    SELECT * FROM calendar_event_edits
      WHERE user_id = ${userId}
      AND event_id = ${eventId}
      ORDER BY event_index ASC;
  `,
    cacheKey,
    null,
    poolClient
  );
};

export const getCalendarEventEdit = async (
  userId,
  eventId,
  editId,
  poolClient
) => {
  const cacheKey = CacheKeys.calendarEventEditKey(userId, eventId, editId);

  const rows = await runQuery(
    SQL`
    SELECT * FROM calendar_event_edits
      WHERE id = ${editId}
      AND user_id = ${userId}
      AND event_id = ${eventId};
  `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const createCalendarEventEdit = async (
  userId,
  eventId,
  eventIndex,
  data,
  poolClient
) => {
  const { isActive, startsAt, systemEventId } = data;
  const createdAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
    INSERT INTO calendar_event_edits (user_id, event_id, event_index, is_active, starts_at, system_event_id, created_at, updated_at)
      VALUES (${userId}, ${eventId}, ${eventIndex}, ${isActive}, ${startsAt}, ${systemEventId}, ${createdAt}, ${createdAt})
      RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const updateCalendarEventEdit = async (
  userId,
  editId,
  data,
  poolClient
) => {
  const { isActive, startsAt, systemEventId } = data;
  const updatedAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
    UPDATE calendar_event_edits
    SET 
      is_active = ${isActive},
      starts_at = ${startsAt},
      system_event_id = ${systemEventId},
      updated_at = ${updatedAt}
    WHERE id = ${editId}
    AND user_id = ${userId}
    RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  // console.log('rows', rows);

  return rows && rows.length ? rows[0] : null;
};

export const deleteCalendarEventEdit = async (
  userId,
  eventId,
  editId,
  poolClient
) => {
  const rows = await runQuery(
    SQL`
    DELETE FROM calendar_event_edits
    WHERE id = ${editId}
    AND event_id = ${eventId}
    AND user_id = ${userId}
    RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export default {};
