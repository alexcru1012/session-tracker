import SQL from 'sql-template-strings';
// import * as Sentry from '@sentry/node';
// import moment from 'moment-timezone';

import { runQuery } from '@/helpers';
import { CacheKeys } from '@/constants';

export const getSchedule = async (userId, scheduleId, poolClient) => {
  const result = await runQuery(
    SQL`
      SELECT * FROM user_schedules 
        WHERE id = ${scheduleId}
        AND user_id = ${userId};
    `,
    CacheKeys.schedule.userSchedule(userId, scheduleId),
    null,
    poolClient
  );

  return result && result.length ? result[0] : null;
};

export const getSchedules = async (userId, poolClient) => {
  const result = await runQuery(
    SQL`
      SELECT * FROM user_schedules 
        WHERE user_id = ${userId};
    `,
    CacheKeys.schedule.userSchedules(userId),
    null,
    poolClient
  );

  return result && result.length ? result : [];
};

export const createSchedule = async (props, poolClient) => {
  const { userId, name, ical, tz } = props;

  const result = await runQuery(
    SQL`
      INSERT INTO user_schedules (user_id, name, ical, tz)
        VALUES (${userId}, ${name}, ${ical}, ${tz})
        RETURNING *;
    `,
    null,
    null,
    poolClient
  );

  return result && result.length ? result[0] : null;
};

export const updateSchedule = async (userId, scheduleId, props, poolClient) => {
  const { name, ical, tz } = props;

  const result = await runQuery(
    SQL`
      UPDATE user_schedules
        SET
          name = ${name},
          ical = ${ical},
          tz = ${tz}
        WHERE id = ${scheduleId}
        AND user_id = ${userId}
        RETURNING *;
    `,
    null,
    null,
    poolClient
  );

  return result && result.length ? result[0] : null;
};

export const deleteSchedule = async (userId, scheduleId, poolClient) => {
  const result = await runQuery(
    SQL`
      DELETE FROM user_schedules
      WHERE id = ${scheduleId}
      AND user_id = ${userId}
      RETURNING *;
    `,
    null,
    null,
    poolClient
  );

  return result && result.length ? result[0] : null;
};
