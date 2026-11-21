// Stripe payments on the account (src/edge/stripe.js): signature check, one row per checkout, landing on the client project. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { fakeD1 } from './_d1.mjs';
import { verifyStripe, stripeWebhook, recordCheckout } from '../src/edge/stripe.js';
import { accountsDb, saveProject, projectsFor, paymentsFor } from '../src/edge/accounts.js';

const SECRET = 'whsec_test_secret_value';
const now = () => Math.floor(Date.now() / 1000);
const sig = (raw, t = now(), secret = SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
const session = (over = {}) => ({ id: 'cs_test_a1b2c3', object: 'checkout.session', payment_status: 'paid', amount_total: 25000, currency: 'usd', created: now(), customer_details: { email: 'Client@Example.com' }, ...over });
const event = (s, type = 'checkout.session.completed') => JSON.stringify({ id: 'evt_1', type, data: { object: s } });
const call = (env, raw, header) => stripeWebhook({ request: new Request('https://www.nrnszn.com/api/stripe-webhook', { method: 'POST', body: raw, headers: header ? { 'stripe-signature': header } : {} }), env });

test('the signature: right secret, recent, any v1 of several; anything else is refused', async () => {
  const raw = event(session());
  assert.equal(await verifyStripe(raw, sig(raw), SECRET), true);
  assert.equal(await verifyStripe(raw, `t=${now()},v1=deadbeef,` + sig(raw).split(',')[1], SECRET), true, 'Stripe may send two v1 values while rolling the secret');
  assert.equal(await verifyStripe(raw, sig(raw, now(), 'whsec_other'), SECRET), false);
  assert.equal(await verifyStripe(raw + ' ', sig(raw), SECRET), false, 'a changed body');
  assert.equal(await verifyStripe(raw, sig(raw, now() - 600), SECRET), false, 'too old (replay)');
  assert.equal(await verifyStripe(raw, '', SECRET), false); assert.equal(await verifyStripe(raw, sig(raw), ''), false);
});

test('the webhook: off until set up; bad signature refused; a paid checkout is stored once under the e-mail and lands on its project', async () => {
  const env = { ACCOUNTS_DB: fakeD1(), STRIPE_WEBHOOK_SECRET: SECRET };
  const db = await accountsDb(env);
  assert.equal((await (await stripeWebhook({ request: new Request('https://x/api/stripe-webhook'), env: {} })).json()).mode, 'not-set-up');
  assert.equal((await (await stripeWebhook({ request: new Request('https://x/api/stripe-webhook'), env })).json()).mode, 'ready');
  const p = await saveProject(db, { email: 'client@example.com', title: 'EP mix', total: 600 });
  const raw = event(session({ client_reference_id: p.id }));
  assert.equal((await call(env, raw, sig(raw, now(), 'whsec_wrong'))).status, 400);
  const ok = await (await call(env, raw, sig(raw))).json();
  assert.equal(ok.saved, true); assert.equal(ok.project, p.id);
  await call(env, raw, sig(raw));   // Stripe retries the same event
  const pays = await paymentsFor(db, 'client@example.com');
  assert.equal(pays.length, 1); assert.equal(pays[0].amount, 25000); assert.equal(pays[0].what, 'EP mix');
  const [proj] = await projectsFor(db, 'client@example.com');
  assert.equal(proj.paid, 25000); assert.equal(proj.balance, 35000); assert.equal(proj.payments.length, 1, 'added once'); assert.equal(proj.payments[0].method, 'stripe');
  // a Support tip with no project: kept on the account only; an unpaid or odd event: ignored
  const tip = event(session({ id: 'cs_test_tip9', amount_total: 1000, client_reference_id: null }));
  assert.equal((await (await call(env, tip, sig(tip))).json()).project, null);
  assert.equal((await paymentsFor(db, 'client@example.com')).length, 2);
  for (const s of [session({ id: 'cs_x1', payment_status: 'unpaid' }), session({ id: 'cs_x2', customer_details: {} }), session({ id: 'cs_x3', amount_total: 0 }), session({ id: 'bad id' })]) {
    const r = event(s); assert.ok((await (await call(env, r, sig(r))).json()).skipped);
  }
  const other = event(session({ id: 'cs_x4' }), 'invoice.paid');
  assert.equal((await (await call(env, other, sig(other))).json()).ignored, 'invoice.paid');
  assert.equal((await recordCheckout(db, session({ id: 'cs_x5', client_reference_id: 'not-ours' }))).project, null, 'an unknown reference is not trusted');
});
