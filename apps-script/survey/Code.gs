/**
 * Certified Lounge Survey — backend
 * ---------------------------------------------------------------
 * SETUP:
 * 1. Go to script.google.com > New project (this should be its own,
 *    standalone Apps Script project — not pasted into any other widget's
 *    script, since each already has its own doGet/doPost and a second
 *    pair would collide with it).
 * 2. In the new project: File > New > HTML file, name it exactly "index",
 *    and paste index.html (the widget) into it.
 * 3. Delete the starter code in Code.gs and paste this whole file in.
 * 4. Deploy > New deployment > type "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone
 *    - Click Deploy, authorize when prompted (first time only — this
 *      script opens its own "Certified Lounge Survey" Google Sheet by ID,
 *      so you'll be asked to approve that on first run).
 * 5. Copy the Web App URL it gives you. Paste it into APPS_SCRIPT_URL
 *    inside index.html, in BOTH places you're using the widget:
 *      - the copy pasted into this same Apps Script project (index.html)
 *      - the copy pasted into the Wix HTML Embed on nrnszn.com
 *    Then redeploy this Apps Script project (Deploy > Manage deployments
 *    > pencil icon > New version > Deploy) so the standalone page picks
 *    up the change too.
 * 6. That single Web App URL is now both:
 *      - the standalone survey page (put it on a QR code / flyer link —
 *        add ?show=Solberg%20Studios%20-%20Oct%2017 to the end of the URL
 *        to auto-tag responses to a specific show and skip straight to
 *        the show flow, no typing or picker required. Optionally also add
 *        &lineup=Artist%20One,Artist%20Two,Artist%20Three to turn the
 *        "who stood out" field into tap chips for that night's lineup
 *        instead of free text. For a service follow-up, use
 *        ?service=Video%20Production instead to skip straight to the
 *        service flow pre-tagged. ?type=show or ?type=service alone
 *        jumps to that flow's picker step without pre-tagging anything.)
 *      - the submit endpoint the Wix-embedded copy posts to
 * ---------------------------------------------------------------
 * TWO SURVEYS, ONE SCRIPT:
 * The widget's first screen lets the person pick which kind of feedback
 * they're giving — "A Show" (Certified Lounge) or "A NuRenaissance
 * Service" (video, photo, livestream, web, admin) — and everything below
 * branches on that choice. Deep-link a QR code or email straight past the
 * picker with ?type=show or ?type=service (?show=... / ?service=... alone
 * also work, same as today).
 *
 * THE SHEET:
 * This script has its own dedicated Google Sheet — "NuRenaissance
 * Surveys" — separate from NuDirectory's spreadsheet. Its tabs:
 * - "Certified_Lounge_Surveys" — every show survey response, one row each
 * - "Subscribers" — show-survey "stay plugged in" opt-ins, deduped by email
 * - "Certified_Lounge_Summary" — rebuilt after every show submission:
 *   response count, avg rating, first-time/returning split, "would bring
 *   a friend" rate, and top discovery source, broken out per show plus an
 *   all-shows total. No manual refresh needed.
 * - "Certified_Lounge_Recap_Log" — tracks who's already gotten a recap
 *   email for which show, so nobody gets double-emailed
 * - "NuRenaissance_Service_Surveys" — every service survey response
 * - "Service_Subscribers" — service-survey opt-ins, kept as its own list
 *   (deliberately separate from the show Subscribers tab, so a business
 *   client and a concertgoer aren't automatically on the same list)
 * - "Discount_Codes" — one row per person who's ever been issued the
 *   service-survey thank-you discount code (see below)
 *
 * All seven tabs build themselves automatically as they're needed — but you
 * can also run "initializeCertifiedLoungeSheets" once from the function
 * dropdown to lay them all down immediately, so you can see the real
 * sheet structure without waiting on a live submission.
 *
 * The service survey doesn't have a summary tab or a recap newsletter the
 * way the show side does — it does now have its own immediate thank-you +
 * discount email (below), just not the "wait for a video, batch-email
 * everyone" system the show side has, since there's no equivalent video to
 * point people to for a one-off service job.
 * ---------------------------------------------------------------
 * SERVICE SURVEY THANK-YOU + ONE-TIME DISCOUNT:
 * The moment someone submits the service survey AND checks "Stay plugged
 * in" (that's the only path that collects their email at all — the field
 * doesn't even show otherwise), they immediately get a short thank-you
 * email with a one-time 10% off code for their next job. Nothing to set up
 * — this fires straight out of doPost, no trigger needed.
 *
 * "One-time" is enforced by email address, not by submission: the
 * Discount_Codes tab is checked first, and if that email already has a
 * code (from this submission or any earlier one), the SAME code is reused
 * rather than a new one being issued — so there's no way to end up with
 * more than one code by resubmitting the survey. SERVICE_DISCOUNT_PERCENT
 * below controls the percentage if you ever want to change it.
 *
 * Actually marking a code "spent" once it's used on a job is a manual
 * step, on purpose — there's no checkout/invoicing system wired into this
 * script to hook an automatic redemption into. When you apply someone's
 * code to an invoice, open the Discount_Codes tab and change that row's
 * Status from "Unused" to "Redeemed" (and fill in Redeemed_Date if you
 * want the record) — same as how Subscribers' Status column already works
 * by hand. That marking isn't just record-keeping — it changes what a
 * repeat submitter sees: if that email submits the service survey again
 * after their Status is "Redeemed," they get a different, honest version
 * of the thank-you email (thanks for the feedback, but no code shown, and
 * a note that their one-time discount was already used) instead of being
 * shown their old code again as if it were still claimable.
 *
 * Want to see what that email looks like without waiting for a real
 * submission? Pick "previewServiceThankYouEmail" from the function
 * dropdown and click Run — sends the real template to your own inbox with
 * sample data, clearly marked as a preview. "previewServiceThankYouEmailAlreadyRedeemed"
 * shows you the other version — what a repeat, already-redeemed submitter sees.
 * ---------------------------------------------------------------
 * RECAP NEWSLETTER (automatic — see below):
 * The morning after a show, once you upload the recap video to your
 * @nrnszn YouTube channel, this script notices the new upload on its own
 * and emails everyone who subscribed via THAT show's survey a link to
 * watch the recap + a link to the NuRenaissance shop. No manual send.
 *
 * One-time setup:
 * 1. SHOP_URL below is already set to nrnszn.com/shop — only touch it if
 *    that link ever changes.
 * 2. In the Apps Script editor, pick "setUpDailyRecapTrigger" from the
 *    function dropdown at the top and click Run once. (Re-running it
 *    later is safe — it won't create duplicates.) This schedules a daily
 *    check around 10am; nothing else to do after this.
 * Whenever you want to force an immediate check instead of waiting for
 * the next scheduled run (e.g. right after uploading a video), pick
 * "sendRecapNow" from the same dropdown and click Run.
 *
 * Want to see what the recap email actually looks like without waiting on a real show?
 * Pick "previewRecapEmail" from the function dropdown and click Run — it sends the real
 * template to your own inbox (NOTIFY_EMAIL) with sample placeholder data, clearly marked
 * as a preview. Run it as often as you want.
 *
 * Optional but recommended — a YouTube Data API key makes recap detection meaningfully
 * more accurate in two ways:
 *   1. Confirms a stream has actually ENDED before treating it as the recap. On its own,
 *      the RSS feed this uses can't tell a completed stream apart from one that's only
 *      scheduled or still airing, so a daily check that lands mid-stream could grab it early.
 *   2. Confirms the video is actually a LIVESTREAM, not just "whatever was posted most
 *      recently." Since @nrnszn also posts other things (shorts, trailers, promo clips,
 *      etc.), the RSS feed alone can't tell those apart from an actual show recap — if one
 *      of those goes up around the same time as a show, the old approach could grab the
 *      wrong video. With a key, this asks YouTube directly for the latest COMPLETED
 *      livestream specifically, so non-livestream uploads are never mistaken for a recap.
 * To set one up:
 * 1. Go to console.cloud.google.com (sign in with the same Google account this Apps Script
 *    project uses is easiest, but any Google account works).
 * 2. Create a new project (top-left project dropdown > New Project) — name doesn't matter,
 *    it doesn't need to connect to anything else you have.
 * 3. APIs & Services > Library > search "YouTube Data API v3" > Enable.
 * 4. APIs & Services > Credentials > + Create Credentials > API key. Copy the key it gives
 *    you.
 * 5. Optional but a good idea: click into that new key > under "API restrictions" choose
 *    "Restrict key" and select only "YouTube Data API v3" — limits what the key can be used
 *    for if it's ever seen by the wrong person. Leave "Application restrictions" as None;
 *    this key is called from Apps Script's servers, not a browser or app, so restricting it
 *    to a website or app would break it.
 * 6. Paste the key into YOUTUBE_API_KEY near the top of this script, then save the project
 *    (the disk icon, or Ctrl/Cmd+S).
 * 7. Pick "testYoutubeSetup" from the function dropdown and click Run, then check the log
 *    (View > Logs) for a pass/fail result — confirms the key actually works without waiting
 *    for a real show. Safe to run as many times as you want.
 * This is free at the volume this script uses it (one check a day) — no billing needed, even
 * though this specific lookup uses more of the free daily quota per check than a simple
 * lookup would (still a tiny fraction of the daily allowance).
 * Without a key, the recap system falls back to its original behavior: trusting whatever the
 * RSS feed says is the latest upload, without being able to tell a livestream apart from
 * other content on the channel. Still functional, just without this extra accuracy.
 *
 * How it decides which show a video is for: it looks at which Show value
 * shows up most in survey responses submitted in the days right before
 * the video went up, and treats that as the match. This works well as
 * long as you're not running two Certified Lounge shows within a few days
 * of each other and you upload reasonably promptly. If it can't find a
 * confident match, it emails you instead of guessing, so you can send
 * that one manually.
 *
 * Every recap email includes a one-click Unsubscribe link (tamper-proof —
 * it's signed, so nobody can unsubscribe someone else by guessing their
 * email in the URL). Clicking it flips that person's Status to
 * "Unsubscribed" in this sheet's own Subscribers tab.
 *
 * If a recap batch is big enough to hit this Google account's daily email
 * sending limit, it stops there, emails you a heads-up, and automatically
 * finishes the rest on the next daily check — nobody gets skipped or
 * double-emailed.
 * ---------------------------------------------------------------
 */

const SPREADSHEET_ID = '1TVI4SfvMOhFYpAfTkdV3p1pT9Gs5xUlNnwKDed7yvp0'; // "NuRenaissance Surveys" — its own dedicated sheet
const SURVEY_SHEET_NAME = 'Certified_Lounge_Surveys';
const SUMMARY_SHEET_NAME = 'Certified_Lounge_Summary';
const SUBSCRIBERS_SHEET_NAME = 'Subscribers';
const RECAP_LOG_SHEET_NAME = 'Certified_Lounge_Recap_Log';
const SERVICE_SURVEY_SHEET_NAME = 'NuRenaissance_Service_Surveys';
const SERVICE_SUBSCRIBERS_SHEET_NAME = 'Service_Subscribers'; // deliberately separate from Subscribers — see setup notes
const DISCOUNT_CODES_SHEET_NAME = 'Discount_Codes';
const NOTIFY_EMAIL = 'nurrenaissance@gmail.com';

const YOUTUBE_CHANNEL_ID = 'UCy-wvitXVh2is_RHwQBBRjQ'; // @nrnszn
// Optional but recommended — see the YouTube Data API setup notes near the top of this file
// for how to get one. With a key, the recap check asks YouTube directly for the latest
// COMPLETED livestream on the channel (so a shorts/trailer/promo upload never gets mistaken
// for a recap). Without it, the recap system falls back to its old behavior — trusting
// whatever the RSS feed says is newest, live or not, and unable to tell a livestream apart
// from any other upload.
const YOUTUBE_API_KEY = 'PASTE_YOUR_KEY_HERE'; // backup copy: the live script has the real key
const SHOP_URL = 'https://www.nrnszn.com/shop';
// An actual product photo from the shop (the RC Slides) — reused as a clickable banner in
// the recap + service thank-you emails so the shop plug is an actual image, not just a text
// link. (An earlier version of this used the shop page's background hero photo, which turned
// out to be a venue/stage shot, not merch — swapped for a real product image instead.) To
// swap in a different product later: open that product's page on nrnszn.com, right-click its
// photo > Copy Image Address, and paste the result in here.
const SHOP_BANNER_URL = 'https://static.wixstatic.com/media/355bb7_4dfc63c136b24d95ad49376494971eb3~mv2.jpg/v1/fill/w_2000,h_2000,al_c,q_90,enc_avif,quality_auto/355bb7_4dfc63c136b24d95ad49376494971eb3~mv2.jpg';
const SERVICE_DISCOUNT_PERCENT = 10; // % off, one-time, sent via the service-survey thank-you email
const RECAP_SHOW_WINDOW_DAYS = 4; // how many days back to look for the matching show's survey responses
const MIN_SUBMIT_MS = 1500; // a real person can't rate + tap through step 1 faster than this — bots that skip straight to POST get quietly dropped
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_PER_MINUTE = 60; // circuit breaker against a scripted submission flood — well above any real traffic this widget will ever see

// Required in the footer of any commercial/bulk email (like the recap newsletter) under
// CAN-SPAM. Update this if the studio ever moves.
const MAILING_ADDRESS = '14919 Lebanon Rd, Old Hickory, TN 37138';

// Random secret baked in so unsubscribe links can't be forged (someone can't type in a
// stranger's email and unsubscribe them without the matching token). It's fine as-is —
// no need to ever touch this — but if you do regenerate it, links already sent out will
// read as "invalid" (harmless; the person just emails you instead).
const UNSUB_SECRET = 'CHANGE-ME-backup-copy-the-live-script-has-the-real-value';

const SURVEY_HEADERS = [
  'Timestamp', 'Show', 'Rating', 'Feedback', 'Note',
  'Attendee_Type', 'Source', 'Favorite_Performer', 'Bring_Friend',
  'Name', 'Email', 'Subscribed'
];
const SUBSCRIBERS_HEADERS = ['Timestamp', 'Name', 'Email', 'Status', 'Unsubscribed Date'];
const SERVICE_SURVEY_HEADERS = [
  'Timestamp', 'Service', 'Rating', 'Feedback', 'Note',
  'Hire_Again', 'Testimonial_OK', 'Source',
  'Name', 'Email', 'Subscribed'
];
const DISCOUNT_CODES_HEADERS = ['Email', 'Name', 'Code', 'Issued_Date', 'Status', 'Redeemed_Date'];

function doGet(e) {
  if (e && e.parameter && e.parameter.unsub === '1') {
    return handleUnsubscribeRequest(e);
  }
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('NuRenaissance — Feedback Survey')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ error: 'No data received by the server — check the request is sending a body.' });
    }
    const body = JSON.parse(e.postData.contents);

    // Honeypot — a hidden field real users never fill in. If it's filled, silently drop.
    if (body.website) return jsonOut({ ok: true });

    // Time trap — the widget records when it loaded and sends that back. A real
    // person can't rate + tap through step 1 in under ~1.5s; a script hitting
    // this endpoint directly with no `loadedAt` (or one that's suspiciously
    // recent) gets quietly dropped the same way the honeypot does.
    const loadedAt = Number(body.loadedAt);
    if (!loadedAt || (Date.now() - loadedAt) < MIN_SUBMIT_MS) return jsonOut({ ok: true });

    // Global rate limit — a shared per-minute counter in the script cache. If something
    // (a misconfigured script, a scraper) starts hammering this endpoint, submissions
    // past the cap are quietly dropped instead of piling up in the sheet or spamming
    // your inbox with notification emails. Way above any real traffic this widget sees.
    if (isRateLimited()) return jsonOut({ ok: true });

    // Rating must be a real 1–5 integer — clamp anything else to blank rather
    // than trust the client, since this feeds directly into the summary stats.
    let rating = parseInt(body.rating, 10);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) rating = '';

    // Only store an email that actually looks like one, and never mark someone
    // subscribed off the back of a malformed address.
    let email = (body.email || '').toString().trim();
    let subscribed = !!body.subscribed;
    if (email && !EMAIL_RE.test(email)) { email = ''; subscribed = false; }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const kind = body._kind === 'service' ? 'service' : 'show';
    let subscribeResult = 'skipped';

    if (kind === 'service') {
      const surveySheet = getOrCreateServiceSurveySheet(ss);

      const row = [
        new Date(),
        (body.service || '').toString().trim().slice(0, 200),
        rating,
        (body.feedback || '').toString().trim().slice(0, 2000),
        (body.note || '').toString().trim().slice(0, 2000),
        (body.hireAgain || '').toString().trim().slice(0, 100),
        body.testimonialOk ? 'Yes' : 'No',
        (body.source || '').toString().trim().slice(0, 100),
        (body.name || '').toString().trim().slice(0, 100),
        email,
        subscribed ? 'Yes' : 'No'
      ];

      const targetRow = surveySheet.getLastRow() + 1;
      surveySheet.getRange(targetRow, 1, 1, row.length).setNumberFormat('@');
      surveySheet.getRange(targetRow, 1).setNumberFormat('yyyy-MM-dd HH:mm:ss');
      surveySheet.getRange(targetRow, 1, 1, row.length).setValues([row]);

      if (subscribed && email) {
        subscribeResult = upsertServiceSubscriber(ss, email);

        // Thank-you + one-time discount, sent right here rather than batched — there's no
        // "wait for a video" step on this side the way the show recap has. Wrapped so a
        // hiccup here (mail quota, etc.) never loses the survey response itself, which is
        // already safely written above.
        try {
          const name = (body.name || '').toString().trim();
          const codeInfo = issueDiscountCode(ss, email, name);
          sendServiceThankYouEmail(email, name, codeInfo.code, {
            alreadyRedeemed: codeInfo.alreadyRedeemed,
            redeemedDate: codeInfo.redeemedDate
          });
        } catch (thankYouErr) {
          Logger.log('Service thank-you/discount email FAILED (submission still saved): ' + thankYouErr.toString());
        }
      }

      notifyServiceSubmission(row, subscribeResult);
    } else {
      const surveySheet = getOrCreateSurveySheet(ss);

      const row = [
        new Date(),
        (body.show || '').toString().trim().slice(0, 200),
        rating,
        (body.feedback || '').toString().trim().slice(0, 2000),
        (body.note || '').toString().trim().slice(0, 2000),
        (body.attendeeType || '').toString().trim().slice(0, 100),
        (body.source || '').toString().trim().slice(0, 100),
        (body.favoritePerformer || '').toString().trim().slice(0, 200),
        (body.bringFriend || '').toString().trim().slice(0, 100),
        (body.name || '').toString().trim().slice(0, 100),
        email,
        subscribed ? 'Yes' : 'No'
      ];

      const targetRow = surveySheet.getLastRow() + 1;
      // Force plain-text formatting so Sheets doesn't silently mangle values.
      surveySheet.getRange(targetRow, 1, 1, row.length).setNumberFormat('@');
      surveySheet.getRange(targetRow, 1).setNumberFormat('yyyy-MM-dd HH:mm:ss'); // Timestamp column stays a real date
      surveySheet.getRange(targetRow, 1, 1, row.length).setValues([row]);

      if (subscribed && email) {
        subscribeResult = upsertSubscriber(ss, email);
      }

      notifySubmission(row, subscribeResult);

      try {
        refreshSummary(ss);
      } catch (summaryErr) {
        Logger.log('Summary refresh FAILED (submission still saved): ' + summaryErr.toString());
      }
    }

    return jsonOut({ ok: true, subscribeResult: subscribeResult });
  } catch (err) {
    // Log the real error for you to see in the Apps Script executions log, but don't
    // hand it back to the submitter verbatim — a raw exception can mention internal
    // details (sheet/service names, stack info) that have no business being shown to
    // whoever's filling out a survey on their phone.
    Logger.log('doPost FAILED: ' + err.toString());
    return jsonOut({ error: 'unexpected server error' });
  }
}

/**
 * Simple global per-minute submission counter using the script cache (shared across all
 * executions of this project, survives ~this many minutes). Returns true once the current
 * minute's count is at/over RATE_LIMIT_PER_MINUTE. Fails open (never blocks) if the cache
 * service has a hiccup — a rate limiter should never be the reason a real submission is lost.
 */
function isRateLimited() {
  try {
    const cache = CacheService.getScriptCache();
    const bucket = 'submits_' + Math.floor(Date.now() / 60000); // one bucket per minute
    const current = Number(cache.get(bucket)) || 0;
    if (current >= RATE_LIMIT_PER_MINUTE) return true;
    cache.put(bucket, String(current + 1), 90); // 90s > 1 minute so a bucket never expires mid-use
    return false;
  } catch (e) {
    Logger.log('Rate limit check failed (allowing submission through): ' + e.toString());
    return false;
  }
}

function getOrCreateSurveySheet(ss) {
  let sheet = ss.getSheetByName(SURVEY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SURVEY_SHEET_NAME);
    sheet.getRange(1, 1, 1, SURVEY_HEADERS.length).setValues([SURVEY_HEADERS]);
    sheet.getRange(1, 1, 1, SURVEY_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreateServiceSurveySheet(ss) {
  let sheet = ss.getSheetByName(SERVICE_SURVEY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SERVICE_SURVEY_SHEET_NAME);
    sheet.getRange(1, 1, 1, SERVICE_SURVEY_HEADERS.length).setValues([SERVICE_SURVEY_HEADERS]);
    sheet.getRange(1, 1, 1, SERVICE_SURVEY_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);

    // Highlight rows OK'd for use as a testimonial (the Testimonial_OK column) so they're
    // easy to spot at a glance when you're pulling quotes for the site or a pitch deck.
    // Both the highlighted column and the range's own last column are derived from
    // SERVICE_SURVEY_HEADERS.length rather than a hardcoded letter, so this keeps working
    // correctly if a column is ever added or reordered.
    const testimonialColLetter = String.fromCharCode('A'.charCodeAt(0) + SERVICE_SURVEY_HEADERS.indexOf('Testimonial_OK'));
    const lastColLetter = String.fromCharCode('A'.charCodeAt(0) + SERVICE_SURVEY_HEADERS.length - 1);
    // The formula's cell references are relative to the TOP-LEFT cell of the range it's
    // applied to (A2:<lastCol>1000 below) — so this must reference row 2, not row 1, or
    // every row's highlight would check the row above it instead of itself.
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + testimonialColLetter + '2="Yes"')
      .setBackground('#FCF0CE') // soft gold, matches the widget's accent color
      .setRanges([sheet.getRange('A2:' + lastColLetter + '1000')])
      .build();
    sheet.setConditionalFormatRules([rule]);
  }
  return sheet;
}

/** Creates a Subscribers-shaped tab (Timestamp/Name/Email/Status/Unsubscribed Date) by name if it doesn't exist yet. */
function getOrCreateNamedSubscribersSheet(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, SUBSCRIBERS_HEADERS.length).setValues([SUBSCRIBERS_HEADERS]);
    sheet.getRange(1, 1, 1, SUBSCRIBERS_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreateSubscribersSheet(ss) {
  return getOrCreateNamedSubscribersSheet(ss, SUBSCRIBERS_SHEET_NAME);
}

function getOrCreateServiceSubscribersSheet(ss) {
  return getOrCreateNamedSubscribersSheet(ss, SERVICE_SUBSCRIBERS_SHEET_NAME);
}

/**
 * Adds `email` to the named Subscribers-shaped tab if it's not already there
 * (case-insensitive match), or reactivates it if it was unsubscribed.
 * Leaves an already-active subscriber untouched. Creates the tab on first
 * use if it doesn't exist yet.
 * Returns one of: 'added' | 'reactivated' | 'already-subscribed' | 'no-email-column'
 */
function upsertToSubscriberSheet(ss, email, sheetName) {
  const sheet = getOrCreateNamedSubscribersSheet(ss, sheetName);

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().trim());
  const emailIdx = headers.findIndex(h => h.toLowerCase() === 'email');
  const statusIdx = headers.findIndex(h => h.toLowerCase() === 'status');
  const unsubIdx = headers.findIndex(h => h.toLowerCase() === 'unsubscribed date');
  if (emailIdx === -1) return 'no-email-column';

  const normalized = email.toLowerCase();
  for (let r = 1; r < data.length; r++) {
    const rowEmail = (data[r][emailIdx] || '').toString().trim().toLowerCase();
    if (rowEmail === normalized) {
      const status = statusIdx > -1 ? (data[r][statusIdx] || '').toString().trim().toLowerCase() : '';
      if (status === 'unsubscribed' || status === '') {
        if (statusIdx > -1) sheet.getRange(r + 1, statusIdx + 1).setValue('Active');
        if (unsubIdx > -1) sheet.getRange(r + 1, unsubIdx + 1).setValue('');
        return 'reactivated';
      }
      return 'already-subscribed';
    }
  }

  // Not found — append as a new subscriber.
  const newRow = headers.map(h => {
    const key = h.toLowerCase();
    if (key === 'email') return email;
    if (key === 'timestamp') return new Date();
    if (key === 'status') return 'Active';
    return '';
  });
  const newRowNum = sheet.getLastRow() + 1;
  // Force the row to Plain Text formatting BEFORE setValues — the email column here is
  // attacker-controllable (EMAIL_RE only checks for an @ and a dot, so something shaped like
  // =HYPERLINK(...)@x.co still passes as a valid email) and setValues() otherwise lets Sheets
  // parse a leading =/+/-/@ as a real formula, same as typing it into the UI. Same technique
  // already used on the survey response sheets in doPost. Timestamp is set back to a date
  // format right after, same as those sheets do.
  sheet.getRange(newRowNum, 1, 1, newRow.length).setNumberFormat('@');
  const tsCol = headers.findIndex(h => h.toLowerCase() === 'timestamp');
  if (tsCol > -1) sheet.getRange(newRowNum, tsCol + 1).setNumberFormat('yyyy-MM-dd HH:mm:ss');
  sheet.getRange(newRowNum, 1, 1, newRow.length).setValues([newRow]);
  return 'added';
}

function upsertSubscriber(ss, email) {
  return upsertToSubscriberSheet(ss, email, SUBSCRIBERS_SHEET_NAME);
}

function upsertServiceSubscriber(ss, email) {
  return upsertToSubscriberSheet(ss, email, SERVICE_SUBSCRIBERS_SHEET_NAME);
}

function getOrCreateDiscountCodesSheet(ss) {
  let sheet = ss.getSheetByName(DISCOUNT_CODES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DISCOUNT_CODES_SHEET_NAME);
    sheet.getRange(1, 1, 1, DISCOUNT_CODES_HEADERS.length).setValues([DISCOUNT_CODES_HEADERS]);
    sheet.getRange(1, 1, 1, DISCOUNT_CODES_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Looks up this email's one-time discount code, or issues a fresh one if they've never had
 * one. Always returns the SAME code for a given email once it exists — resubmitting the
 * service survey and re-subscribing later never issues a second one, so there's no way to
 * end up with more than one code per person.
 *
 * Also reports back whether that code has already been marked "Redeemed" (by hand, in the
 * Status column — see the setup notes at the top of this file), so a repeat submitter who's
 * already used their discount gets told that honestly instead of being shown the exact same
 * "here's your one-time code" email a second time as if it were still unclaimed.
 *
 * Returns { code, alreadyRedeemed, redeemedDate }.
 */
function issueDiscountCode(ss, email, name) {
  const sheet = getOrCreateDiscountCodesSheet(ss);
  const data = sheet.getDataRange().getValues();
  const normalized = email.toLowerCase();
  for (let r = 1; r < data.length; r++) {
    const rowEmail = (data[r][0] || '').toString().trim().toLowerCase();
    if (rowEmail === normalized) {
      const status = (data[r][4] || '').toString().trim().toLowerCase();
      return { code: data[r][2], alreadyRedeemed: status === 'redeemed', redeemedDate: data[r][5] || null };
    }
  }
  const code = generateDiscountCode();
  const newRowNum = sheet.getLastRow() + 1;
  // Same Plain Text protection as the survey sheets and the subscriber sheets — both Email
  // and Name here are free-typed survey input, so without this a value like a "name" of
  // =IMPORTXML(...) would get stored as a live formula instead of literal text.
  sheet.getRange(newRowNum, 1, 1, DISCOUNT_CODES_HEADERS.length).setNumberFormat('@');
  sheet.getRange(newRowNum, 4).setNumberFormat('yyyy-MM-dd HH:mm:ss'); // Issued_Date stays a real date
  sheet.getRange(newRowNum, 1, 1, DISCOUNT_CODES_HEADERS.length)
    .setValues([[email, name || '', code, new Date(), 'Unused', '']]);
  return { code: code, alreadyRedeemed: false, redeemedDate: null };
}

/**
 * Plain "Mon D, YYYY" formatting for showing a redeemed date in an email. Never throws, and
 * never returns the literal text "Invalid Date" either — if Redeemed_Date was left blank or
 * has something unparseable typed into it by hand, this quietly returns '' so the email just
 * omits the date clause instead of showing a broken-looking date to whoever receives it.
 */
function formatShortDate(date) {
  if (!date) return ''; // null/undefined/'' would otherwise become "Jan 1, 1970" — never what's meant
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) {
    return '';
  }
}

/** Short, readable, hard-to-guess code — e.g. NR10-4F91A2C7. */
function generateDiscountCode() {
  const raw = Utilities.getUuid().replace(/-/g, '').toUpperCase();
  return 'NR' + SERVICE_DISCOUNT_PERCENT + '-' + raw.slice(0, 8);
}

/**
 * Sent immediately from doPost the moment someone subscribes via the service survey —
 * thanks them for the feedback and hands them their one-time discount code. `code` is
 * always whatever issueDiscountCode returned, so a repeat sender just sees their same code
 * again rather than a new one.
 */
function sendServiceThankYouEmail(email, name, code, opts) {
  opts = opts || {};
  const alreadyRedeemed = !!opts.alreadyRedeemed;
  const safeName = escapeHtml(name);
  const greeting = safeName ? ('Hey ' + safeName + ',') : 'Hey,';
  const subject = (opts.preview ? '[PREVIEW] ' : '') +
    (alreadyRedeemed ? 'Thanks for the feedback!' : ('Thanks for the feedback — here\'s ' + SERVICE_DISCOUNT_PERCENT + '% off your next job'));
  const unsubUrl = buildUnsubscribeUrl(email, 'service');

  // Someone who's already redeemed their one-time code and submits again (a second job, a
  // repeat "thanks for the survey" moment) gets told that honestly instead of being shown
  // their old code again dressed up as a fresh, still-claimable offer.
  const redeemedDateStr = opts.redeemedDate ? formatShortDate(opts.redeemedDate) : '';
  const offerHtml = alreadyRedeemed
    ? ('<p style="margin:0 0 22px; color:#A69FC0;">Looks like you\'ve already used your one-time ' + SERVICE_DISCOUNT_PERCENT + '% off' +
        (redeemedDateStr ? (' (redeemed ' + redeemedDateStr + ')') : '') +
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
    bodyHtml: bodyHtml,
    footerNote: 'You\'re getting this because you opted in after telling us about a NuRenaissance job. — NuRenaissance Media',
    unsubUrl: unsubUrl,
    previewBanner: opts.preview ? previewBannerHtml() : ''
  });

  MailApp.sendEmail({ to: email, subject: subject, htmlBody: html });
}

/**
 * Sends yourself a preview of the service-survey thank-you + discount email with a sample
 * code, so you can see it without submitting a real survey. Run from the function dropdown.
 */
function previewServiceThankYouEmail() {
  sendServiceThankYouEmail(NOTIFY_EMAIL, 'Jordan', 'NR' + SERVICE_DISCOUNT_PERCENT + '-PREV1234', { preview: true });
  Logger.log('Preview service thank-you email sent to ' + NOTIFY_EMAIL);
}

/**
 * Sends yourself a preview of the OTHER version of this email — what a repeat submitter
 * sees when they've already redeemed their one-time code. Run from the function dropdown.
 */
function previewServiceThankYouEmailAlreadyRedeemed() {
  sendServiceThankYouEmail(NOTIFY_EMAIL, 'Jordan', 'NR' + SERVICE_DISCOUNT_PERCENT + '-PREV1234', {
    preview: true,
    alreadyRedeemed: true,
    redeemedDate: new Date()
  });
  Logger.log('Preview (already-redeemed) service thank-you email sent to ' + NOTIFY_EMAIL);
}

/**
 * Rebuilds the Certified_Lounge_Summary tab from scratch off the current
 * Certified_Lounge_Surveys data: an all-shows total row, then one row per
 * show (most recently active first).
 */
function refreshSummary(ss) {
  const surveySheet = ss.getSheetByName(SURVEY_SHEET_NAME);
  if (!surveySheet) return;

  const data = surveySheet.getDataRange().getValues();
  if (data.length < 2) return;

  const headers = data[0].map(h => h.toString().trim());
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });
  const rows = data.slice(1);

  function blankStat() {
    return { count: 0, ratingSum: 0, ratingCount: 0, firstTime: 0, returning: 0, friendYes: 0, friendCounted: 0, sources: {}, lastTs: null };
  }

  const byShow = {};
  const total = blankStat();

  rows.forEach(r => {
    const show = (r[idx['Show']] || '').toString().trim() || '(unspecified)';
    const rating = Number(r[idx['Rating']]) || 0;
    const attendeeType = (r[idx['Attendee_Type']] || '').toString().trim();
    const bringFriend = (r[idx['Bring_Friend']] || '').toString().trim();
    const source = (r[idx['Source']] || '').toString().trim();
    const ts = r[idx['Timestamp']];

    if (!byShow[show]) byShow[show] = blankStat();
    [byShow[show], total].forEach(s => {
      s.count++;
      if (rating) { s.ratingSum += rating; s.ratingCount++; }
      if (attendeeType === 'First-time') s.firstTime++;
      if (attendeeType === 'Returning') s.returning++;
      if (bringFriend) {
        s.friendCounted++;
        if (bringFriend === 'Yes') s.friendYes++;
      }
      if (source) s.sources[source] = (s.sources[source] || 0) + 1;
      if (ts && (!s.lastTs || ts > s.lastTs)) s.lastTs = ts;
    });
  });

  function topSource(sources) {
    let best = '', bestN = 0;
    Object.keys(sources).forEach(k => { if (sources[k] > bestN) { best = k; bestN = sources[k]; } });
    return best || '—';
  }
  function pct(n, d) { return d ? Math.round((n / d) * 100) + '%' : '—'; }
  function avg(sum, count) { return count ? (sum / count).toFixed(2) : '—'; }
  function statRow(label, s) {
    return [
      label, s.count, avg(s.ratingSum, s.ratingCount),
      pct(s.firstTime, s.firstTime + s.returning), pct(s.returning, s.firstTime + s.returning),
      pct(s.friendYes, s.friendCounted), topSource(s.sources), s.lastTs || ''
    ];
  }

  let summarySheet = ss.getSheetByName(SUMMARY_SHEET_NAME);
  if (!summarySheet) summarySheet = ss.insertSheet(SUMMARY_SHEET_NAME);
  summarySheet.clear();

  const headerRow = ['Show', 'Responses', 'Avg Rating', 'First-Time %', 'Returning %', 'Would Bring a Friend %', 'Top Source', 'Last Response'];
  const out = [];
  out.push(statRow('🎯 ALL SHOWS (TOTAL)', total));
  out.push(new Array(headerRow.length).fill(''));
  out.push(headerRow);

  const showNames = Object.keys(byShow).sort((a, b) => {
    const ta = byShow[a].lastTs ? byShow[a].lastTs.getTime() : 0;
    const tb = byShow[b].lastTs ? byShow[b].lastTs.getTime() : 0;
    return tb - ta;
  });
  showNames.forEach(show => out.push(statRow(show, byShow[show])));

  summarySheet.getRange(1, 1, out.length, headerRow.length).setValues(out);
  summarySheet.getRange(1, 1, 1, headerRow.length).setFontWeight('bold');
  summarySheet.getRange(3, 1, 1, headerRow.length).setFontWeight('bold').setBackground('#f0f0f0');
  summarySheet.setFrozenRows(3);
  summarySheet.autoResizeColumns(1, headerRow.length);
}

function notifySubmission(row, subscribeResult) {
  if (!NOTIFY_EMAIL) return;
  try {
    const ts = row[0], show = row[1], rating = row[2], feedback = row[3], note = row[4],
      attendeeType = row[5], source = row[6], favoritePerformer = row[7], bringFriend = row[8],
      name = row[9], email = row[10], subscribedFlag = row[11];

    const subject = 'New Certified Lounge survey response' + (show ? ' — ' + stripForSubject(show) : '');
    const lines = [
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
      'Subscribed: ' + subscribedFlag + (subscribedFlag === 'Yes' ? ' (' + subscribeResult + ')' : '')
    ];
    MailApp.sendEmail(NOTIFY_EMAIL, subject, lines.join('\n'));
  } catch (e) {
    Logger.log('Notify failed: ' + e.toString());
  }
}

function notifyServiceSubmission(row, subscribeResult) {
  if (!NOTIFY_EMAIL) return;
  try {
    const ts = row[0], service = row[1], rating = row[2], feedback = row[3], note = row[4],
      hireAgain = row[5], testimonialOk = row[6], source = row[7],
      name = row[8], email = row[9], subscribedFlag = row[10];

    const subject = 'New NuRenaissance service survey response' + (service ? ' — ' + stripForSubject(service) : '');
    const lines = [
      'Service: ' + (service || '(not specified)'),
      'Rating: ' + (rating || '(none)') + ' / 5',
      'Feedback: ' + (feedback || '(none)'),
      'Anything else: ' + (note || '(none)'),
      'Would hire again: ' + (hireAgain || '(not answered)'),
      'OK to use as testimonial: ' + testimonialOk,
      'Heard about NuRenaissance via: ' + (source || '(not answered)'),
      'Name: ' + (name || '(none)'),
      'Email: ' + (email || '(none)'),
      'Subscribed: ' + subscribedFlag + (subscribedFlag === 'Yes' ? ' (' + subscribeResult + ')' : '')
    ];
    MailApp.sendEmail(NOTIFY_EMAIL, subject, lines.join('\n'));
  } catch (e) {
    Logger.log('Notify (service) failed: ' + e.toString());
  }
}

/**
 * Run ONCE from the Apps Script editor's function dropdown to pre-build every tab
 * this script needs (Show Surveys, Subscribers, Summary, Recap Log, Service
 * Surveys, Service Subscribers, Discount Codes) right away — so you can see the
 * real sheet structure immediately instead of waiting for a live submission to
 * trigger auto-creation. Safe to re-run any time; never touches existing data.
 */
function initializeCertifiedLoungeSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const report = [];

  const wasNewSurvey = !ss.getSheetByName(SURVEY_SHEET_NAME);
  getOrCreateSurveySheet(ss);
  report.push((wasNewSurvey ? 'Created' : 'Already existed') + ': ' + SURVEY_SHEET_NAME);

  const wasNewServiceSurvey = !ss.getSheetByName(SERVICE_SURVEY_SHEET_NAME);
  getOrCreateServiceSurveySheet(ss);
  report.push((wasNewServiceSurvey ? 'Created' : 'Already existed') + ': ' + SERVICE_SURVEY_SHEET_NAME);

  const wasNewServiceSubs = !ss.getSheetByName(SERVICE_SUBSCRIBERS_SHEET_NAME);
  getOrCreateServiceSubscribersSheet(ss);
  report.push((wasNewServiceSubs ? 'Created' : 'Already existed') + ': ' + SERVICE_SUBSCRIBERS_SHEET_NAME);

  const wasNewDiscounts = !ss.getSheetByName(DISCOUNT_CODES_SHEET_NAME);
  getOrCreateDiscountCodesSheet(ss);
  report.push((wasNewDiscounts ? 'Created' : 'Already existed') + ': ' + DISCOUNT_CODES_SHEET_NAME);

  const wasNewSubs = !ss.getSheetByName(SUBSCRIBERS_SHEET_NAME);
  getOrCreateSubscribersSheet(ss);
  report.push((wasNewSubs ? 'Created' : 'Already existed') + ': ' + SUBSCRIBERS_SHEET_NAME);

  const wasNewLog = !ss.getSheetByName(RECAP_LOG_SHEET_NAME);
  getOrCreateRecapLogSheet(ss);
  report.push((wasNewLog ? 'Created' : 'Already existed') + ': ' + RECAP_LOG_SHEET_NAME);

  // Summary: just lay down the header row now — it fully rebuilds itself off real
  // data after the first submission, so there's nothing to fake here.
  let summarySheet = ss.getSheetByName(SUMMARY_SHEET_NAME);
  const wasNewSummary = !summarySheet;
  if (!summarySheet) summarySheet = ss.insertSheet(SUMMARY_SHEET_NAME);
  if (summarySheet.getLastRow() === 0) {
    const headerRow = ['Show', 'Responses', 'Avg Rating', 'First-Time %', 'Returning %', 'Would Bring a Friend %', 'Top Source', 'Last Response'];
    summarySheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
    summarySheet.getRange(1, 1, 1, headerRow.length).setFontWeight('bold');
    summarySheet.setFrozenRows(1);
    summarySheet.autoResizeColumns(1, headerRow.length);
  }
  report.push((wasNewSummary ? 'Created' : 'Already existed') + ': ' + SUMMARY_SHEET_NAME + ' (fills in fully after the first real submission)');

  const message = report.join('\n');
  Logger.log(message);
  try { MailApp.sendEmail(NOTIFY_EMAIL, 'NuRenaissance Surveys — sheet setup complete', message); } catch (e) {}
  return message;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =================================================================
 * RECAP NEWSLETTER — run setUpDailyRecapTrigger() once (see the setup
 * notes at the top of this file), everything below runs on its own.
 * ================================================================= */

/** Run ONCE from the Apps Script editor's function dropdown. Safe to re-run. */
function setUpDailyRecapTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkForRecapVideo') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkForRecapVideo').timeBased().everyDays(1).atHour(10).create();
  Logger.log('Daily recap check scheduled for ~10am.');
}

/** Run manually any time you want to force a check right away. */
function sendRecapNow() {
  checkForRecapVideo();
}

function checkForRecapVideo() {
  try {
    const latest = getLatestReadyRecapVideo();
    if (!latest) return; // nothing ready to send yet — see getLatestReadyRecapVideo for why

    const props = PropertiesService.getScriptProperties();
    const lastSeenId = props.getProperty('LAST_RECAP_VIDEO_ID');
    if (latest.videoId === lastSeenId) return; // nothing new since last check

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const show = findShowForVideo(ss, latest.published);

    if (!show) {
      notifyRecapNeedsAttention(latest, 'Couldn\'t match this video to a specific show (no survey responses in the ' + RECAP_SHOW_WINDOW_DAYS + ' days before it went up). Send the recap manually this time.');
      props.setProperty('LAST_RECAP_VIDEO_ID', latest.videoId);
      return;
    }

    const recipients = getUnsentSubscribersForShow(ss, show);
    if (!recipients.length) {
      props.setProperty('LAST_RECAP_VIDEO_ID', latest.videoId);
      return; // matched a show, but no one new to send to
    }

    const logSheet = getOrCreateRecapLogSheet(ss);

    // Gmail/Apps Script caps how many emails this account can send per day. A big
    // recap blast could theoretically bump into that as the list grows, so this
    // checks remaining quota before every send rather than firing blind and having
    // some emails silently fail partway through.
    let sentCount = 0;
    let quotaRanOut = false;
    for (let i = 0; i < recipients.length; i++) {
      if (MailApp.getRemainingDailyQuota() < 1) { quotaRanOut = true; break; }
      const r = recipients[i];
      sendRecapEmail(r.email, r.name, show, latest.url);
      logSheet.appendRow([r.email, show, new Date(), latest.url]);
      sentCount++;
    }

    if (quotaRanOut) {
      const remaining = recipients.length - sentCount;
      notifyRecapNeedsAttention(latest, 'Sent ' + sentCount + ' of ' + recipients.length + ' recap emails for ' + show +
        ' before hitting today\'s email sending limit. The remaining ' + remaining + ' will go out automatically on ' +
        'tomorrow\'s daily check (nobody gets double-emailed — already-sent ones are skipped) — no action needed unless ' +
        'you want it sooner, in which case run "sendRecapNow" after the quota resets.');
      // Deliberately NOT marking this video as fully processed — leaving
      // LAST_RECAP_VIDEO_ID unset means tomorrow's check picks this same video back
      // up and finishes the remaining recipients instead of skipping it as "already done."
    } else {
      props.setProperty('LAST_RECAP_VIDEO_ID', latest.videoId);
      notifyRecapSent(show, latest.url, sentCount);
    }
  } catch (err) {
    Logger.log('checkForRecapVideo FAILED: ' + err.toString());
    try { MailApp.sendEmail(NOTIFY_EMAIL, 'Certified Lounge recap check failed', err.toString()); } catch (e2) {}
  }
}

function hasYoutubeApiKey() {
  return !!YOUTUBE_API_KEY && YOUTUBE_API_KEY.indexOf('PASTE_YOUR') !== 0;
}

/**
 * Finds the latest video that's actually ready to be sent as a recap.
 *
 * With YOUTUBE_API_KEY configured: asks YouTube directly for the latest COMPLETED
 * livestream on the channel. This is the accurate path — it can't be fooled by a
 * shorts/trailer/promo upload posted around the same time as a show, and "completed" means
 * it's already confirmed done (not scheduled, not still airing). Returns null when there's
 * no completed livestream to find yet.
 *
 * Without a key (or if that lookup errors — e.g. a transient API hiccup): falls back to the
 * original approach — latest upload from the channel's RSS feed, filtered only by
 * isVideoReady() (not still live/scheduled). This can't tell a livestream apart from any
 * other upload, so it's the same behavior the recap system always had — no worse than
 * before, just without the extra accuracy a key provides.
 */
function getLatestReadyRecapVideo() {
  if (hasYoutubeApiKey()) {
    try {
      const viaApi = getLatestCompletedLivestreamViaApi();
      if (viaApi) return viaApi;
      Logger.log('No completed livestream found via YouTube Data API yet.');
      return null; // clean "nothing yet" — don't fall back to the less-accurate RSS path
    } catch (e) {
      Logger.log('YouTube Data API livestream lookup failed, falling back to RSS feed: ' + e.toString());
    }
  }
  const latest = getLatestYouTubeVideo();
  if (!latest) return null;
  if (!isVideoReady(latest.videoId)) {
    // Still scheduled or actively live — deliberately not treated as ready, so the next
    // daily check re-evaluates this same video and picks it up automatically once it's
    // actually done, instead of emailing subscribers a link to something that isn't
    // watchable yet (or skipping it because it looked "already handled").
    Logger.log('Latest video (' + latest.videoId + ') is still scheduled or live — waiting for it to finish.');
    return null;
  }
  return latest;
}

/**
 * Asks the YouTube Data API for the most recent COMPLETED livestream on the channel —
 * eventType=completed means YouTube itself has confirmed it was a livestream AND that it has
 * actually ended, so this single call replaces both "find the latest upload" and "check it's
 * actually done" with one authoritative answer. Uses more of the free daily quota per check
 * than a simple lookup (search.list is a heavier endpoint), but still a tiny fraction of the
 * daily allowance at one check a day.
 *
 * Note: YouTube's search index can lag a bit behind a stream actually ending (sometimes by a
 * few hours), so this may not see a just-finished stream as "completed" the instant it ends —
 * fine for a once-a-day check, since the next day's run picks it up.
 */
function getLatestCompletedLivestreamViaApi() {
  const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=' +
    encodeURIComponent(YOUTUBE_CHANNEL_ID) + '&eventType=completed&type=video&order=date&maxResults=1&key=' +
    encodeURIComponent(YOUTUBE_API_KEY);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());
  if (data.error) throw new Error('YouTube Data API error: ' + JSON.stringify(data.error));
  if (!data.items || !data.items.length || !data.items[0].id || !data.items[0].id.videoId) return null;
  const item = data.items[0];
  const videoId = item.id.videoId;
  const published = new Date(item.snippet.publishedAt);
  return { videoId: videoId, url: 'https://www.youtube.com/watch?v=' + videoId, published: published };
}

/**
 * One-click way to confirm the YouTube Data API key actually works, without waiting for a
 * real show or the daily trigger. Pick "testYoutubeSetup" from the function dropdown and
 * click Run, then check the log (View > Logs, or View > Executions > this run > Log) for
 * the result. Safe to run as many times as you want — it doesn't send anything or change
 * any data, just reports what it finds.
 */
function testYoutubeSetup() {
  Logger.log('--- YouTube API key check ---');
  if (!hasYoutubeApiKey()) {
    Logger.log('No YOUTUBE_API_KEY set yet (still the placeholder text). Paste in a real key, ' +
      'save the project, then run this again.');
    return;
  }
  Logger.log('Key looks set. Asking YouTube for the latest COMPLETED livestream on the channel...');
  try {
    const result = getLatestCompletedLivestreamViaApi();
    if (!result) {
      Logger.log('The API call worked, but found no completed livestream right now — expected if ' +
        'nothing has aired recently, or the latest one is still scheduled/live. That\'s not a failure.');
    } else {
      Logger.log('SUCCESS — found a completed livestream: ' + result.url + ' (published ' + result.published + '). ' +
        'The key is working correctly.');
    }
  } catch (e) {
    Logger.log('FAILED — the API call itself errored: ' + e.toString() + '. Double-check the key was ' +
      'pasted in correctly (no extra spaces/quotes) and that "YouTube Data API v3" is enabled for ' +
      'that key\'s project in Cloud Console.');
  }
}

function getLatestYouTubeVideo() {
  const feedUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + YOUTUBE_CHANNEL_ID;
  const xml = UrlFetchApp.fetch(feedUrl).getContentText();
  const doc = XmlService.parse(xml);
  const root = doc.getRootElement();
  const atom = XmlService.getNamespace('http://www.w3.org/2005/Atom');
  const yt = XmlService.getNamespace('yt', 'http://www.youtube.com/xml/schemas/2015');
  const entries = root.getChildren('entry', atom);
  if (!entries.length) return null;
  const first = entries[0];
  const videoId = first.getChild('videoId', yt).getText();
  const published = new Date(first.getChild('published', atom).getText());
  return { videoId: videoId, url: 'https://www.youtube.com/watch?v=' + videoId, published: published };
}

/**
 * Checks whether a video is actually done streaming — not just scheduled, and not still
 * live — before the recap system treats it as ready to send. The RSS feed alone can't tell
 * the difference: a stream shows up there the moment it's scheduled, so without this check
 * a daily run that lands mid-stream could grab it and email subscribers a link to
 * something that isn't watchable yet.
 *
 * Only used in the fallback (no-API-key, or API-error) path — see getLatestReadyRecapVideo.
 * Needs YOUTUBE_API_KEY to actually check. Without one set, this can't ask YouTube
 * anything, so it just says "ready" — the same as the old behavior, no worse than before,
 * just without this extra safety net until a key is added.
 */
function isVideoReady(videoId) {
  if (!hasYoutubeApiKey()) return true;
  try {
    const url = 'https://www.googleapis.com/youtube/v3/videos?part=snippet&id=' +
      encodeURIComponent(videoId) + '&key=' + encodeURIComponent(YOUTUBE_API_KEY);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());
    if (!data.items || !data.items.length) return true; // couldn't look it up — don't block on it
    // liveBroadcastContent is 'live' while airing, 'upcoming' while scheduled, and 'none'
    // for both a plain upload and a stream that's actually finished — 'none' is the signal
    // that this video is safe to treat as the recap.
    return data.items[0].snippet.liveBroadcastContent === 'none';
  } catch (e) {
    Logger.log('isVideoReady check failed (treating video as ready): ' + e.toString());
    return true; // never let an API hiccup hold up a real recap
  }
}

/** Whichever Show value appears most in survey responses in the days right before the video went up. */
function findShowForVideo(ss, publishedDate) {
  const surveySheet = ss.getSheetByName(SURVEY_SHEET_NAME);
  if (!surveySheet) return null;
  const data = surveySheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0].map(h => h.toString().trim());
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });

  const windowStart = new Date(publishedDate.getTime() - RECAP_SHOW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const counts = {};
  data.slice(1).forEach(r => {
    const ts = r[idx['Timestamp']];
    const show = (r[idx['Show']] || '').toString().trim();
    if (!show || !(ts instanceof Date)) return;
    if (ts >= windowStart && ts <= publishedDate) {
      counts[show] = (counts[show] || 0) + 1;
    }
  });
  let best = null, bestN = 0;
  Object.keys(counts).forEach(k => { if (counts[k] > bestN) { best = k; bestN = counts[k]; } });
  return best;
}

/** Survey-subscribed emails for this show that haven't already gotten a recap, minus anyone who's since unsubscribed. */
function getUnsentSubscribersForShow(ss, show) {
  const surveySheet = ss.getSheetByName(SURVEY_SHEET_NAME);
  const data = surveySheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().trim());
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });

  const already = new Set();
  const logSheet = ss.getSheetByName(RECAP_LOG_SHEET_NAME);
  if (logSheet) {
    logSheet.getDataRange().getValues().slice(1).forEach(r => {
      already.add((r[0] || '').toString().trim().toLowerCase() + '|' + (r[1] || '').toString().trim().toLowerCase());
    });
  }

  const unsubscribed = getUnsubscribedEmailSet(ss);

  const seen = new Set();
  const recipients = [];
  data.slice(1).forEach(r => {
    const rowShow = (r[idx['Show']] || '').toString().trim();
    const subscribed = (r[idx['Subscribed']] || '').toString().trim().toLowerCase() === 'yes';
    const email = (r[idx['Email']] || '').toString().trim();
    if (rowShow !== show || !subscribed || !email) return;
    const emailLower = email.toLowerCase();
    if (unsubscribed.has(emailLower)) return;
    const key = emailLower + '|' + show.toLowerCase();
    if (already.has(key) || seen.has(key)) return;
    seen.add(key);
    recipients.push({ email: email, name: (r[idx['Name']] || '').toString().trim() });
  });
  return recipients;
}

function getUnsubscribedEmailSet(ss) {
  const set = new Set();
  const sheet = ss.getSheetByName(SUBSCRIBERS_SHEET_NAME);
  if (!sheet) return set;
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().trim());
  const emailIdx = headers.findIndex(h => h.toLowerCase() === 'email');
  const statusIdx = headers.findIndex(h => h.toLowerCase() === 'status');
  if (emailIdx === -1 || statusIdx === -1) return set;
  data.slice(1).forEach(r => {
    const status = (r[statusIdx] || '').toString().trim().toLowerCase();
    if (status === 'unsubscribed') set.add((r[emailIdx] || '').toString().trim().toLowerCase());
  });
  return set;
}

function getOrCreateRecapLogSheet(ss) {
  let sheet = ss.getSheetByName(RECAP_LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(RECAP_LOG_SHEET_NAME);
    sheet.getRange(1, 1, 1, 4).setValues([['Email', 'Show', 'Sent_At', 'Video_URL']]);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Strips line breaks (and other control characters) from user-supplied text before it's
 * used to build an email subject line. The show/service name is free-typed by whoever
 * fills out the survey, so without this, someone could type a "show name" containing a
 * newline and attempt to inject extra headers into an outgoing email.
 */
function stripForSubject(str) {
  return (str || '').toString().replace(/[\r\n\t]+/g, ' ').trim();
}

/** Escapes text pulled from a survey response before it goes into an HTML email body. */
function escapeHtml(str) {
  return (str || '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Clickable shop banner (the hero image from nrnszn.com/shop, linking to SHOP_URL) —
 * shared between the recap and service thank-you emails so there's one place to change it.
 * Sits alongside the existing text link rather than replacing it, since some inboxes block
 * images by default and the text link still works even when the image doesn't load.
 */
function shopBannerHtml() {
  return '<p style="margin:20px 0;"><a href="' + SHOP_URL + '"><img src="' + SHOP_BANNER_URL + '" ' +
    'alt="Shop NuRenaissance" width="440" style="width:100%;max-width:440px;height:auto;' +
    'border-radius:12px;display:block;margin:0 auto;border:0;" /></a></p>';
}

/**
 * Pulls the 11-character video ID out of a YouTube URL (watch?v= or youtu.be/ form — the
 * only two shapes this script ever generates) so a thumbnail image can be built for it.
 * Returns null on anything it doesn't recognize, so callers can just skip the thumbnail
 * instead of breaking the email over an unexpected URL shape.
 */
function extractYoutubeVideoId(url) {
  if (!url) return null;
  const watchMatch = url.match(/[?&]v=([0-9A-Za-z_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = url.match(/youtu\.be\/([0-9A-Za-z_-]{11})/);
  if (shortMatch) return shortMatch[1];
  return null;
}

/**
 * Clickable video thumbnail for the recap email — uses YouTube's own thumbnail CDN
 * (img.youtube.com/vi/<id>/hqdefault.jpg), which needs no API key and exists for every
 * public video, livestream VODs included. Returns '' (skips the thumbnail, not the email)
 * if the video ID can't be parsed out of the URL, so a weird URL never breaks the send.
 */
function recapThumbnailHtml(videoUrl) {
  const videoId = extractYoutubeVideoId(videoUrl);
  if (!videoId) return '';
  const thumbUrl = 'https://img.youtube.com/vi/' + encodeURIComponent(videoId) + '/hqdefault.jpg';
  return '<p style="margin:0 0 20px;"><a href="' + videoUrl + '"><img src="' + thumbUrl + '" ' +
    'alt="Watch the recap" width="440" style="width:100%;max-width:440px;height:auto;' +
    'border-radius:12px;display:block;margin:0 auto;border:0;" /></a></p>';
}

/** The little "PREVIEW — sample data" notice at the top of a preview send, styled to sit on the dark card. */
function previewBannerHtml() {
  return '<div style="background-color:rgba(232,179,61,0.14);border:1px solid #E8B33D;border-radius:8px;' +
    'padding:10px 14px;margin:0 0 20px;font-family:Helvetica,Arial,sans-serif;font-size:12px;' +
    'line-height:1.5;color:#E8B33D;">PREVIEW — sample data below, this isn\'t a real send.</div>';
}

/**
 * Wraps an email's body content in the same dark, gold-accented card look the widget uses —
 * eyebrow label, the content itself, a thin divider, then the footer note + address +
 * unsubscribe link. Built with tables (not just divs), since that's what actually holds up
 * across different email clients — Outlook especially. Every outgoing email goes through
 * this one function, so they all read as coming from the same place.
 *
 * opts: { eyebrow, bodyHtml, footerNote, unsubUrl, previewBanner }
 */
function emailShell(opts) {
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

function sendRecapEmail(email, name, show, videoUrl, opts) {
  opts = opts || {};
  const safeName = escapeHtml(name);
  const safeShow = escapeHtml(show);
  const greeting = safeName ? ('Hey ' + safeName + ',') : 'Hey,';
  const subject = (opts.preview ? '[PREVIEW] ' : '') + '🎤 Relive ' + stripForSubject(show) + ' — Certified Lounge Recap';
  const unsubUrl = buildUnsubscribeUrl(email, 'show');

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
    eyebrow: 'Certified Lounge',
    bodyHtml: bodyHtml,
    footerNote: 'You\'re getting this because you opted in after a Certified Lounge show. — NuRenaissance Media',
    unsubUrl: unsubUrl,
    previewBanner: opts.preview ? previewBannerHtml() : ''
  });

  MailApp.sendEmail({ to: email, subject: subject, htmlBody: html });
}

/**
 * Sends the recap newsletter to YOU (NOTIFY_EMAIL) with sample placeholder data — a fake
 * show name and a dummy video link — so you can see exactly what a subscriber's recap
 * email looks like without waiting for a real show + video upload. Run this any time from
 * the function dropdown up top. It's the same sendRecapEmail function underneath (just
 * aimed at your own inbox with a yellow "PREVIEW" banner up top and "[PREVIEW]" in the
 * subject), so it always matches the real template exactly — no separate copy to drift
 * out of sync if the real template ever changes.
 */
function previewRecapEmail() {
  sendRecapEmail(
    NOTIFY_EMAIL,
    'Jordan',
    'Solberg Studios — Oct 17',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ', // placeholder link — swap in a real video URL if you want the button to actually go somewhere
    { preview: true }
  );
  Logger.log('Preview recap email sent to ' + NOTIFY_EMAIL);
}

/**
 * Builds a one-click, tamper-proof unsubscribe link for this deployment + email. `kind`
 * says which list it should unsubscribe from — 'show' (the default, used by the recap
 * newsletter) or 'service' (used by the service-survey thank-you email) — since those are
 * two separate subscriber lists by design (see the setup notes at the top of this file).
 */
function buildUnsubscribeUrl(email, kind) {
  const base = ScriptApp.getService().getUrl();
  const token = makeUnsubToken(email);
  const safeKind = kind === 'service' ? 'service' : 'show';
  return base + '?unsub=1&kind=' + safeKind + '&email=' + encodeURIComponent(email) + '&t=' + token;
}

/** Short HMAC token so an unsubscribe link can't be forged for someone else's email. */
function makeUnsubToken(email) {
  const bytes = Utilities.computeHmacSha256Signature((email || '').toLowerCase().trim(), UNSUB_SECRET);
  return bytes.map(function (b) { return ((b < 0 ? b + 256 : b)).toString(16).padStart(2, '0'); }).join('').slice(0, 24);
}

function verifyUnsubToken(email, token) {
  return !!token && makeUnsubToken(email) === token;
}

/** Handles a click on an unsubscribe link: verifies the token, flips Status, shows a confirmation page. */
function handleUnsubscribeRequest(e) {
  const email = (e.parameter.email || '').toString().trim();
  const token = (e.parameter.t || '').toString().trim();
  const kind = (e.parameter.kind || 'show').toString().trim().toLowerCase() === 'service' ? 'service' : 'show';
  let ok = false, message;

  if (!email || !verifyUnsubToken(email, token)) {
    message = 'That unsubscribe link doesn\'t look right (or has already been used). Email ' + NOTIFY_EMAIL + ' and we\'ll take care of it by hand.';
  } else {
    try {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const result = kind === 'service' ? unsubscribeServiceEmail(ss, email) : unsubscribeShowEmail(ss, email);
      ok = (result === 'unsubscribed');
      message = ok
        ? (email + ' is unsubscribed — no more ' + (kind === 'service' ? 'NuRenaissance service' : 'Certified Lounge or NuRenaissance') +
           ' emails. Sorry to see you go, and thanks for coming out.')
        : 'We couldn\'t find that email on the list — you may already be unsubscribed.';
    } catch (err) {
      message = 'Something went wrong on our end. Email ' + NOTIFY_EMAIL + ' and we\'ll unsubscribe you by hand.';
    }
  }

  return HtmlService.createHtmlOutput(unsubscribePageHtml(message))
    .setTitle('Certified Lounge — Unsubscribed')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Sets a subscriber's Status to Unsubscribed in the given Subscribers-shaped tab.
 * Returns 'unsubscribed' | 'not-found' | 'no-subscribers-sheet' | 'no-email-column'
 */
function unsubscribeFromSheet(ss, email, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return 'no-subscribers-sheet';

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().trim());
  const emailIdx = headers.findIndex(h => h.toLowerCase() === 'email');
  const statusIdx = headers.findIndex(h => h.toLowerCase() === 'status');
  const unsubIdx = headers.findIndex(h => h.toLowerCase() === 'unsubscribed date');
  if (emailIdx === -1) return 'no-email-column';

  const normalized = email.toLowerCase();
  for (let r = 1; r < data.length; r++) {
    const rowEmail = (data[r][emailIdx] || '').toString().trim().toLowerCase();
    if (rowEmail === normalized) {
      if (statusIdx > -1) sheet.getRange(r + 1, statusIdx + 1).setValue('Unsubscribed');
      if (unsubIdx > -1) sheet.getRange(r + 1, unsubIdx + 1).setValue(new Date());
      return 'unsubscribed';
    }
  }
  return 'not-found';
}

function unsubscribeShowEmail(ss, email) {
  return unsubscribeFromSheet(ss, email, SUBSCRIBERS_SHEET_NAME);
}

function unsubscribeServiceEmail(ss, email) {
  return unsubscribeFromSheet(ss, email, SERVICE_SUBSCRIBERS_SHEET_NAME);
}

function unsubscribePageHtml(message) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>' +
    'body{ margin:0; background:#14121B; color:#F5F1E8; font-family:Georgia,serif; ' +
    'display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; box-sizing:border-box; }' +
    '.card{ max-width:420px; text-align:center; }' +
    'h1{ font-size:20px; margin:0 0 14px; }' +
    'p{ font-size:14px; line-height:1.6; color:#A69FC0; }' +
    '</style></head><body><div class="card">' +
    '<h1>Certified Lounge</h1><p>' + escapeHtml(message) + '</p>' +
    '</div></body></html>';
}

function notifyRecapSent(show, videoUrl, count) {
  if (!NOTIFY_EMAIL) return;
  try {
    MailApp.sendEmail(NOTIFY_EMAIL, 'Recap sent for ' + show, 'Sent the recap email (' + videoUrl + ') to ' + count + ' subscriber(s) from ' + show + '.');
  } catch (e) { Logger.log('notifyRecapSent failed: ' + e.toString()); }
}

function notifyRecapNeedsAttention(latest, message) {
  if (!NOTIFY_EMAIL) return;
  try {
    MailApp.sendEmail(NOTIFY_EMAIL, 'Certified Lounge recap needs a look', message + '\n\nVideo: ' + latest.url);
  } catch (e) { Logger.log('notifyRecapNeedsAttention failed: ' + e.toString()); }
}
