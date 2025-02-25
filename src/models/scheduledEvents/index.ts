// @ts-nocheck
import SQL from 'sql-template-strings';
import { PoolClient } from 'pg';

import { CacheKeys } from '@/constants';
import { runQuery } from '@/helpers';
import { PostScheduledEvent } from './types';

export const getScheduledEvents = async (
  userId: number,
  guestEmail: string,
  poolClient: PoolClient
) => {
  const cacheKey = CacheKeys.scheduledEvents.all(userId);

  const rows = await runQuery(
    SQL`
      SELECT * FROM scheduled_events
      WHERE user_id = ${userId}
      OR guest_email = ${guestEmail}
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const getScheduledEvent = async (
  userId: number,
  scheduledEventId: number,
  poolClient: PoolClient
) => {
  const cacheKey = CacheKeys.scheduledEvents.single(userId, scheduledEventId);

  const rows = await runQuery(
    SQL`
      SELECT * FROM scheduled_events
      WHERE user_id = ${userId}
      AND id = ${scheduledEventId};
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const createScheduledEvent = async (
  userId: number,
  data: PostScheduledEvent,
  poolClient?: PoolClient
) => {
  const cacheKey = CacheKeys.scheduledEvents.all(userId);

  const rows = await runQuery(
    SQL`
      INSERT INTO scheduled_events
      (user_id, session_type_id, starts_at, local_time, tz, guest_name, guest_email, notes, is_active)
      VALUES (${userId}, ${data.sessionTypeId}, ${data.startsAt}, ${data.localTime}, ${data.tz}, ${data.guestName}, ${data.guestEmail}, ${data.notes}, ${data.isActive})
      RETURNING *;
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const updateScheduledEvent = async (
  userId: number,
  scheduledEventId: number,
  data: PostScheduledEvent,
  poolClient?: PoolClient
) => {
  const cacheKey = CacheKeys.scheduledEvents.all(userId);

  const rows = await runQuery(
    SQL`
      UPDATE scheduled_events
      SET
        session_type_id = ${data.sessionTypeId},
        starts_at = ${data.startsAt},
        local_time = ${data.localTime},
        tz = ${data.tz},
        guest_name = ${data.guestName},
        guest_email = ${data.guestEmail},
        notes = ${data.notes},
        is_active = ${data.isActive}
      WHERE id = ${scheduledEventId}
      AND user_id = ${userId}
      RETURNING *;
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const deleteScheduledEvent = async (
  userId,
  scheduledEventId,
  poolClient
) =>
  runQuery(
    SQL`
    DELETE FROM scheduled_events
    WHERE id = ${scheduledEventId}
    AND user_id = ${userId}
    RETURNING *;
  `,
    null,
    null,
    poolClient
  );
