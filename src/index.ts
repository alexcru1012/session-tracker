import debug2 from 'debug';
import http from 'http';

import { app } from './app';
import { ErrnoException } from './types';

/**
 * Module dependencies.
 */

// var app = process.env.NODE_ENV === 'production' ? require('../dist/src/index') : require('../src/index');
const debug = debug2('session-tracker-api:server');

/**
 * Normalize a port into a number, string, or false.
 */
const normalizePort = (val: string) => {
  const port = parseInt(val, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
};
/**
 * Get port from environment and store in Express.
 */
const port = normalizePort(process.env.PORT || '3000');

app.set('port', port);

/**
 * Create HTTP server.
 */
const server = http.createServer(app);

/**
 * Listen on provided port, on all network interfaces.
 */
server.listen(port);
/**
 * Event listener for HTTP server "error" event.
 */
const onError = (error: ErrnoException) => {
  if (error.syscall !== 'listen') throw error;

  const bind = typeof port === 'string' ? `Pipe ${port}` : `Port ${port}`;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(`${bind} requires elevated privileges`);
      process.exit(1);
    case 'EADDRINUSE': // eslint-disable-line
      console.error(`${bind} is already in use`);
      process.exit(1);
    default: // eslint-disable-line
      throw error;
  }
};

/**
 * Event listener for HTTP server "listening" event.
 */
const onListening = () => {
  const addr = server.address();
  const bind = typeof addr === 'string' ? `pipe ${addr}` : `port ${addr?.port}`;

  debug(`Listening on ${bind}`);
};

server.on('error', onError);
server.on('listening', onListening);

process.on('SIGTERM', () => {
  console.log('SIGTERM received, exiting');
  process.exit(0);
});
