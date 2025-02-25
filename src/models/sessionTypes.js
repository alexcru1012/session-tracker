import SQL from 'sql-template-strings';
import moment from 'moment-timezone';

import { CacheKeys } from '@/constants';
import { runQuery } from '@/helpers';

export const getSessionTypes = async (userId, poolClient) => {
  const rows = await runQuery(
    SQL`
      SELECT * FROM session_types
        WHERE user_id = ${userId};
    `,
    CacheKeys.sessionTypesKey(userId),
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const getSessionType = async (userId, sessionTypeId, poolClient) => {
  const rows = await runQuery(
    SQL`
      SELECT * FROM session_types
        WHERE id = ${sessionTypeId}
        AND user_id = ${userId}
        ORDER BY created_at DESC;
    `,
    CacheKeys.sessionTypeKey(userId, sessionTypeId),
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const setSchedule = async (
  userId,
  sessionTypeId,
  scheduleId,
  poolClient
) => {
  const updatedAt = moment().toISOString();

  const result = await runQuery(
    SQL`
    UPDATE session_types
      SET
        schedule_id = ${scheduleId},
        updated_at = ${updatedAt}
      WHERE id = ${sessionTypeId}
      AND user_id = ${userId}
      RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  return result && result.length ? result[0] : null;
};

export const setSlug = async (sessionTypeId, slug, poolClient) => {
  const updatedAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
     UPDATE session_types
     SET
      slug = ${slug},
      updated_at = ${updatedAt}
     WHERE id = ${sessionTypeId}
     RETURNING *;
   `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export default {};
