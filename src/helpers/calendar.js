import * as Sentry from '@sentry/node';
import moment from 'moment-timezone';
import validator from 'validator';

import {
  Occurrence,
  Occurrences,
  Frequency,
  Frequencies,
  WeekDays,
  Options,
} from '@/constants';
import { getTimezone } from '@/helpers';
import { Schedule, Rule, Dates } from '@/helpers/rschedule'; // eslint-disable-line

const ID_TO_TEST = 57;

export const mapEventToScheduleRuleOptions = event => {
  let frequency;
  let byMonthOfYear;
  let byWeekOfMonth;
  let byDayOfMonth;
  let byDayOfWeek;
  let byHourOfDay;
  let byMinuteOfHour;

  switch (event.frequency) {
    case Frequency.yearly:
      frequency = Frequency.yearly;
      byMonthOfYear = [event.month_of_year];
      byDayOfMonth = [event.day_of_month];
      byHourOfDay = [event.hour_of_day];
      byMinuteOfHour = [event.minute_of_hour];
      break;
    case Frequency.monthly:
      frequency = Frequency.monthly;
      byDayOfMonth = [event.day_of_month];
      byHourOfDay = [event.hour_of_day];
      byMinuteOfHour = [event.minute_of_hour];
      break;
    case Frequency.weekly:
      frequency = Frequency.weekly;
      byDayOfWeek = event.day_of_week.split(/[ ,]+/);
      break;
    case Frequency.daily:
      frequency = Frequency.daily;
      byDayOfWeek = event.day_of_week
        ? event.day_of_week.split(/[ ,]+/)
        : undefined;
      break;
    default:
      frequency = Frequency.monthly;
      byDayOfMonth = [event.day_of_month];
      byHourOfDay = [event.hour_of_day];
      byMinuteOfHour = [event.minute_of_hour];
      break;
  }

  return {
    frequency,
    interval: event.interval || 1,
    duration: event.duration,
    byMonthOfYear,
    byWeekOfMonth,
    byDayOfMonth,
    byDayOfWeek,
    byHourOfDay,
    byMinuteOfHour,
  };
};

export const explodeCalendarEvents = (pgEvents, start, end, tz) => {
  if (!pgEvents || !pgEvents.length) return [];

  // console.log('pgEvents', pgEvents);

  const dates = [];
  const data = [];
  const schedules = [];

  // Only return events between these two dates
  const startDate = start
    ? moment(start)
    : moment()
      .subtract(6, 'months')
      .startOf('month');
  const endDate = end
    ? moment(end)
    : moment()
      .add(6, 'months')
      .endOf('month');
  let events = [];

  const userTz = getTimezone(tz);

  try {
    for (let i = 0; i < pgEvents.length; i++) {
      const event = pgEvents[i];
      // const eventStart = moment(event.starts_at);
      const eventStart = moment.tz(event.starts_at, userTz);

      // if (event.id === ID_TO_TEST)
      //   console.log('eventStart.format()', eventStart.format());

      if (event.occurrence === Occurrence.recurring) {
        const options = mapEventToScheduleRuleOptions(event);

        // if (event.id === ID_TO_TEST)
        //   console.log('recurring options', options);

        // const recurringStart = moment(event.recurring_starts_at);
        const recurringStart = moment
          .tz(event.recurring_starts_at, userTz)
          // Also match the exact start time
          .set('hour', eventStart.hour())
          .set('minute', eventStart.minute())
          .set('second', eventStart.second());
        const recurringEnd = event.recurring_ends_at
          ? moment
            .tz(event.recurring_ends_at, userTz)
            // Also match the exact start time
            .set('hour', eventStart.hour())
            .set('minute', eventStart.minute())
            .set('second', eventStart.second())
          : undefined;
        // ? moment(event.recurring_ends_at)

        // console.log('options', options);
        const schedule = new Schedule({
          rrules: [
            new Rule(
              {
                ...options,
                // We want ALL instances of this event. So the indexes are consistent
                start: recurringStart,
                // We should probably always pass undefined, but might as well save some memory
                end: recurringEnd,
              }
              // {
              //   data: event,
              // }
            ),
          ],
          // Additional dates to include
          rdates: [recurringStart], // moment(event.recurring_starts_at)],
          data: event,
          timezone: userTz,
        });

        // schedule.set('timezone', tz);
        // if (event.id === ID_TO_TEST)
        //   console.log('schedule', startDate.format(), schedule.rrules[0]);

        // Push schedule
        schedules.push(schedule);

        // Also push the first date since it seems to not include one...
        // dates.push(eventStart);
        // data.push(event);
      } else if (event.starts_at) {
        // const eventEnd = eventStart.clone().add(event.duration, 'seconds');

        // if (event.id === ID_TO_TEST) {
        //   console.log('startDate', startDate.format());
        //   console.log('event start', event.id, eventStart.format());
        // }

        dates.push(eventStart);
        data.push(event);
      }
    }
  } catch (error) {
    Sentry.captureException(error);
    console.log('error', error);

    return [];
  }

  try {
    const addEvent = (date, generatedData, index = 0) => {
      const {
        id,
        // duration,
        // recurring_starts_at,
        // recurring_ends_at,
      } = generatedData;

      // Ignore duplicate data to save kb
      const newData = {
        // ...generatedData,
        starts_at: date.toISOString(),
        id: `${id}-${index}`,
      };

      // if (generatedData && generatedData.id === ID_TO_TEST)
      //   console.log('addEvent', newData);

      events.push(newData);
    };

    // console.log('dates', dates);
    // console.log('data', data);

    const rDates = new Dates({ dates, data });
    const singleEvents = rDates.occurrences().toArray();

    // console.log('singleEvents', singleEvents.map(e => e.date.format()));

    // Loop single events
    for (let i = 0; i < singleEvents.length; i++) {
      const { date, generators } = singleEvents[i];
      const generatedData = generators[0].data[i];

      // if (generatedData && generatedData.id === ID_TO_TEST)
      //   console.log('single generatedData', date.format(), generatedData);

      addEvent(moment(date), generatedData);
    }

    // console.log('schedules.length', schedules.length);

    // Loop schedules and then loop scheduled events
    for (let j = 0; j < schedules.length; j++) {
      // Get all dates here, filter later
      const schedule = schedules[j].occurrences({ take: 365 }).toArray();
      // const scheduleIterator = schedules[j].occurrences({ take: 365 });

      // const occurrences = [];

      // for (const s of scheduleIterator)
      //   console.log('iterator', s.date.toISOString());

      // if (date.getMonth() > new Date().getMonth()) {
      //   occurrences.push(date)
      // }

      for (let k = 0; k < schedule.length; k++) {
        const { date, generators } = schedule[k];

        const generatedData = generators[0].data;

        // if (generatedData && generatedData.id === ID_TO_TEST) {
        //   console.log(
        //     'generatedData',
        //     generatedData.id,
        //     generatedData.starts_at
        //   );
        // }

        // Something is duplicating the first event in a recurring set
        // if (
        //   k === 0 &&
        //   schedule[1] &&
        //   schedule[1].generators[0]?.data?.starts_at === generatedData.starts_at
        // )
        //   continue;

        const eventStart = moment(generatedData?.starts_at);
        let newDate = date;
        // Not sure why but the first event doesn't match the same time as the others
        if (k === 0) {
          newDate = moment(date.format())
            // Also match the exact start time
            .set('hour', eventStart.hour())
            .set('minute', eventStart.minute())
            .set('second', eventStart.second());
        }

        // console.log('newDate', newDate.toISOString());

        // if (generatedData && generatedData.id === ID_TO_TEST) {
        //   console.log(
        //     'recurring generatedData',
        //     date.format(),
        //     generatedData.title
        //   );
        // }

        addEvent(newDate, generatedData, k);
      }
    }
  } catch (error) {
    Sentry.captureException(error);
    console.log('error', error);

    return [];
  }

  // console.log('events.length before', events.length);
  events = events.filter(
    event =>
      startDate.isBefore(event.starts_at) && endDate.isAfter(event.starts_at)
  );
  // console.log('events.length after', events.length);
  // console.log('SORTING!!!!!!');
  // events = events.sort((a, b) => {
  //   const aVal = a.starts_at || 0;
  //   const bVal = b.starts_at || 0;

  //   if (aVal === bVal) return 0;
  //   if (!aVal) return -1;
  //   if (!bVal) return 1;

  //   return aVal < bVal ? 1 : -1;
  // });

  // console.log('events?', events.map(e => e.id));

  return events;
};

export const validatePost = req => {
  const { user } = req;
  const {
    startsAt,
    localTime,
    tz,
    //
    duration,
    clientId,
    sessionTypeId,
    title,
    notes,
    color,
    //
    occurrence,
    frequency,
    interval,
    recurringStartsAt,
    recurringEndsAt,
    monthOfYear,
    dayOfMonth,
    dayOfWeek,
    hourOfDay,
    minuteOfHour,

    sendNotifications,
    notificationDistance,
    systemEventId,
  } = req.body;

  let error = '';

  // console.log('req.body', req.body);

  // Escape required inputs
  let startsAtInput = startsAt ? validator.escape(startsAt) : undefined;
  const startsAtMoment = moment(startsAtInput);

  startsAtInput = startsAtMoment.isValid()
    ? startsAtMoment.toISOString()
    : undefined;

  let tzInput = tz ? validator.escape(String(tz)) : user.tz;

  // Put back slash character
  tzInput = tzInput ? tzInput.replace(/&#x2F;/g, '/') : user.tz;

  let localTimeInput = localTime ? validator.escape(localTime) : null;
  if (localTimeInput && !moment(localTime, 'HH:mm:ss').isValid())
    localTimeInput = null;

  const titleInput = title ? validator.escape(title) : null;

  // Escape optional inputs
  const durationInput = duration ? validator.escape(String(duration)) : null;
  const clientIdInput = !!clientId ? validator.escape(String(clientId)) : null;
  const sessionTypeIdInput = !!sessionTypeId
    ? validator.escape(String(sessionTypeId))
    : null;
  const notesInput = notes ? validator.escape(notes).substring(0, 501) : '';
  const colorInput = color ? validator.escape(color.toString()) : '';

  const isActiveInput = true;
  const occurrenceInput = occurrence
    ? validator.escape(occurrence)
    : Occurrence.single;
  const frequencyInput = frequency ? validator.escape(frequency) : null;
  const intervalInput = interval ? validator.escape(String(interval)) : 1;
  const recurringStartsAtInput = recurringStartsAt
    ? validator.escape(recurringStartsAt)
    : null;
  const recurringEndsAtInput = recurringEndsAt
    ? validator.escape(recurringEndsAt)
    : null;
  const monthOfYearInput =
    monthOfYear !== null && monthOfYear !== undefined
      ? validator.escape(String(monthOfYear))
      : null;
  const dayOfMonthInput =
    dayOfMonth !== null && dayOfMonth !== undefined
      ? validator.escape(String(dayOfMonth))
      : null;
  const dayOfWeekInput =
    dayOfWeek !== null && dayOfWeek !== undefined
      ? validator.escape(String(dayOfWeek)).trim()
      : null;
  const hourOfDayInput =
    hourOfDay !== null && hourOfDay !== undefined
      ? validator.escape(String(hourOfDay))
      : null;
  const minuteOfHourInput =
    minuteOfHour !== null && minuteOfHour !== undefined
      ? validator.escape(String(minuteOfHour))
      : null;

  const sendNotificationsInput = !!sendNotifications;
  const notificationDistanceInput =
    notificationDistance !== null && notificationDistance !== undefined
      ? validator.escape(String(notificationDistance))
      : null;
  const systemEventIdInput = systemEventId
    ? validator.escape(String(systemEventId))
    : null;

  // Missing required input
  if (!titleInput || !startsAtInput) error = 'Missing required input.';

  if (!titleInput || !validator.isLength(titleInput, { min: 2, max: 100 }))
    error = 'Invalid title input.';

  if (!startsAtInput || !validator.isISO8601(startsAtInput))
    error = 'Invalid startsAt input.';

  if (localTime && !localTimeInput) error = 'Invalid localTime input.';

  if (
    !!durationInput &&
    !validator.isNumeric(String(durationInput), {
      no_symbols: true,
      min: 1, // 1 second
      max: 86400, // 1 day
    })
  )
    error = 'Invalid duration input.';

  if (!!notesInput && !validator.isLength(notesInput, { min: 1, max: 500 }))
    error = 'Invalid notes input. (too long)';

  if (
    !!clientIdInput &&
    !validator.isNumeric(clientIdInput, { no_symbols: true })
  )
    error = 'Invalid clientId input.';

  if (
    !!sessionTypeIdInput &&
    !validator.isNumeric(sessionTypeIdInput, { no_symbols: true })
  )
    error = 'Invalid sessionTypeId input.';

  // Validate color
  if (
    !!colorInput &&
    (!validator.isHexColor(colorInput) ||
      !validator.isLength(colorInput, { min: 3, max: 8 }))
  )
    error = 'Invalid color input. (must be hex ie. "ff0000")';

  // Recurrence inputs

  if (!Occurrences.includes(occurrenceInput))
    error = 'Invalid occurrence input.';

  if (
    occurrenceInput === Occurrence.recurring &&
    (!frequencyInput || !Frequencies.includes(frequencyInput))
  )
    error = 'Invalid frequency input.';

  if (
    occurrenceInput === Occurrence.recurring &&
    !validator.isNumeric(String(intervalInput), { no_symbols: true })
  )
    error = 'Invalid interval input.';

  if (
    !!recurringStartsAtInput &&
    !validator.isISO8601(String(recurringStartsAtInput))
  )
    error = 'Invalid recurringStartsAt input.';

  if (
    !!recurringEndsAtInput &&
    !validator.isISO8601(String(recurringEndsAtInput))
  )
    error = 'Invalid recurringEndsAt input.';

  if (
    !!monthOfYearInput &&
    (!validator.isNumeric(String(monthOfYearInput), { no_symbols: true }) ||
      monthOfYearInput < 1 ||
      monthOfYearInput > 12)
  )
    error = 'Invalid monthOfYear input. (1 - 12)';

  if (
    !!dayOfMonthInput &&
    (!validator.isNumeric(String(dayOfMonthInput), { no_symbols: true }) ||
      dayOfMonthInput < 1 ||
      dayOfMonthInput > 31)
  )
    error = 'Invalid dayOfMonth input. (1 - 31)';

  if (dayOfWeek && dayOfWeek.length > 2) {
    const dayOfWeekArray = dayOfWeek.split(/[ ,]+/); // one or more commas or spaces

    for (let i = 0; i < dayOfWeekArray.length; i++) {
      if (!WeekDays.includes(dayOfWeekArray[i]))
        error = 'Invalid dayOfWeek input. (SU, MO, TU, WE, TH, FR, SA)';
    }
  } else if (dayOfWeek && !WeekDays.includes(dayOfWeek))
    error = 'Invalid dayOfWeek input. (SU, MO, TU, WE, TH, FR, SA)';

  if (
    !!hourOfDayInput &&
    (!validator.isNumeric(String(hourOfDayInput), { no_symbols: true }) ||
      hourOfDayInput < 0 ||
      hourOfDayInput > 23)
  )
    error = 'Invalid hourOfDay input. (0 - 23)';

  if (
    !!minuteOfHourInput &&
    (!validator.isNumeric(String(minuteOfHourInput), {
      no_symbols: true,
    }) ||
      minuteOfHourInput < 0 ||
      minuteOfHourInput > 59)
  )
    error = 'Invalid minuteOfHour input. (0 - 59)';

  const monthOfYearExists = !!monthOfYearInput;
  const dayOfMonthExists = !!dayOfMonthInput;
  const dayOfWeekExists = !!dayOfWeekInput || dayOfWeekInput === 0;
  const hourOfDayExists = !!hourOfDayInput || hourOfDayInput === 0;
  const minuteOfHourExists = !!minuteOfHourInput || minuteOfHourInput === 0;

  if (occurrenceInput === Occurrence.recurring && !recurringStartsAtInput)
    error = 'recurring events require a recurringStartsAt date.';

  if (
    occurrenceInput === Occurrence.recurring &&
    frequencyInput === Frequency.yearly &&
    (!monthOfYearExists ||
      !dayOfMonthExists ||
      !hourOfDayExists ||
      !minuteOfHourExists)
  )
    error = 'YEARLY requires monthOfYear, dayOfMonth, hourOfDay, minuteOfHour';

  if (
    occurrenceInput === Occurrence.recurring &&
    frequencyInput === Frequency.monthly &&
    (!dayOfMonthExists || !hourOfDayExists || !minuteOfHourExists)
  )
    error = 'MONTHLY requires dayOfMonth, hourOfDay, minuteOfHour';

  if (
    occurrenceInput === Occurrence.recurring &&
    frequencyInput === Frequency.weekly &&
    (!dayOfWeekExists || !hourOfDayExists || !minuteOfHourExists)
  )
    error = 'WEEKLY requires dayOfWeek, hourOfDay, minuteOfHour';

  if (
    occurrenceInput === Occurrence.recurring &&
    frequencyInput === Frequency.daily &&
    (!hourOfDayExists || !minuteOfHourExists)
  )
    error = 'DAILY requires hourOfDay, minuteOfHour';

  if (
    !!notificationDistanceInput &&
    !validator.isNumeric(String(notificationDistanceInput), {
      no_symbols: true,
      min: 1, // 1 second
      max: 604800, // 7 days
    })
  )
    error = 'Invalid notificationDistance input.';

  if (
    !!systemEventIdInput &&
    !validator.isLength(systemEventIdInput, { min: 10, max: 50 })
  )
    error = 'Invalid systemEventId input';

  return {
    error,
    startsAtInput,
    localTimeInput,
    tzInput,
    titleInput,
    clientIdInput,
    sessionTypeIdInput,
    notesInput,
    colorInput,
    durationInput,
    isActiveInput,
    occurrenceInput,
    frequencyInput,
    recurringStartsAtInput,
    recurringEndsAtInput,
    intervalInput,
    monthOfYearInput,
    dayOfMonthInput,
    dayOfWeekInput,
    hourOfDayInput,
    minuteOfHourInput,
    sendNotificationsInput,
    notificationDistanceInput,
    systemEventIdInput,
  };
};

export const validatePatch = (req, existingEvent) => {
  const { user } = req;
  const {
    startsAt,
    localTime,
    tz,

    duration,
    clientId,
    sessionTypeId,
    title,
    notes,
    color,
    //
    isActive,
    occurrence,
    frequency,
    interval,
    recurringStartsAt,
    recurringEndsAt,
    monthOfYear,
    dayOfMonth,
    dayOfWeek,
    hourOfDay,
    minuteOfHour,

    sendNotifications,
    notificationDistance,
    systemEventId,
  } = req.body;

  // console.log('req.body', req.body);

  let error = '';

  // Escape required inputs
  let startsAtInput = startsAt
    ? validator.escape(startsAt)
    : existingEvent.starts_at;
  const startsAtMoment = moment(startsAtInput);

  startsAtInput = startsAtMoment.isValid()
    ? startsAtMoment.toISOString()
    : undefined;

  let tzInput = tz ? validator.escape(String(tz)) : user.tz;

  // Put back slash character
  tzInput = tzInput ? tzInput.replace(/&#x2F;/g, '/') : null;

  let localTimeInput = localTime
    ? validator.escape(localTime)
    : existingEvent.local_time;
  if (localTimeInput && !moment(localTime, 'HH:mm:ss').isValid())
    localTimeInput = null;

  const titleInput = title
    ? validator.escape(String(title))
    : existingEvent.title;

  // Escape optional inputs (allow values to become null)
  const durationInput = duration
    ? validator.escape(String(duration || 0))
    : Options.defaultSessionDurationS;
  const clientIdInput =
    (clientId && clientId !== undefined
      ? validator.escape(String(clientId || ''))
      : null) || null;
  const sessionTypeIdInput =
    (sessionTypeId && sessionTypeId !== undefined
      ? validator.escape(String(sessionTypeId || ''))
      : null) || null;
  const notesInput =
    notes && notes !== undefined
      ? validator.escape(String(notes || '')).substring(0, 501)
      : '';
  const colorInput = color ? validator.escape(color.toString()) : '';

  const isActiveInput = !(isActive === false || isActive === 'false');
  const occurrenceInput = occurrence
    ? validator.escape(occurrence)
    : existingEvent.occurrence;
  let frequencyInput =
    frequency !== undefined
      ? validator.escape(frequency || '')
      : existingEvent.frequency;
  let intervalInput = interval
    ? validator.escape(String(interval))
    : existingEvent.interval;
  let recurringStartsAtInput = existingEvent.recurring_starts_at
    ? moment(existingEvent.recurring_starts_at).toISOString()
    : null;
  if (recurringStartsAt) {
    recurringStartsAtInput = validator.escape(recurringStartsAt);

    // If the recurring start date changes, duplicate startsAt
    if (
      occurrenceInput === Occurrence.recurring &&
      existingEvent.recurring_starts_at &&
      moment(existingEvent.recurring_starts_at).isAfter(recurringStartsAtInput)
    )
      startsAtInput = recurringStartsAtInput;
  }
  let recurringEndsAtInput = existingEvent.recurring_ends_at
    ? moment(existingEvent.recurring_ends_at).toISOString()
    : null;
  if (recurringEndsAt) recurringEndsAtInput = validator.escape(recurringEndsAt);
  let monthOfYearInput =
    monthOfYear !== null && monthOfYear !== undefined
      ? validator.escape(String(monthOfYear))
      : null; // existingEvent.month_of_year;
  let dayOfMonthInput =
    dayOfMonth !== null && dayOfMonth !== undefined
      ? validator.escape(String(dayOfMonth))
      : null; // existingEvent.day_of_month;
  let dayOfWeekInput =
    dayOfWeek !== null && dayOfWeek !== undefined
      ? validator.escape(String(dayOfWeek)).trim()
      : null; // existingEvent.day_of_week;
  let hourOfDayInput =
    hourOfDay !== null && hourOfDay !== undefined
      ? validator.escape(String(hourOfDay))
      : null; // existingEvent.hour_of_day;
  let minuteOfHourInput =
    minuteOfHour !== null && minuteOfHour !== undefined
      ? validator.escape(String(minuteOfHour))
      : null; // existingEvent.minute_of_hour;

  // console.log('startsAt', startsAt);
  // console.log('existingEvent.starts_at', existingEvent.starts_at);
  // console.log('startsAtInput', startsAtInput);
  // console.log('occurrenceInput', occurrenceInput);
  // console.log('frequencyInput', frequencyInput);

  // If an event will not repeat any longer, reset rules
  if (occurrenceInput === Occurrence.single) {
    // occurrenceInput = Occurrence.single;
    intervalInput = 1;
    frequencyInput = null;
    monthOfYearInput = null;
    dayOfMonthInput = null;
    dayOfWeekInput = null;
    hourOfDayInput = null;
    minuteOfHourInput = null;
    recurringStartsAtInput = null;
    recurringEndsAtInput = null;
  }

  // console.log('occurrenceInput', occurrenceInput);
  // console.log('frequencyInput', frequencyInput);

  const sendNotificationsInput = !!sendNotifications;
  const notificationDistanceInput =
    notificationDistance !== null && notificationDistance !== undefined
      ? validator.escape(String(notificationDistance))
      : null;
  const systemEventIdInput = systemEventId
    ? validator.escape(String(systemEventId))
    : existingEvent.system_event_id;

  // Missing required input
  if (!titleInput || !startsAtInput) error = 'Missing required input.';

  if (!titleInput || !validator.isLength(titleInput, { min: 2, max: 100 }))
    error = 'Invalid title input.';

  if (!startsAtInput || !validator.isISO8601(startsAtInput))
    error = 'Invalid startsAt input.';

  if (localTime && !localTimeInput) error = 'Invalid localTime input.';

  if (
    !!durationInput &&
    !validator.isNumeric(String(durationInput), {
      no_symbols: true,
      min: 1, // 1 second
      max: 86400, // 1 day
    })
  )
    error = 'Invalid duration input.';

  if (!!notesInput && !validator.isLength(notesInput, { min: 1, max: 500 }))
    error = 'Invalid notes input. (too long)';

  // Validate color
  if (
    !!colorInput &&
    (!validator.isHexColor(colorInput) ||
      !validator.isLength(colorInput, { min: 3, max: 8 }))
  )
    error = 'Invalid color input. (must be hex ie. "ff0000")';

  if (
    !!clientIdInput &&
    !validator.isNumeric(String(clientIdInput), { no_symbols: true })
  )
    error = 'Invalid clientId input.';

  if (
    !!sessionTypeIdInput &&
    !validator.isNumeric(String(sessionTypeIdInput), { no_symbols: true })
  )
    error = 'Invalid sessionTypeId input.';

  // Recurrence inputs

  if (!Occurrences.includes(occurrenceInput))
    error = 'Invalid occurrence input.';

  if (
    occurrenceInput === Occurrence.recurring &&
    (!frequencyInput || !Frequencies.includes(frequencyInput))
  )
    error = 'Invalid frequency input.';

  if (
    occurrenceInput === Occurrence.recurring &&
    !validator.isNumeric(String(intervalInput), { no_symbols: true })
  )
    error = 'Invalid interval input.';

  if (
    !!recurringStartsAtInput &&
    !validator.isISO8601(String(recurringStartsAtInput))
  )
    error = 'Invalid recurringStartsAt input.';

  if (
    !!recurringEndsAtInput &&
    !validator.isISO8601(String(recurringEndsAtInput))
  )
    error = 'Invalid recurringEndsAt input.';

  if (
    !!monthOfYearInput &&
    (!validator.isNumeric(String(monthOfYearInput), { no_symbols: true }) ||
      monthOfYearInput < 1 ||
      monthOfYearInput > 12)
  )
    error = 'Invalid monthOfYear input. (1 - 12)';

  if (
    !!dayOfMonthInput &&
    (!validator.isNumeric(String(dayOfMonthInput), { no_symbols: true }) ||
      dayOfMonthInput < 1 ||
      dayOfMonthInput > 31)
  )
    error = 'Invalid dayOfMonth input. (1 - 31)';

  if (dayOfWeek && dayOfWeek.length > 2) {
    const dayOfWeekArray = dayOfWeek.split(/[ ,]+/); // one or more commas or spaces

    for (let i = 0; i < dayOfWeekArray.length; i++) {
      if (!WeekDays.includes(dayOfWeekArray[i]))
        error = 'Invalid dayOfWeek input. (SU, MO, TU, WE, TH, FR, SA)';
    }
  } else if (dayOfWeek && !WeekDays.includes(dayOfWeek))
    error = 'Invalid dayOfWeek input. (SU, MO, TU, WE, TH, FR, SA)';

  if (
    !!hourOfDayInput &&
    (!validator.isNumeric(String(hourOfDayInput), { no_symbols: true }) ||
      hourOfDayInput < 0 ||
      hourOfDayInput > 23)
  )
    error = 'Invalid hourOfDay input. (0 - 23)';

  if (
    !!minuteOfHourInput &&
    (!validator.isNumeric(String(minuteOfHourInput), {
      no_symbols: true,
    }) ||
      minuteOfHourInput < 0 ||
      minuteOfHourInput > 59)
  )
    error = 'Invalid minuteOfHour input. (0 - 59)';

  const monthOfYearExists = !!monthOfYearInput;
  const dayOfMonthExists = !!dayOfMonthInput;
  const dayOfWeekExists = !!dayOfWeekInput || dayOfWeekInput === 0;
  const hourOfDayExists = !!hourOfDayInput || hourOfDayInput === 0;
  const minuteOfHourExists = !!minuteOfHourInput || minuteOfHourInput === 0;

  if (occurrenceInput === Occurrence.recurring && !recurringStartsAtInput)
    error = 'recurring events require a recurringStartsAt date.';

  if (
    occurrenceInput === Occurrence.recurring &&
    frequencyInput === Frequency.yearly &&
    (!monthOfYearExists ||
      !dayOfMonthExists ||
      !hourOfDayExists ||
      !minuteOfHourExists)
  )
    error = 'YEARLY requires monthOfYear, dayOfMonth, hourOfDay, minuteOfHour';

  if (
    occurrenceInput === Occurrence.recurring &&
    frequencyInput === Frequency.monthly &&
    (!dayOfMonthExists || !hourOfDayExists || !minuteOfHourExists)
  )
    error = 'MONTHLY requires dayOfMonth, hourOfDay, minuteOfHour';

  if (
    occurrenceInput === Occurrence.recurring &&
    frequencyInput === Frequency.weekly &&
    (!dayOfWeekExists || !hourOfDayExists || !minuteOfHourExists)
  )
    error = 'WEEKLY requires dayOfWeek, hourOfDay, minuteOfHour';

  if (
    occurrenceInput === Occurrence.recurring &&
    frequencyInput === Frequency.daily &&
    (!hourOfDayExists || !minuteOfHourExists)
  )
    error = 'DAILY requires hourOfDay, minuteOfHour';

  if (
    !!notificationDistanceInput &&
    !validator.isNumeric(String(notificationDistanceInput), {
      no_symbols: true,
      min: 1, // 1 second
      max: 604800, // 7 days
    })
  )
    error = 'Invalid notificationDistance input.';

  if (
    !!systemEventIdInput &&
    !validator.isLength(systemEventIdInput, { min: 10, max: 50 })
  )
    error = 'Invalid systemEventId input';

  return {
    error,
    startsAtInput,
    localTimeInput,
    tzInput,
    titleInput,
    clientIdInput,
    sessionTypeIdInput,
    notesInput,
    colorInput,
    durationInput,
    isActiveInput,
    occurrenceInput,
    frequencyInput,
    recurringStartsAtInput,
    recurringEndsAtInput,
    intervalInput,
    monthOfYearInput,
    dayOfMonthInput,
    dayOfWeekInput,
    hourOfDayInput,
    minuteOfHourInput,
    sendNotificationsInput,
    notificationDistanceInput,
    systemEventIdInput,
  };
};

export default {};
