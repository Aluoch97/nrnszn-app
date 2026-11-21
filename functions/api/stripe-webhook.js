// /api/stripe-webhook: Stripe tells the site about paid card / Apple Pay checkouts (see src/edge/stripe.js). GET says whether it is set up.
import { stripeWebhook } from '../../src/edge/stripe.js';

export const onRequest = (context) => stripeWebhook(context);
