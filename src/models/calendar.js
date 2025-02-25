import SQL from 'sql-template-strings';
import * as Sentry from '@sentry/node';
import moment from 'moment-timezone';

import { CacheKeys, Occurrence, Options } from '@/constants';
import { runQuery } from '@/helpers';
import { getDataFromCache, cacheData } from '@/redis/helpers';
import logger from '@/logger';
import { explodeCalendarEvents } from '@/helpers/calendar';
import {
  applyEditToCalendarEvent,
  applyEditsToCalendarEventsV2,
} from '@/helpers/calendarEdits';

export const getPgCalendarEvent = async (eventIdRaw, poolClient) => {
  const eventParts = String(eventIdRaw).split('-');
  const eventId = eventParts[0];

  const pgEventCacheKey = CacheKeys.pgCalendarEventKey(eventId);

  const rows = await runQuery(
    SQL`
      SELECT * FROM calendar_events
      WHERE id = ${eventId}
    `,
    pgEventCacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const getCalendarEvent = async (eventIdRaw, userTz, poolClient) => {
  const eventParts = String(eventIdRaw).split('-');
  const eventId = eventParts[0];
  const eventIndex = eventParts[1];
  const resultCacheKey = CacheKeys.calendarEventKey(eventIdRaw);

  const existingData = await getDataFromCache(resultCacheKey);

  // Return cached data
  if (existingData && existingData.id) return existingData;

  const pgEvent = await getPgCalendarEvent(eventIdRaw, poolClient);

  if (!pgEvent || eventIndex === null || eventIndex === undefined) {
    if (!eventIndex === null || eventIndex === undefined)
      console.log('this event does not have an index', eventIdRaw);
    else {
      // It was probably just deleted
    }

    return pgEvent;
  }

  let returnId = eventIdRaw;
  let foundEvent = { ...pgEvent };
  let events;
  // Fetch an exploded list of events to find the correct event index
  if (
    pgEvent &&
    eventIndex !== null &&
    eventIndex !== undefined &&
    pgEvent.occurrence === Occurrence.recurring
  ) {
    try {
      events = await explodeCalendarEvents([pgEvent], null, null, userTz);
    } catch (error) {
      console.log('error', error);
      Sentry.captureException(error);

      return [];
    }

    if (events && events.length) {
      // Find the index of event within this exploded array
      const actualIndex = events.findIndex(e => e.id === eventIdRaw);

      foundEvent = events[actualIndex];

      // console.log('foundEvent', foundEvent);

      if (!foundEvent === -1)
        logger.warn(`WARNING: actualIndex not found ${eventIdRaw}`);
    } else return null;
  } else returnId = `${eventId}-0`;

  // console.log('foundEvent', foundEvent);
  // console.log('pgEvent', pgEvent);

  // Check for and apply edits
  const event = await applyEditToCalendarEvent(
    eventIdRaw,
    foundEvent,
    pgEvent,
    poolClient
  );

  // console.log('applyEdit event', event);
  const result = { ...event, id: returnId };

  // console.log('final', result);

  // 2 min
  await cacheData(resultCacheKey, result, Options.defaultCacheTimeS * 2);

  return result;
};

export const getCalendarEvents = async (user, start, end, poolClient) => {
  const mStart = start
    ? moment(start)
    : moment().startOf('month').subtract(1, 'months');
  const mEnd = end ? moment(end) : moment().add(6, 'months').endOf('month');

  const resultCacheKey = CacheKeys.calendarEventsKey(
    user.id,
    '0', // ? moment(start).format() : '0',
    '0' //  ? moment(end).format() : '0'
  );

  // logger.info(`getCalendarEvents: ${resultCacheKey}`);

  const existingData = await getDataFromCache(resultCacheKey);

  // console.log('existingData', existingData);

  // Return cached data
  if (existingData && existingData.events && existingData.events.length)
    return existingData;

  // Fetch everything again...
  const pgEventCacheKey = CacheKeys.pgCalendarEventsKey(
    user.id,
    '0', // start ? moment(start).format() : '0',
    '0' // end ? moment(end).format() : '0'
  );

  // Get all events regardless of dates and active
  // AND is_active = true
  let pgEvents = await runQuery(
    SQL`
    SELECT * FROM calendar_events
      WHERE user_id = ${user.id}
      ORDER BY starts_at ASC;
  `,
    pgEventCacheKey,
    Math.floor(Options.defaultCacheTimeS * (Math.random() * 10 + 5)), // 5-15 min
    poolClient
  );

  let events = await applyEditsToCalendarEventsV2(
    user,
    pgEvents,
    mStart.format(),
    mEnd.format(),
    poolClient
  );

  // console.log('events', events);

  // Final culling of events outside of range
  events = events.filter(e => moment(e.starts_at).isBetween(mStart, mEnd));
  const eventIds = events.map(e => (e.id || '').split('-')[0]);

  // Don't include any pgEvents that aren't referenced by an event
  pgEvents = pgEvents.filter(e => eventIds.includes(String(e.id)));
  const pgEventsById = pgEvents.reduce(
    (acc, cur) => ({ ...acc, [cur.id]: cur }),
    {}
  );

  const result = { pgEvents, pgEventsById, events };

  // Long cache time
  await cacheData(resultCacheKey, result, Options.defaultCacheTimeS * 2);

  return result;
};

export const getCalendarEventsForClient = async (
  user,
  clientId,
  start,
  end,
  poolClient
) => {
  // These default start/end dates should always be between calendar start/end
  // otherwise client won't have the pgEvents
  const mStart = start ? moment(start) : moment().startOf('day');
  const mEnd = end ? moment(end) : moment().add(2, 'months').endOf('month');

  const resultCacheKey = CacheKeys.calendarEventsForClientKey(
    user.id,
    clientId
  );

  const existingData = await getDataFromCache(resultCacheKey);

  // console.log('existingData', existingData?.events?.length);

  // Return cached data
  if (existingData && existingData.events && existingData.events.length)
    return existingData;

  const pgEventsCacheKey = CacheKeys.pgCalendarEventsForClientKey(
    user.id,
    clientId
  );

  // AND starts_at BETWEEN SYMMETRIC ${startDate.toISOString()} AND ${endDate.toISOString()}
  // AND is_active = true
  let pgEvents = await runQuery(
    SQL`
    SELECT * FROM calendar_events
      WHERE user_id = ${user.id}
      AND client_id = ${clientId}
      ORDER BY starts_at ASC;
  `,
    pgEventsCacheKey,
    null, // Options.defaultCacheTimeS, // 1 min
    poolClient
  );

  // console.log('start', start);
  // console.log('end', end);
  // console.log('pgEvents', pgEvents.map(e => `${e.id} - ${e.title}`));

  let events = await applyEditsToCalendarEventsV2(
    user,
    pgEvents,
    mStart.format(),
    mEnd.format(),
    poolClient
  );

  // console.log('edited events before', events.length);

  // Final culling of events outside of range
  events = events.filter(e => moment(e.starts_at).isBetween(mStart, mEnd));
  const eventIds = events.map(e => (e.id || '').split('-')[0]);

  // console.log(
  //   'edited events',
  //   events.length,
  //   events.map(e => `${e.id}, ${e.starts_at}, is_active: ${e.is_active}`)
  // );

  // Don't include any pgEvents that aren't referenced by an event
  pgEvents = pgEvents.filter(e => eventIds.includes(String(e.id)));
  const pgEventsById = pgEvents.reduce(
    (acc, cur) => ({ ...acc, [cur.id]: cur }),
    {}
  );

  const result = { pgEvents, pgEventsById, events };

  // 2 min
  await cacheData(resultCacheKey, result, Options.defaultCacheTimeS * 2);

  return result;
};

export const getCalendarEventIdsForClient = async (
  user,
  clientId,
  start,
  end,
  poolClient
) => {
  const { events } = await getCalendarEventsForClient(
    user,
    clientId,
    start,
    end,
    poolClient
  );

  // console.log(
  //   'events for client',
  //   events.map(
  //     e => `id: ${e.id}, starts_at: ${e.starts_at}, is_active: ${e.is_active}`
  //   )
  // );

  return events && events.length ? events.map(event => event.id) : [];
};

export default {};
