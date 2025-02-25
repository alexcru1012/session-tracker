import SQL from 'sql-template-strings';
import moment from 'moment-timezone';

import { CacheKeys } from '@/constants';
import { runQuery } from '@/helpers';

export const getUserBySlug = async (slug, poolClient) => {
  const rows = await runQuery(
    SQL`
    SELECT * FROM users WHERE slug = ${slug};
  `,
    CacheKeys.userSlugKey(slug),
    null,
    poolClient
  );

  // Find exact email match only
  return rows && rows.length ? rows[0] : null;
};

export const getPublicSessionTypes = async (userId, poolClient) => {
  const rows = await runQuery(
    SQL`
      SELECT *
      FROM session_types
      WHERE user_id = ${userId}
      AND schedule_id IS NOT NULL;
    `,
    CacheKeys.sessionTypesPublicKey(userId),
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const getPublicSessionType = async (
  userId,
  sessionTypeSlug,
  poolClient
) => {
  const rows = await runQuery(
    SQL`
      SELECT *
      FROM session_types
      WHERE user_id = ${userId}
      AND slug = ${sessionTypeSlug}
      AND schedule_id IS NOT NULL;
    `,
    CacheKeys.sessionTypePublicKey(userId, sessionTypeSlug),
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};
