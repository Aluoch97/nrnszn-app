// E-mails to clients and to Nick about service work (Nov 25, 2026, Nick: "do all 6" after the services review):
//   * leadEmails: when someone sends the Services request form, the client gets "We got your request" (what happens next) and
//     Nick gets the full request (functions/api/service-lead.js, only after the lead was saved);
//   * statusEmail: when Nick changes a client project's status in /admin > Clients & projects (and leaves "E-mail the client" on),
//     the client gets what it means, the target date and a link to their account (src/edge/admin.js, client-save).
// Sent through Resend (RESEND_API_KEY, the same key as sign-in links and the survey), from projects@mail.nrnszn.com with replies
// going to Nick. The Resend free tier (100 a day) is shared with NuDirectory and the newsletters, so these are capped at
// CLIENT_MAILS_PER_DAY when a database is connected. Every bit of text people typed is escaped.
import { NOTIFY_EMAIL } from './survey.js';

export const CLIENT_MAILS_PER_DAY = 30;
export const FROM = 'NuRenaissance Media <projects@mail.nrnszn.com>';
const SITE = 'https://www.nrnszn.com';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const one = (s, n = 200) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim().slice(0, n);
export const usd = (n) => '$' + (Math.round(Number(n) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

/** A branded e-mail (same look as the sign-in e-mail). paragraphs: plain text; rows: [label, value] pairs; button: {label, url}. */
export function branded({ subject, preheader = '', heading, paragraphs = [], rows = [], button = null, footnote = '' }) {
  const p = (t) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#3d3450;">${esc(t).replace(/\n/g, '<br>')}</p>`;
  const table = rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;border-collapse:collapse;">${rows.map(([k, v]) => `<tr><td style="padding:9px 0;border-top:1px solid #eee8f5;font-size:14px;color:#6f6585;vertical-align:top;width:38%;">${esc(k)}</td><td style="padding:9px 0;border-top:1px solid #eee8f5;font-size:15px;color:#1d1528;vertical-align:top;">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>` : '';
  const btn = button && /^https:\/\//.test(button.url) ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px auto 4px;"><tr><td align="center" bgcolor="#c8175f" style="border-radius:999px;"><a href="${esc(button.url)}" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(button.label)}</a></td></tr></table>` : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f0f8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f0f8;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f0f8;"><tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e4dcef;">
    <tr><td align="center" style="background:#140f1f;padding:24px 24px 18px;">
      <img src="${SITE}/email/mascot.png" width="60" height="60" alt="" style="display:block;border:0;width:60px;height:60px;">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:bold;color:#f5c542;padding-top:6px;">NuRenaissance Media</div>
    </td></tr>
    <tr><td style="padding:30px 30px 18px;font-family:Arial,Helvetica,sans-serif;color:#1d1528;">
      <h1 style="margin:0 0 14px;font-size:23px;line-height:1.25;color:#1d1528;">${esc(heading)}</h1>
      ${paragraphs.map(p).join('')}${table}${btn}
    </td></tr>
    ${footnote ? `<tr><td style="padding:16px 30px;background:#faf8fd;border-top:1px solid #eee8f5;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#6f6585;">${esc(footnote)}</td></tr>` : ''}
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;"><tr><td align="center" style="padding:18px 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8a8199;">
    NuRenaissance Media · Nashville, Tennessee · Reply to this e-mail to reach us<br><a href="${SITE}" style="color:#8a8199;">nrnszn.com</a> · <a href="${SITE}/terms" style="color:#8a8199;">Terms</a> · <a href="${SITE}/privacy-policy" style="color:#8a8199;">Privacy policy</a>
  </td></tr></table>
</td></tr></table></body></html>`;
  const text = [heading, '', ...paragraphs.flatMap((t) => [t, '']), ...rows.map(([k, v]) => `${k}: ${v}`), ...(rows.length ? [''] : []),
    ...(button ? [`${button.label}: ${button.url}`, ''] : []), ...(footnote ? [footnote, ''] : []), 'NuRenaissance Media, Nashville, Tennessee', 'nrnszn.com'].join('\n');
  return { subject: one(subject, 150), html, text };
}

async function capOk(env, now) {
  const db = env.DB && typeof env.DB.prepare === 'function' ? env.DB : env.ACCOUNTS_DB && typeof env.ACCOUNTS_DB.prepare === 'function' ? env.ACCOUNTS_DB : null;
  if (!db) return true;
  const day = new Date(now).toISOString().slice(0, 10);
  await db.prepare('CREATE TABLE IF NOT EXISTS client_mail_log (day TEXT PRIMARY KEY, n INTEGER NOT NULL)').run();
  const r = await db.prepare('SELECT n FROM client_mail_log WHERE day = ?').bind(day).first();
  if (r && Number(r.n) >= CLIENT_MAILS_PER_DAY) return false;
  await db.prepare('INSERT INTO client_mail_log (day, n) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET n = n + 1').bind(day).run();
  return true;
}

/** Sends one message. Never throws: returns { sent, reason }. */
export async function sendMail(env, to, msg, now = Date.now()) {
  env = env || {};
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'no-key' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to || ''))) return { sent: false, reason: 'bad-address' };
  try {
    if (!(await capOk(env, now))) return { sent: false, reason: 'daily-limit' };
    const r = await (env.__fetch || fetch)('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.PROJECTS_FROM_EMAIL || FROM, to: [to], reply_to: NOTIFY_EMAIL, subject: msg.subject, html: msg.html, text: msg.text }),
      signal: AbortSignal.timeout(15000),
    });
    return r.ok ? { sent: true } : { sent: false, reason: `resend-${r.status}` };
  } catch (e) { console.error('client mail', e); return { sent: false, reason: 'error' }; }
}

// ---- 1. a new service request --------------------------------------------------------------------------------------------------
export function leadEmails(p) {
  const name = one(p.name, 80) || 'there', first = name.split(' ')[0];
  const summary = String(p.summary || '').slice(0, 2000), total = Number(p.total);
  const client = branded({
    subject: 'We got your request · NuRenaissance Media',
    preheader: 'Thanks for reaching out. Here is what happens next.',
    heading: `Thanks, ${first}. We got your request.`,
    paragraphs: [
      'Here is what you picked. The total is an estimate from our published prices; your quote is confirmed after we talk.',
      'What happens next:\n1. We read every request and reply within 2 business days.\n2. We set up a short call (or you can book one yourself with the button below).\n3. You get a written quote with the final price, dates and what is included.\n4. A $50 deposit books your date. It counts toward the total.',
    ],
    rows: [['Services', summary || '(not listed)'], ...(Number.isFinite(total) && total > 0 ? [['Estimated total', usd(total)]] : []), ...(p.timeline ? [['Timeline', one(p.timeline, 120)]] : [])],
    button: { label: 'Book a 30-minute call', url: `${SITE}/services` },
    footnote: 'Questions in the meantime? Just reply to this e-mail. If you have a NuRenaissance account, you can follow your request at nrnszn.com/account.',
  });
  const owner = branded({
    subject: `New service request: ${name}`,
    preheader: summary.slice(0, 120),
    heading: `New request from ${name}`,
    paragraphs: ['Reply to the client within 2 business days (the confirmation e-mail promised that). It is also saved in the NuServices sheet.'],
    rows: [['Name', name], ['E-mail', one(p.email, 200)], ['Phone', one(p.phone, 40) || '(none)'], ['Where', one(p.location, 120) || '(none)'], ['Artist or business', one(p.role, 60) || '(none)'],
      ['Timeline', one(p.timeline, 120) || '(none)'], ['Heard about us', one(p.heardAbout, 120) || '(none)'], ['Services', summary || '(none)'],
      ['Estimate', Number.isFinite(total) ? usd(total) : '(none)'], ['Details', String(p.details || '').slice(0, 3000) || '(none)']],
    button: { label: 'Open Clients & projects', url: `${SITE}/admin` },
  });
  return { client, owner };
}

// ---- 4. a project's status changed ---------------------------------------------------------------------------------------------
const STATUS_TEXT = {
  requested: ['We got your request', 'Thanks for reaching out. We will reply within 2 business days with next steps.'],
  quote: ['Your quote is ready', 'Your quote is ready. The total and what is included are below; reply to this e-mail with any questions. A $50 deposit books your date.'],
  booked: ['You are booked', 'You are booked. Your date is held, and we will be in touch before we start.'],
  'in-progress': ['Work has started', 'Work on your project has started.'],
  review: ['Ready for your review', 'Your project is ready for you to review. Take a look and send us your notes; two rounds of changes are included.'],
  done: ['Your project is done', 'Your project is finished. Thank you for working with us.'],
  paused: ['Your project is paused', 'Your project is on hold for now. We will let you know when it picks back up.'],
  cancelled: ['Your project was cancelled', 'Your project has been cancelled. If this is a surprise, reply to this e-mail.'],
};
export function statusEmail(p) {
  const [title, line] = STATUS_TEXT[p.status] || STATUS_TEXT.booked;
  const day = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
  const due = day(p.due);
  const rows = [['Project', one(p.title, 120)], ['Status', title]];
  if (due) rows.push([p.status === 'done' ? 'Finished' : p.status === 'booked' ? 'Date' : 'Target date', due]);
  if (Number(p.totalCents) > 0) rows.push(['Total', usd(p.totalCents / 100)]);
  if (Number.isFinite(Number(p.balanceCents)) && Number(p.totalCents) > 0) rows.push(['Balance', usd(Number(p.balanceCents) / 100)]);
  if (p.note) rows.push(['Note from us', String(p.note).slice(0, 2000)]);
  const link = p.status === 'review' || p.status === 'done' ? (/^https:\/\//.test(String(p.link || '')) ? String(p.link) : '') : '';
  return branded({
    subject: `${title}: ${one(p.title, 80)} · NuRenaissance Media`,
    preheader: line,
    heading: title,
    paragraphs: [`Hi ${one(p.clientName, 60).split(' ')[0] || 'there'},`, line],
    rows,
    button: link ? { label: p.status === 'done' ? 'Get your files' : 'Review it here', url: link } : { label: 'See your project', url: `${SITE}/account` },
    footnote: 'You can follow every project at nrnszn.com/account (sign in with this e-mail address). Reply to this e-mail to reach us.',
  });
}
