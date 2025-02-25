import * as Sentry from '@sentry/node';

import logger from '@/logger';
import { emailerTransport, supportTransport } from '@/emails';
import { cacheData, getDataFromCache } from '@/redis/helpers';

export const getMailOptions = (html, smtpOptions) => ({
  html,
  from: `Session Tracker <${process.env.EMAILER_EMAIL}>`,
  ...smtpOptions,
});

/**
 *
 * @param {string} template
 * const template = ejs.compile(`<h1>hello, <%= name %></h1>`, options);
 * @param {object} data
 * const data = { name: 'Nico };
 * @param {object} smtpOptions
 * const smtpOptions = {
 *  to: user.email,
 *  subject: 'Welcome!',
 * }};
 * @param {function} callback
 * const callback = (err) => {};
 *
 */
export const sendEmail = async (
  html,
  smtpOptions,
  callback,
  cacheKey,
  cacheTimeS
) => {
  if (process.env.ENV !== 'production') {
    const errorStr = 'Skipping sendEmail in development';
    const error = new Error(errorStr);

    logger.warn(errorStr);
    // console.error(errorStr);

    callback(error, errorStr);

    return;
  }

  logger.info(`sendEmail ${smtpOptions.subject}`);
  logger.info(`smtpOptions ${JSON.stringify(smtpOptions)}`);

  // Make sure not to send the same email too often
  if (cacheKey) {
    const result = await getDataFromCache(cacheKey).catch(err => {
      // continue
    });
    if (result) {
      const errorStr =
        'Attempting to send email too often (try again in a few minutes)'; // : ${cacheKey}`;
      const error = new Error(errorStr);

      Sentry.captureException(error);
      logger.error(errorStr);

      callback(error, errorStr);

      // throw error;
      // Promise.reject(error);
      return;
    }
  }

  const mailOptions = getMailOptions(html, smtpOptions);

  // Store an entry in cache
  if (cacheKey) {
    try {
      cacheData(cacheKey, 'sent', cacheTimeS || 60); // 1 minute
    } catch (error) {
      Sentry.captureException(error);
      // Continue...
    }
  }

  const isSupport =
    smtpOptions.from &&
    smtpOptions.from.indexOf(process.env.SUPPORT_EMAIL) > -1;

  logger.info(`Using ${isSupport ? 'support' : 'notifications'} transport`);
  const transport = isSupport ? supportTransport : emailerTransport;

  try {
    if (transport) transport.sendMail(mailOptions, callback);
    else callback(null); // no error
  } catch (error) {
    console.log(error);
    logger.error(error);
    Sentry.captureException(error);
    callback(error, error.message);
  }
};

export const hasRequiredData = (data, optional = []) => {
  // Make sure everything exists...
  const keys = Object.keys(data);

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];

    // Only allow empty keys if it's listed in "optional"
    if (
      optional.length &&
      !optional.includes(key) &&
      (data[key] === null || data[key] === undefined)
    ) {
      logger.error(`hasRequiredData missing key: ${key}`);

      return false;
    }
  }

  return true;
};
