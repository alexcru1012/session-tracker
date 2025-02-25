// import mimemessage from 'mimemessage';
// import { simpleParser } from 'mailparser';
// import Imap from 'imap';

// import * as Sentry from '@sentry/node';
// import {support, notifications} from '@/imap';
// import logger from '@/logger';

const NOOP = () => {};

// export const getImap = mailOptions => {
//   const isSupport =
//     mailOptions.from &&
//     mailOptions.from.indexOf(process.env.SUPPORT_EMAIL) > -1;

//   return isSupport ? ImapHelper.support : ImapHelper.notifications;
// };

export const copyMessageToSent = (mailOptions, cb = NOOP) => { // eslint-disable-line
  return null;

  /*
  const account = getImap(mailOptions);

  if (!account || !account.ready) throw new Error('No imap');

  // "INBOX", "Junk E-mail", "Drafts", "Sent Items", "Deleted Items", "Outbox"
  const mailbox = 'Sent Items';

  account.openBox(mailbox, (err, _box) => {
    if (err) throw err;

    try {
      const msg = mimemessage.factory({
        contentType: 'multipart/alternate',
        body: [],
      });
      const htmlEntity = mimemessage.factory({
        contentType: 'text/html;charset=utf-8',
        body: mailOptions.html,
      });

      msg.header('From', mailOptions.from);
      msg.header('To', mailOptions.to);
      msg.header('Subject', mailOptions.subject);
      msg.header('Date', new Date());
      msg.body.push(htmlEntity);

      account.imap.append(msg.toString(), { mailbox, flags: ['Seen'] }, cb);

      logger.info(
        `Imap copied email: ${mailOptions.from} - ${mailOptions.subject}`
      );

      // Done?
      // account.closeBox(() => logger.info('imap box closed'));
      account.closeBox();
      // account.imap.end();
    } catch (err2) {
      logger.error(err2);
      Sentry.captureException(err2);

      account.closeBox(() => logger.error(`imap box closed: ${err.message}`));

      if (cb) cb(err2);
    }
  });
  */
};

/*
export const readInbox = (count = '*', mailbox = 'INBOX') => {
  const account = support;

  if (!account) throw new Error('No imap');

  account.openBox(mailbox, (err, box) => {
    if (err) throw err;

    const f = account.imap.seq.fetch(`1:${count}`, {
      bodies: ['HEADER.FIELDS (FROM)', 'TEXT'],
      struct: true,
    });

    f.on('message', (msg, seqno) => {
      console.log('Message #%d', seqno);
      const prefix = `(#${seqno}) `;

      // console.log('prefix', prefix);

      msg.on('body', (stream, info) => {
        // console.log('body', stream, info);

        let buffer = '';
        // let count = 0;

        stream.on('data', chunk => {
          // count += chunk.length;
          buffer += chunk.toString('utf8');
        });

        stream.once('end', () => {
          if (info.which !== 'TEXT') {
            const header = Imap.parseHeader(buffer);
            const emailLabel = header.from[0];
            const regex = /^.+ <(.+\@.+\..+)>$/i;
            const match = regex.exec(emailLabel);
            const email = match && match[1];

            console.log(`${prefix}Parsed header: from %s`, email || emailLabel);
          } else {
            // Parse body text
            simpleParser(buffer, {}, (err2, parsed) => {
              const { text } = parsed;

              let message = text;
              const replyRegex = /\nOn .+ wrote:/gim;
              const footerRegex = /\n--\s?\n/gim;
              // Remove replies
              let match = replyRegex.exec(text);

              if (match && match.index) message = text.substr(0, match.index);
              // Remove footer
              match = footerRegex.exec(message);

              if (match && match.index)
                message = message.substr(0, match.index);

              if (err2) console.log('err2', err2);
              else console.log(`${prefix}Parsed body: %s`, message);
            });
          }
        });
      });

      // msg.once('attributes', attrs => {
      //   console.log(`${prefix}Attributes: %s`, inspect(attrs, false, 8));
      // });

      // msg.once('end', () => {
      //   console.log(`${prefix}Finished`);
      // });
    });

    f.once('error', err2 => {
      logger.error(`Fetch error: ${err2}`);
    });

    f.once('end', () => {
      logger.info('Done fetching all messages!');
      account.imap.end();
    });
  });
};
*/

export default {};
