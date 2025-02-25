// import express from 'express';
import createError from 'http-errors';
import moment from 'moment';
import * as Sentry from '@sentry/node';

import { Strings } from '../constants';
import logger from '../logger';

const routes = app => {
  // Home
  app.get('/', (req, res, next) => {
    res.status(200).json({
      success: true,
      message: 'hello world',
    });
  });

  // For clients to compute time offset
  app.get('/now', (req, res, next) => {
    res.status(200).json({
      success: true,
      data: moment().format(),
    });
  });

  // =====================================
  // 404 =================================
  // =====================================

  // Anything else
  app.get('*', (req, res, next) => {
    console.log('404!');
    res.sendStatus(404);
  });

  // =====================================
  // ERROR HANDLING MIDDLEWARE ===========
  // =====================================

  // catch 404 and forward to error handler
  app.use((req, res, next) => {
    logger.error(`Not Found? ${req.originalUrl} / ${req.path}`);
    next(createError(404));
  });

  // error handlers

  // development error handler
  // will print stacktrace
  if (app.get('env') === 'development') {
    console.log('running development');
    app.use((error, req, res, next) => {
      const message = error.message || error || Strings.defaultError;

      console.log('dev error', error);
      Sentry.captureException(error);
      logger.error(error);
      res.status(error.status || 500).json({
        success: false,
        message,
      });
    });
  }

  // production error handler
  // no stacktraces leaked to user
  app.use((error, req, res, next) => {
    const message = error.message || error || Strings.defaultError;

    console.log('prod error', error);
    Sentry.captureException(error);
    logger.error(error);
    res.status(error.status || 500).json({
      success: false,
      message,
    });
  });
};

export default routes;
