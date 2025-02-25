import logger from '../logger';
import google from '../google';

/**
 * Summary
 *
 * Refresh gmail api access/refresh tokens manually every hour
 *
 */
const refreshGmailAccess = async () => {
  logger.info('Refreshing gmail tokens...');

  google.refreshTokens();

  return true;
};

export default refreshGmailAccess;
