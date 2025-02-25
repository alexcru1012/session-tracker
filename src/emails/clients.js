import moment from 'moment';
import ejs from 'ejs';
import toCsv from 'to-csv';

import logger from '@/logger';
import { CacheKeys, Templates } from '@/constants';
import { getMailOptions, hasRequiredData, sendEmail } from '@/emails/helpers';
import { commonData, commonSmtpOptions } from './constants';
import { copyMessageToSent } from '@/imap/helpers';

export const sendExportClientCSV = (user, rows) =>
  new Promise(async (resolve, reject) => {
    const today = moment().format('YYYY-MM-DD');

    // Prepare data for template
    const data = {
      ...commonData,
      title: 'My SessionTracker clients data is ready for download',
      trainerName: user.name,
      date: today,
    };
    const optional = [];

    // Make sure everything exists...
    if (!hasRequiredData(data, optional))
      return reject(new Error('Missing required input'));

    const options = {};
    const smtpOptions = {
      ...commonSmtpOptions,
      to: user.email,
      subject: 'My SessionTracker clients data is ready for download',
      attachments: [
        {
          filename: `sessiontracker-clients-${today}.csv`,
          content: toCsv(rows),
        },
      ],
    };
    const emailCacheKey = CacheKeys.myClientsCsv(user.id);

    let htmlString;

    try {
      htmlString = await ejs.renderFile(Templates.myClientsCsv, data, options);
    } catch (err) {
      logger.info(`sendExportClientCSV error ${err}`);

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
