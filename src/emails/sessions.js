import moment from 'moment';
import ejs from 'ejs';

import { getUser } from '@/models/users';
import { getClient } from '@/models/clients';
import {
  getSession,
  getUsedSessions,
  getUsedSessionCount,
  getAvailableSessionIds,
} from '@/models/sessions';
import { getSessionTypes } from '@/models/sessionTypes';
import { Templates, CacheKeys, OmitProps } from '@/constants';
import { getSessionTypeLabel, omit } from '@/helpers';
import { getMailOptions, hasRequiredData, sendEmail } from '@/emails/helpers';
import { commonData, commonSmtpOptions } from './constants';
import { copyMessageToSent } from '@/imap/helpers';
import logger from '@/logger';

export const sendSessionReceipt = async (
  userId,
  clientId,
  sessionId,
  message,
  ccMe,
  poolClient
) =>
  new Promise(async (resolve, reject) => {
    const historyNumDays = 30;
    const startDate = moment()
      .subtract(historyNumDays, 'days')
      .format('YYYY-MM-DD');

    let userResult;
    let clientResult;
    let sessionResult;
    let sessionsResult;
    let sessionCountResult;
    let sessionTypesResult;
    let availableSessionIdsResult;

    try {
      userResult = await getUser(userId, poolClient);
      clientResult = await getClient(userId, clientId, poolClient);
      sessionResult = await getSession(clientId, sessionId, poolClient);
      sessionsResult = await getUsedSessions(
        clientId,
        startDate,
        null,
        poolClient
      );
      sessionCountResult = await getUsedSessionCount(clientId, poolClient);
      sessionTypesResult = await getSessionTypes(userId, poolClient);
      availableSessionIdsResult = await getAvailableSessionIds(
        clientId,
        poolClient
      );
    } catch (err) {
      console.log('err', err);

      return reject(new Error('There was a problem fetching session data.'));
    }

    // console.log('userResult', userResult);
    // console.log('clientResult', clientResult);
    // console.log('sessionResult', sessionResult);
    // console.log('sessionsResult', sessionsResult);
    // console.log('sessionCountResult', sessionCountResult);
    // console.log('availableSessionIdsResult', availableSessionIdsResult);

    if (
      !userResult ||
      !clientResult ||
      !sessionResult ||
      !sessionsResult.length ||
      !sessionCountResult.length // ||
      // !sessionTypesResult.length
    )
      return reject(new Error('There was a problem fetching session data.'));

    const user = userResult;
    const client = omit(clientResult, OmitProps.client);
    const session = sessionResult;
    const sessionTypes = sessionTypesResult;
    const totalUsedSessions = sessionCountResult[0].count;
    const sessionTypeLabel = getSessionTypeLabel(sessionId, sessionTypes);
    const usedSessions = sessionsResult
      .map(s => ({
        sessionType: getSessionTypeLabel(s.id, sessionTypes),
        usedAt: moment(s.used_at || undefined).format('YYYY-MM-DD'),
      }))
      .sort((a, b) => new Date(b.used_at) - new Date(a.used_at));
    const availableSessions = availableSessionIdsResult.length;

    // Prepare data for template
    const data = {
      ...commonData,
      title: "A Summary of Today's Session - SessionTracker",
      clientName: client.name_alias,
      trainerName: user.name,
      trainerAvatar: user.avatar,
      trainerMessage: message || '',
      sessionDate: moment(session.used_at || undefined).format('YYYY-MM-DD'),
      sessionTypeLabel,
      usedSessions,
      historyNumDays,
      totalSessions: totalUsedSessions,
      availableSessions,
      showHeaderLogo: false,
    };
    const optional = ['trainerAvatar', 'trainerMessage'];

    // Make sure everything exists...
    if (!hasRequiredData(data, optional))
      return reject(new Error('Missing required input.'));

    if (!client.email_alias || !user.email)
      return reject(new Error('There was a problem creating session email.'));

    const options = {};
    const smtpOptions = {
      ...commonSmtpOptions,
      to: client.email_alias,
      cc: ccMe ? user.email : undefined,
      subject: `Your Session Summary for ${data.sessionDate}`,
      attachments: [], // hide logo attachment here
    };
    const emailCacheKey = CacheKeys.sessionReceipt(
      userId,
      clientId,
      session.id
    );

    let htmlString;

    try {
      htmlString = await ejs.renderFile(
        Templates.sessionReceipt,
        data,
        options
      );
    } catch (err) {
      return reject(err);
    }

    return sendEmail(
      htmlString,
      smtpOptions,
      err => {
        if (err) reject(err);

        try {
          const mailOptions = getMailOptions(htmlString, smtpOptions);

          copyMessageToSent(mailOptions);
        } catch (err2) {
          logger.error(err2);
        }

        return resolve(true);
      },
      emailCacheKey
    );
  });

export default {};
