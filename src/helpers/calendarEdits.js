import * as Sentry from '@sentry/node';
import moment from 'moment-timezone';
// import SQL from 'sql-template-strings';

// import { runQuery } from './index';
// import { CacheKeys } from '@/constants';
import {
  getEventEditsForEvent,
  getEventEditsForUser,
} from '@/models/calendarEdits';
import logger from '@/logger';
// import pool from '@/postgres';
import { explodeCalendarEvents } from '@/helpers/calendar';

export const applyEditToCalendarEvent = async (
  eventIdRaw,
  smallEvent,
  pgEvent = {},
  _poolClient
) => {
  const [eventId, eventIndex] = eventIdRaw.split('-');
  const userId = pgEvent.user_id; // || smallEvent.user_id;
  let edits = [];

  if (!userId || !eventId || eventIndex === null || eventIndex === undefined) {
    // Always copy pgEvent data for single events
    return {
      ...pgEvent,
      id: smallEvent.id,
      starts_at: smallEvent.starts_at,
      is_active: smallEvent.is_active,
    };
  }

  if (!edits.length) {
    try {
      edits = await getEventEditsForEvent(userId, eventId, _poolClient);
    } catch (error) {
      logger.error(error);
      Sentry.captureException(error);
    }
  }

  // console.log('edits', edits);

  if (edits && edits.length) {
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i] || {};

      if (
        String(edit.event_id) === String(eventId) &&
        String(edit.event_index) === String(eventIndex)
      ) {
        const { id: edit_id, is_active, starts_at, system_event_id } = edit;

        // Always copy pgEvent data for single events
        // Edits might not have a different starts_at
        return {
          ...pgEvent,
          ...smallEvent,
          edit_id,
          is_active,
          starts_at: starts_at
            ? moment(starts_at).toISOString()
            : smallEvent.starts_at,
          system_event_id,
        };
      }
    }
  }

  return {
    ...pgEvent,
    ...smallEvent,
  };
};

export const applyEditsToCalendarEventsV2 = async (
  user,
  pgEvents,
  start,
  end,
  _poolClient
) => {
  let events;

  try {
    events = await explodeCalendarEvents(pgEvents, start, end, user.tz);
  } catch (error) {
    logger.error(error);
    Sentry.captureException(error);

    return [];
  }

  let edits = [];

  try {
    edits = await getEventEditsForUser(user.id, _poolClient);
  } catch (error) {
    logger.error(error);
    Sentry.captureException(error);
  }

  const editsById = {};

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];

    editsById[`${edit.event_id}-${edit.event_index}`] = edit;
  }

  events = events.map(event => {
    // const pgEvent = pgEventsById[(event.id || '').split('-')[0]] || {};

    // Find edit
    if (Object.prototype.hasOwnProperty.call(editsById, String(event.id))) {
      const edit = editsById[event.id] || {};
      const { id: edit_id, is_active, starts_at, system_event_id } = edit;

      // console.log('edit', edit);

      // Apply edits to this event instance
      // Edits might not have a different starts_at
      return {
        ...event,
        edit_id,
        is_active,
        starts_at: starts_at
          ? moment(starts_at).toISOString()
          : event.starts_at,
        system_event_id,
      };
    }

    // Regular event no edit
    return {
      ...event,
      id: event.id,
      starts_at: event.starts_at,
    };
  });

  return events;
};

export default {};
