// The Certified Lounge / service survey backend, moved from Apps Script (apps-script/survey/Code.gs) to the edge in STAGES.
// This file is stage 1: the parts that are pure logic and can be proven identical to the old code (tests/survey.unit.mjs runs
// the real Code.gs functions next to these and compares the results):
//   - the submission rules (honeypot, "too fast" trap, rating 1-5, e-mail check, the row for the show or service tab)
//   - the e-mails: the service thank-you with the one-time discount code, and your notification e-mail for each response
//   - the tamper-proof unsubscribe links
//   - sending through Resend (the same sender NuDirectory uses)
// Not wired to any URL yet: the survey keeps running on Apps Script until the later stages (sheet writes, summary tab, endpoint,
// unsubscribe page, recap newsletter) are done. See docs/survey-migration-plan.md.

// Same values as Code.gs (a test keeps them equal).
export const NOTIFY_EMAIL = 'nurrenaissance@gmail.com';
export const SHOP_URL = 'https://www.nrnszn.com/shop';
export const SHOP_BANNER_URL = 'https://static.wixstatic.com/media/355bb7_4dfc63c136b24d95ad49376494971eb3~mv2.jpg/v1/fill/w_2000,h_2000,al_c,q_90,enc_avif,quality_auto/355bb7_4dfc63c136b24d95ad49376494971eb3~mv2.jpg';
export const SERVICE_DISCOUNT_PERCENT = 10;
export const MIN_SUBMIT_MS = 1500;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAILING_ADDRESS = '14919 Lebanon Rd, Old Hickory, TN 37138';
export const SURVEY_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzEigyj8nDLW4XtUANXkX8dCsWNgt0kb8Uc6gWp2vhC12g3lTke2XeX_eot1RXLYeyB/exec'; // where unsubscribe links point until that page moves too
const MAIL_TIMEZONE = 'America/Chicago';

// ---------------------------------------------------------------- the submission rules (doPost, before any sheet is touched)
/** Honeypot and "too fast" trap: true means the submission is quietly dropped (answered as ok, nothing saved). */
export function shouldDrop(body, nowMs = Date.now()) {
  if (body.website) return true; // a hidden field real people never fill in
  const loadedAt = Number(body.loadedAt);
  return !loadedAt || nowMs - loadedAt < MIN_SUBMIT_MS; // a script posting with no (or a just-now) page-load time
}

const text = (v, n) => (v || '').toString().trim().slice(0, n);

/**
 * Cleans a submission and builds its row for the Sheet. `ts` goes in the Timestamp column.
 * Show row:    Timestamp, Show, Rating, Feedback, Note, Attendee_Type, Source, Favorite_Performer, Bring_Friend, Name, Email, Subscribed
 * Service row: Timestamp, Service, Rating, Feedback, Note, Hire_Again, Testimonial_OK, Source, Name, Email, Subscribed
 */
export function buildSubmission(body, ts) {
  let rating = parseInt(body.rating, 10);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) rating = ''; // never trust the client: this feeds the summary stats

  let email = (body.email || '').toString().trim();
  let subscribed = !!body.subscribed;
  if (email && !EMAIL_RE.test(email)) { email = ''; subscribed = false; } // never mark someone subscribed off a malformed address

  const kind = body._kind === 'service' ? 'service' : 'show';
  const row = kind === 'service'
    ? [ts, text(body.service, 200), rating, text(body.feedback, 2000), text(body.note, 2000), text(body.hireAgain, 100), body.testimonialOk ? 'Yes' : 'No', text(body.source, 100), text(body.name, 100), email, subscribed ? 'Yes' : 'No']
    : [ts, text(body.show, 200), rating, text(body.feedback, 2000), text(body.note, 2000), text(body.attendeeType, 100), text(body.source, 100), text(body.favoritePerformer, 200), text(body.bringFriend, 100), text(body.name, 100), email, subscribed ? 'Yes' : 'No'];
  return { kind, rating, email, subscribed, row, name: (body.name || '').toString().trim() };
}

// ---------------------------------------------------------------- small text helpers
export const stripForSubject = (str) => (str || '').toString().replace(/[\r\n\t]+/g, ' ').trim();
/** Escapes text from a survey response before it goes into an HTML e-mail. */
export const escapeHtml = (str) => (str || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** "Mon D, YYYY"; never throws and never gives "Invalid Date" (a blank or unreadable date gives ''). */
export function formatShortDate(date) {
  if (!date) return '';
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: MAIL_TIMEZONE });
  } catch { return ''; }
}

/** A short, hard-to-guess one-time code, e.g. NR10-4F91A2C7. */
export function generateDiscountCode(uuid = crypto.randomUUID()) {
  return 'NR' + SERVICE_DISCOUNT_PERCENT + '-' + uuid.replace(/-/g, '').toUpperCase().slice(0, 8);
}

// ---------------------------------------------------------------- unsubscribe links
const enc = new TextEncoder();
/** Short HMAC token so an unsubscribe link cannot be forged for someone else's e-mail (hex, first 24 characters). */
export async function makeUnsubToken(email, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode((email || '').toLowerCase().trim())));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
export async function verifyUnsubToken(email, token, secret) {
  return !!token && (await makeUnsubToken(email, secret)) === token;
}
/** `kind` is 'show' (recap newsletter list) or 'service' (service thank-you list): two separate lists by design. */
export async function buildUnsubscribeUrl(email, kind, secret, base = SURVEY_APPS_SCRIPT_URL) {
  return base + '?unsub=1&kind=' + (kind === 'service' ? 'service' : 'show') + '&email=' + encodeURIComponent(email) + '&t=' + (await makeUnsubToken(email, secret));
}

// ---------------------------------------------------------------- the e-mails
export function shopBannerHtml() {
  return '<p style="margin:20px 0;"><a href="' + SHOP_URL + '"><img src="' + SHOP_BANNER_URL + '" ' +
    'alt="Shop NuRenaissance" width="440" style="width:100%;max-width:440px;height:auto;' +
    'border-radius:12px;display:block;margin:0 auto;border:0;" /></a></p>';
}

export function previewBannerHtml() {
  return '<div style="background-color:rgba(232,179,61,0.14);border:1px solid #E8B33D;border-radius:8px;' +
    'padding:10px 14px;margin:0 0 20px;font-family:Helvetica,Arial,sans-serif;font-size:12px;' +
    'line-height:1.5;color:#E8B33D;">PREVIEW — sample data below, this isn\'t a real send.</div>';
}

/** The dark, gold-accented card every e-mail sits in. opts: { eyebrow, bodyHtml, footerNote, unsubUrl, previewBanner } */
export function emailShell(opts) {
  const eyebrow = escapeHtml(opts.eyebrow || 'NuRenaissance');
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#14121B" ' +
    'style="background-color:#14121B;padding:36px 16px;"><tr><td align="center">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1E1B29" ' +
      'style="max-width:520px;background-color:#1E1B29;border:1px solid #2A2638;border-radius:16px;">' +
        '<tr><td bgcolor="#E8B33D" style="height:4px;line-height:4px;font-size:0;background-color:#E8B33D;' +
        'border-radius:16px 16px 0 0;">&nbsp;</td></tr>' +
        '<tr><td style="padding:30px 28px 6px;">' +
          (opts.previewBanner || '') +
          '<div style="font-family:\'Courier New\',Courier,monospace;font-size:11px;letter-spacing:3px;' +
          'color:#E8B33D;text-transform:uppercase;margin:0 0 18px;">' + eyebrow + '</div>' +
          '<div style="font-family:Helvetica,Arial,sans-serif;color:#F5F1E8;font-size:15px;line-height:1.6;">' +
            opts.bodyHtml +
          '</div>' +
        '</td></tr>' +
        '<tr><td style="padding:0 28px 30px;">' +
          '<div style="border-top:1px solid #2A2638;margin:8px 0 18px;line-height:1px;font-size:1px;">&nbsp;</div>' +
          '<p style="font-family:Helvetica,Arial,sans-serif;color:#A69FC0;font-size:12px;line-height:1.6;margin:0;">' +
            opts.footerNote +
            '<br>' + escapeHtml(MAILING_ADDRESS) +
            (opts.unsubUrl ? '<br><a href="' + opts.unsubUrl + '" style="color:#A69FC0;">Unsubscribe</a>' : '') +
          '</p>' +
        '</td></tr>' +
      '</table>' +
    '</td></tr></table>'
  );
}

/**
 * The service-survey thank-you with the one-time discount code, as { subject, html }.
 * opts: { alreadyRedeemed, redeemedDate, preview }. A repeat submitter who already used the code is told so, not shown the code again.
 */
export async function buildServiceThankYouEmail(email, name, code, opts, secret, unsubBase) {
  opts = opts || {};
  const alreadyRedeemed = !!opts.alreadyRedeemed;
  const safeName = escapeHtml(name);
  const greeting = safeName ? 'Hey ' + safeName + ',' : 'Hey,';
  const subject = (opts.preview ? '[PREVIEW] ' : '') +
    (alreadyRedeemed ? 'Thanks for the feedback!' : 'Thanks for the feedback — here\'s ' + SERVICE_DISCOUNT_PERCENT + '% off your next job');
  const unsubUrl = await buildUnsubscribeUrl(email, 'service', secret, unsubBase);

  const redeemedDateStr = opts.redeemedDate ? formatShortDate(opts.redeemedDate) : '';
  const offerHtml = alreadyRedeemed
    ? ('<p style="margin:0 0 22px; color:#A69FC0;">Looks like you\'ve already used your one-time ' + SERVICE_DISCOUNT_PERCENT + '% off' +
        (redeemedDateStr ? ' (redeemed ' + redeemedDateStr + ')' : '') +
        ' — since it\'s a one-time thing we\'re not able to issue another, but we genuinely appreciate you taking the time to share more feedback.</p>')
    : (
      '<p style="margin:0 0 10px;color:#A69FC0;">As a thank-you, here\'s ' + SERVICE_DISCOUNT_PERCENT + '% off your next job with us:</p>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">' +
        '<tr><td align="center" bgcolor="#14121B" style="background-color:#14121B; border:2px dashed #E8B33D; ' +
        'border-radius:12px; padding:16px 12px;">' +
          '<span style="font-family:\'Courier New\',Courier,monospace; font-size:20px; font-weight:bold; ' +
          'letter-spacing:1px; color:#E8B33D;">' + escapeHtml(code) + '</span>' +
        '</td></tr>' +
      '</table>' +
      '<p style="margin:0 0 22px; color:#A69FC0; font-size:13px;">One-time use, good toward your next NuRenaissance job — just mention it when you book. ' +
      'It\'s tied to you, so hang onto it (we won\'t send another).</p>'
    );

  const bodyHtml =
    '<div style="font-family:Arial Black,Arial,Helvetica,sans-serif;font-weight:900;font-size:23px;' +
    'letter-spacing:0.5px;text-transform:uppercase;color:#E8B33D;margin:0 0 18px;line-height:1.2;">' +
    'Thanks For The Feedback</div>' +
    '<p style="margin:0 0 16px;">' + greeting + '</p>' +
    '<p style="margin:0 0 18px;">Thanks for taking a minute to tell us how it went — feedback like yours is what keeps NuRenaissance\'s work sharp.</p>' +
    offerHtml +
    '<p style="margin:0 0 14px; color:#A69FC0;">And if you want to rep NuRenaissance in the meantime, the shop\'s open:</p>' +
    shopBannerHtml() +
    '<p style="margin:12px 0 0;"><a href="' + SHOP_URL + '" style="display:inline-block; border:1px solid #6C4FE0; ' +
    'color:#907BE7; padding:10px 20px; border-radius:999px; text-decoration:none; ' +
    'font-family:Helvetica,Arial,sans-serif; font-size:13px;">Shop NuRenaissance ↗</a></p>';

  const html = emailShell({
    eyebrow: 'NuRenaissance',
    bodyHtml,
    footerNote: 'You\'re getting this because you opted in after telling us about a NuRenaissance job. — NuRenaissance Media',
    unsubUrl,
    previewBanner: opts.preview ? previewBannerHtml() : '',
  });
  return { subject, html };
}

/** Your notification e-mail for a show response (`row` is the show row), as { subject, text }. */
export function buildNotifySubmission(row, subscribeResult) {
  const [, show, rating, feedback, note, attendeeType, source, favoritePerformer, bringFriend, name, email, subscribedFlag] = row;
  const subject = 'New Certified Lounge survey response' + (show ? ' — ' + stripForSubject(show) : '');
  return { subject, text: [
    'Show: ' + (show || '(not specified)'),
    'Rating: ' + (rating || '(none)') + ' / 5',
    'Feedback: ' + (feedback || '(none)'),
    'Anything else: ' + (note || '(none)'),
    'First-time or returning: ' + (attendeeType || '(not answered)'),
    'Heard about it via: ' + (source || '(not answered)'),
    'Stood out to them: ' + (favoritePerformer || '(not answered)'),
    'Would bring a friend: ' + (bringFriend || '(not answered)'),
    'Name: ' + (name || '(none)'),
    'Email: ' + (email || '(none)'),
    'Subscribed: ' + subscribedFlag + (subscribedFlag === 'Yes' ? ' (' + subscribeResult + ')' : ''),
  ].join('\n') };
}

/** Your notification e-mail for a service response (`row` is the service row), as { subject, text }. */
export function buildNotifyServiceSubmission(row, subscribeResult) {
  const [, service, rating, feedback, note, hireAgain, testimonialOk, source, name, email, subscribedFlag] = row;
  const subject = 'New NuRenaissance service survey response' + (service ? ' — ' + stripForSubject(service) : '');
  return { subject, text: [
    'Service: ' + (service || '(not specified)'),
    'Rating: ' + (rating || '(none)') + ' / 5',
    'Feedback: ' + (feedback || '(none)'),
    'Anything else: ' + (note || '(none)'),
    'Would hire again: ' + (hireAgain || '(not answered)'),
    'OK to use as testimonial: ' + testimonialOk,
    'Heard about NuRenaissance via: ' + (source || '(not answered)'),
    'Name: ' + (name || '(none)'),
    'Email: ' + (email || '(none)'),
    'Subscribed: ' + subscribedFlag + (subscribedFlag === 'Yes' ? ' (' + subscribeResult + ')' : ''),
  ].join('\n') };
}

// ---------------------------------------------------------------- sending (Resend)
/** Sends one e-mail through Resend (secret RESEND_API_KEY; sender from SURVEY_FROM_EMAIL). Throws when Resend refuses. */
export async function sendEmail({ to, subject, html, text }, env) {
  const key = String(env.RESEND_API_KEY || '').trim();
  if (!key) throw new Error('RESEND_API_KEY is not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.SURVEY_FROM_EMAIL || 'NuRenaissance <survey@mail.nrnszn.com>',
      to: [to], subject: String(subject).replace(/[\r\n]+/g, ' '), reply_to: NOTIFY_EMAIL,
      ...(html ? { html, text: text || 'Please view this email in an HTML-compatible client.' } : { text: text || '' }),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}
