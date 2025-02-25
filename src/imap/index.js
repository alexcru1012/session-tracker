import Imap from 'imap';
import * as Sentry from '@sentry/node';

import logger from '@/logger';

const {
  IMAP_HOST,
  IMAP_PORT,
  // WORKMAIL_EMAILER_USER,
  // WORKMAIL_EMAILER_PASS,
  // WORKMAIL_SUPPORT_USER,
  // WORKMAIL_SUPPORT_PASS,
} = process.env;

const NOOP = () => {};

class ImapHelper {
  constructor(user, pass) {
    this.user = user;
    this.pass = pass;
  }

  ready = false;
  user = null;
  pass = null;
  imap = null;

  connect = (cb = NOOP) => {
    if (cb && this.imap) return cb(null, this.imap);
    if (this.imap) return this.imap;

    logger.info(`setup imap ${this.user}`);

    this.ready = false;

    try {
      this.imap = new Imap({
        host: IMAP_HOST,
        port: IMAP_PORT,
        user: this.user,
        password: this.pass,
        tls: true,
      });
    } catch (err) {
      logger.error(err);
      Sentry.captureException(err);
    }

    this.imap.once('ready', this.handleReady(cb));
    this.imap.once('error', this.handleError(cb));
    this.imap.once('end', this.handleEnd);

    this.imap.connect();
  };

  handleReady = (cb = NOOP) => () => {
    logger.info(`imap ready :) ${this.user}`);
    this.ready = true;
    if (cb) cb(null, this.imap);
  };

  handleError = (cb = NOOP) => err => {
    logger.error(`imap fail :( ${this.user}, ${err}`);
    if (cb) cb(err);
  };

  handleEnd = () => {
    this.ready = false;
    logger.info(`imap connection ended ${this.user}`);
  };

  getBoxes = (cb = NOOP) => {
    this.connect((err, imap) => {
      if (err) {
        logger.error(`openBox: ${this.user}, ${err}`);
        Sentry.captureException(err);
      }

      return imap ? imap.getBoxes(cb) : null;
    });
  };

  openBox = (box = 'INBOX', cb = NOOP) => {
    this.connect((err, imap) => {
      if (err) {
        logger.error(`openBox: ${err}`);
        Sentry.captureException(err);
      }

      return imap ? imap.openBox(box, true, cb) : null;
    });
  };

  closeBox = (cb = NOOP) => {
    if (this.imap) this.imap.closeBox(cb);
  };
}

// export const support = new ImapHelper(
//   WORKMAIL_SUPPORT_USER,
//   WORKMAIL_SUPPORT_PASS
// );
// export const notifications = new ImapHelper(
//   WORKMAIL_EMAILER_USER,
//   WORKMAIL_EMAILER_PASS
// );
