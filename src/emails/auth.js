import ejs from 'ejs';

import logger from '@/logger';
import { Templates, Strings, CacheKeys } from '@/constants';
import { sendEmail, hasRequiredData, getMailOptions } from '@/emails/helpers';
import { commonData, commonSmtpOptions } from '@/emails/constants';
import { copyMessageToSent } from '@/imap/helpers';
import { getActivationLink } from '@/helpers';

export const sendActivationEmail = async (to, activationToken) =>
  new Promise(async (resolve, reject) => {
    const ejsOptions = {};
    const smtpOptions = {
      ...commonSmtpOptions,
      to,
      from: `SessionTracker <${process.env.SUPPORT_EMAIL}>`,
      subject: `Activate your ${Strings.appName} account`,
    };
    const templateData = {
      ...commonData,
      title: `${Strings.appName} account activation`,
      link: getActivationLink(activationToken),
    };

    if (!hasRequiredData(templateData))
      return reject(new Error('Missing required input'));

    let htmlString;

    try {
      htmlString = await ejs.renderFile(
        Templates.activate,
        templateData,
        ejsOptions
      );
    } catch (err) {
      return reject(err);
    }

    const mailOptions = getMailOptions(htmlString, smtpOptions);
    const cacheKey = CacheKeys.emails.toUser.activate(to);

    return sendEmail(
      htmlString,
      smtpOptions,
      error => {
        if (error) {
          logger.error(error);
          reject(error);
        } else {
          logger.info('sendActivationEmail sent.');

          try {
            copyMessageToSent(mailOptions);
          } catch (err) {
            logger.error(err);
          }

          resolve();
        }
      },
      cacheKey,
      300 // 5 min
    );
  });

export const sendWelcomeEmail = async (to, data) =>
  new Promise(async (resolve, reject) => {
    const ejsOptions = {};
    const smtpOptions = {
      ...commonSmtpOptions,
      to,
      from: `SessionTracker <${process.env.SUPPORT_EMAIL}>`,
      subject: `Welcome to ${Strings.appName}!`,
    };

    const templateData = {
      ...commonData,
      title: `Thanks for joining the ${Strings.appName} community`,
      name: data.name || '',
      email: data.email || '',
      iosLink:
        'https://itunes.apple.com/us/app/my-session-tracker/id1444380642?ls=1&mt=8',
      androidLink:
        'https://play.google.com/store/apps/details?id=com.listenfirstlabs.sessiontrackerandroid',
    };

    if (!hasRequiredData(templateData))
      return reject(new Error('Missing required input'));

    let htmlString;

    try {
      htmlString = await ejs.renderFile(
        Templates.welcome,
        templateData,
        ejsOptions
      );
    } catch (err) {
      return reject(err);
    }

    if (!htmlString) return reject(new Error('Could not create this email'));

    const mailOptions = getMailOptions(htmlString, smtpOptions);

    return sendEmail(
      htmlString,
      smtpOptions,
      error => {
        if (error) reject(error);
        else {
          console.log('email sent.');

          try {
            copyMessageToSent(mailOptions);
          } catch (err) {
            logger.error(err);
          }

          resolve();
        }
      }
      // emailCacheKey
    );
  });

export const sendForgotPasswordEmail = async (to, name, code) =>
  new Promise(async (resolve, reject) => {
    const ejsOptions = {};
    const smtpOptions = {
      ...commonSmtpOptions,
      to,
      from: `SessionTracker <${process.env.SUPPORT_EMAIL}>`,
      subject: `Reset your ${Strings.appName} password`,
    };
    const templateData = {
      ...commonData,
      name,
      code,
      title: `${Strings.appName} password change`,
    };

    if (!hasRequiredData(templateData)) return 'Missing required input';

    let htmlString;

    try {
      htmlString = await ejs.renderFile(
        Templates.forgotPassword,
        templateData,
        ejsOptions
      );
    } catch (err) {
      return reject(err);
    }

    const mailOptions = getMailOptions(htmlString, smtpOptions);

    return sendEmail(
      htmlString,
      smtpOptions,
      error => {
        if (error) {
          logger.error(`forgotPassword error ${error}`);
          reject(error);
        } else {
          logger.info('forgotPassword email sent.');

          try {
            copyMessageToSent(mailOptions);
          } catch (err) {
            logger.error(err);
          }

          resolve();
        }
      }
      // emailCacheKey
    );
  });

export const sendPasswordChangedEmail = async (to, name) =>
  new Promise(async (resolve, reject) => {
    const ejsOptions = {};
    const smtpOptions = {
      ...commonSmtpOptions,
      to,
      from: `SessionTracker <${process.env.SUPPORT_EMAIL}>`,
      subject: `Your ${Strings.appName} password has been changed`,
    };
    const templateData = {
      ...commonData,
      name,
      title: `${Strings.appName} password change was successful`,
    };

    if (!hasRequiredData(templateData))
      return reject(new Error('Missing required input'));

    let htmlString;

    try {
      htmlString = await ejs.renderFile(
        Templates.passwordChanged,
        templateData,
        ejsOptions
      );
    } catch (err) {
      return reject(err);
    }

    const mailOptions = getMailOptions(htmlString, smtpOptions);

    return sendEmail(htmlString, smtpOptions, error => {
      if (error) return reject(error);

      try {
        copyMessageToSent(mailOptions);
      } catch (err) {
        logger.error(err);
      }

      resolve();
    });
  });

export const sendOTPasswordEmail = async (to, name, code) =>
  new Promise(async (resolve, reject) => {
    const ejsOptions = {};
    const smtpOptions = {
      ...commonSmtpOptions,
      to,
      from: `SessionTracker <${process.env.SUPPORT_EMAIL}>`,
      subject: `One time password for ${Strings.appName}`,
    };
    const templateData = {
      ...commonData,
      name,
      code,
      title: `${Strings.appName} one time password`,
    };

    if (!hasRequiredData(templateData)) return 'Missing required input';

    let htmlString;

    try {
      htmlString = await ejs.renderFile(
        Templates.oneTimePassword,
        templateData,
        ejsOptions
      );
    } catch (err) {
      return reject(err);
    }

    const mailOptions = getMailOptions(htmlString, smtpOptions);

    return sendEmail(htmlString, smtpOptions, error => {
      if (error) {
        logger.error(`sendOTPasswordEmail error ${error}`);
        reject(error);
      } else {
        logger.info('oneTimePassword email sent.');

        try {
          copyMessageToSent(mailOptions);
        } catch (err) {
          logger.error(err);
        }

        resolve();
      }
    });
  });
