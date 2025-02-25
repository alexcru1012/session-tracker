import moment from 'moment';
import ejs from 'ejs';
import ICal from 'ical-generator';

import { getUser } from '@/models/users';
import { getClientSimple } from '@/models/clients';
import { getSessionTypes } from '@/models/sessionTypes';
import { Templates, CacheKeys, OmitProps, Options } from '@/constants';
import { getSessionTypeLabel, getTimezone, omit } from '@/helpers';
import { cacheData, getDataFromCache } from '@/redis/helpers';
import { getMailOptions, hasRequiredData, sendEmail } from '@/emails/helpers';
import {
  getCalendarEvent,
  getCalendarEventsForClient,
} from '@/models/calendar';
import { copyMessageToSent } from '@/imap/helpers';
import logger from '@/logger';
import { commonData, commonSmtpOptions } from './constants';

export const sendClientEventConfirmation = async (
  event,
  startDate,
  endDate,
  cacheKey,
  poolClient
) =>
  new Promise(async (resolve, reject) => {
    let userResult;
    let clientResult;
    let sessionTypesResult;
    let calendarEventsResult;

    try {
      userResult = await getUser(event.user_id, poolClient);

      if (!userResult)
        return reject(new Error('There was a problem fetching session data.'));

      clientResult = await getClientSimple(
        event.user_id,
        event.client_id,
        poolClient
      );
      sessionTypesResult = await getSessionTypes(event.user_id, poolClient);
      calendarEventsResult = await getCalendarEventsForClient(
        userResult,
        event.client_id,
        startDate,
        endDate,
        poolClient
      );
    } catch (err) {
      console.log('err', err);

      return reject(new Error('There was a problem fetching event data.'));
    }

    // console.log('userResult', userResult);
    // console.log('clientResult', clientResult);
    // console.log('eventResult', eventResult);
    // console.log('sessionTypesResult', sessionTypesResult);

    if (
      !userResult ||
      !clientResult ||
      !calendarEventsResult ||
      !calendarEventsResult.events // ||
      // !sessionTypesResult // .length
    )
      return reject(new Error('There was a problem fetching session data.'));

    const user = userResult;
    const client = omit(clientResult, OmitProps.client);
    const sessionTypes = sessionTypesResult || [];
    const sessionTypeLabel = getSessionTypeLabel(
      event.session_type_id,
      sessionTypes
    );
    const { events, pgEventsById } = calendarEventsResult;

    if (!client.email_alias || !user.email) {
      // Lets ignore it...
      if (!client.email_alias && cacheKey) {
        // Cache for 24h
        cacheData(cacheKey, true, 86400);

        return reject(
          new Error(
            'There was a problem creating confirmation email. No client email address.'
          )
        );
      }

      return reject(
        new Error(
          'There was a problem creating confirmation email. No user email found.'
        )
      );
    }

    const userTz = getTimezone(user.tz || 'UTC');
    // Display GMT if we don't know the users timezone
    const makeStartLabel = (startsAt, format) =>
      userTz !== 'UTC'
        ? moment
            .utc(startsAt)
            .tz(userTz)
            .format(format)
        : `${moment(startsAt).format(format)} GMT`;

    const upcomingEvents = events
      .slice(0, 6)
      .map(e => {
        const pgEvent = pgEventsById[(e.id || '').split('-')[0]] || {};

        if (!pgEvent) return null;

        return {
          title: pgEvent.title,
          sessionType: getSessionTypeLabel(
            pgEvent.session_type_id,
            sessionTypes
          ),
          startsAt: makeStartLabel(e.starts_at, 'MMM Do, h:mm A (z)'),
        };
      })
      .filter(e => !!e)
      .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
    const startsAt = moment(event.starts_at).startOf('minute');
    const endsAt = startsAt
      .clone()
      .add(event.duration || Options.defaultSessionDurationS, 'seconds');
    const dateLabel = makeStartLabel(startsAt, 'MMMM Do');
    const whenDateLabel = `${makeStartLabel(startsAt, 'dddd MMMM Do')}`;
    const whenTimeLabel = `${makeStartLabel(
      startsAt,
      'h:mm A'
    )} - ${makeStartLabel(endsAt, 'h:mm A (z)')}`;
    // const contactLabel = links
    //   ? `Please contact ${user.name} at ${links} for questions or schedule changes.`
    //   : null;

    // Prepare data for template
    const data = {
      ...commonData,
      title: 'Session Confirmed',
      clientName: client.name_alias,
      trainerName: user.name,
      trainerAvatar: user.avatar,
      trainerHasContact: user.contact_email || user.contact_phone,
      trainerContactEmail: user.contact_email,
      trainerContactPhone: user.contact_phone,
      eventTitle: event.title,
      dateLabel,
      whenDateLabel,
      whenTimeLabel,
      sessionTypeLabel,
      upcomingEvents,
      showHeaderLogo: false,
    };
    const optional = [
      'trainerAvatar',
      'trainerHasContact',
      'trainerContactEmail',
      'trainerContactPhone',
    ];

    // Make sure everything exists...
    if (!hasRequiredData(data, optional))
      return reject(new Error('Missing required input.'));

    // Generate an iCal invitation
    const invite = ICal({
      domain: 'mysessiontracker.com',
      name: 'Session Tracker',
      timezone: user.tz,
      events: [
        {
          start: startsAt,
          end: startsAt
            .clone()
            .add(event.duration || Options.defaultSessionDurationS, 'seconds'),
          summary: event.title,
          organizer: `${user.name} <${user.contact_email || user.email}>`,
        },
      ],
    });

    const options = {};
    const smtpOptions = {
      ...commonSmtpOptions,
      to: client.email_alias,
      from: `Session Tracker <${process.env.EMAILER_EMAIL}>`,
      subject: `Confirmed: ${event.title} with ${user.name}`,
      icalEvent: {
        filename: 'invite.ics',
        method: 'request',
        content: invite.toString(),
      },
      attachments: [], // hide logo attachment here
    };
    const emailCacheKey = CacheKeys.clientEventConfirmation(
      event.user_id,
      event.id,
      event.client_id
    );

    let htmlString;

    try {
      htmlString = await ejs.renderFile(
        Templates.clientEventConfirmation,
        data,
        options
      );
    } catch (err) {
      logger.error(err);

      return reject(err);
    }

    return sendEmail(
      htmlString,
      smtpOptions,
      err => {
        if (err) reject(err);
        else {
          const mailOptions = getMailOptions(htmlString, smtpOptions);

          try {
            copyMessageToSent(mailOptions);
          } catch (err2) {
            logger.error(err2);
          }

          resolve();
        }
      },
      emailCacheKey
    );
  });

export const sendClientEventCancellation = async (
  event,
  user,
  client,
  renderHtml,
  poolClient
) =>
  new Promise(async (resolve, reject) => {
    // const emailCacheKey = CacheKeys.clientEventCancellation(
    //   event.user_id,
    //   event.id,
    //   event.client_id
    // );
    const sentCacheKey = CacheKeys.emails.toClient.eventCancellationSent(
      event.user_id,
      event.client_id,
      event.id
    );

    const hasBeenSent = await getDataFromCache(sentCacheKey);

    if (!!hasBeenSent)
      return reject(new Error('Cancellation email was already sent.'));

    let sessionTypesResult;

    try {
      sessionTypesResult = await getSessionTypes(event.user_id, poolClient);
    } catch (err) {
      console.log('err', err);
      logger.error(`sendClientEventCancellation: ${err}`);
      // return reject(new Error('There was a problem fetching event data.'));
    }

    const userTz = getTimezone(user.tz || 'UTC');
    // Display GMT if we don't know the users timezone
    const makeStartLabel = (startsAt, format) =>
      userTz !== 'UTC'
        ? moment
            .utc(startsAt)
            .tz(userTz)
            .format(format)
        : `${moment(startsAt).format(format)} GMT`;
    const startsAt = moment(event.starts_at).startOf('minute');
    const endsAt = startsAt
      .clone()
      .add(event.duration || Options.defaultSessionDurationS, 'seconds');
    const dateLabel = makeStartLabel(startsAt, 'MMMM Do');
    const whenDateLabel = `${makeStartLabel(startsAt, 'dddd MMMM Do')}`;
    const whenTimeLabel = `${makeStartLabel(
      startsAt,
      'h:mm A'
    )} - ${makeStartLabel(endsAt, 'h:mm A (z)')}`;
    const sessionTypes = sessionTypesResult || [];
    const sessionTypeLabel = getSessionTypeLabel(
      event.session_type_id,
      sessionTypes
    );

    const invite = ICal({
      domain: 'mysessiontracker.com',
      name: 'Session Tracker',
      events: [
        {
          start: startsAt,
          end: startsAt
            .clone()
            .add(event.duration || Options.defaultSessionDurationS, 'seconds'),
          summary: event.title,
          organizer: `${user.name} <${user.contact_email || user.email}>`,
        },
      ],
    });

    const smtpOptions = {
      ...commonSmtpOptions,
      to: client.email_alias,
      from: `Session Tracker <${process.env.EMAILER_EMAIL}>`,
      subject: `Session Cancelled: ${event.title} with ${user.name}`,
      icalEvent: {
        filename: 'invite.ics',
        method: 'CANCEL',
        content: invite.toString(),
      },
      attachments: [], // hide logo attachment here
    };
    const data = {
      ...commonData,
      title: 'Session Cancelled',
      trainerName: user.name,
      trainerAvatar: user.avatar,
      trainerHasContact: user.contact_email || user.contact_phone,
      trainerContactEmail: user.contact_email || user.email,
      trainerContactPhone: user.contact_phone,
      eventTitle: event.title,
      dateLabel,
      whenDateLabel,
      whenTimeLabel,
      sessionTypeLabel,
      showHeaderLogo: false,
    };
    const optional = [
      'trainerAvatar',
      'trainerHasContact',
      'trainerContactEmail',
      'trainerContactPhone',
    ];

    // Make sure everything exists...
    if (!hasRequiredData(data, optional))
      return reject(new Error('Missing required input.'));

    let htmlString;
    const options = {};

    try {
      htmlString = await renderHtml(data, options);
    } catch (err) {
      logger.error(err);

      return reject(err);
    }

    return sendEmail(
      htmlString,
      smtpOptions,
      err => {
        if (err) reject(err);
        else {
          const mailOptions = getMailOptions(htmlString, smtpOptions);

          // Cache for 24h
          cacheData(sentCacheKey, true, 86400);

          try {
            copyMessageToSent(mailOptions);
          } catch (err2) {
            logger.error(err2);
          }

          resolve();
        }
      }
      // sentCacheKey // manually checking cacheKeys here
    );
  });

export const sendClientEventReminder = async (
  eventId,
  pgEvent,
  cacheKey,
  poolClient
) =>
  new Promise(async (resolve, reject) => {
    let userResult;
    let clientResult;
    let eventResult;
    let sessionTypesResult;

    try {
      userResult = await getUser(pgEvent.user_id, poolClient);
      clientResult = await getClientSimple(
        pgEvent.user_id,
        pgEvent.client_id,
        poolClient
      );
      eventResult = await getCalendarEvent(eventId, userResult?.tz, poolClient);
      sessionTypesResult = await getSessionTypes(pgEvent.user_id, poolClient);
    } catch (err) {
      console.log('err', err);

      return reject(new Error('There was a problem fetching event data.'));
    }

    // console.log('userResult', userResult);
    // console.log('clientResult', clientResult);
    // console.log('eventResult', eventResult);
    // console.log('sessionTypesResult', sessionTypesResult);

    if (
      !userResult ||
      !eventResult ||
      !clientResult // ||
      // !sessionTypesResult //.length
    )
      return reject(new Error('There was a problem fetching session data.'));

    const user = userResult;
    const event = eventResult;
    const client = omit(clientResult, OmitProps.client);
    const sessionTypes = sessionTypesResult || [];
    const sessionTypeLabel = getSessionTypeLabel(
      pgEvent.session_type_id,
      sessionTypes
    );

    const userTz = getTimezone(user.tz || 'UTC');
    // Display GMT if we don't know the users timezone
    const makeStartLabel = (startsAt, format) =>
      userTz !== 'UTC'
        ? moment
            .utc(startsAt)
            .tz(userTz)
            .format(format)
        : `${moment(startsAt).format(format)} GMT`;

    const startsAt = moment(event.starts_at).startOf('minute');
    const endsAt = startsAt
      .clone()
      .add(event.duration || Options.defaultSessionDurationS, 'seconds');
    const dateLabel = makeStartLabel(startsAt, 'MMMM Do');
    const whenDateLabel = `${makeStartLabel(startsAt, 'dddd MMMM Do')}`;
    const whenTimeLabel = `${makeStartLabel(
      startsAt,
      'h:mm A'
    )} - ${makeStartLabel(endsAt, 'h:mm A (z)')}`;

    // Prepare data for template
    const data = {
      ...commonData,
      title: `Today's session with ${user.name} is starting soon`,
      clientName: client.name_alias,
      trainerName: user.name,
      trainerAvatar: user.avatar,
      trainerHasContact: user.contact_email || user.contact_phone,
      trainerContactEmail: user.contact_email || user.email,
      trainerContactPhone: user.contact_phone,
      eventTitle: event.title,
      dateLabel,
      whenDateLabel,
      whenTimeLabel,
      sessionTypeLabel,
      showHeaderLogo: false,
    };
    const optional = [
      'trainerAvatar',
      'trainerHasContact',
      'trainerContactEmail',
      'trainerContactPhone',
    ];

    // Make sure everything exists...
    if (!hasRequiredData(data, optional))
      return reject(new Error('Missing required input.'));

    if (!client.email_alias || !user.email) {
      // Lets ignore it...
      if (!client.email_alias && cacheKey) {
        // Cache for 24h
        cacheData(cacheKey, true, 86400);

        return reject(
          new Error(
            'There was a problem creating reminder email. No client email address.'
          )
        );
      }

      return reject(
        new Error(
          'There was a problem creating reminder email. No user email found.'
        )
      );
    }

    // Generate an iCal invitation
    const invite = ICal({
      domain: 'mysessiontracker.com',
      name: 'Session Tracker',
      timezone: user.tz,
      events: [
        {
          start: startsAt,
          end: startsAt
            .clone()
            .add(event.duration || Options.defaultSessionDurationS, 'seconds'),
          summary: event.title,
          organizer: `${user.name} <${user.contact_email || user.email}>`,
        },
      ],
    });

    const options = {};
    const smtpOptions = {
      ...commonSmtpOptions,
      to: client.email_alias,
      from: `Session Tracker <${process.env.EMAILER_EMAIL}>`,
      subject: `Reminder: ${event.title} with ${user.name}`,
      icalEvent: {
        filename: 'invite.ics',
        method: 'request',
        content: invite.toString(),
      },
      attachments: [], // hide logo attachment here
    };
    const emailCacheKey = CacheKeys.clientEventReminder(
      event.user_id,
      event.id,
      event.client_id
    );

    let htmlString;

    try {
      htmlString = await ejs.renderFile(
        Templates.clientEventReminder,
        data,
        options
      );
    } catch (err) {
      logger.error(err);

      return reject(err);
    }

    return sendEmail(
      htmlString,
      smtpOptions,
      err => {
        if (err) reject(err);
        else {
          const mailOptions = getMailOptions(htmlString, smtpOptions);

          try {
            copyMessageToSent(mailOptions);
          } catch (err2) {
            logger.error(err2);
          }

          resolve();
        }
      },
      emailCacheKey
    );
  });

export default {};
