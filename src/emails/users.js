import ejs from 'ejs';

import logger from '@/logger';
import { Templates } from '@/constants';
import { sendEmail, hasRequiredData, getMailOptions } from '@/emails/helpers';
import { commonData, commonSmtpOptions } from '@/emails/constants';
import { copyMessageToSent } from '@/imap/helpers';
import { getOrCreateUserMeta } from '@/mongo/helpers';

export const sendMailToMissingUser = async user =>
  new Promise(async (resolve, reject) => {
    const ejsOptions = {};
    const smtpOptions = {
      ...commonSmtpOptions,
      to: user.email,
      from: `SessionTracker <${process.env.SUPPORT_EMAIL}>`,
      subject: "It's not you, it's us!",
    };
    const templateData = {
      ...commonData,
      title: "It's not you, it's us!",
      trainerName: user.name,
    };

    if (!hasRequiredData(templateData))
      return reject(new Error('Missing required input'));

    let htmlString;

    try {
      htmlString = await ejs.renderFile(
        Templates.missingUser,
        templateData,
        ejsOptions
      );
    } catch (err) {
      return reject(err);
    }

    const mailOptions = getMailOptions(htmlString, smtpOptions);

    return sendEmail(htmlString, smtpOptions, error => {
      if (error) {
        logger.error(`sendMailToMissingUser error ${error}`);
        reject(error);
      } else {
        logger.info('sendMailToMissingUser email sent.');

        try {
          copyMessageToSent(mailOptions);
        } catch (err) {
          logger.error(err);
        }
        resolve();
      }
    });
  });

  
/** Send an email the first time a user successfully upgrades  */
export const sendUpgradeSuccessEmail = async (user, _userMeta) =>
  new Promise(async (resolve, reject) => {
    const userMeta = _userMeta || (await getOrCreateUserMeta(user.id));

    if (!userMeta) return reject(new Error('User meta was not found'));

    if (!!userMeta.wasSentUpgradeSuccessEmail)
      return reject(new Error('User has already been welcomed'));

    const ejsOptions = {};
    const smtpOptions = {
      ...commonSmtpOptions,
      to: user.email,
      from: `SessionTracker <${process.env.SUPPORT_EMAIL}>`,
      subject: 'Welcome to the club!',
    };
    const templateData = {
      ...commonData,
      title: 'You are now a premium user!',
      trainerName: user.name,
    };

    if (!hasRequiredData(templateData))
      return reject(new Error('Missing required input'));

    let htmlString;

    try {
      htmlString = await ejs.renderFile(
        Templates.upgradeSuccess,
        templateData,
        ejsOptions
      );
    } catch (err) {
      return reject(err);
    }

    const mailOptions = getMailOptions(htmlString, smtpOptions);

    return sendEmail(htmlString, smtpOptions, error => {
      if (error) {
        logger.error(`sendUpgradeSuccessEmail error ${error}`);
        reject(error);
      } else {
        logger.info('sendUpgradeSuccessEmail email sent.');

        userMeta.wasSentUpgradeSuccessEmail = new Date().toISOString();
        userMeta.save();

        try {
          copyMessageToSent(mailOptions);
        } catch (err) {
          logger.error(err);
        }
        resolve();
      }
    });
  });

export default {};
