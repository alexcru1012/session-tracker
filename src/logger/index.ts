import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Read env file
dotenv.config();

const { combine, timestamp, json, prettyPrint } = winston.format;

const logsDir = String(process.env.LOG_DIR);
const errorLog = path.join(logsDir, 'error-%DATE%.log');
const combinedLog = path.join(logsDir, 'combined-%DATE%.log');

// Make the logs dir
fs.mkdir(logsDir, (err: any) => {
  /* no-op */
});

// Add stacktrace to log line
const addStack = winston.format((info: any) => {
  if (info instanceof Error) {
    return Object.assign({}, info, {
      message: info.message,
      stack: info.stack,
    });
  }

  return info;
});

const formatTz = () => {
  const label = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
  });
  const split = label.split(', ');
  const date = split[0].split('/');

  return `${date[2]}-${date[0]}-${date[1]}, ${split[1]} (EST)`;
};

// All logs go to console out
const consoleOut = new winston.transports.Console({
  level: 'info',
  handleExceptions: true,
});
// Write all logs error (and below) to `error.log`.
const errorLogger = new winston.transports.DailyRotateFile({
  filename: errorLog,
  level: 'error',
  maxSize: '4m',
  maxFiles: '30',
  datePattern: 'YYYY-MM-DD',
});
// Write to all logs with level `info` and below to `combined.log`
const combinedLogger = new winston.transports.DailyRotateFile({
  filename: combinedLog,
  maxSize: '32m',
  maxFiles: '14d',
  datePattern: 'YYYY-MM-DD',
});

const logger = winston.createLogger({
  level: 'info',
  format: combine(
    timestamp({ format: formatTz as any }),
    addStack(),
    json(),
    prettyPrint()
  ),
  transports: [consoleOut, errorLogger, combinedLogger],
  exitOnError: false, // do not exit on handled exceptions
});

// If we're not in production then log to the `console` with the format:
// if (process.env.NODE_ENV !== 'production')
//   logger.add(new winston.transports.Console());

export default logger;
