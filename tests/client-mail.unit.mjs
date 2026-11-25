// E-mails about service work (src/edge/client-mail.js): "we got your request" + Nick's copy, status-change e-mails from /admin,
// the shared daily limit, and that typed text is escaped. Fake Resend, real SQLite (tests/_d1.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './_d1.mjs';
import { leadEmails, statusEmail, sendMail, CLIENT_MAILS_PER_DAY } from '../src/edge/client-mail.js';
import { adminPost, makeToken } from '../src/edge/admin.js';

const resend = () => { const sent = []; return { sent, f: async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); } }; };

test('a new request: the client gets what happens next, Nick gets every detail, and typed text is escaped', () => {
  const { client, owner } = leadEmails({ name: 'Jo <b>Client</b>', email: 'jo@example.com', summary: 'Video production: Music video', total: 900, timeline: 'This month', details: '<script>x</script>', phone: '615' });
  assert.match(client.subject, /We got your request/); assert.match(client.html, /within 2 business days/); assert.match(client.html, /\$900/);
  assert.match(client.html, /deposit books your date/i); assert.match(client.text, /Book a 30-minute call: https:\/\/www\.nrnszn\.com\/services/);
  assert.equal(client.html.includes('<b>Client</b>'), false); assert.match(client.html, /Jo &lt;b&gt;Client&lt;\/b&gt;|Thanks, Jo/);
  assert.match(owner.subject, /New service request/); assert.match(owner.html, /jo@example\.com/); assert.equal(owner.html.includes('<script>'), false);
  assert.equal(/[\r\n]/.test(owner.subject), false);
});

test('status e-mails say what each step means, show the target date and balance, and link files only when ready', () => {
  const m = statusEmail({ status: 'in-progress', title: 'SIN CITY video', clientName: 'Jo Client', due: '2026-12-15', totalCents: 90000, balanceCents: 85000, note: 'Rough cut next week' });
  assert.match(m.subject, /Work has started: SIN CITY video/); assert.match(m.html, /Target date/); assert.match(m.html, /December 15, 2026/);
  assert.match(m.html, /\$850/); assert.match(m.html, /Rough cut next week/); assert.match(m.html, /nrnszn\.com\/account/);
  const d = statusEmail({ status: 'done', title: 'X', link: 'https://drive.google.com/x' }); assert.match(d.html, /Get your files/);
  assert.equal(statusEmail({ status: 'done', title: 'X', link: 'javascript:alert(1)' }).html.includes('javascript:'), false);
  assert.equal(statusEmail({ status: 'quote', title: 'X', link: 'https://drive.google.com/x' }).html.includes('drive.google'), false, 'files only at review / done');
});

test('sending: no key = nothing sent; a daily limit protects the shared Resend allowance', async () => {
  assert.equal((await sendMail({}, 'a@b.co', { subject: 's', html: 'h', text: 't' })).reason, 'no-key');
  const r = resend(), env = { RESEND_API_KEY: 're_x', DB: fakeD1(), __fetch: r.f };
  assert.equal((await sendMail(env, 'not-an-address', { subject: 's' })).reason, 'bad-address');
  for (let i = 0; i < CLIENT_MAILS_PER_DAY; i++) assert.equal((await sendMail(env, 'a@b.co', { subject: 's', html: 'h', text: 't' })).sent, true);
  assert.equal((await sendMail(env, 'a@b.co', { subject: 's', html: 'h', text: 't' })).reason, 'daily-limit');
  assert.equal(r.sent.length, CLIENT_MAILS_PER_DAY); assert.equal(r.sent[0].reply_to, 'nurrenaissance@gmail.com'); assert.match(r.sent[0].from, /projects@mail\.nrnszn\.com/);
});

test('/admin: a new project or a status change e-mails the client; saving without a change, or with the switch off, does not', async () => {
  const r = resend(), env = { ADMIN_PASSWORD: 'correct horse battery staple', ACCOUNTS_DB: fakeD1(), RESEND_API_KEY: 're_x', __fetch: r.f };
  const token = await makeToken(env);
  const post = async (body) => (await adminPost({ request: new Request('https://www.nrnszn.com/api/admin', { method: 'POST', body: JSON.stringify(body), headers: { authorization: `Bearer ${token}` } }), env })).json();
  const a = await post({ action: 'client-save', project: { email: 'k@l.co', clientName: 'Kay', title: 'Shoot', total: 300, status: 'booked', due: '2026-12-01' } });
  assert.equal(a.emailed, true); assert.match(r.sent[0].subject, /You are booked: Shoot/); assert.deepEqual(r.sent[0].to, ['k@l.co']);
  await post({ action: 'client-save', project: { id: a.id, email: 'k@l.co', title: 'Shoot', total: 300, status: 'booked', note: 'typo fix' } });
  assert.equal(r.sent.length, 1, 'same status: no e-mail');
  await post({ action: 'client-save', project: { id: a.id, email: 'k@l.co', title: 'Shoot', total: 300, status: 'in-progress', notify: false } });
  assert.equal(r.sent.length, 1, 'switch off: no e-mail');
  const c = await post({ action: 'client-save', project: { id: a.id, email: 'k@l.co', title: 'Shoot', total: 300, status: 'review', link: 'https://drive.google.com/x' } });
  assert.equal(c.emailed, true); assert.match(r.sent[1].subject, /Ready for your review/); assert.match(r.sent[1].html, /Review it here/);
});
