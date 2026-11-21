// Stripe payments on the NuRenaissance account (Nov 21, 2026, Nick: "one payment history").
//
// Stripe calls POST /api/stripe-webhook (functions/api/stripe-webhook.js) after each card / Apple Pay checkout (Payment Links included).
// The call is believed only with a valid `Stripe-Signature` (HMAC-SHA256 of "<timestamp>.<raw body>" with the Cloudflare secret
// STRIPE_WEBHOOK_SECRET, the "whsec_…" value Stripe shows for the endpoint; at most 5 minutes old). Then:
//   * the payment is kept in `account_payments` under the e-mail typed at checkout, so it shows in Your account for that e-mail;
//   * when the checkout carried `client_reference_id` = one of our client project ids (the "Pay a balance" button adds it), the payment is
//     also added to that project (method "stripe"), so the balance goes down by itself.
// Each Stripe checkout is stored once, however often Stripe retries. PayPal, Cash App, Venmo and Zelle cannot be seen here: mark those by hand.
import { accountsDb, hasAccountsDb, cleanEmail } from './accounts.js';

export const TOLERANCE_S = 300;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sign(secret, payload) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}
function sameHex(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

/** True when `header` (Stripe-Signature) is a valid signature of `raw` with `secret`, made within the last 5 minutes. */
export async function verifyStripe(raw, header, secret, nowS = Math.floor(Date.now() / 1000)) {
  if (!secret || !header) return false;
  const parts = String(header).split(',').map((p) => p.trim().split('='));
  const t = (parts.find(([k]) => k === 't') || [])[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v || '');
  if (!/^\d{9,11}$/.test(t || '') || !sigs.length || Math.abs(nowS - Number(t)) > TOLERANCE_S) return false;
  const want = await sign(secret, `${t}.${raw}`);
  return sigs.some((s) => sameHex(s, want));
}

/** Records one paid checkout. Returns what happened (for the logs and the tests). */
export async function recordCheckout(db, session, now = Date.now()) {
  const s = session || {};
  if (s.object !== 'checkout.session' || s.payment_status !== 'paid' || !/^cs_[\w]+$/.test(String(s.id || ''))) return { skipped: 'not a paid checkout' };
  const email = cleanEmail((s.customer_details && s.customer_details.email) || s.customer_email);
  const amount = Number(s.amount_total);
  if (!email || !Number.isInteger(amount) || amount <= 0) return { skipped: 'no e-mail or amount' };
  const ref = String(s.client_reference_id || '');
  const project = /^[0-9a-f]{12}$/.test(ref) ? await db.prepare('SELECT id, title FROM client_projects WHERE id = ?').bind(ref).first() : null;
  const what = project ? project.title : String((s.metadata && s.metadata.what) || '').slice(0, 120) || 'Card payment';
  const ins = await db.prepare('INSERT OR IGNORE INTO account_payments (id, email, amount_cents, currency, what, project_id, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(s.id, email, amount, String(s.currency || 'usd').slice(0, 3), what, project ? project.id : '', Number(s.created) > 0 ? Number(s.created) * 1000 : now).run();
  if (project) {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(Number(s.created) > 0 ? Number(s.created) * 1000 : now));
    await db.prepare('INSERT OR IGNORE INTO client_payments (id, project_id, amount_cents, method, paid_on, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(`st_${s.id.slice(-20)}`, project.id, amount, 'stripe', day, 'Paid online', now).run();
    await db.prepare('UPDATE client_projects SET updated_at = ? WHERE id = ?').bind(now, project.id).run();
  }
  return { saved: !!(ins.meta && ins.meta.changes), email, amount, project: project ? project.id : null };
}

const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function stripeWebhook({ request, env }) {
  env = env || {};
  if (request.method === 'GET') return reply({ status: 'ok', mode: env.STRIPE_WEBHOOK_SECRET && hasAccountsDb(env) ? 'ready' : 'not-set-up' });
  if (request.method !== 'POST') return reply({ ok: false }, 405);
  if (!env.STRIPE_WEBHOOK_SECRET || !hasAccountsDb(env)) return reply({ ok: false, message: 'not set up' }, 503);
  const raw = await request.text();
  if (raw.length > 512_000 || !(await verifyStripe(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) return reply({ ok: false, message: 'bad signature' }, 400);
  let event; try { event = JSON.parse(raw); } catch { return reply({ ok: false }, 400); }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event && event.type)) return reply({ ok: true, ignored: event && event.type });
  try { return reply({ ok: true, ...(await recordCheckout(await accountsDb(env), event.data && event.data.object)) }); }
  catch (e) { console.error('stripe webhook', e); return reply({ ok: false }, 500); }   // Stripe retries a failure
}
