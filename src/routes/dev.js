import express from 'express';
// import async from 'async';
// import moment from 'moment';
// import SQL from 'sql-template-strings';
import createError from 'http-errors';
// import * as fs from 'fs';
// import ejs from 'ejs';
// import aws from 'aws-sdk';

import passport from '@/passport';
// import google from '@/google';
// import { Strings, Templates } from '@/constants';
// import { runQuery, imageUpload } from '@/helpers';
import { sendEmail, getMailOptions } from '@/emails/helpers';
import { requireSubscriptionTier } from '@/helpers/userSubscriptions';
import Kitten from '@/mongo/schemas/kitten';
import { copyMessageToSent } from '@/imap/helpers';
// import { getActiveUserIds, getActiveUsers } from '@/models/users';
// import { sendSessionReceipt } from '@/emails/sessions';
import logger from '@/logger';
import { sendUpgradeSuccessEmail } from '@/emails/users';

const router = express.Router();

router
  .route('/')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) =>
      res.json({
        success: true,
      })
  );

router
  .route('/email')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      next(createError(401));

      // const smtpOptions = {
      //   to: process.env.GMAIL_EMAIL,
      //   from: process.env.EMAILER_EMAIL,
      //   subject: 'Testing email system',
      // };

      // const htmlString = '<p>hello world!</p>';

      // await sendEmail(
      //   htmlString,
      //   smtpOptions,
      //   err => {
      //     if (err) console.log(err);
      //     else {
      //       console.log('email sent.');
      //       const mailOptions = getMailOptions(htmlString, smtpOptions);

      //       try {
      //         copyMessageToSent(mailOptions);
      //       } catch (err2) {
      //         logger.error(err2);
      //       }
      //     }
      //   }
      //   // emailCacheKey
      // );

      // return res.json({
      //   success: true,
      // });
    }
  );

router
  .route('/upgrade-success-email')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      next(createError(401));

      // sendUpgradeSuccessEmail(user);

      // return res.json({
      //   success: true,
      // });
    }
  );

router.route('/receipt').get(
  [
    passport.authenticate('jwt', { session: false }),
    requireSubscriptionTier(1),
  ],
  async (req, res, next) =>
    // This is just a test route
    next(createError(401))

  /*
      let result;

      try {
        result = await sendSessionReceipt(
          14,
          79, // 35,
          426,
          'wow you did so good!!!!!'
        );
      } catch (err) {
        return res.json({
          success: false,
          error: err.message,
        });
      }

      return res.json({
        success: true,
        result,
      });
      */
);

router.route('/users').get(
  [
    passport.authenticate('jwt', { session: false }),
    requireSubscriptionTier(1),
  ],
  async (req, res, next) =>
    // This is just a test route
    // if (process.env.NODE_ENV !== 'development')
    next(createError(401))

  /*
      // Query postgres
      const query = SQL`SELECT * FROM users;`;
      const cacheKey = 'st__users';

      try {
        // Perform query
        const rows = await runQuery(query, cacheKey);

        // Send fresh data
        return res.json({
          success: true,
          data: rows,
        });
      } catch (error) {
        return next(error);
      }
      */
);

router.route('/clients').get(
  [
    passport.authenticate('jwt', { session: false }),
    requireSubscriptionTier(1),
  ],
  async (req, res, next) =>
    // This is just a test route
    next(createError(401))
  /*
      // if (process.env.NODE_ENV !== 'development')

      // Query postgres
      const query = SQL`SELECT * FROM clients;`;
      const cacheKey = 'st__client-sessions';

      try {
        // Perform query
        const rows = await runQuery(query, cacheKey);

        // Send fresh data
        return res.json({
          success: true,
          data: rows,
        });
      } catch (error) {
        return next(error);
      }
      */
);

router
  .route('/s3')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) =>
      // This is just a test route
      next(createError(401))

    /*
      // Check for credentials
      aws.config.getCredentials(err => {
        console.log('err', err);

        if (err) console.log(err.stack);
        else {
          console.log('Access key:', aws.config.credentials.accessKeyId);
          console.log(
            'Secret access key:',
            aws.config.credentials.secretAccessKey
          );
        }

        res.json({
          success: 'WOW',
        });
      });

      // Create unique bucket name
      const bucketName = `node-sdk-sample-${Math.random()}`;
      // Create name for uploaded object key
      const keyName = 'hello_world.txt';
      // Create a promise on S3 service object
      const bucketPromise = new aws.S3({ apiVersion: '2006-03-01' })
        .createBucket({ Bucket: bucketName })
        .promise();

      // Handle promise fulfilled/rejected states
      bucketPromise
        .then(data => {
          // Create params for putObject call
          const objectParams = {
            Bucket: bucketName,
            Key: keyName,
            Body: 'Hello World!',
          };
          // Create object upload promise
          const uploadPromise = new aws.S3({ apiVersion: '2006-03-01' })
            .putObject(objectParams)
            .promise();

          uploadPromise.then(d => {
            res.json({
              success: true,
              message: `Successfully uploaded data to ${bucketName}/${keyName}`,
            });
          });
        })
        .catch(err => {
          console.error(err, err.stack);
        });
        */
  )
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) =>
      // This is just a test route
      next(createError(401))

    /*
      const imageUpload = s3Upload(S3Buckets.avatars).single('image');
      imageUpload(req, res, err => {
        if (err) {
          return res.status(422).send({
            success: false,
            error: 'Image Upload Error',
            message: err.message,
          });
        }

        return res.json({
          success: true,
          data: req.file.location,
          message: 'File successfully saved to bucket',
        });
      });
      */
  );

router.route('/activeIds').get(
  [
    passport.authenticate('jwt', { session: false }),
    requireSubscriptionTier(1),
  ],
  async (req, res, next) =>
    // This is just a test route
    next(createError(401))

  // let results;

  // try {
  //   results = (await getActiveUserIds()) || [];

  //   console.log('results', results);
  // } catch (error) {
  //   console.warn(error);

  //   return res.json({
  //     success: false,
  //   });
  // }

  // res.json({
  //   success: true,
  //   data: results,
  // });
);

router.route('/activeUsers').get(
  [
    passport.authenticate('jwt', { session: false }),
    requireSubscriptionTier(1),
  ],
  async (req, res, next) =>
    // This is just a test route
    next(createError(401))

  // let results;

  // try {
  //   results = (await getActiveUsers()) || [];
  // } catch (error) {
  //   console.warn(error);

  //   return res.json({
  //     success: false,
  //   });
  // }

  // res.json({
  //   success: true,
  //   data: results,
  // });
);

router
  .route('/test-mongo')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      // const kitten = new Kitten({ name: 'Fluffy' });

      // kitten.meow();

      // await kitten.save();

      const kittens = await Kitten.find();

      kittens[0].names.push('hello');

      kittens[0].save();

      return res.json({
        success: true,
        data: {
          kittens,
        },
      });
    }
  );

export default router;
