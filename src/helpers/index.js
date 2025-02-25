import bcrypt from 'bcrypt-nodejs';
import SQL from 'sql-template-strings';
import * as Sentry from '@sentry/node';
import aws from 'aws-sdk';
import multer from 'multer';
import multerS3 from 'multer-s3';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import moment from 'moment-timezone';

import { Strings, OmitProps, Options } from '@/constants';
import { TimezoneOptions } from '@/constants/timezones';
import { cacheData, getDataFromCache } from '@/redis/helpers';
import logger from '@/logger';
import pool from '@/postgres';

const s3 = new aws.S3();

export function omit(obj, keys) {
  if (!obj) return obj;

  const shallowCopy = {
    ...obj,
  };

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    delete shallowCopy[key];
  }

  return shallowCopy;
}

export const generateHash = password =>
  bcrypt.hashSync(password, bcrypt.genSaltSync(8));

export const isPasswordValid = (plainTextPass, hashedPass) =>
  bcrypt.compareSync(plainTextPass, hashedPass);

// const thing = jwt.sign(
//   {
//     id: {HOME_SECRET},
//   },
//   process.env.JWT_SECRET
// );

// console.log('thing', thing);

export const generateJWTToken = (user, expiresIn) =>
  jwt.sign(omit(user, OmitProps.me), process.env.JWT_SECRET, {
    expiresIn:
      expiresIn ||
      (user.is_activated
        ? Options.jwtExpiresIn
        : Options.jwtExpiresInNonAuthed),
  });

export const generateRandomCode = (bytes = 20) =>
  new Promise((resolve, reject) => {
    crypto.randomBytes(bytes, (err, buf) => {
      if (err) reject(new Error(err.message || Strings.defaultError));

      resolve(buf.toString('hex'));
    });
  });

export const runQuery = (
  query,
  cacheKey,
  cacheTime = Options.defaultCacheTimeS,
  client = null
) =>
  new Promise(async (resolve, reject) => {
    if (cacheKey) {
      try {
        // Get cached data
        const cachedData = await getDataFromCache(cacheKey);

        // logger.info(`RETURNING CACHED DATA: ${cacheKey}`);
        // console.log('returning cached data', cacheKey);

        if (cachedData) return resolve(cachedData);
      } catch (error) {
        // Nothing found, continue
      }
    }

    // console.log('FETCHING DATA', cacheKey);
    // console.log('query', query.text);
    // Get pool client
    let poolClient = client;
    let wasCreated = false;

    const maybeReleaseClient = () => {
      if (poolClient && wasCreated) poolClient.release();
    };

    if (!poolClient) {
      wasCreated = true;
      // console.log('runQuery:', query);
      // logger.info(
      //   `Pulling new client from the pool. total: ${pool.totalCount}, waiting: ${pool.waitingCount}, cacheKey: ${cacheKey}`
      // );
      poolClient = await pool.connect();
    }

    if (!poolClient) reject(new Error('Could not create pool client.'));

    let data;

    try {
      // Query
      data = await poolClient.query(query);
    } catch (error) {
      logger.error(error);
      Sentry.captureException(error);

      maybeReleaseClient();

      // Halt
      return reject(error);
    }

    if (cacheKey)
      cacheData(cacheKey, data?.rows, cacheTime || Options.defaultCacheTimeS);

    // Finished
    maybeReleaseClient();

    // Send response
    return resolve(data?.rows || data?.count || data);
  });

export const sendMaskedError = (
  error,
  betterMessage = Strings.defaultError,
  next
) => {
  logger.error(
    error && typeof error === 'object'
      ? error.stack || error.message || betterMessage
      : betterMessage
  );

  // console.log('sendMaskedError', error);

  return next ? next(betterMessage) : betterMessage;
};

export const sendBadRequest = (
  res,
  message = Strings.defaultError,
  status = 400,
  data
) => {
  logger.error(`${status}: ${message}`);
  res.status(status).json({ success: false, message, data });
};

export const doesUserHaveClient = async (userId, clientId, poolClient) => {
  try {
    // const cacheKey = CacheKeys.clientKey(userId, clientId);
    const clientResults = await runQuery(
      SQL`
      SELECT * FROM clients WHERE id = ${clientId} AND user_id = ${userId};
    `,
      null,
      null,
      poolClient
    );

    if (!clientResults || !clientResults.length) return false;

    return true;
  } catch (error) {
    logger.error(error);

    // Mask sensitive errors
    return false;
  }
};

const fileFilter = (req, file, cb) => {
  if (cb && (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png'))
    cb(null, true);
  else if (cb)
    cb(new Error('Invalid file type, only JPEG and PNG is allowed!'), false);
};

export const s3Upload = (bucket, name) => {
  if (!bucket) return;

  /* eslint-disable */
  return multer({
    fileFilter,
    storage: multerS3({
      s3,
      bucket,
      acl: 'public-read',
      metadata: (req, file, cb) => {
        const { user } = req;

        // Save metadata
        if (cb) cb(null, { userId: user.id.toString() });
      },
      key: (req, file, cb) => {
        const { user } = req;
        const extension = file.mimetype.replace('image/', '');

        const filename = `${
          name || user.id
        }-${Date.now().toString()}.${extension}`;

        // Write to file
        if (cb) cb(null, filename);
      },
    }),
  });
  /* eslint-enable */
};

export const getSessionTypeLabel = (sessionId, sessionTypes) => {
  let label = 'General Session';
  if (sessionId && sessionTypes.length) {
    const st = sessionTypes.find(_st => String(_st.id) === String(sessionId));
    if (st) label = st.name || 'General Session';
  }

  return label;
};

export const parseBoolean = input => {
  if (input === false || input === 'false' || input === 0 || input === '0')
    return false;
  if (input === true || input === 'true' || input === 1 || input === '1')
    return true;

  return null;
};

/* eslint-disable no-cond-assign */
export const humanizeDuration = timeInS => {
  let result;
  if (timeInS) {
    if ((result = Math.round(timeInS / (60 * 60 * 24 * 30 * 12))) > 0) {
      // years
      return result === 1 ? `${result} year` : `${result} years`;
    }
    if ((result = Math.round(timeInS / (60 * 60 * 24 * 30))) > 0) {
      // months
      return result === 1 ? `${result} month` : `${result} months`;
    }
    if ((result = Math.round(timeInS / (60 * 60 * 24))) > 0) {
      // days
      return result === 1 ? `${result} day` : `${result} days`;
    }
    if ((result = Math.round(timeInS / (60 * 60))) > 0) {
      // hours
      return result === 1 ? `${result} hour` : `${result} hours`;
    }
    if ((result = Math.round(timeInS / 60)) > 0) {
      // minutes
      return result === 1 ? `${result} minute` : `${result} minutes`;
    }

    // result = result === 1 ? result + " second" : result + " seconds";
    return '0 minutes';
  }

  return '';
};
/* eslint-enable no-cond-assign */

export const getTimezone = tz => {
  if (!tz || tz === 'UTC') return 'UTC';

  // Convert -5:00 to America/New_York
  if (['0', '+', '-'].includes(tz[0])) {
    const result = TimezoneOptions.find(
      option => tz === option.value || tz === option.offset
    );

    return result ? result.value : 'UTC';
  }

  return tz;
};

export const getActivationLink = activationToken =>
  `${process.env.API_BASE}/connect/activate?token=${activationToken}`;

export const makeDateKey = userTz =>
  userTz
    ? moment().tz(getTimezone(userTz)).format('YYYY-MM-DD')
    : moment().format('YYYY-MM-DD');

// export const slugify = (...args: (string | number)[]): string => {
export const slugify = (...args) => {
  const value = args.join(' ');

  return value
    .normalize('NFD') // split an accented letter in the base letter and the acent
    .replace(/[\u0300-\u036f]/g, '') // remove all previously split accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 ]/g, '') // remove all chars not letters, numbers and spaces (to be replaced)
    .replace(/\s+/g, '-') // separator
    .substring(0, 99);
};

export const generateRandomSlug = () =>
  (Math.random() + 1).toString(36).substring(7);

export const getPagination = (page = 0, size = 10) => {
  const limit = size ? +size : 3;
  const offset = page ? page * limit : 0;

  return { limit, offset };
};
