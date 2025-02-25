import nodemailer from 'nodemailer';

import logger from '@/logger';

const {
  WORKMAIL_SMTP_HOST,
  WORKMAIL_SMTP_PORT,
  WORKMAIL_SUPPORT_USER,
  WORKMAIL_SUPPORT_PASS,
  WORKMAIL_EMAILER_USER,
  WORKMAIL_EMAILER_PASS,
} = process.env;

// Using Gmail oauth credentials
export const emailerTransport =
  process.env.ENV === 'production'
    ? nodemailer.createTransport({
        host: WORKMAIL_SMTP_HOST,
        port: WORKMAIL_SMTP_PORT,
        // debug: true,
        auth: {
          user: WORKMAIL_EMAILER_USER,
          pass: WORKMAIL_EMAILER_PASS,
        },
      })
    : null;

export const supportTransport =
  process.env.ENV === 'production'
    ? nodemailer.createTransport({
        host: WORKMAIL_SMTP_HOST,
        port: WORKMAIL_SMTP_PORT,
        // debug: true,
        auth: {
          user: WORKMAIL_SUPPORT_USER,
          pass: WORKMAIL_SUPPORT_PASS,
        },
      })
    : null;

if (emailerTransport) {
  emailerTransport.verify((err, _success) => {
    console.log('emailerTransport.verify', emailerTransport.options.host);

    if (err) logger.error('nodemailer error', err);
    else logger.info('Emailer nodemailer connected :)');
  });
} else logger.info('Emailer nodemailer NOT CONNECTED');

if (supportTransport) {
  supportTransport.verify((err, _success) => {
    console.log('supportTransport.verify', supportTransport.options.host);

    if (err) logger.error('nodemailer error', err);
    else logger.info('Support nodemailer is connected :)');
  });
} else logger.info('Support nodemailer NOT CONNECTED');
