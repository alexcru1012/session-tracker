import moment from 'moment-timezone';
import * as Sentry from '@sentry/node';

import { CacheKeys, Options } from '@/constants';
import {
  getUsedSessionsForAllClients,
  getLoggedSessionsCountByUser,
} from '@/models/sessions';
import { getCalendarEvents } from '@/models/calendar';
import { getUser } from '@/models/users';
import { bumpUsageForUser } from '@/mongo/helpers';
import { cacheData, getDataFromCache } from '@/redis/helpers';
import logger from '@/logger';

const NUM_MONTHS = 6;

export const getUsage = async (user, poolClient) => {
  const cacheKey = CacheKeys.dashboard.usage(user.id);
  const existingData = await getDataFromCache(cacheKey);

  if (existingData) return existingData;

  let me;
  let _dates = {};

  try {
    me = await getUser(user.id, poolClient);

    const res = await bumpUsageForUser(user.id, me?.tz);

    if (res) _dates = res.dates;
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`getUsage error: ${err}`);
  }

  const startDate = moment().subtract(7, 'days').startOf('day');
  const endDate = moment().add(1, 'day').startOf('day');

  const keys = Object.keys(_dates) || [];
  const dates = {};

  keys
    .filter(d => moment(d).isBetween(startDate, endDate))
    .forEach(d => {
      dates[d] = true;
    });

  const data = { dates, total: keys.length };

  await cacheData(cacheKey, data);

  // Success
  return data;
};

export const getWeekly = async (user, poolClient) => {
  const cacheKey = CacheKeys.dashboard.weeklySummary(user.id);
  const existingData = await getDataFromCache(cacheKey);

  if (existingData) return existingData;

  // Find sessions that have occurred in the last 7 days
  const startDate = moment().startOf('week').toISOString();
  const endDate = moment()
    .endOf('week')
    .add(1, 'day')
    .startOf('day')
    .toISOString();

  let rows;

  rows = await getUsedSessionsForAllClients(
    user.id,
    startDate,
    endDate,
    poolClient
  );

  const responseArray = [];
  let totalDuration = 0;
  let totalSessions = 0;

  const clientIdArray = [];

  rows.forEach(element => {
    // TODO: update with session duration
    totalDuration += Options.defaultSessionDurationS; // element.duration;
    if (clientIdArray.length === 0) clientIdArray.push(element.client_id);
    else if (clientIdArray.filter(x => x === element.client_id).length === 0)
      clientIdArray.push(element.client_id);
  });

  if (clientIdArray && clientIdArray.length > 0) {
    clientIdArray.forEach(element => {
      const clientSessions = rows.filter(x => x.client_id === element);
      if (clientSessions && clientSessions.length > 0) {
        let clientTotalDuration = 0;

        clientSessions.forEach(_session => {
          // TODO: update with session duration
          clientTotalDuration += Options.defaultSessionDurationS; // _session.duration;
        });

        const obj = {
          client_id: element,
          duration: clientTotalDuration,
          num_sessions: clientSessions.length,
          fraction: ((clientTotalDuration / totalDuration) * 100).toFixed(2),
        };

        responseArray.push(obj);
      }

      totalSessions += clientSessions.length;
    });
  }

  const data = {
    total_sessions: totalSessions,
    total_duration: totalDuration,
    durations: responseArray,
    start_date: startDate,
    end_date: endDate,
  };

  await cacheData(cacheKey, data);

  // Success
  return data;
};

export const getMonthly = async (user, poolClient) => {
  const cacheKey = CacheKeys.dashboard.monthlySummary(user.id);
  const existingData = await getDataFromCache(cacheKey);

  if (existingData) return existingData;

  // Find sessions that have occurred in the last 60 days
  const startDate = moment()
    .subtract(NUM_MONTHS - 1, 'months')
    .startOf('month')
    .toISOString();
  const endDate = moment().endOf('month').toISOString();

  let sessions = [];

  sessions = await getLoggedSessionsCountByUser(
    user.id,
    startDate,
    endDate,
    poolClient
  );

  const months = [];
  const m = moment(startDate);

  for (let i = 0; i < NUM_MONTHS; i++) {
    const date = m.clone().add(i, 'months').startOf('month');
    const _end = date.clone().add(1, 'month');
    let value = 0;

    const found = sessions.filter(s => moment(s.date).isBetween(date, _end));

    value = found.reduce((prev, cur) => prev + cur.value, 0);

    months.push({ date: date.format('YYYY-MM-DD'), value });
  }

  const data = { startDate, endDate, months };

  await cacheData(cacheKey, data);

  // Success
  return data;
};

export const getNextEvents = async (user, poolClient) => {
  const cacheKey = CacheKeys.dashboard.nextEvents(user.id);
  const existingData = await getDataFromCache(cacheKey);

  if (existingData) return existingData;

  let events = [];
  const mToday = moment();

  let response = [];

  response = await getCalendarEvents(user, null, null, poolClient);

  const { pgEventsById, events: smallEvents } = response;

  events = smallEvents
    .sort(
      (a, b) =>
        a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0 // eslint-disable-line
    )
    .filter(smallEvent => mToday.isBefore(smallEvent.starts_at, 'hour'))
    .slice(0, 3)
    .map(smallEvent => ({
      ...pgEventsById[smallEvent.id.split('-')[0]],
      id: smallEvent.id,
      starts_at: smallEvent.starts_at,
      is_active: smallEvent.is_active,
    }));

  // console.log('events', events.map(e => e.starts_at));

  const data = { events };

  // Long cache time
  await cacheData(cacheKey, data, Options.defaultCacheTimeS * 2);

  // Success
  return data;
};
