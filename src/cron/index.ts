import cron from 'node-cron';

import logger from '@/logger';
import scanCalendarEvents from './scanCalendarEvents';
import scanFailedTickets from './scanFailedTickets';
import createSessionsForEndedEvents from './createSessionsForEndedEvents';
import sendEventPushNotifications from './sendEventPushNotifications';
import sendClientEventConfirmations from './sendClientEventConfirmations';
import sendEventCancellations from './sendEventCancellations';
import sendClientEventReminders from './sendClientEventReminders';
// import sendMissingUserEmail from './sendMissingUserEmail';
import scanInactiveUsers from './scanInactiveUsers';
import scanExpiredSubscriptions from './scanExpiredSubscriptions';
import healthCheckPostgres from './healthCheckPostgres';

// * * * * * (every minute)
// 30 0-59 * * * * (every minute offset 30 seconds)
// */5 * * * * (every 5 minutes)
// */30 * * * * (every 30 minutes)
// 0 * * * * (every hour at minute 0)
// 0 */6 * * * (every 6 hours)
// 0 0 * * * (every day at hour 0)
// */2 * * * * (every even minute)
// 1-59/2 * * * * (every odd minute)
// 1-59/5 * * * * (every 5 minutes starting at 1 minute after the hour)

export const runCron = () => {
  if (process.env.ENV !== 'production') return;

  logger.info('Scheduling cron jobs...');

  // Database health check
  cron.schedule('* * * * *', healthCheckPostgres);
  // Scan calendar events
  cron.schedule('* * * * *', scanCalendarEvents);
  // Send notifications for events starting soon
  cron.schedule('30 0-59 * * * *', sendEventPushNotifications);
  // Check client events completed in the last hour, add sessions to client history
  cron.schedule('1-59/5 * * * *', createSessionsForEndedEvents);
  // Check failed tickets for their receipts which contain errors or warnings
  cron.schedule('0 */6 * * *', scanFailedTickets);
  // Send confirmation emails to clients for events scheduled
  cron.schedule('*/6 * * * *', sendClientEventConfirmations);
  // Send reminders to clients for events starting soon
  cron.schedule('*/26 * * * *', sendClientEventReminders);
  // Send emails to clients for event cancellations
  cron.schedule('*/29 * * * *', sendEventCancellations);
  // set is_action : true which are not logged in from last 90 days
  cron.schedule('0 4 * * *', scanInactiveUsers, {
    timezone: 'America/New_York',
  });
  cron.schedule('0 2 * * *', scanExpiredSubscriptions, {
    timezone: 'America/New_York',
  });
  // Send emails to missing users
  // cron.schedule('0 7 * * *', sendMissingUserEmail, {timezone: 'America/New_York'});
};
