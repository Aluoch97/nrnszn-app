// NuRenaissance Payment Widget plus Financial Dashboard: Apps Script backend.
//
// doPost() receives a click from payment-widget.html and logs it as a row
// in the Payments tab: timestamp, brand, category, platform, amount, name,
// note, page, confirmed.
//
// setupDashboard() is a one-time, re-runnable function you run yourself
// from the Apps Script editor. It builds or repairs the Payments tab (adds
// the Confirmed checkbox column), a new Expenses tab for logging business
// expenses by hand, and a new Dashboard tab with formulas and charts
// pulling from both.
//
// Nothing here moves money or touches your actual bank, PayPal, or similar
// accounts. It is purely a log that you and the widget write into.
//
// Full setup steps are in SETUP.md. Short version: SHEET_ID and
// WIDGET_TOKEN below are already filled in and already match
// payment-widget.html, so paste this file into the sheet's
// Extensions, Apps Script editor exactly as given. Then, from the
// function dropdown in that editor, select setupDashboard and click Run
// once, approving permissions when asked. After that, go to Deploy, New
// deployment, Web app, set Execute as: Me and Who has access: Anyone, and
// paste the resulting /exec URL into SCRIPT_URL in payment-widget.html.

var SHEET_ID = '1aNyLjchT3jwzlY93p_h70gNtUhzge-m0nNx-sHpF2sA'; // "NuRenaissance Payments Log", already created in your Drive

// --- Security config ----------------------------------------------------
// Must match WIDGET_TOKEN in payment-widget.html exactly. This one was
// randomly generated for you — it isn't a strong secret since it's visible
// in the page's JavaScript, but it stops bots that scan for open Apps
// Script endpoints from writing directly to your Payments sheet.
var WIDGET_TOKEN = 'SAME-AS-WIDGET_TOKEN-IN-public/widgets/support.html'; // backup copy: the live script has the real value

// Must be >= the highest per-category cap in payment-widget.html
// (CATEGORY_AMOUNT_NOTICE[x] * 10 — currently $100,000 for NuService, the
// highest of the four). If this is lower than what the widget lets someone
// type, a legitimate large payment still goes through on PayPal/etc. for
// the real amount, but gets silently clamped down here — understating that
// income in the sheet. Keep the two in sync if either changes.
var MAX_AMOUNT = 100000;     // reject/clamp any $ amount above this as garbage
var MAX_TEXT_LENGTH = 500;   // cap free-text fields (name, note, page) to stop giant spam payloads
// Simple flood guard, not tied to any one customer — this only ever blocks
// the *logging* of a click, never the payment itself (the customer still
// reaches PayPal/Cash App/etc. either way). Raised from 100/hour: with
// live shows selling tickets in bursts, 100 real clicks in an hour on one
// platform is plausible, and hitting the ceiling would silently drop rows
// from the Payments sheet with no error shown to you. 1000/hour still
// easily blocks a scripted bot flood while giving real traffic headroom.
var CLICK_PER_PLATFORM_MAX = 1000;
var CLICK_WINDOW_SECONDS = 3600;    // 1 hour

var PAYMENTS_SHEET = 'Payments';
var EXPENSES_SHEET = 'Expenses';
var DASHBOARD_SHEET = 'Dashboard';

// Old header-row shapes — used only to detect and migrate a sheet created
// before a given column existed, so existing rows shift into the right
// columns instead of being silently relabeled.
var PAYMENTS_HEADERS_V1 = ['Timestamp', 'Platform', 'Amount', 'Name', 'Note', 'Page', 'Confirmed'];
var PAYMENTS_HEADERS_V2 = ['Timestamp', 'Brand', 'Category', 'Platform', 'Amount', 'Name', 'Note', 'Page', 'Confirmed'];

var PAYMENTS_HEADERS = ['Timestamp', 'Brand', 'Category', 'Platform', 'Amount', 'Name', 'Email', 'Note', 'Page', 'Confirmed'];
var EXPENSES_HEADERS = ['Date', 'Category', 'Vendor', 'Amount', 'Note'];

// Column numbers (1-based) derived from PAYMENTS_HEADERS so the dashboard
// formulas below never depend on hardcoded column letters.
var COL = {
  TIMESTAMP: PAYMENTS_HEADERS.indexOf('Timestamp') + 1,
  BRAND: PAYMENTS_HEADERS.indexOf('Brand') + 1,
  CATEGORY: PAYMENTS_HEADERS.indexOf('Category') + 1,
  PLATFORM: PAYMENTS_HEADERS.indexOf('Platform') + 1,
  AMOUNT: PAYMENTS_HEADERS.indexOf('Amount') + 1,
  CONFIRMED: PAYMENTS_HEADERS.indexOf('Confirmed') + 1
};

function colLetter_(index) {
  var letters = '';
  while (index > 0) {
    var rem = (index - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    index = Math.floor((index - 1) / 26);
  }
  return letters;
}

var BRANDS = [
  ['nurenaissance', 'NuRenaissance Media'],
  ['nicolassoul', 'Nicolas Soul']
];
var CATEGORIES = [
  ['service', 'NuService'],
  ['merch', 'Merch'],
  ['ticket', 'Live Ticket'],
  ['donation', 'Donation']
];
var BRAND_CODES = BRANDS.map(function (b) { return b[0]; });
var CATEGORY_CODES = CATEGORIES.map(function (c) { return c[0]; });
var EXPENSE_CATEGORIES = [
  'Gear & Equipment',
  'Software & Subscriptions',
  'Travel & Mileage',
  'Location / Facility Rental',
  'Contractor / Freelancer Pay',
  'Marketing',
  'Office / Admin',
  'Other'
];
var PLATFORMS = [
  ['paypal', 'PayPal'],
  ['cashapp', 'Cash App'],
  ['venmo', 'Venmo'],
  ['zelle', 'Zelle'],
  ['applepay', 'Apple Pay']
];
var PLATFORM_CODES = PLATFORMS.map(function (p) { return p[0]; });
var MAX_ROWS = 5000; // checkbox/dropdown validation is pre-applied this far down

// ----------------------------------------------------------------------
// Widget entry point
// ----------------------------------------------------------------------

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.token !== WIDGET_TOKEN) {
      return jsonOutput_({ status: 'error', message: 'Unauthorized' });
    }
    // Same allowed-values check as brand/category below — the widget only
    // ever sends one of PLATFORM_CODES, so anything else here means someone
    // is POSTing to this endpoint directly rather than clicking a button in
    // the widget (the WIDGET_TOKEN is visible in the page source, so that's
    // expected to happen occasionally). Normalizing collapses all of that
    // to one '' bucket instead of letting arbitrary strings pile up as
    // "Platform" values in the sheet.
    var platform = normalizeChoice_(data.platform, PLATFORM_CODES);
    if (!rateLimitOk_('payclick_' + (platform || 'unknown'), CLICK_PER_PLATFORM_MAX, CLICK_WINDOW_SECONDS)) {
      return jsonOutput_({ status: 'error', message: 'Rate limited' });
    }

    // Migration is a one-time step run from setupDashboard(), not here —
    // doPost() fires on every customer click, and re-opening the sheet to
    // check its header row on every single request would add a needless
    // round trip (and burn quota) forever after the migration is done once.
    var sheet = getOrCreateSheet_(PAYMENTS_SHEET, PAYMENTS_HEADERS);

    sheet.appendRow([
      new Date(),
      normalizeChoice_(data.brand, BRAND_CODES),
      normalizeChoice_(data.category, CATEGORY_CODES),
      platform,
      clampAmount_(data.amount),
      sanitizeForSheet_(data.name || ''),
      sanitizeForSheet_(data.email || ''),
      sanitizeForSheet_(data.note || ''),
      sanitizeForSheet_(data.page || ''),
      false // Confirmed — you check this manually once you verify the money actually landed
    ]);

    return jsonOutput_({ status: 'ok' });
  } catch (err) {
    return jsonOutput_({ status: 'error', message: String(err) });
  }
}

// Only lets through the exact brand/category codes the widget defines —
// anything else (a bug, or someone crafting their own POST) is logged as
// blank rather than as an arbitrary string, so the Dashboard's per-brand
// and per-category totals stay trustworthy.
function normalizeChoice_(value, allowedCodes) {
  var v = (value === null || value === undefined) ? '' : String(value).toLowerCase();
  return allowedCodes.indexOf(v) !== -1 ? v : '';
}

// One-time, self-limiting migration, run in two possible steps depending on
// how old the sheet is: a 7-column pre-Brand/Category sheet gets two blank
// columns inserted after Timestamp, then (whether it just went through that
// step or was already at 9 columns) a 9-column pre-Email sheet gets one
// blank column inserted after Name. Either way, existing rows shift into
// the right columns automatically instead of having their old values
// silently relabeled. getOrCreateSheet_() fills in the new header text
// afterward since the inserted blank cells won't match PAYMENTS_HEADERS.
function migratePaymentsSheetIfNeeded_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(PAYMENTS_SHEET);
  if (!sheet) return; // doesn't exist yet — getOrCreateSheet_ will create it fresh with new headers

  var firstRowV1 = sheet.getRange(1, 1, 1, PAYMENTS_HEADERS_V1.length).getValues()[0];
  var isV1 = PAYMENTS_HEADERS_V1.every(function (h, i) { return firstRowV1[i] === h; });
  if (isV1) {
    sheet.insertColumnsAfter(1, 2);
    Logger.log('Migrated existing Payments sheet to the Brand/Category layout.');
  }

  var firstRowV2 = sheet.getRange(1, 1, 1, PAYMENTS_HEADERS_V2.length).getValues()[0];
  var isV2 = PAYMENTS_HEADERS_V2.every(function (h, i) { return firstRowV2[i] === h; });
  if (isV2) {
    sheet.insertColumnsAfter(6, 1); // after Name (column 6)
    Logger.log('Migrated existing Payments sheet to add the Email column.');
  }
}

function rateLimitOk_(key, maxCount, windowSeconds) {
  var cache = CacheService.getScriptCache();
  var current = Number(cache.get(key)) || 0;
  if (current >= maxCount) return false;
  cache.put(key, String(current + 1), windowSeconds);
  return true;
}

function clampAmount_(value) {
  if (value === '' || value === undefined || value === null) return ''; // "not specified" stays blank, not $0
  var n = Number(value);
  if (isNaN(n) || n < 0) return '';
  return Math.min(n, MAX_AMOUNT);
}

// Caps length AND neutralizes spreadsheet formula injection: a free-text
// field starting with =, +, -, or @ would otherwise be interpreted as a
// formula the moment you open the sheet (e.g. someone typing
// "=IMPORTXML(...)" into the note field). The leading apostrophe forces
// Sheets to store it as literal text, same as typing '=foo manually.
function sanitizeForSheet_(value) {
  var s = (value === null || value === undefined) ? '' : String(value);
  if (s.length > MAX_TEXT_LENGTH) s = s.slice(0, MAX_TEXT_LENGTH);
  if (s && ['=', '+', '-', '@', '\t', '\r'].indexOf(s.charAt(0)) !== -1) {
    s = "'" + s;
  }
  return s;
}

// Lets you sanity-check the deployment by visiting the /exec URL directly.
function doGet(e) {
  return jsonOutput_({ status: 'ok', message: 'NuRenaissance payment logger is live.' });
}

// ----------------------------------------------------------------------
// One-time (re-runnable) setup — run this yourself from the editor
// ----------------------------------------------------------------------

function setupDashboard() {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  migratePaymentsSheetIfNeeded_();
  var payments = getOrCreateSheet_(PAYMENTS_SHEET, PAYMENTS_HEADERS);
  ensureConfirmedCheckboxes_(payments);

  var expenses = getOrCreateSheet_(EXPENSES_SHEET, EXPENSES_HEADERS);
  ensureExpenseCategoryDropdown_(expenses);

  buildDashboard_(ss);

  SpreadsheetApp.flush();
  Logger.log('Dashboard setup complete. Check the "Dashboard" tab.');
}

function getOrCreateSheet_(name, headers) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  var firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var hasHeaders = headers.every(function (h, i) { return firstRow[i] === h; });
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.autoResizeColumns(1, headers.length);
  }
  return sheet;
}

function ensureConfirmedCheckboxes_(sheet) {
  var confirmedCol = PAYMENTS_HEADERS.indexOf('Confirmed') + 1;
  var range = sheet.getRange(2, confirmedCol, MAX_ROWS, 1);
  range.insertCheckboxes();
}

function ensureExpenseCategoryDropdown_(sheet) {
  var categoryCol = EXPENSES_HEADERS.indexOf('Category') + 1;
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(EXPENSE_CATEGORIES, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, categoryCol, MAX_ROWS, 1).setDataValidation(rule);
}

function buildDashboard_(ss) {
  var sheet = ss.getSheetByName(DASHBOARD_SHEET);
  if (sheet) {
    ss.deleteSheet(sheet); // rebuild fresh each time setupDashboard() runs
  }
  sheet = ss.insertSheet(DASHBOARD_SHEET, 0);

  var amountCol = colLetter_(COL.AMOUNT);
  var brandCol = colLetter_(COL.BRAND);
  var categoryCol = colLetter_(COL.CATEGORY);
  var platformCol = colLetter_(COL.PLATFORM);
  var confirmedCol = colLetter_(COL.CONFIRMED);
  var timestampCol = colLetter_(COL.TIMESTAMP);

  sheet.getRange('A1').setValue('NuRenaissance Financial Dashboard')
    .setFontSize(16).setFontWeight('bold');
  sheet.getRange('A2').setValue('Auto-updates from the Payments and Expenses tabs. Confirmed = you\'ve verified the money actually landed.')
    .setFontStyle('italic').setFontColor('#666666');

  // --- Top-line summary ---------------------------------------------
  sheet.getRange('A4').setValue('Summary').setFontWeight('bold');
  var summary = [
    ['Confirmed income', '=SUMIFS(Payments!' + amountCol + ':' + amountCol + ',Payments!' + confirmedCol + ':' + confirmedCol + ',TRUE)'],
    ['Pending income (not yet confirmed)', '=SUMIFS(Payments!' + amountCol + ':' + amountCol + ',Payments!' + confirmedCol + ':' + confirmedCol + ',FALSE)'],
    ['Total expenses', '=SUM(Expenses!D:D)'],
    ['Net (confirmed income − expenses)', '=B5-B7']
  ];
  sheet.getRange(5, 1, summary.length, 2).setValues(summary);
  sheet.getRange(5, 2, summary.length, 1).setNumberFormat('$#,##0.00');
  sheet.getRange('A8').setFontWeight('bold');
  sheet.getRange('B8').setFontWeight('bold');

  var row = 11;

  // --- Confirmed income by brand ---------------------------------------
  sheet.getRange(row - 1, 1).setValue('Confirmed income by brand').setFontWeight('bold');
  var brandRows = BRANDS.map(function (b) {
    return [b[1], '=SUMIFS(Payments!' + amountCol + ':' + amountCol + ',Payments!' + brandCol + ':' + brandCol + ',"' + b[0] + '",Payments!' + confirmedCol + ':' + confirmedCol + ',TRUE)'];
  });
  sheet.getRange(row, 1, brandRows.length, 2).setValues(brandRows);
  sheet.getRange(row, 2, brandRows.length, 1).setNumberFormat('$#,##0.00');
  sheet.insertChart(sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(sheet.getRange(row, 1, brandRows.length, 2))
    .setPosition(row - 1, 4, 0, 0)
    .setOption('title', 'Confirmed income by brand')
    .build());
  row = row + brandRows.length + 3;

  // --- Confirmed income by category -------------------------------------
  sheet.getRange(row - 1, 1).setValue('Confirmed income by category').setFontWeight('bold');
  var catRows = CATEGORIES.map(function (c) {
    return [c[1], '=SUMIFS(Payments!' + amountCol + ':' + amountCol + ',Payments!' + categoryCol + ':' + categoryCol + ',"' + c[0] + '",Payments!' + confirmedCol + ':' + confirmedCol + ',TRUE)'];
  });
  sheet.getRange(row, 1, catRows.length, 2).setValues(catRows);
  sheet.getRange(row, 2, catRows.length, 1).setNumberFormat('$#,##0.00');
  sheet.insertChart(sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(sheet.getRange(row, 1, catRows.length, 2))
    .setPosition(row - 1, 4, 0, 0)
    .setOption('title', 'Confirmed income by category')
    .build());
  row = row + catRows.length + 3;

  // --- Income by platform ---------------------------------------------
  sheet.getRange(row - 1, 1).setValue('Confirmed income by platform').setFontWeight('bold');
  var platformRows = PLATFORMS.map(function (p) {
    return [p[1], '=SUMIFS(Payments!' + amountCol + ':' + amountCol + ',Payments!' + platformCol + ':' + platformCol + ',"' + p[0] + '",Payments!' + confirmedCol + ':' + confirmedCol + ',TRUE)'];
  });
  sheet.getRange(row, 1, platformRows.length, 2).setValues(platformRows);
  sheet.getRange(row, 2, platformRows.length, 1).setNumberFormat('$#,##0.00');
  sheet.insertChart(sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(sheet.getRange(row, 1, platformRows.length, 2))
    .setPosition(row - 1, 4, 0, 0)
    .setOption('title', 'Confirmed income by platform')
    .build());
  row = row + platformRows.length + 3;

  // --- Confirmed income by month (trailing 12 months) -------------------
  sheet.getRange(row - 1, 1).setValue('Confirmed income by month (trailing 12 months)').setFontWeight('bold');
  var today = new Date();
  var monthRows = [];
  for (var i = 11; i >= 0; i--) {
    var monthStart = new Date(today.getFullYear(), today.getMonth() - i, 1);
    var monthEnd = new Date(today.getFullYear(), today.getMonth() - i + 1, 1);
    var label = Utilities.formatDate(monthStart, ss.getSpreadsheetTimeZone(), 'MMM yyyy');
    var formula = '=SUMIFS(Payments!' + amountCol + ':' + amountCol + ',Payments!' + confirmedCol + ':' + confirmedCol + ',TRUE,Payments!' + timestampCol + ':' + timestampCol + ',">="&DATE(' +
      monthStart.getFullYear() + ',' + (monthStart.getMonth() + 1) + ',1),Payments!' + timestampCol + ':' + timestampCol + ',"<"&DATE(' +
      monthEnd.getFullYear() + ',' + (monthEnd.getMonth() + 1) + ',1))';
    monthRows.push([label, formula]);
  }
  sheet.getRange(row, 1, monthRows.length, 2).setValues(monthRows);
  sheet.getRange(row, 2, monthRows.length, 1).setNumberFormat('$#,##0.00');
  sheet.insertChart(sheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sheet.getRange(row, 1, monthRows.length, 2))
    .setPosition(row - 1, 4, 0, 0)
    .setOption('title', 'Confirmed income by month')
    .setOption('legend', { position: 'none' })
    .build());
  row = row + monthRows.length + 3;

  // --- Expenses by category ---------------------------------------------
  sheet.getRange(row - 1, 1).setValue('Expenses by category').setFontWeight('bold');
  var expenseRows = EXPENSE_CATEGORIES.map(function (c) {
    return [c, '=SUMIFS(Expenses!D:D,Expenses!B:B,"' + c + '")'];
  });
  sheet.getRange(row, 1, expenseRows.length, 2).setValues(expenseRows);
  sheet.getRange(row, 2, expenseRows.length, 1).setNumberFormat('$#,##0.00');
  sheet.insertChart(sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(sheet.getRange(row, 1, expenseRows.length, 2))
    .setPosition(row - 1, 4, 0, 0)
    .setOption('title', 'Expenses by category')
    .build());

  sheet.autoResizeColumns(1, 2);
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
