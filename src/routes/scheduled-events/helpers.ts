import { Request } from 'express';
import moment from 'moment-timezone';
import validator from 'validator';
import { body, param, validationResult } from 'express-validator';

import {
  PostScheduledEvent,
  PostScheduledEventParams,
} from '@/models/scheduledEvents/types';
import { TimezoneOptions } from '@/constants/timezones';

export const validatePost = async (
  req: Request<PostScheduledEventParams, PostScheduledEvent, never, never>
) => {
  await param('targetUserId')
    .notEmpty()
    .escape()
    .isNumeric({ no_symbols: true })
    .run(req);
  await body('sessionTypeId')
    .notEmpty()
    .escape()
    .isNumeric({ no_symbols: true })
    .run(req);
  await body('startsAt').notEmpty().escape().isISO8601().run(req);
  await body('localTime')
    .notEmpty()
    .escape()
    .isLength({ min: 3, max: 8 })
    .custom(value => moment(value, 'HH:mm:ss').isValid())
    .run(req);
  await body('tz')
    .escape()
    .customSanitizer(value =>
      value ? validator.escape(String(value)).replace(/&#x2F;/g, '/') : null
    )
    .notEmpty()
    .isLength({ min: 3, max: 50 })
    .custom(value => TimezoneOptions.findIndex(t => t.value === value) > -1)
    .run(req);
  await body('guestEmail').escape().notEmpty().isEmail().run(req);
  await body('guestName')
    .escape()
    .notEmpty()
    .isLength({ min: 2, max: 100 })
    .run(req);
  await body('notes').escape().isLength({ min: 0, max: 1000 }).run(req);

  return validationResult(req);
};

export const validatePatch = async (
  req: Request<PostScheduledEventParams, PostScheduledEvent, never, never>
) => {
  await param('targetUserId')
    .notEmpty()
    .escape()
    .isNumeric({ no_symbols: true })
    .run(req);
  await body('sessionTypeId')
    .notEmpty()
    .escape()
    .isNumeric({ no_symbols: true })
    .run(req);
  await body('startsAt').escape().isISO8601().run(req);
  await body('localTime')
    .escape()
    .isLength({ min: 3, max: 8 })
    .custom(value => moment(value, 'HH:mm:ss').isValid())
    .run(req);
  await body('tz')
    .escape()
    .customSanitizer(value =>
      value ? validator.escape(String(value)).replace(/&#x2F;/g, '/') : null
    )
    .isLength({ min: 3, max: 50 })
    .custom(value => TimezoneOptions.findIndex(t => t.value === value) > -1)
    .run(req);
  await body('guestEmail').escape().isEmail().run(req);
  await body('guestName').escape().isLength({ min: 2, max: 100 }).run(req);
  await body('notes').escape().isLength({ min: 0, max: 1000 }).run(req);

  return validationResult(req);
};
