import express from 'express';
import StripeApi from 'stripe';
import validator from 'validator';
import bodyParser from 'body-parser';
import moment from 'moment-timezone';
// import * as Sentry from '@sentry/node';

import passport from '@/passport';
import logger from '@/logger';
import { sendMaskedError, sendBadRequest } from '@/helpers';
import { CacheKeys, HomeUrls, Options, WebAppUrls } from '@/constants';
import {
  getUserByEmail,
  createUser,
  getUser,
  setSubscriptionId,
} from '@/models/users';
import { cacheData, getDataFromCache } from '@/redis/helpers';
import {
  getOrCreateUserMeta,
  getUserMetaByStripeSession,
  getUserMetaByStripeCustomer,
  getUserMetaByStripeSubscription,
  setUserMetaProp,
  getUserMetaByUserId,
} from '@/mongo/helpers';
import pool from '@/postgres';
import {
  requireSubscriptionTier,
  makeDefaultSubscription,
  makePaidSubscription,
} from '@/helpers/userSubscriptions';
import {
  getUserSubscription,
  createUserSubscription,
  updateUserSubscription,
} from '@/models/userSubscriptions';
import { sendUpgradeSuccessEmail } from '@/emails/users';
// import { deleteCachedData } from '@/redis/helpers';

const router = express.Router();
const stripe = StripeApi(
  process.env.NODE_ENV === 'production'
    ? process.env.STRIPE_LIVE_SECRET
    : process.env.STRIPE_TEST_SECRET
);

router.route('/prices').get(
  [
    passport.authenticate('jwt', { session: false }),
    // requireSubscriptionTier(1),
  ],
  async (req, res, next) => {
    // const { user } = req;
    const cacheKey = CacheKeys.payment.prices();
    const existingData = await getDataFromCache(cacheKey);

    // Return cached data
    if (existingData && existingData.id) {
      return res.json({
        success: true,
        data: existingData,
      });
    }

    try {
      const prices = await stripe.prices.list({
        active: true,
        expand: ['data.product'],
      });

      // console.log('prices', prices.length);
      const data = { prices };

      cacheData(cacheKey, data, Options.defaultCacheTimeS * 15); // 1hr

      return res.json({
        success: true,
        data: {
          prices,
        },
      });
    } catch (error) {
      console.log('error', error);
      logger.error(`GET /payment/prices ERROR ${error.stack || error.message}`);

      return sendMaskedError(error, 'Could not retrieve products.', next);
    }
  }
);

// Start a payment
router.route('/checkout-session').post(
  [
    passport.authenticate('jwt', { session: false }),
    // requireSubscriptionTier(1),
  ],
  async (req, res, next) => {
    // const { user } = req;
    const { email, price_id } = req.body;

    const emailInput = validator.escape(String(email).toLowerCase());

    if (!emailInput || !price_id)
      return sendBadRequest(res, 'Missing required input.');

    logger.info(`STRIPE checkout-session: (${emailInput})`);

    // console.log('price_id', price_id);
    const poolClient = await pool.connect();

    try {
      const price = await stripe.prices.retrieve(price_id);

      const session = await stripe.checkout.sessions.create({
        billing_address_collection: 'auto',
        line_items: [
          {
            price: price.id,
            // For metered billing, do not pass quantity
            quantity: 1,
          },
        ],
        subscription_data: {
          trial_period_days: 14,
        },
        mode: 'subscription',
        success_url: `${HomeUrls.purchase}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${HomeUrls.purchase}/?canceled=true`,
        client_reference_id: emailInput,
      });

      if (!session) {
        poolClient.release();

        return sendMaskedError(null, 'Could not connect to Stripe', next);
      }

      let user = await getUserByEmail(emailInput, poolClient);
      // Create a user here, just incase
      if (!user) user = await createUser(emailInput, false, poolClient);

      // Store sessionId in userMeta
      await setUserMetaProp(user.id, 'stripeSessionId', session.id);
      // I don't think these will exist yet...
      if (session.customer)
        await setUserMetaProp(user.id, 'stripeCustomerId', session.customer);
      if (session.subscription) {
        await setUserMetaProp(
          user.id,
          'stripeSubscriptionId',
          session.subscription
        );
      }

      if (poolClient) poolClient.release();

      return res.json({
        success: true,
        data: {
          session_id: session.id,
          session_url: session.url,
        },
      });
    } catch (error) {
      console.log('error', error);

      if (poolClient) poolClient.release();

      return sendMaskedError(error, 'Could not connect to Stripe.', next);
    }
  }
);

router
  .route('/checkout-session-auth')
  .post(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;
      const { price_id } = req.body;

      if (!price_id) return sendBadRequest(res, 'Missing required input.');

      logger.info(`STRIPE checkout-session-auth: (${user.id})`);

      // console.log('price_id', price_id);
      const poolClient = await pool.connect();

      let session;

      try {
        const price = await stripe.prices.retrieve(price_id);

        session = await stripe.checkout.sessions.create({
          // customer: userMeta.stripeCustomerId,
          billing_address_collection: 'auto',
          line_items: [
            {
              price: price.id,
              // For metered billing, do not pass quantity
              quantity: 1,
            },
          ],
          subscription_data: {
            trial_period_days: 14,
          },
          mode: 'subscription',
          // I don't think we need to return sessionId via url
          success_url: `${WebAppUrls.upgrade}/?success=true`, // &session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${WebAppUrls.upgrade}/?canceled=true`,
          client_reference_id: user.email,
        });

        if (!session) {
          poolClient.release();

          return sendMaskedError(null, 'Could not connect to Stripe', next);
        }

        console.log('STRIPE session', session);

        // Store sessionId in userMeta
        await setUserMetaProp(user.id, 'stripeSessionId', session.id);
        // I don't think these will exist yet...
        if (session.customer)
          await setUserMetaProp(user.id, 'stripeCustomerId', session.customer);
        if (session.subscription) {
          await setUserMetaProp(
            user.id,
            'stripeSubscriptionId',
            session.subscription
          );
        }
      } catch (error) {
        console.log('error', error);

        if (poolClient) poolClient.release();

        return sendMaskedError(error, 'Could not connect to Stripe.', next);
      }

      if (poolClient) poolClient.release();

      return res.json({
        success: true,
        data: {
          session_id: session.id,
          session_url: session.url,
        },
      });
    }
  );

// Fetch session after checkout
router.route('/portal-session').post(
  [
    passport.authenticate('jwt', { session: false }),
    // requireSubscriptionTier(1),
  ],
  async (req, res, next) => {
    // const { user } = req;
    const { session_id } = req.body;

    const checkoutSession = await stripe.checkout.sessions.retrieve(session_id);

    if (!checkoutSession)
      return sendMaskedError(null, 'Invalid Stripe session', next);

    // This is the url to which the customer will be redirected when they are done
    // managing their billing with the portal.
    const returnUrl = `${HomeUrls.purchase}/?success=true&session_id=${session_id}`;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: checkoutSession.customer,
      return_url: returnUrl,
    });

    if (!portalSession)
      return sendMaskedError(null, 'Could not connect to Stripe portal', next);

    return res.json({
      success: true,
      data: {
        portal_url: portalSession.url,
      },
    });
  }
);

// Fetch session via authed userMeta
router
  .route('/portal-session-auth')
  .get(
    [
      passport.authenticate('jwt', { session: false }),
      requireSubscriptionTier(1),
    ],
    async (req, res, next) => {
      const { user } = req;

      const userMeta = await getOrCreateUserMeta(user.id);

      if (!userMeta)
        return sendBadRequest(res, 'Could not find user details', 400);

      const { stripeSessionId, stripeSubscriptionId } = userMeta;
      let { stripeCustomerId } = userMeta;

      // We want customerId but if we don't have it, find it with session
      if (!stripeCustomerId && stripeSessionId) {
        const checkoutSession = await stripe.checkout.sessions.retrieve(
          stripeSessionId
        );

        stripeCustomerId = checkoutSession?.customer;
      } else if (!stripeCustomerId && stripeSubscriptionId) {
        const checkoutSubscription = await stripe.subscription.retrieve(
          stripeSubscriptionId
        );

        stripeCustomerId = checkoutSubscription?.customer;
      }

      // This is the url to which the customer will be redirected when they are done
      // managing their billing with the portal.
      const returnUrl = WebAppUrls.billing;

      if (!stripeCustomerId)
        return sendBadRequest(res, 'Could not find stripe customer', 400);

      let portalSession;

      try {
        portalSession = await stripe.billingPortal.sessions.create({
          customer: stripeCustomerId,
          return_url: returnUrl,
        });
      } catch (error) {
        console.log('error', error);

        return sendMaskedError(
          error,
          'Could not create a portal session.',
          next
        );
      }

      return res.json({
        success: true,
        data: {
          portal_url: portalSession?.url || '',
        },
      });
    }
  );

router
  .route('/webhook')
  .post(
    bodyParser.raw({ type: 'application/json' }),
    async (req, res, _next) => {
      let data;
      let eventType;
      // Check if webhook signing is configured.
      const webhookSecret =
        process.env.NODE_ENV === 'production'
          ? process.env.STRIPE_LIVE_WEBHOOK_SECRET
          : process.env.STRIPE_TEST_WEBHOOK_SECRET;

      // const customerEmail: string = (paymentIntent.customer as Stripe.Customer).email;

      if (webhookSecret) {
        // Retrieve the event by verifying the signature using the raw body and secret.
        let event;
        const signature = req.headers['stripe-signature'];

        try {
          event = stripe.webhooks.constructEvent(
            req.body,
            signature,
            webhookSecret
          );
        } catch (err) {
          logger.error(`Webhook signature verification failed. ${err}`);

          return res.sendStatus(400);
        }
        // Extract the object from the event.
        data = event.data; // eslint-disable-line
        eventType = event.type;
      } else {
        // Webhook signing is recommended, but if the secret is not configured in `config.js`,
        // retrieve the event data directly from the request body.
        data = req.body.data; // eslint-disable-line
        eventType = req.body.type;
      }

      console.log('webhook data', eventType, data);
      logger.info(`STRIPE WEBHOOK: ${eventType}`);

      const poolClient = await pool.connect();

      switch (eventType) {
        case 'customer.subscription.trial_will_end': {
          const { object: subscription } = data;
          const { customer: customerId } = subscription;

          // Email the user notifying them they will be charged in 3 days?
          logger.info(
            `STRIPE trial_will_end: Customer (${customerId}) will be charged soon`
          );

          break;
        }
        case 'checkout.session.completed': {
          // Payment is successful and the subscription is created.
          // You should provision the subscription and save the customer ID to your database.
          const { object: session } = data;
          const {
            id: sessionId,
            customer: customerId,
            subscription: subscriptionId,
            client_reference_id: emailInput,
            // payment_status,
            // customer_details,
          } = session;

          let userMeta;
          if (sessionId) userMeta = await getUserMetaByStripeSession(sessionId);
          if (!userMeta && subscriptionId)
            userMeta = await getUserMetaByStripeSubscription(subscriptionId);
          // Insane last resort...
          if (!userMeta && emailInput) {
            const user = await getUserByEmail(emailInput, poolClient);
            if (user && user.id) userMeta = await getUserMetaByUserId(user.id);
            // Still...???
            if (!userMeta) userMeta = getOrCreateUserMeta(user.id);
          }

          // Store the customerId and subscriptionId for when 'invoice.paid' occurs
          if (userMeta) {
            userMeta.stripeSubscriptionId = subscriptionId;
            userMeta.markModified('stripeSubscriptionId');
            userMeta.stripeCustomerId = customerId;
            userMeta.markModified('stripeCustomerId');
            userMeta = await userMeta.save();
          } else {
            logger.error(
              `STRIPE checkout.session.completed USER META NOT FOUND. (${customerId}) (${subscriptionId})`
            );
          }
          break;
        }
        case 'invoice.paid': {
          // Continue to provision the subscription as payments continue to be made.
          // Store the status in your database and check when a user accesses your service.
          // This approach helps you avoid hitting rate limits.
          const { object: invoice } = data;
          const {
            customer: customerId,
            subscription: subscriptionId,
            lines,
            // paid,
          } = invoice;
          const { data: items } = lines;
          const { price } = items[0];
          // const { recurring } = price;

          let user;
          let userMeta;
          let subscription;

          try {
            subscription = await stripe.subscriptions.retrieve(subscriptionId);
          } catch (error) {
            logger.error(`STRIPE invoice.paid subscription ERROR: ${error}`);
          }
          const { status, current_period_end } = subscription || {};
          // const isTrialing = status === 'trialing';
          // const isActive = isTrialing || status === 'active';
          const expiresAt = moment(current_period_end * 1000).toISOString();

          logger.info(
            `STRIPE invoice.paid! customer (${customerId}) status (${status}) expires (${expiresAt})`
          );

          try {
            // Try to find userMeta
            if (subscriptionId)
              userMeta = await getUserMetaByStripeSubscription(subscriptionId);

            if (!userMeta && customerId)
              userMeta = await getUserMetaByStripeCustomer(customerId);

            // Write missing data?
            if (userMeta) {
              userMeta.stripeSubscriptionId = subscriptionId;
              userMeta.markModified('stripeSubscriptionId');
              userMeta.stripeCustomerId = customerId;
              userMeta.markModified('stripeCustomerId');

              userMeta = await userMeta.save();
            }

            // Try to find user
            if (userMeta) user = await getUser(userMeta.userId, poolClient);
          } catch (err) {
            logger.error(`STRIPE invoice.paid ERROR:' ${err}`);
          }

          const subData = makePaidSubscription(expiresAt);

          try {
            if (user && user.subscription_id) {
              await updateUserSubscription(
                user.id,
                user.subscription_id,
                subData,
                poolClient
              );
            } else if (user && !user.subscription_id) {
              const sub = await createUserSubscription(
                user.id,
                subData,
                poolClient
              );

              await setSubscriptionId(user.id, sub.id, poolClient);
            } else logger.error('could not find stripe user subscription');
          } catch (err) {
            logger.error(`STRIPE invoice.paid ERROR: ${err}`);
          }

          try {
            // Send an async upgrade email
            if (userMeta && !userMeta.wasSentUpgradeSuccessEmail)
              sendUpgradeSuccessEmail(user);
          } catch (err) {
            logger.error(`STRIPE invoice.paid email ERROR: ${err}`);
          }

          break;
        }
        // case 'invoice.payment_action_required':
        case 'invoice.payment_failed':
          {
            // The payment failed or the customer does not have a valid payment method.
            // The subscription becomes past_due. Notify your customer and send them to the
            // customer portal to update their payment information.
            const { object: invoice } = data;
            const {
              customer: customerId,
              // subscription: subscriptionId,
              // lines,
              // paid,
            } = invoice;
            // const { data: items } = lines;
            // const { price } = items[0];
            // const { recurring } = price;

            const userMeta = await getUserMetaByStripeCustomer(customerId);
            let user = userMeta
              ? await getUser(userMeta.userId, poolClient)
              : null;
            let subData = makeDefaultSubscription();
            let sub;

            try {
              // Give users 3 days to fix a failed payment for their expired subscription
              if (user && user.subscription_id) {
                // See if they're "paid"
                const currentSub = await getUserSubscription(
                  user.subscription_id,
                  poolClient
                );
                // Update expires_at
                if (currentSub && currentSub.tier > 1) {
                  subData = makePaidSubscription(
                    moment()
                      .add(3, 'days')
                      .toISOString()
                  );

                  sub = await updateUserSubscription(
                    user.id,
                    user.subscription_id,
                    subData,
                    poolClient
                  );
                }
              } else if (user && !user.subscription_id) {
                sub = await createUserSubscription(
                  user.id,
                  subData,
                  poolClient
                );
                // Set new subscription_id on user
                user = await setSubscriptionId(user.id, sub.id, poolClient);
              }
            } catch (err) {
              logger.error(`STRIPE invoice.payment_failed ERROR: ${err}`);
            }
          }
          break;
        default:
          // Unhandled event type
          break;
      }

      if (poolClient) poolClient.release();

      return res.sendStatus(200);
    }
  );

export default router;
