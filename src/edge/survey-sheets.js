// Survey stage 2: saving a survey response to the "NuRenaissance Surveys" Google Sheet from the edge, the way Code.gs doPost did:
// the response row (show or service tab), the subscriber lists, the one-time discount code, the thank-you and notification e-mails
// and the Summary tab. A port of that logic, proven against the real Code.gs by tests/survey-sheets.unit.mjs.
// Not wired to any URL yet (stage 3). It writes with its own Google service account (Editor on the Surveys sheet only).
import { getAccessToken, parseServiceAccount, SHEETS_WRITE_SCOPE } from './google.js';
import {
  shouldDrop, buildSubmission, generateDiscountCode, buildServiceThankYouEmail, buildNotifySubmission, buildNotifyServiceSubmission, sendEmail, NOTIFY_EMAIL,
} from './survey.js';

export const SURVEYS_SHEET_ID = '1TVI4SfvMOhFYpAfTkdV3p1pT9Gs5xUlNnwKDed7yvp0'; // "NuRenaissance Surveys" (an address, not a secret)
export const TABS = {
  show: 'Certified_Lounge_Surveys', summary: 'Certified_Lounge_Summary', subscribers: 'Subscribers', recapLog: 'Certified_Lounge_Recap_Log',
  service: 'NuRenaissance_Service_Surveys', serviceSubscribers: 'Service_Subscribers', discounts: 'Discount_Codes',
};
export const HEADERS = {
  show: ['Timestamp', 'Show', 'Rating', 'Feedback', 'Note', 'Attendee_Type', 'Source', 'Favorite_Performer', 'Bring_Friend', 'Name', 'Email', 'Subscribed'],
  service: ['Timestamp', 'Service', 'Rating', 'Feedback', 'Note', 'Hire_Again', 'Testimonial_OK', 'Source', 'Name', 'Email', 'Subscribed'],
  subscribers: ['Timestamp', 'Name', 'Email', 'Status', 'Unsubscribed Date'],
  discounts: ['Email', 'Name', 'Code', 'Issued_Date', 'Status', 'Redeemed_Date'],
};
const SHEET_TZ = 'America/Chicago';
const API = 'https://sheets.googleapis.com/v4/spreadsheets/';
const DATE_TIME = 'yyyy-MM-dd HH:mm:ss';

// ---------------------------------------------------------------- dates: the Sheet keeps wall-clock "serial" numbers in its own time zone
const parts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: SHEET_TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, Number(p.value)]));
/** A Date as the Sheet's serial number (days since 1899-12-30, wall clock in Nashville). */
export function dateToSerial(d) { const p = parts(d); return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) + (((d.getTime() % 1000) + 1000) % 1000)) / 86400000 + 25569; } // keeps the milliseconds, so quick submissions keep their order
/** A serial number back to a real moment, so the e-mail's "redeemed on" date comes out right. */
export function serialToDate(serial) {
  const wall = Math.round((serial - 25569) * 86400000); // the wall-clock time, as if it were UTC
  const offset = (at) => { const p = parts(at); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000; }; // Nashville's offset at that moment
  const first = new Date(wall - offset(new Date(wall)));
  return new Date(wall - offset(first)); // a second pass settles the hours around a daylight-saving change (the repeated autumn hour is ambiguous: the first one wins)
}

// ---------------------------------------------------------------- a thin client for the Sheets API
const colLetter = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
export class SurveySheet {
  constructor(token, sheetId = SURVEYS_SHEET_ID) { this.token = token; this.id = sheetId; this.meta = null; }
  async call(path, init = {}) {
    const res = await fetch(API + this.id + path, { ...init, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Sheets answered ${res.status} for ${path.split('?')[0]}`);
    return res.json();
  }
  async tabs() {
    if (!this.meta) this.meta = new Map(((await this.call('?fields=sheets.properties(sheetId,title)')).sheets || []).map((s) => [s.properties.title, s.properties.sheetId]));
    return this.meta;
  }
  async batch(requests) { return this.call(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) }); }
  /** The tab's rows (values as Sheets stores them; dates come back as serial numbers). */
  async read(tab) {
    return (await this.call(`/values/${encodeURIComponent(tab)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`)).values || [];
  }
  /** Creates the tab with its header row (bold, frozen) if it is missing, like the getOrCreate... functions did. */
  async ensureTab(tab, headers) {
    const tabs = await this.tabs();
    if (tabs.has(tab)) return tabs.get(tab);
    const add = await this.batch([{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }]);
    const sheetId = add.replies[0].addSheet.properties.sheetId;
    tabs.set(tab, sheetId);
    await this.call(`/values/${encodeURIComponent(tab + '!A1')}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [headers] }) });
    await this.batch([{ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: headers.length }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } }]);
    return sheetId;
  }
  /** Adds one row as plain values (RAW: text stays text, nothing is run as a formula); returns its 1-based row number. */
  async append(tab, row, dateCol) {
    const out = await this.call(`/values/${encodeURIComponent(tab + '!A:A')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values: [row] }) });
    const n = Number(/!\D*(\d+)/.exec(out.updates.updatedRange || '')[1]);
    if (dateCol) await this.dateTimeFormat(tab, n, dateCol);
    return n;
  }
  async dateTimeFormat(tab, row, col) {
    const sheetId = (await this.tabs()).get(tab);
    await this.batch([{ repeatCell: { range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: col - 1, endColumnIndex: col }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: DATE_TIME } } }, fields: 'userEnteredFormat.numberFormat' } }]);
  }
  /** Sets single cells: [{ row, col, value }] (1-based), as plain values. */
  async setCells(tab, cells) {
    await this.call('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: cells.map((c) => ({ range: `${tab}!${colLetter(c.col)}${c.row}`, values: [[c.value]] })) }) });
  }
}

// ---------------------------------------------------------------- the subscriber lists, the discount codes, the summary (ports of Code.gs)
/** Adds `email` to a Subscribers-shaped tab or reactivates it: 'added' | 'reactivated' | 'already-subscribed' | 'no-email-column'. */
export async function upsertToSubscriberSheet(sheets, email, tab, now = new Date()) {
  await sheets.ensureTab(tab, HEADERS.subscribers);
  const data = await sheets.read(tab);
  const headers = (data[0] || []).map((h) => h.toString().trim());
  const emailIdx = headers.findIndex((h) => h.toLowerCase() === 'email');
  const statusIdx = headers.findIndex((h) => h.toLowerCase() === 'status');
  const unsubIdx = headers.findIndex((h) => h.toLowerCase() === 'unsubscribed date');
  if (emailIdx === -1) return 'no-email-column';

  const normalized = email.toLowerCase();
  for (let r = 1; r < data.length; r++) {
    const rowEmail = ((data[r] || [])[emailIdx] || '').toString().trim().toLowerCase();
    if (rowEmail === normalized) {
      const status = statusIdx > -1 ? ((data[r] || [])[statusIdx] || '').toString().trim().toLowerCase() : '';
      if (status === 'unsubscribed' || status === '') {
        const cells = [];
        if (statusIdx > -1) cells.push({ row: r + 1, col: statusIdx + 1, value: 'Active' });
        if (unsubIdx > -1) cells.push({ row: r + 1, col: unsubIdx + 1, value: '' });
        if (cells.length) await sheets.setCells(tab, cells);
        return 'reactivated';
      }
      return 'already-subscribed';
    }
  }
  const tsCol = headers.findIndex((h) => h.toLowerCase() === 'timestamp');
  const newRow = headers.map((h) => { const k = h.toLowerCase(); return k === 'email' ? email : k === 'timestamp' ? dateToSerial(now) : k === 'status' ? 'Active' : ''; });
  await sheets.append(tab, newRow, tsCol > -1 ? tsCol + 1 : 0);
  return 'added';
}
/** Sets the first row with this e-mail to Unsubscribed (+ date): 'unsubscribed' | 'not-found' | 'no-subscribers-sheet' | 'no-email-column' (like unsubscribeFromSheet in Code.gs). */
export async function unsubscribeFromSheet(sheets, email, tab, now = new Date()) {
  if (!(await sheets.tabs()).has(tab)) return 'no-subscribers-sheet';
  const data = await sheets.read(tab);
  const headers = (data[0] || []).map((h) => h.toString().trim());
  const emailIdx = headers.findIndex((h) => h.toLowerCase() === 'email');
  const statusIdx = headers.findIndex((h) => h.toLowerCase() === 'status');
  const unsubIdx = headers.findIndex((h) => h.toLowerCase() === 'unsubscribed date');
  if (emailIdx === -1) return 'no-email-column';
  const normalized = email.toLowerCase();
  for (let r = 1; r < data.length; r++) {
    if (((data[r] || [])[emailIdx] || '').toString().trim().toLowerCase() === normalized) {
      const cells = [];
      if (statusIdx > -1) cells.push({ row: r + 1, col: statusIdx + 1, value: 'Unsubscribed' });
      if (unsubIdx > -1) cells.push({ row: r + 1, col: unsubIdx + 1, value: dateToSerial(now) });
      if (cells.length) await sheets.setCells(tab, cells);
      if (unsubIdx > -1) { try { await sheets.dateTimeFormat(tab, r + 1, unsubIdx + 1); } catch { /* cosmetic: the date is already saved */ } }
      return 'unsubscribed';
    }
  }
  return 'not-found';
}
export const upsertSubscriber = (sheets, email, now) => upsertToSubscriberSheet(sheets, email, TABS.subscribers, now);
export const upsertServiceSubscriber = (sheets, email, now) => upsertToSubscriberSheet(sheets, email, TABS.serviceSubscribers, now);

/** This e-mail's one-time discount code, issued if they never had one. Always the same code per e-mail. */
export async function issueDiscountCode(sheets, email, name, now = new Date(), uuid) {
  await sheets.ensureTab(TABS.discounts, HEADERS.discounts);
  const data = await sheets.read(TABS.discounts);
  const normalized = email.toLowerCase();
  for (let r = 1; r < data.length; r++) {
    const row = data[r] || [];
    if ((row[0] || '').toString().trim().toLowerCase() === normalized) {
      const redeemed = row[5];
      return { code: row[2], alreadyRedeemed: (row[4] || '').toString().trim().toLowerCase() === 'redeemed', redeemedDate: typeof redeemed === 'number' ? serialToDate(redeemed) : redeemed || null };
    }
  }
  const code = generateDiscountCode(uuid);
  await sheets.append(TABS.discounts, [email, name || '', code, dateToSerial(now), 'Unused', ''], 4);
  return { code, alreadyRedeemed: false, redeemedDate: null };
}

/** Rebuilds the Summary tab from the show responses (all-shows total, then one row per show, most recent first). */
export async function refreshSummary(sheets) {
  if (!(await sheets.tabs()).has(TABS.show)) return;
  const data = await sheets.read(TABS.show);
  if (data.length < 2) return;
  const headers = data[0].map((h) => h.toString().trim());
  const idx = {}; headers.forEach((h, i) => { idx[h] = i; });
  const blank = () => ({ count: 0, ratingSum: 0, ratingCount: 0, firstTime: 0, returning: 0, friendYes: 0, friendCounted: 0, sources: {}, lastTs: null });
  const byShow = {}, total = blank();
  for (const r of data.slice(1)) {
    const cell = (name) => (r || [])[idx[name]];
    const show = (cell('Show') || '').toString().trim() || '(unspecified)';
    const rating = Number(cell('Rating')) || 0;
    const attendeeType = (cell('Attendee_Type') || '').toString().trim();
    const bringFriend = (cell('Bring_Friend') || '').toString().trim();
    const source = (cell('Source') || '').toString().trim();
    const ts = cell('Timestamp');
    if (!byShow[show]) byShow[show] = blank();
    for (const s of [byShow[show], total]) {
      s.count++;
      if (rating) { s.ratingSum += rating; s.ratingCount++; }
      if (attendeeType === 'First-time') s.firstTime++;
      if (attendeeType === 'Returning') s.returning++;
      if (bringFriend) { s.friendCounted++; if (bringFriend === 'Yes') s.friendYes++; }
      if (source) s.sources[source] = (s.sources[source] || 0) + 1;
      if (ts && (!s.lastTs || ts > s.lastTs)) s.lastTs = ts;
    }
  }
  const topSource = (sources) => { let best = '', n = 0; for (const k of Object.keys(sources)) if (sources[k] > n) { best = k; n = sources[k]; } return best || '—'; };
  const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '—');
  const avg = (sum, count) => (count ? (sum / count).toFixed(2) : '—');
  const statRow = (label, s) => [label, s.count, avg(s.ratingSum, s.ratingCount), pct(s.firstTime, s.firstTime + s.returning), pct(s.returning, s.firstTime + s.returning), pct(s.friendYes, s.friendCounted), topSource(s.sources), s.lastTs || ''];

  const headerRow = ['Show', 'Responses', 'Avg Rating', 'First-Time %', 'Returning %', 'Would Bring a Friend %', 'Top Source', 'Last Response'];
  const out = [statRow('🎯 ALL SHOWS (TOTAL)', total), new Array(headerRow.length).fill(''), headerRow];
  Object.keys(byShow).sort((a, b) => (byShow[b].lastTs ? Number(byShow[b].lastTs) : 0) - (byShow[a].lastTs ? Number(byShow[a].lastTs) : 0)).forEach((s) => out.push(statRow(s, byShow[s])));

  const sheetId = await sheets.ensureTab(TABS.summary, headerRow);
  const range = (r0, r1, c0 = 0, c1 = headerRow.length) => ({ sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  await sheets.call(`/values/${encodeURIComponent(TABS.summary)}:clear`, { method: 'POST', body: '{}' });
  await sheets.call(`/values/${encodeURIComponent(TABS.summary + '!A1')}?valueInputOption=USER_ENTERED`, { method: 'PUT', body: JSON.stringify({ values: out }) });
  await sheets.batch([
    { repeatCell: { range: { sheetId }, cell: { userEnteredFormat: {} }, fields: 'userEnteredFormat' } }, // clear() also cleared the old formatting
    { repeatCell: { range: range(0, 1), cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
    { repeatCell: { range: range(2, 3), cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.941, green: 0.941, blue: 0.941 } } }, fields: 'userEnteredFormat(textFormat.bold,backgroundColor)' } },
    { repeatCell: { range: range(0, out.length, 7, 8), cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'M/d/yyyy H:mm:ss' } } }, fields: 'userEnteredFormat.numberFormat' } },
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 3 } }, fields: 'gridProperties.frozenRowCount' } },
    { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: headerRow.length } } },
  ]);
}

// ---------------------------------------------------------------- recording one submission (the body of doPost, after the rate limit)
/**
 * Saves one response and sends the e-mails. `env` needs PAYMENTS-style secrets: SURVEY_SERVICE_ACCOUNT_JSON (Editor on the Surveys sheet),
 * RESEND_API_KEY and SURVEY_UNSUB_SECRET. Returns what doPost answered: { ok: true, subscribeResult }.
 * The response row is always saved first: a failing e-mail, discount code or summary never loses the response (they are logged).
 */
export async function recordSubmission(body, env, { sheets, now = new Date(), uuid, log = console.error } = {}) {
  if (shouldDrop(body, now.getTime())) return { ok: true }; // honeypot / too fast: quietly dropped, like before
  if (!sheets) sheets = new SurveySheet(await getAccessToken(parseServiceAccount(env.SURVEY_SERVICE_ACCOUNT_JSON), now.getTime(), SHEETS_WRITE_SCOPE), env.SURVEYS_SHEET_ID || SURVEYS_SHEET_ID);

  const sub = buildSubmission(body, dateToSerial(now));
  const isService = sub.kind === 'service';
  const tab = isService ? TABS.service : TABS.show;
  await sheets.ensureTab(tab, isService ? HEADERS.service : HEADERS.show);
  await sheets.append(tab, sub.row, 1);
  let subscribeResult = 'skipped';
  const mail = async (what, build) => { try { const m = await build(); await sendEmail(m, env); } catch (e) { log(`survey: ${what} failed (the response is saved): ${e}`); } };

  if (isService) {
    if (sub.subscribed && sub.email) {
      subscribeResult = await upsertServiceSubscriber(sheets, sub.email, now);
      await mail('thank-you e-mail', async () => {
        const info = await issueDiscountCode(sheets, sub.email, sub.name, now, uuid);
        const m = await buildServiceThankYouEmail(sub.email, sub.name, info.code, { alreadyRedeemed: info.alreadyRedeemed, redeemedDate: info.redeemedDate }, env.SURVEY_UNSUB_SECRET, env.SURVEY_UNSUB_BASE);
        return { to: sub.email, ...m };
      });
    }
    await mail('notification', async () => ({ to: NOTIFY_EMAIL, ...buildNotifyServiceSubmission(sub.row, subscribeResult) }));
  } else {
    if (sub.subscribed && sub.email) subscribeResult = await upsertSubscriber(sheets, sub.email, now);
    await mail('notification', async () => ({ to: NOTIFY_EMAIL, ...buildNotifySubmission(sub.row, subscribeResult) }));
    try { await refreshSummary(sheets); } catch (e) { log(`survey: summary refresh failed (the response is saved): ${e}`); }
  }
  return { ok: true, subscribeResult };
}
