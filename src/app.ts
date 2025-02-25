// import 'module-alias/register';
import * as dotenv from 'dotenv';
/* eslint-disable */
dotenv.config();
import express, { Application, NextFunction, Request, Response } from 'express';
import path from 'path';
import favicon from 'serve-favicon';
import cors from 'cors';
import bodyParser from 'body-parser';
import * as Sentry from '@sentry/node';
import { config } from 'aws-sdk';

import logger from '@/logger';
import visitor from '@/analytics';
import mongo from '@/mongo';
// Passport
import myPassport from '@/passport';
// Routes
import devRoutes from '@/routes/dev';
import connectRoutes from '@/routes/connect';
import meRoutes from '@/routes/me';
import userMetaRoutes from '@/routes/user-meta';
import clientsRoutes from '@/routes/clients';
import calendarRoutes from '@/routes/calendar';
import calendarEditRoutes from '@/routes/calendar-edits';
import clientSessionsRoutes from '@/routes/client-sessions';
import clientTodosRoutes from '@/routes/client-todos';
import clientOptionsRoutes from '@/routes/client-options';
import clientMetaRoutes from '@/routes/client-meta';
import sessionTypesRoutes from '@/routes/session-types';
import chatsRoutes from '@/routes/chats';
import chatMessagesRoutes from '@/routes/chat-messages';
import supportRoutes from '@/routes/support';
import adminRoutes from '@/routes/admin';
import dashboardRoutes from '@/routes/dashboard';
import paymentRoutes from '@/routes/payment';
import scheduleRoutes from '@/routes/schedules';
import userPublicRoutes from '@/routes/user-public';
import scheduledEventsRoutes from '@/routes/scheduled-events';
import defaultRoutes from '@/routes';
import { runCron } from '@/cron';
import { generateJWTToken } from './helpers';
import { Options } from './constants';
// import { support, notifications } from '@/imap';
/* eslint-enable */

console.log('mongo', mongo); // do not remove

// Init imap
// support.connect();
// notifications.connect();

// Init AWS
config.update({
  secretAccessKey: process.env.AWS_SECRET_KEY,
  accessKeyId: process.env.AWS_ACCESS_KEY,
  apiVersion: '2010-12-01',
  region: 'us-east-1',
});

// Sentry
// @ts-ignore
Sentry.enableInExpoDevelopment = false; // eslint-disable-line
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
  });
}

// Express init
export const app: Application = express();

// Security (http://expressjs.com/en/advanced/best-practice-security.html)
app.disable('x-powered-by');

// view engine setup
app.set('view engine', 'ejs');
// app.set('views', path.join(__dirname, 'views'))

app.use(favicon(path.join(__dirname, '../public', 'favicon.ico')));
// if (app.get('env') === 'development') {
// app.use(morgan('dev'))
// }
// app.use(morgan('combined', { stream: logger.stream }))

// req.body contains the parsed data, this object will contain key-value pairs
// where the value can be a string or array (when extended is false), or any type (when extended is true).
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);
// Allow both json and url-encoded requests
// app.use(bodyParser.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  // webhook requires raw non-json data
  if (req.originalUrl === '/payment/webhook') next();
  else bodyParser.json()(req, res, next);
});

// Passport init
app.use(myPassport.initialize());

// Built-in serve-static module to serve static assets
app.use(express.static('public'));

app.use(
  cors((_req: Request, callback: Function) => {
    const origin = [
      'http://localhost:3001',
      'http://localhost:3010',
      'http://localhost:8080',
      'https://mysessiontracker.com',
      'https://www.mysessiontracker.com',
      'https://app.mysessiontracker.com',
      process.env.ADMIN_BASE,
    ] as (string | boolean | RegExp)[];
    const methods = ['GET', 'PUT', 'PATCH', 'POST', 'DELETE'];
    const allowedHeaders = [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Authorization',
      'Accept',
      'sentry-trace',
    ];
    const credentials = true;
    const maxAge = undefined;
    const preflightContinue = false;

    callback(null, {
      origin,
      methods,
      allowedHeaders,
      credentials,
      maxAge,
      preflightContinue,
    });
  })
);

// Universal-analytics middleware
app.use('/', (req: Request, _res: Response, next: NextFunction) => {
  const url = new URL(`${req.protocol}://${req.get('host')}${req.originalUrl}`);
  const params = new URLSearchParams(url.search);
  const hasParams = Array.from(params).length;

  // Delete params we don't want analytics to have
  if (hasParams) {
    params.delete('state');
    params.delete('token');
    params.delete('code');
    params.delete('auth');
    params.delete('access_token');
    params.delete('credentials');
  }

  const trackUrl = hasParams ? `${req.path}?${params.toString()}` : req.path;

  // console.log('tracking pageview', trackUrl);

  // Track pageview
  if (visitor) visitor.pageview(trackUrl).send();

  next();
});

// Handle uncaught exceptions?
process.on('uncaughtException', err => {
  console.log('Uncaught exception!', err);
  Sentry.captureException(err);
  visitor.exception(err);
  logger.error(err);
});

logger.info('Welcome. System booting up.');
logger.info(
  `Home ${generateJWTToken(
    { id: process.env.HOME_SECRET_ID },
    Options.jwtExpiresIn
  )}`
);
// logger.error('Testing error message.')

// API Routes
app.use('/connect', connectRoutes);
app.use('/me', meRoutes);
app.use('/user-meta', userMetaRoutes);
app.use('/clients', clientsRoutes);
app.use('/client-todos', clientTodosRoutes);
app.use('/client-sessions', clientSessionsRoutes);
app.use('/session-types', sessionTypesRoutes);
app.use('/calendar', calendarRoutes);
app.use('/calendar-edits', calendarEditRoutes);
app.use('/chats', chatsRoutes);
app.use('/chat-messages', chatMessagesRoutes);
app.use('/support', supportRoutes);
app.use('/admin', adminRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/client-options', clientOptionsRoutes);
app.use('/client-meta', clientMetaRoutes);
app.use('/payment', paymentRoutes);
app.use('/schedules', scheduleRoutes);
app.use('/user-public', userPublicRoutes);
app.use('/scheduled-events', scheduledEventsRoutes);
if (process.env.NODE_ENV !== 'production') app.use('/dev', devRoutes);
// Other app routes and error handling
// @ts-ignore
const _routes = defaultRoutes(app); // eslint-disable-line

// Schedule cron tasks
runCron();

// module.exports = app;
// export default app;
