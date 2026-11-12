// Survey stage 5: the daily Certified Lounge RECAP newsletter at the edge, replacing checkForRecapVideo() and its helpers in
// apps-script/survey/Code.gs. Once a day it finds the latest finished livestream on the @nrnszn channel, works out which show it was
// from the survey responses of the days before, and e-mails that show's opted-in subscribers a link to the recap (never the same
// person twice for the same show, never anyone who unsubscribed). Proven against the real Code.gs by tests/survey-recap.unit.mjs.
//
// It has no timer of its own: a daily GitHub Actions job (.github/workflows/recap-daily.yml) calls POST /api/survey-recap with a secret.
// Differences from the old script, on purpose: e-mails go out through Resend (not Gmail) in batches, a daily cap (RECAP_DAILY_CAP, default 50)
// stands in for Gmail's quota so the recap cannot use up the Resend allowance shared with NuDirectory, "which video was already handled"
// lives in a small tab of the Surveys sheet (Certified_Lounge_Recap_State) instead of an Apps Script property, and the unsubscribe links
// go to this site's page (stage 4). The sent-log tab is shared with the old script, so nobody is e-mailed twice while both exist.
import { SurveySheet, SURVEYS_SHEET_ID, TABS, serialToDate, dateToSerial } from './survey-sheets.js';
import {
  emailShell, escapeHtml, stripForSubject, shopBannerHtml, previewBannerHtml, buildUnsubscribeUrl, sendEmail, NOTIFY_EMAIL, SHOP_URL,
} from './survey.js';
import { parseServiceAccount, getAccessToken, SHEETS_WRITE_SCOPE } from './google.js';

export const YOUTUBE_CHANNEL_ID = 'UCy-wvitXVh2is_RHwQBBRjQ'; // @nrnszn (same as YOUTUBE_CHANNEL_ID in Code.gs; a test checks)
export const RECAP_SHOW_WINDOW_DAYS = 4; // how many days back to look for the matching show's survey responses
export const DEFAULT_RECAP_DAILY_CAP = 50;
export const STATE_TAB = 'Certified_Lounge_Recap_State';
export const LAST_VIDEO_KEY = 'LAST_RECAP_VIDEO_ID';
export const SITE_SURVEY_URL = 'https://www.nrnszn.com/api/survey';
const BATCH_SIZE = 50;
const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- the recap e-mail (port of sendRecapEmail and its helpers)
export function extractYoutubeVideoId(url) {
  if (!url) return null;
  const watch = url.match(/[?&]v=([0-9A-Za-z_-]{11})/); if (watch) return watch[1];
  const short = url.match(/youtu\.be\/([0-9A-Za-z_-]{11})/); if (short) return short[1];
  return null;
}
export function recapThumbnailHtml(videoUrl) {
  const id = extractYoutubeVideoId(videoUrl);
  if (!id) return '';
  return '<p style="margin:0 0 20px;"><a href="' + videoUrl + '"><img src="https://img.youtube.com/vi/' + encodeURIComponent(id) + '/hqdefault.jpg" ' +
    'alt="Watch the recap" width="440" style="width:100%;max-width:440px;height:auto;' +
    'border-radius:12px;display:block;margin:0 auto;border:0;" /></a></p>';
}
/** { subject, html } for one subscriber. `secret` is SURVEY_UNSUB_SECRET; `unsubBase` is where the Unsubscribe link points. */
export async function buildRecapEmail(email, name, show, videoUrl, secret, { preview = false, unsubBase = SITE_SURVEY_URL } = {}) {
  const safeName = escapeHtml(name), safeShow = escapeHtml(show);
  const greeting = safeName ? ('Hey ' + safeName + ',') : 'Hey,';
  const subject = (preview ? '[PREVIEW] ' : '') + '🎤 Relive ' + stripForSubject(show) + ' — Certified Lounge Recap';
  const bodyHtml =
    '<div style="font-family:Arial Black,Arial,Helvetica,sans-serif;font-weight:900;font-size:23px;' +
    'letter-spacing:0.5px;text-transform:uppercase;color:#E8B33D;margin:0 0 18px;line-height:1.2;">' +
    'The Recap Is Here</div>' +
    '<p style="margin:0 0 16px;">' + greeting + '</p>' +
    '<p style="margin:0 0 22px;">Thanks for coming through to <b style="color:#F5F1E8;">' + safeShow + '</b>. Here\'s the recap from that night if you want to relive it (or catch what you missed):</p>' +
    recapThumbnailHtml(videoUrl) +
    '<p style="margin:0 0 26px;"><a href="' + videoUrl + '" style="display:inline-block; background-color:#E8B33D; ' +
    'color:#14121B; padding:13px 24px; border-radius:999px; text-decoration:none; font-weight:bold; ' +
    'font-family:Helvetica,Arial,sans-serif;">▶ Watch The Recap</a></p>' +
    '<p style="margin:0 0 14px; color:#A69FC0;">And if you want to rep Certified Lounge or NuRenaissance, the shop\'s open:</p>' +
    shopBannerHtml() +
    '<p style="margin:12px 0 0;"><a href="' + SHOP_URL + '" style="display:inline-block; border:1px solid #6C4FE0; ' +
    'color:#907BE7; padding:10px 20px; border-radius:999px; text-decoration:none; ' +
    'font-family:Helvetica,Arial,sans-serif; font-size:13px;">Shop NuRenaissance ↗</a></p>';
  const html = emailShell({
    eyebrow: 'Certified Lounge', bodyHtml,
    footerNote: 'You\'re getting this because you opted in after a Certified Lounge show. — NuRenaissance Media',
    unsubUrl: await buildUnsubscribeUrl(email, 'show', secret, unsubBase),
    previewBanner: preview ? previewBannerHtml() : '',
  });
  return { subject, html };
}

// ---------------------------------------------------------------- finding the video (YouTube)
const hasKey = (key) => !!key && key.indexOf('PASTE_YOUR') !== 0;
const cleanKey = (env) => String(env.YOUTUBE_API_KEY || '').trim().replace(/^['"]+|['"]+$/g, '');
const yt = async (url) => (await fetch(url, { signal: AbortSignal.timeout(15000) })).json();

/** The latest COMPLETED livestream on the channel via the YouTube Data API, or null. Throws when the API answers with an error. */
export async function latestCompletedLivestream(key) {
  const data = await yt('https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=' + encodeURIComponent(YOUTUBE_CHANNEL_ID) + '&eventType=completed&type=video&order=date&maxResults=1&key=' + encodeURIComponent(key));
  if (data.error) throw new Error('YouTube Data API error: ' + JSON.stringify(data.error));
  if (!data.items || !data.items.length || !data.items[0].id || !data.items[0].id.videoId) return null;
  const videoId = data.items[0].id.videoId;
  return { videoId, url: 'https://www.youtube.com/watch?v=' + videoId, published: new Date(data.items[0].snippet.publishedAt) };
}
/** The newest upload from the channel's RSS feed (the fallback when there is no API key or the API fails). */
export async function latestFromFeed() {
  const res = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + YOUTUBE_CHANNEL_ID, { signal: AbortSignal.timeout(15000) });
  const xml = await res.text();
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml);
  if (!entry) return null;
  const id = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(entry[1]), pub = /<published>([^<]+)<\/published>/.exec(entry[1]);
  if (!id || !pub) return null;
  return { videoId: id[1].trim(), url: 'https://www.youtube.com/watch?v=' + id[1].trim(), published: new Date(pub[1].trim()) };
}
/** True unless YouTube says the video is still live or scheduled; an API hiccup never holds up a real recap. */
export async function isVideoReady(videoId, key) {
  if (!hasKey(key)) return true;
  try {
    const data = await yt('https://www.googleapis.com/youtube/v3/videos?part=snippet&id=' + encodeURIComponent(videoId) + '&key=' + encodeURIComponent(key));
    if (!data.items || !data.items.length) return true;
    return data.items[0].snippet.liveBroadcastContent === 'none';
  } catch { return true; }
}
export async function getLatestReadyRecapVideo(env, log = console.error) {
  const key = cleanKey(env);
  if (hasKey(key)) {
    try {
      const viaApi = await latestCompletedLivestream(key);
      if (viaApi) return viaApi;
      return null; // a clean "nothing yet": do not fall back to the less accurate feed
    } catch (e) { log('YouTube Data API livestream lookup failed, falling back to the feed: ' + e); }
  }
  const latest = await latestFromFeed();
  if (!latest) return null;
  if (!(await isVideoReady(latest.videoId, key))) return null; // still scheduled or live: the next daily check picks it up
  return latest;
}

// ---------------------------------------------------------------- the lists (ports of findShowForVideo / getUnsentSubscribersForShow / getUnsubscribedEmailSet)
const headerIndex = (data) => { const idx = {}; (data[0] || []).map((h) => String(h).trim()).forEach((h, i) => { idx[h] = i; }); return idx; };
const cell = (r, i) => (r[i] === undefined || r[i] === null ? '' : r[i]);

/** Whichever Show value appears most in survey responses in the days right before the video went up (first to reach the top count wins ties). */
export function findShowForVideo(surveyRows, published) {
  if (!surveyRows || surveyRows.length < 2) return null;
  const idx = headerIndex(surveyRows);
  const windowStart = published.getTime() - RECAP_SHOW_WINDOW_DAYS * DAY;
  const counts = {};
  surveyRows.slice(1).forEach((r) => {
    const ts = cell(r, idx.Timestamp), show = String(cell(r, idx.Show)).trim();
    if (!show || typeof ts !== 'number') return; // only real dates count
    const when = serialToDate(ts).getTime();
    if (when >= windowStart && when <= published.getTime()) counts[show] = (counts[show] || 0) + 1;
  });
  let best = null, bestN = 0;
  Object.keys(counts).forEach((k) => { if (counts[k] > bestN) { best = k; bestN = counts[k]; } });
  return best;
}
export function unsubscribedSet(subscriberRows) {
  const set = new Set();
  const data = subscriberRows || [];
  if (!data.length) return set;
  const headers = (data[0] || []).map((h) => String(h).trim());
  const emailIdx = headers.findIndex((h) => h.toLowerCase() === 'email'), statusIdx = headers.findIndex((h) => h.toLowerCase() === 'status');
  if (emailIdx === -1 || statusIdx === -1) return set;
  data.slice(1).forEach((r) => { if (String(cell(r, statusIdx)).trim().toLowerCase() === 'unsubscribed') set.add(String(cell(r, emailIdx)).trim().toLowerCase()); });
  return set;
}
/** Survey-subscribed e-mails for this show that have not had a recap yet, minus anyone who has since unsubscribed. */
export function unsentSubscribers(surveyRows, logRows, subscriberRows, show) {
  const idx = headerIndex(surveyRows);
  const already = new Set();
  (logRows || []).slice(1).forEach((r) => { already.add(String(cell(r, 0)).trim().toLowerCase() + '|' + String(cell(r, 1)).trim().toLowerCase()); });
  const unsubscribed = unsubscribedSet(subscriberRows);
  const seen = new Set(), recipients = [];
  surveyRows.slice(1).forEach((r) => {
    const rowShow = String(cell(r, idx.Show)).trim();
    const subscribed = String(cell(r, idx.Subscribed)).trim().toLowerCase() === 'yes';
    const email = String(cell(r, idx.Email)).trim();
    if (rowShow !== show || !subscribed || !email) return;
    const lower = email.toLowerCase();
    if (unsubscribed.has(lower)) return;
    const key = lower + '|' + show.toLowerCase();
    if (already.has(key) || seen.has(key)) return;
    seen.add(key);
    recipients.push({ email, name: String(cell(r, idx.Name)).trim() });
  });
  return recipients;
}

// ---------------------------------------------------------------- sending in batches (Resend /emails/batch: one request for up to 100 e-mails)
export async function sendEmailBatch(messages, env) {
  const key = String(env.RESEND_API_KEY || '').trim();
  if (!key) throw new Error('RESEND_API_KEY is not set');
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(messages.map((m) => ({
      from: env.SURVEY_FROM_EMAIL || 'NuRenaissance <survey@mail.nrnszn.com>', to: [m.to], subject: String(m.subject).replace(/[\r\n]+/g, ' '), reply_to: NOTIFY_EMAIL,
      html: m.html, text: m.text || 'Please view this email in an HTML-compatible client.',
    }))),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

// ---------------------------------------------------------------- the daily check (checkForRecapVideo)
const tabRows = async (sheets, tab) => ((await sheets.tabs()).has(tab) ? sheets.read(tab) : []);
async function readLastVideo(sheets) {
  const rows = await tabRows(sheets, STATE_TAB);
  const i = rows.findIndex((r) => String(cell(r, 0)) === LAST_VIDEO_KEY);
  return { value: i === -1 ? '' : String(cell(rows[i], 1)), row: i === -1 ? 0 : i + 1 };
}
async function writeLastVideo(sheets, videoId) {
  await sheets.ensureTab(STATE_TAB, ['Key', 'Value']);
  const { row } = await readLastVideo(sheets);
  if (row) await sheets.setCells(STATE_TAB, [{ row, col: 2, value: videoId }]);
  else await sheets.append(STATE_TAB, [LAST_VIDEO_KEY, videoId], 0);
}
/** Adds sent rows to the recap log (Email, Show, Sent_At, Video_URL) in one request, with the date column formatted like a real date. */
async function appendLog(sheets, rows) {
  const out = await sheets.call(`/values/${encodeURIComponent(TABS.recapLog + '!A:A')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values: rows }) });
  const m = /!\D*(\d+):\D*(\d+)$/.exec((out.updates && out.updates.updatedRange) || '');
  if (m) {
    try {
      const sheetId = (await sheets.tabs()).get(TABS.recapLog);
      await sheets.batch([{ repeatCell: { range: { sheetId, startRowIndex: Number(m[1]) - 1, endRowIndex: Number(m[2]), startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'yyyy-MM-dd HH:mm:ss' } } }, fields: 'userEnteredFormat.numberFormat' } }]);
    } catch { /* cosmetic: the rows are already saved */ }
  }
}

/**
 * The whole daily check. Returns what happened: { result: 'nothing-ready' | 'already-handled' | 'no-show' | 'no-recipients' | 'sent' | 'partial', ... }.
 * Any failure is e-mailed to NOTIFY_EMAIL and returned as { result: 'failed' } (it never throws).
 */
export async function checkForRecapVideo(env, { sheets, now = new Date(), log = console.error } = {}) {
  const notify = async (subject, text) => { try { await sendEmail({ to: NOTIFY_EMAIL, subject, text }, env); } catch (e) { log('recap: notification failed: ' + e); } };
  try {
    if (!sheets) sheets = new SurveySheet(await getAccessToken(parseServiceAccount(env.SURVEY_SERVICE_ACCOUNT_JSON), now.getTime(), SHEETS_WRITE_SCOPE), /^[A-Za-z0-9_-]{20,100}$/.test(env.SURVEYS_SHEET_ID || '') ? env.SURVEYS_SHEET_ID : SURVEYS_SHEET_ID);
    const latest = await getLatestReadyRecapVideo(env, log);
    if (!latest) return { result: 'nothing-ready' }; // nothing ready to send yet
    if (latest.videoId === (await readLastVideo(sheets)).value) return { result: 'already-handled', videoId: latest.videoId };

    const surveyRows = await tabRows(sheets, TABS.show);
    const show = findShowForVideo(surveyRows, latest.published);
    if (!show) {
      await notify('Certified Lounge recap needs a look', "Couldn't match this video to a specific show (no survey responses in the " + RECAP_SHOW_WINDOW_DAYS + ' days before it went up). Send the recap manually this time.\n\nVideo: ' + latest.url);
      await writeLastVideo(sheets, latest.videoId);
      return { result: 'no-show', videoId: latest.videoId };
    }
    const recipients = unsentSubscribers(surveyRows, await tabRows(sheets, TABS.recapLog), await tabRows(sheets, TABS.subscribers), show);
    if (!recipients.length) { await writeLastVideo(sheets, latest.videoId); return { result: 'no-recipients', show, videoId: latest.videoId }; }

    await sheets.ensureTab(TABS.recapLog, ['Email', 'Show', 'Sent_At', 'Video_URL']);
    const cap = parseInt(env.RECAP_DAILY_CAP, 10) > 0 ? parseInt(env.RECAP_DAILY_CAP, 10) : DEFAULT_RECAP_DAILY_CAP;
    const today = recipients.slice(0, cap);
    let sent = 0;
    for (let i = 0; i < today.length; i += BATCH_SIZE) {
      const chunk = today.slice(i, i + BATCH_SIZE);
      const messages = [];
      for (const r of chunk) messages.push({ to: r.email, ...(await buildRecapEmail(r.email, r.name, show, latest.url, env.SURVEY_UNSUB_SECRET, { unsubBase: env.SURVEY_UNSUB_BASE || SITE_SURVEY_URL })) });
      await sendEmailBatch(messages, env);
      sent += chunk.length;
      await appendLog(sheets, chunk.map((r) => [r.email, show, dateToSerial(now), latest.url])); // logged right after each batch: a later failure cannot make anyone get it twice
    }
    if (recipients.length > today.length) {
      await notify('Certified Lounge recap needs a look', 'Sent ' + sent + ' of ' + recipients.length + ' recap emails for ' + show +
        " before hitting today's email sending limit. The remaining " + (recipients.length - sent) + " will go out automatically on tomorrow's daily check (nobody gets double-emailed — already-sent ones are skipped) — no action needed unless you want it sooner, in which case run \"sendRecapNow\" after the quota resets.\n\nVideo: " + latest.url);
      return { result: 'partial', show, sent, remaining: recipients.length - sent, videoId: latest.videoId }; // NOT marked handled: tomorrow finishes the rest
    }
    await writeLastVideo(sheets, latest.videoId);
    await notify('Recap sent for ' + show, 'Sent the recap email (' + latest.url + ') to ' + sent + ' subscriber(s) from ' + show + '.');
    return { result: 'sent', show, sent, videoId: latest.videoId };
  } catch (err) {
    log('checkForRecapVideo FAILED: ' + err);
    await notify('Certified Lounge recap check failed', String(err));
    return { result: 'failed', error: String(err && err.message || err) };
  }
}

/** Sends the real recap template to NOTIFY_EMAIL with sample data (the old previewRecapEmail). */
export async function sendPreviewRecap(env) {
  const m = await buildRecapEmail(NOTIFY_EMAIL, 'Jordan', 'Solberg Studios — Oct 17', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', env.SURVEY_UNSUB_SECRET, { preview: true, unsubBase: env.SURVEY_UNSUB_BASE || SITE_SURVEY_URL });
  await sendEmail({ to: NOTIFY_EMAIL, ...m }, env);
}
