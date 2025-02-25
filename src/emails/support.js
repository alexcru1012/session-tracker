import moment from 'moment';
import ejs from 'ejs';

import { Templates, CacheKeys } from '@/constants';
import { hasRequiredData, sendEmail } from '@/emails/helpers';
import { commonData, commonSmtpOptions } from './constants';

export const sendSupportMessage = async (user, subject, message) =>
  new Promise(async (resolve, reject) => {
    try {
      // Prepare data for template
      const data = {
        ...commonData,
        title: 'New Support Message',
        // userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userAvatar: user.avatar,
        subject: subject || '',
        message: message || '',
        timestamp: moment().format(),
      };
      const optional = ['userAvatar'];

      // Make sure everything exists...
      if (!hasRequiredData(data, optional))
        return reject(new Error('Missing required input.'));

      if (!user || !user.email)
        return reject(new Error('There was a problem creating support email.'));

      const options = {};
      const smtpOptions = {
        ...commonSmtpOptions,
        from: `SessionTracker <${process.env.SUPPORT_EMAIL}>`,
        to: process.env.SUPPORT_EMAIL,
        cc: 'sessiontrackerpro@gmail.com',
        subject: `New Support Message! (${subject}).`,
      };
      const emailCacheKey = CacheKeys.userSupportMessage(user.id);

      let htmlString;

      try {
        htmlString = await ejs.renderFile(
          Templates.supportMessage,
          data,
          options
        );
      } catch (err) {
        return reject(err);
      }

      sendEmail(
        htmlString,
        smtpOptions,
        (err, errStr) => {
          if (err) reject(errStr ? new Error(errStr) : err);
          else resolve(true);
        },
        emailCacheKey,
        300 // 5 minutes
      );
    } catch (error) {
      console.log('error', error);

      return reject(error);
    }
  });

export default {};
