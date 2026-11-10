// NuRenaissance Media — Service Select Screen backend
// Deploy as Web App (Execute as: Me, Access: Anyone) and paste the /exec URL
// into wix-embed.html where SCRIPT_URL is defined.

// Logo used in client-facing emails, embedded here as base64 so nothing
// needs to be hosted externally. Decoded into a real image attachment
// with a Content-ID reference (cid:nrnlogo) rather than a base64 data-URI
// in the HTML itself — data-URI images render inconsistently across email
// clients (Outlook in particular), while CID-referenced inline images are
// the standard, reliably-supported way to embed a logo in an email.
var NRN_LOGO_BASE64 = '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';

function getLogoBlob() {
  return Utilities.newBlob(Utilities.base64Decode(NRN_LOGO_BASE64), 'image/png', 'logo.png');
}

var SHEET_SERVICES = 'Services';
var SHEET_TIERS = 'Service_Tiers';
var SHEET_BUNDLES = 'Bundles';
var SHEET_CLIENTS = 'Clients';
var SHEET_REMINDERS = 'Reminders';

// Booking config — adjust to taste. Times are in TIMEZONE, 24-hour.
var TIMEZONE = 'America/Chicago';
var WORKING_HOURS_START = 10; // 10am
var WORKING_HOURS_END = 17;   // 5pm
var SLOT_MINUTES = 30;
var MEETING_DURATION_MINUTES = 30;
var BOOKING_LEAD_MINUTES = 60; // don't let people book within the next hour

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email);
}

function doGet(e) {
  var action = e.parameter.action || 'data';
  try {
    if (action === 'data') {
      return jsonOut(getData());
    }
    if (action === 'click') {
      return jsonOut(logClick(e.parameter.id));
    }
    if (action === 'estimate') {
      return jsonOut(emailEstimate(e.parameter.email, e.parameter.summary, e.parameter.total));
    }
    if (action === 'availability') {
      return jsonOut(getAvailability(e.parameter.date));
    }
    if (action === 'book') {
      return jsonOut(bookSlot(e.parameter.date, e.parameter.time, e.parameter.name, e.parameter.email, e.parameter.summary, e.parameter.total));
    }
    if (action === 'lead') {
      return jsonOut(saveLead(e.parameter));
    }
    return jsonOut({ error: 'Unknown action' });
  } catch (err) {
    // Without this, an unexpected error (a Calendar API hiccup, a
    // malformed Sheet row) would let Apps Script's own default error
    // page take over instead of returning clean JSON — breaking the
    // widget's response.json() parsing in a confusing way, with no
    // record of what happened. This guarantees a clean error response
    // and a log entry to check later.
    Logger.log('doGet error (action=' + action + '): ' + err + (err && err.stack ? '\n' + err.stack : ''));
    return jsonOut({ success: false, error: 'Something went wrong. Please try again or contact NuRenaissance Media directly.' });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------
// getData — reads Services + Service_Tiers + Bundles and returns a
// pricing-model-aware object per service. Four pricing models, matching
// your actual agreements:
//   package          flat tiers, each with its own deposit (Admin, graphic design)
//   hourly           rate x hours + a single deposit (Photography, Livestream)
//   hourly_plus_edit rate x hours + a flat edit tier + a deposit that
//                    depends on whether it's a music video (Video)
//   per_page         rate x pages + a single deposit (Web design)
// See SETUP.md for the exact sheet columns each model reads.
// ---------------------------------------------------------------------

function getData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var servicesSheet = ss.getSheetByName(SHEET_SERVICES);
  var servicesRows = servicesSheet.getDataRange().getValues();
  var servicesHeader = servicesRows.shift();

  var tiersSheet = ss.getSheetByName(SHEET_TIERS);
  var tiersRows = tiersSheet.getDataRange().getValues();
  var tiersHeader = tiersRows.shift();

  var bundlesSheet = ss.getSheetByName(SHEET_BUNDLES);
  var bundlesRows = bundlesSheet.getDataRange().getValues();
  var bundlesHeader = bundlesRows.shift();

  var tiersByService = {};
  tiersRows.forEach(function (row) {
    var t = rowToObj(tiersHeader, row);
    if (!t.ServiceID) return;
    if (!tiersByService[t.ServiceID]) tiersByService[t.ServiceID] = [];
    tiersByService[t.ServiceID].push({
      name: t.TierName,
      price: Number(t.Price) || 0,
      deposit: Number(t.Deposit) || 0,
      depositCredited: String(t.DepositCredited).toLowerCase() === 'yes',
      description: t.TierDescription,
      sortOrder: Number(t.SortOrder) || 0
    });
  });
  Object.keys(tiersByService).forEach(function (id) {
    tiersByService[id].sort(function (a, b) { return a.sortOrder - b.sortOrder; });
  });

  var services = servicesRows
    .map(function (row) {
      var s = rowToObj(servicesHeader, row);
      if (!s.ID) return null;
      var tiers = tiersByService[s.ID] || [];
      var model = s.PricingModel || 'package';
      var hourlyRate = Number(s.HourlyRate) || 0;
      var facilityHourlyRate = Number(s.FacilityHourlyRate) || 0;
      var minHours = Number(s.MinHours) || 1;
      var pageRate = Number(s.PageRate) || 0;
      var deposit = Number(s.Deposit) || 0;
      var depositCredited = String(s.DepositCredited).toLowerCase() === 'yes';
      var musicVideoDeposit = Number(s.MusicVideoDeposit) || 0;

      var startingPrice = 0;
      if (model === 'package') {
        startingPrice = tiers.length ? tiers[0].price + tiers[0].deposit : 0;
      } else if (model === 'hourly') {
        startingPrice = hourlyRate * minHours + deposit;
      } else if (model === 'hourly_plus_edit') {
        var cheapestEdit = tiers.length ? tiers[0].price : 0;
        startingPrice = hourlyRate * minHours + cheapestEdit + deposit;
      } else if (model === 'per_page') {
        startingPrice = pageRate + deposit;
      }

      return {
        id: String(s.ID),
        name: s.Name,
        icon: s.Icon,
        tag: s.Tag,
        description: s.Description,
        clicks: Number(s.Clicks) || 0,
        pricingModel: model,
        hourlyRate: hourlyRate,
        facilityHourlyRate: facilityHourlyRate,
        minHours: minHours,
        pageRate: pageRate,
        deposit: deposit,
        depositCredited: depositCredited,
        musicVideoDeposit: musicVideoDeposit,
        tiers: tiers,
        startingPrice: startingPrice
      };
    })
    .filter(Boolean);

  var maxClicks = services.reduce(function (m, s) { return Math.max(m, s.clicks); }, 0);
  services.forEach(function (s) {
    s.mostBooked = maxClicks > 0 && s.clicks === maxClicks;
  });

  var bundles = bundlesRows
    .map(function (row) {
      var b = rowToObj(bundlesHeader, row);
      if (!b.BundleID) return null;
      return {
        id: String(b.BundleID),
        name: b.Name,
        requiredServiceIds: String(b.RequiredServiceIDs || '')
          .split(',')
          .map(function (x) { return x.trim(); })
          .filter(Boolean),
        description: b.Description,
        price: Number(b.Price) || 0
      };
    })
    .filter(Boolean);

  return { services: services, bundles: bundles };
}

function logClick(id) {
  if (!id) return { success: false, error: 'Missing id' };
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SERVICES);
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idCol = header.indexOf('ID');
  var clicksCol = header.indexOf('Clicks');
  if (idCol === -1 || clicksCol === -1) return { success: false, error: 'Sheet missing ID/Clicks column' };

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      var current = Number(data[i][clicksCol]) || 0;
      sheet.getRange(i + 1, clicksCol + 1).setValue(current + 1);
      return { success: true, clicks: current + 1 };
    }
  }
  return { success: false, error: 'Service not found' };
}

function rowToObj(header, row) {
  var obj = {};
  header.forEach(function (key, i) { obj[key] = row[i]; });
  return obj;
}

// ---------------------------------------------------------------------
// Direct Google Calendar booking — checks your real calendar for open
// slots and books directly onto it with a Google Meet link attached.
// Requires the "Google Calendar API" advanced service enabled in this
// Apps Script project (Services > + > Google Calendar API). See SETUP.md.
// ---------------------------------------------------------------------

function getAvailability(dateStr) {
  if (!dateStr) return { error: 'Missing date' };
  var dayStart = new Date(dateStr + 'T00:00:00');
  var dayEnd = new Date(dateStr + 'T23:59:59');
  if (isNaN(dayStart.getTime())) return { error: 'Invalid date' };

  var cal = CalendarApp.getDefaultCalendar();
  var busyEvents = cal.getEvents(dayStart, dayEnd);
  var now = new Date();
  var earliestBookable = new Date(now.getTime() + BOOKING_LEAD_MINUTES * 60000);

  var slots = [];
  var startMinutes = WORKING_HOURS_START * 60;
  var endMinutes = WORKING_HOURS_END * 60;
  for (var m = startMinutes; m < endMinutes; m += SLOT_MINUTES) {
    var hour = Math.floor(m / 60);
    var minute = m % 60;
    var slotStart = new Date(dateStr + 'T00:00:00');
    slotStart.setHours(hour, minute, 0, 0);
    var slotEnd = new Date(slotStart.getTime() + MEETING_DURATION_MINUTES * 60000);

    if (slotStart < earliestBookable) continue;

    var overlaps = busyEvents.some(function (ev) {
      return slotStart < ev.getEndTime() && slotEnd > ev.getStartTime();
    });
    if (overlaps) continue;

    slots.push({
      time: Utilities.formatDate(slotStart, TIMEZONE, "HH:mm"),
      label: Utilities.formatDate(slotStart, TIMEZONE, "h:mm a")
    });
  }

  return { date: dateStr, slots: slots };
}

function bookSlot(dateStr, timeStr, name, email, summary, total) {
  if (!dateStr || !timeStr || !name || !email) {
    return { success: false, error: 'Missing required fields' };
  }
  if (!isValidEmail(email)) {
    return { success: false, error: 'Invalid email' };
  }

  var start = new Date(dateStr + 'T' + timeStr + ':00');
  var end = new Date(start.getTime() + MEETING_DURATION_MINUTES * 60000);

  var cal = CalendarApp.getDefaultCalendar();
  var stillFree = !cal.getEvents(start, end).some(function (ev) {
    return start < ev.getEndTime() && end > ev.getStartTime();
  });
  if (!stillFree) return { success: false, error: 'That slot was just booked — pick another time' };

  var resource = {
    summary: 'NuRenaissance consultation — ' + name,
    description: 'Services discussed: ' + (summary || 'not specified'),
    start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
    end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
    attendees: [{ email: email }],
    conferenceData: {
      createRequest: {
        requestId: Utilities.getUuid(),
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    }
  };

  var event = Calendar.Events.insert(resource, 'primary', {
    conferenceDataVersion: 1,
    sendUpdates: 'all'
  });

  var meetLink = event.hangoutLink || '';
  var timeLabel = Utilities.formatDate(start, TIMEZONE, 'EEEE, MMMM d \'at\' h:mm a zzz');

  var confirmationEmail = buildBookingConfirmationEmail(name, summary, timeLabel, meetLink);
  GmailApp.sendEmail(email, confirmationEmail.subject, confirmationEmail.plainBody, { htmlBody: confirmationEmail.htmlBody, inlineImages: { nrnlogo: getLogoBlob() } });

  logQuoteReminder(start, name, email, summary, timeLabel, total, event.id);

  return { success: true, time: timeLabel, meetLink: meetLink };
}

// Builds the full booking-confirmation email (subject, plain-text
// fallback, and styled HTML) without sending anything — used by both
// the real bookSlot() flow and the preview function below, so they can
// never drift out of sync with each other.
function buildBookingConfirmationEmail(name, summary, timeLabel, meetLink) {
  var lines = [
    'Hi ' + name + ',',
    '',
    "You're booked! Here's what we'll cover on the call:",
    '',
    summary || '(selection not captured — we\'ll go over it live)',
    '',
    'Time: ' + timeLabel
  ];
  if (meetLink) lines.push('Google Meet: ' + meetLink);
  lines.push('');
  lines.push('Quotes shared on this page are estimates. Deposits are non-refundable once work is booked — full terms are in your service agreement, which we\'ll send ahead of the shoot/session.');
  lines.push('');
  lines.push('Best,');
  lines.push('NuRenaissance Team');

  var htmlBody = buildBookingConfirmationHtml(name, summary, timeLabel, meetLink);
  return { subject: "You're booked with NuRenaissance Media", plainBody: lines.join('\n'), htmlBody: htmlBody };
}

// Brand-styled version of the booking confirmation, same visual language
// as the quote/invoice draft (see buildQuoteInvoiceHtml). Centered on
// the appointment time and Meet link rather than a payment total.
function buildBookingConfirmationHtml(name, summary, timeLabel, meetLink) {
  var items = splitSummaryItems(summary);
  var itemsHtml = items.length
    ? items.map(function (item) {
        return '<tr><td style="padding:8px 0;border-bottom:1px solid #eee4fb;color:#3d2e57;font-size:15px;">' + escapeHtml(item) + '</td></tr>';
      }).join('')
    : '<tr><td style="padding:8px 0;color:#3d2e57;font-size:15px;">(selection not captured — we\u2019ll go over it live)</td></tr>';

  var meetButton = meetLink
    ? '<div style="text-align:center;margin:24px 0;">' +
        '<a href="' + escapeHtml(meetLink) + '" style="display:inline-block;background:#ffd54a;color:#2b1600;font-weight:bold;font-size:15px;padding:14px 36px;border-radius:6px;text-decoration:none;">Join Google Meet</a>' +
      '</div>'
    : '';

  return '' +
'<meta charset="utf-8">' +
'<div style="max-width:600px;margin:0 auto;font-family:Helvetica,Arial,sans-serif;background:#ffffff;">' +
  '<div style="background:#2b1650;padding:28px 32px;text-align:center;">' +
    '<img src="cid:nrnlogo" width="60" height="60" style="display:block;margin:0 auto 12px;border:0;" alt="NuRenaissance Media">' +
    '<div style="color:#ffd54a;font-size:22px;font-weight:bold;letter-spacing:1px;">NuRenaissance Media</div>' +
    '<div style="color:#c9a6ff;font-size:13px;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">Booking Confirmed</div>' +
  '</div>' +
  '<div style="padding:32px;">' +
    '<p style="margin:0 0 16px;font-size:15px;color:#3d2e57;">Hi ' + escapeHtml(name) + ',</p>' +
    '<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d2e57;">You\u2019re booked! Here\u2019s what we\u2019ll cover on the call:</p>' +
    '<table style="width:100%;border-collapse:collapse;margin-bottom:24px;">' + itemsHtml + '</table>' +
    '<div style="text-align:center;background:#f7f3ff;border-radius:6px;padding:20px;margin-bottom:8px;">' +
      '<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6b5b8a;">Time</div>' +
      '<div style="font-size:22px;font-weight:bold;color:#4a2f7a;margin-top:6px;">' + escapeHtml(timeLabel) + '</div>' +
    '</div>' +
    meetButton +
    '<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#6b5b8a;">Quotes shared on this page are estimates. Deposits are non-refundable once work is booked \u2014 full terms are in your service agreement, which we\u2019ll send ahead of the shoot/session.</p>' +
    '<p style="margin:28px 0 0;font-size:15px;color:#3d2e57;">Best,<br>NuRenaissance Team</p>' +
  '</div>' +
  '<div style="background:#f7f3ff;padding:16px 32px;text-align:center;font-size:12px;color:#6b5b8a;">NuRenaissance Media</div>' +
'</div>';
}

// ---------------------------------------------------------------------
// Automatic invoicing — 1 hour after a consultation's actual scheduled
// start time, sends the itemized quote/invoice directly to the client.
// No draft, no review step. Two parts:
//   1. logQuoteReminder — called from bookSlot, writes a row to the
//      Reminders sheet with the meeting's real start time and Calendar
//      event ID.
//   2. sendDueInvoices — checks that sheet every 30 minutes and sends
//      anything that's come due, after confirming the meeting wasn't
//      cancelled or deleted. Requires a one-time trigger setup (see
//      setupAutoInvoiceTrigger below).
// ---------------------------------------------------------------------

function logQuoteReminder(consultationStart, name, email, summary, timeLabel, total, eventId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_REMINDERS);
  if (!sheet) return; // sheet not set up yet — don't let this break booking
  var reminderDate = new Date(consultationStart.getTime() + 24 * 60 * 60 * 1000); // legacy column, no longer used for timing — kept so existing rows/sorting aren't disturbed
  sheet.appendRow([reminderDate, name, email, summary || '', timeLabel, '', Number(total) || 0, eventId || '', consultationStart]);
}

// Auto-sends the itemized quote/invoice directly to the client — no
// draft, no review step, per explicit request. Fires once the meeting's
// actual scheduled start time (not "the day after") plus one hour has
// passed. Because there's no human review step anymore, this also
// verifies the Calendar event wasn't cancelled or deleted after booking
// before sending anything — auto-emailing an invoice for a meeting that
// never happened would be a real, avoidable mistake.
function sendDueInvoices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_REMINDERS);
  if (!sheet) return;

  var rows = sheet.getDataRange().getValues();
  var header = rows.shift();
  var nameCol = header.indexOf('ClientName');
  var emailCol = header.indexOf('ClientEmail');
  var summaryCol = header.indexOf('Summary');
  var bookingTimeCol = header.indexOf('BookingTime');
  var sentCol = header.indexOf('Sent');
  var totalCol = header.indexOf('Total');
  var eventIdCol = header.indexOf('EventId');
  var startTimeCol = header.indexOf('MeetingStartTime');
  if ([nameCol, emailCol, summaryCol, bookingTimeCol, sentCol, totalCol, eventIdCol, startTimeCol].indexOf(-1) !== -1) {
    Logger.log('Reminders sheet is missing expected columns for auto-invoicing — see setup instructions (needs EventId and MeetingStartTime columns).');
    return;
  }

  var now = new Date();
  var myEmail = Session.getActiveUser().getEmail();

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row[sentCol]) continue; // already handled

    var startTimeRaw = row[startTimeCol];
    if (!startTimeRaw) continue; // row predates this feature (old "day after" system) — needs manual handling, not auto-fired

    var dueAt = new Date(new Date(startTimeRaw).getTime() + 60 * 60 * 1000); // 1 hour after the meeting's start
    if (now.getTime() < dueAt.getTime()) continue; // not due yet

    var clientName = row[nameCol];
    var clientEmail = row[emailCol];
    var summary = row[summaryCol];
    var bookingTime = row[bookingTimeCol];
    var total = row[totalCol];
    var eventId = row[eventIdCol];

    try {
      if (eventId) {
        try {
          var event = Calendar.Events.get('primary', eventId);
          if (event.status === 'cancelled') {
            Logger.log('Skipping auto-invoice for ' + clientName + ' — meeting was cancelled.');
            sheet.getRange(i + 2, sentCol + 1).setValue('Skipped (cancelled)');
            continue;
          }
        } catch (lookupErr) {
          // Event was deleted entirely, not just marked cancelled.
          Logger.log('Skipping auto-invoice for ' + clientName + ' — meeting event no longer exists.');
          sheet.getRange(i + 2, sentCol + 1).setValue('Skipped (deleted)');
          continue;
        }
      }

      var quoteEmail = buildQuoteInvoiceEmail(clientName, summary, total, bookingTime);
      GmailApp.sendEmail(clientEmail, quoteEmail.subject, quoteEmail.plainBody, { htmlBody: quoteEmail.htmlBody, inlineImages: { nrnlogo: getLogoBlob() } });

      // Informational only — no action needed, just visibility into
      // what went out automatically on your behalf.
      var fyiBody = [
        'The quote/invoice below was sent automatically to ' + clientName + ', 1 hour after their consultation.',
        '',
        'Consultation was: ' + bookingTime,
        'Total: $' + total,
        '',
        'Services discussed:',
        summary || '(not captured)',
        '',
        'Client email: ' + clientEmail
      ].join('\n');
      GmailApp.sendEmail(myEmail, 'Invoice auto-sent: ' + clientName, fyiBody);

      sheet.getRange(i + 2, sentCol + 1).setValue(new Date());
    } catch (err) {
      // Don't let one bad row (a malformed email, a Gmail quota hiccup)
      // block every other legitimate invoice in this batch. Leave
      // "Sent" blank so it's automatically retried on the next run, and
      // log it so it doesn't fail silently forever.
      Logger.log('sendDueInvoices error on row ' + (i + 2) + ' (' + clientName + '): ' + err);
    }
  }
}

// Creates a Gmail DRAFT addressed to the client — itemized quote/invoice
// based on what they selected in the widget. Never sent automatically;
// sits in Drafts for review. Has placeholder text for payment terms and
// method since those aren't hardcoded anywhere — fill in before sending,
// or tell Claude your standard terms so they can be baked in for real.
// Builds the full quote/invoice email (subject, plain-text fallback, and
// styled HTML) without sending or drafting anything — used by both the
// real draft creator and the preview function below, so they can never
// drift out of sync with each other.
function buildQuoteInvoiceEmail(name, summary, total, timeLabel) {
  var subject = 'Quote & invoice — NuRenaissance Media';
  var s = (summary || '');
  var sLower = s.toLowerCase();
  var hasInterview = sLower.indexOf('interview') !== -1;
  var hasRaiseTheBar = sLower.indexOf('raise the bar') !== -1;
  var hasVideo = s.indexOf('Video production') !== -1 && !hasInterview && !hasRaiseTheBar;
  var hasPhotography = s.indexOf('Photography') !== -1;
  var hasLivestream = s.indexOf('Livestream') !== -1;
  var hasWeb = s.indexOf('Web design') !== -1;
  var hasAdmin = s.indexOf('Admin services') !== -1;
  var hasGraphicDesign = s.indexOf('Graphic design') !== -1;

  var paymentLines = [];
  var hasStandardDeposit = hasVideo || hasInterview || hasRaiseTheBar || hasPhotography || hasLivestream || hasWeb;
  if (hasStandardDeposit) {
    paymentLines.push('A deposit is required to book your date, due right after this consultation — see your service agreement for the exact amount and whether it\'s credited toward this total.');
  }

  if (hasVideo) {
    paymentLines.push('');
    paymentLines.push('For the video production portion: the shoot fee is due after the last production date, and the edit fee is due 5 business days after the final draft is completed.');
  }
  if (hasRaiseTheBar) {
    paymentLines.push('');
    paymentLines.push('For the Raise the Bar performance: $50 is due to book your slot, credited toward the $100 total. The remaining $50 is due at the shoot.');
  }
  if (hasPhotography || hasLivestream || hasInterview) {
    var sessionLabel = [hasPhotography ? 'photography' : null, hasLivestream ? 'livestream' : null, hasInterview ? 'interview' : null].filter(Boolean).join(', ');
    paymentLines.push('');
    paymentLines.push('For the ' + sessionLabel + ' portion: the balance is due before the session/event.');
  }
  if (hasWeb) {
    paymentLines.push('');
    paymentLines.push('For the web design portion: the balance is due immediately on launch.');
  }
  // Admin and Graphic design tiers already state their own payment timing
  // right in the tier description (e.g. "paid in full before work begins",
  // "billed at the start of each cycle") — no generic rule needed here.

  paymentLines.push('');
  paymentLines.push('Payment can be made through this link, which has all accepted payment options: https://www.nrnszn.com/support');

  // What's actually included, straight from each signed service agreement
  // — so the client knows what they're signing up for, not just the price.
  // Tracked two ways: a flat line array (for the plain-text body, unchanged)
  // and a structured list of {heading, text} (for nicer HTML rendering).
  var includedLines = [];
  var includedItems = [];
  function addIncluded(heading, text) {
    if (includedLines.length > 0) includedLines.push('');
    includedLines.push(heading);
    includedLines.push(text);
    includedItems.push({ heading: heading, text: text });
  }
  if (hasInterview) {
    addIncluded('\uD83C\uDF99 Interview:', '2 free creative revision rounds included (extra rounds $75/round). Includes high-res promotional stills and a social media promo cadence after the shoot. Raw footage and stills held for 30 days post-shoot, delivered via Google Drive after full payment.');
  }
  if (hasRaiseTheBar) {
    addIncluded('\uD83C\uDFA4 Raise the Bar:', 'One mic performance slot filmed at City Limit Studios in Mt. Juliet, TN, produced with the Underground Music Collective. $50 to book, $50 due at the shoot.');
  }
  if (hasVideo) {
    addIncluded('\uD83C\uDFA5 Video production:', '2 free creative revision rounds included (extra rounds $75/round). Raw footage transferred at no extra cost after final payment, held for 30 days post-shoot — request early. Additional locations are $50 each ($5/mile beyond 25 miles of the primary shoot). Want your branding removed entirely? White-label buyout is 25% of the total project cost.');
  }
  if (hasPhotography) {
    addIncluded('\uD83D\uDCF7 Photography:', 'All session photos delivered in full; you select 10\u201315 for professional light retouching. Extra edited photos beyond that are $10 each (or 5 for $40). Rush delivery within 48 hours is available for $40. Photos delivered via private Google Drive within 10 business days of full payment.');
  }
  if (hasGraphicDesign) {
    addIncluded('\uD83C\uDFA8 Graphic design:', 'Full fee due upfront. Includes 2 free revision rounds; additional rounds are $50/round.');
  }
  if (hasWeb) {
    addIncluded('\uD83D\uDCBB Web design:', 'Site build completed within 15 business days of receiving all required assets. Includes one 1-hour review session and 2 free revision rounds after that (extra rounds $50/round; meeting time beyond the 1-hour session is $25/hr). You\u2019re responsible for the Wix Premium Plan and Domain Registration costs directly through Wix.');
  }
  if (hasLivestream) {
    addIncluded('\uD83D\uDCE1 Livestream:', 'Covers the live broadcast only — highlight reels and clips are billed separately. Stream archive access is immediate after the broadcast; high-quality backup files are available on request within 14 days.');
  }
  if (hasAdmin) {
    addIncluded('\uD83D\uDCCB Admin services:', 'One-time services (like Digital Foundation) are non-refundable once work has begun, with 2 free revisions included on deliverables like your YouTube banner (extra rounds $25/round). Recurring services (Monthly Momentum, social media management) are billed at the start of each cycle and require 14 days\u2019 written notice to cancel.');
  }

  var plainBody = [
    'Hi ' + name + ',',
    '',
    'Thanks again for your time on ' + timeLabel + '. Here\'s the quote for what we discussed:',
    '',
    summary || '(services not captured — fill in before sending)',
    '',
    'Total: $' + (total || 0),
    ''
  ].concat(paymentLines).concat([
    ''
  ]).concat(includedLines.length ? ['What\'s included:', ''].concat(includedLines) : []).concat([
    '',
    'Let me know if you have any questions or want to adjust anything before we lock in your date.',
    '',
    'Best,',
    'The NuRenaissance team'
  ]).join('\n');

  var htmlBody = buildQuoteInvoiceHtml(name, timeLabel, summary, total, paymentLines, includedItems);

  return { subject: subject, plainBody: plainBody, htmlBody: htmlBody };
}

// ---------------------------------------------------------------------
// HTML email builder — brand-styled version of the quote/invoice draft.
// Email clients have very limited CSS support (no flexbox/grid, no
// external stylesheets reliably), so this uses simple, inline-styled
// blocks only. Colors match the widget: deep purple (#4a2f7a / #2b1650)
// and gold (#ffd54a) accents on a light background — a dark background
// like the widget itself would fight with email clients' own dark-mode
// handling, so this deliberately looks different from the widget while
// using the same brand colors.
// ---------------------------------------------------------------------

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Splits the widget's summary string ("Video production (Standard, $350),
// Photography (2 hrs, $200)") into individual line items for a cleaner
// itemized list, rather than one run-on paragraph. Every item in this
// format always ends in "$N)" — splitting on "), " (with the paren
// re-attached to every item but the last) reliably separates them
// without being tripped up by commas inside a label, since none of the
// current pricing models ever produce a literal "), " substring inside
// a single item's own text.
function splitSummaryItems(summary) {
  if (!summary) return [];
  // Anchor specifically on "$amount)" (the definitive end of an item in
  // this format) rather than any closing paren — labels like "Standard
  // (Tier 2)" have their own internal parentheses that would otherwise
  // cause a false split mid-item.
  var marker = '\u0000';
  var withMarkers = String(summary).replace(/(\$\d+\))/g, '$1' + marker);
  return withMarkers.split(marker + ', ')
    .map(function (p) { return p.split(marker).join('').trim(); })
    .filter(function (p) { return p.length > 0; });
}

function paragraphsHtml(lines, color) {
  var paras = [];
  var current = [];
  lines.forEach(function (line) {
    if (line === '') {
      if (current.length) { paras.push(current.join('<br>')); current = []; }
    } else {
      current.push(escapeHtml(line));
    }
  });
  if (current.length) paras.push(current.join('<br>'));
  return paras.map(function (p) {
    return '<p style="margin:0 0 14px;line-height:1.6;color:' + (color || '#3d2e57') + ';font-size:15px;">' + p + '</p>';
  }).join('');
}

function buildQuoteInvoiceHtml(name, timeLabel, summary, total, paymentLines, includedItems) {
  var items = splitSummaryItems(summary);
  var itemsHtml = items.length
    ? items.map(function (item) {
        return '<tr><td style="padding:8px 0;border-bottom:1px solid #eee4fb;color:#3d2e57;font-size:15px;">' + escapeHtml(item) + '</td></tr>';
      }).join('')
    : '<tr><td style="padding:8px 0;color:#3d2e57;font-size:15px;">(services not captured — fill in before sending)</td></tr>';

  var includedHtml = includedItems.length
    ? '<div style="margin-top:28px;">' +
        '<div style="font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#6b5b8a;margin-bottom:12px;">What\u2019s included</div>' +
        includedItems.map(function (it) {
          return '<p style="margin:0 0 14px;line-height:1.6;font-size:15px;">' +
            '<span style="color:#4a2f7a;font-weight:bold;">' + escapeHtml(it.heading) + '</span> ' +
            '<span style="color:#3d2e57;">' + escapeHtml(it.text) + '</span>' +
          '</p>';
        }).join('') +
      '</div>'
    : '';

  return '' +
'<meta charset="utf-8">' +
'<div style="max-width:600px;margin:0 auto;font-family:Helvetica,Arial,sans-serif;background:#ffffff;">' +
  '<div style="background:#2b1650;padding:28px 32px;text-align:center;">' +
    '<img src="cid:nrnlogo" width="60" height="60" style="display:block;margin:0 auto 12px;border:0;" alt="NuRenaissance Media">' +
    '<div style="color:#ffd54a;font-size:22px;font-weight:bold;letter-spacing:1px;">NuRenaissance Media</div>' +
    '<div style="color:#c9a6ff;font-size:13px;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">Quote &amp; Invoice</div>' +
  '</div>' +
  '<div style="padding:32px;">' +
    '<p style="margin:0 0 16px;font-size:15px;color:#3d2e57;">Hi ' + escapeHtml(name) + ',</p>' +
    '<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d2e57;">Thanks again for your time on ' + escapeHtml(timeLabel) + '. Here\u2019s the quote for what we discussed:</p>' +
    '<table style="width:100%;border-collapse:collapse;margin-bottom:24px;">' + itemsHtml + '</table>' +
    '<div style="text-align:center;background:#f7f3ff;border-radius:6px;padding:20px;margin-bottom:24px;">' +
      '<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6b5b8a;">Total</div>' +
      '<div style="font-size:34px;font-weight:bold;color:#4a2f7a;margin-top:4px;">$' + escapeHtml(total || 0) + '</div>' +
    '</div>' +
    paragraphsHtml(paymentLines) +
    '<div style="text-align:center;margin:24px 0;">' +
      '<a href="https://www.nrnszn.com/support" style="display:inline-block;background:#ffd54a;color:#2b1600;font-weight:bold;font-size:15px;padding:14px 36px;border-radius:6px;text-decoration:none;">Make a Payment</a>' +
    '</div>' +
    includedHtml +
    '<p style="margin:28px 0 4px;font-size:15px;line-height:1.6;color:#3d2e57;">Let me know if you have any questions or want to adjust anything before we lock in your date.</p>' +
    '<p style="margin:20px 0 0;font-size:15px;color:#3d2e57;">Best,<br>The NuRenaissance team</p>' +
  '</div>' +
  '<div style="background:#f7f3ff;padding:16px 32px;text-align:center;font-size:12px;color:#6b5b8a;">NuRenaissance Media</div>' +
'</div>';
}

// Run this ONCE, manually, from the Apps Script editor: select
// "setupDailyReminderTrigger" in the function dropdown at the top, then
// press Run. It sets up the daily check for due reminders. Safe to run
// more than once — it checks for an existing trigger first so it won't
// create duplicates.
// Run this ONCE, manually, from the Apps Script editor to switch from
// the old once-a-day check to checking every 30 minutes for invoices
// that are due (1 hour after a meeting's actual start time). Cleans up
// the old daily trigger first if one exists — leaving it in place would
// have it fail every day trying to call a function that no longer
// exists. Safe to run more than once.
function setupAutoInvoiceTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDueReminders' || t.getHandlerFunction() === 'sendDueInvoices') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('sendDueInvoices')
    .timeBased()
    .everyMinutes(30)
    .create();
  Logger.log('Auto-invoice trigger created — checks every 30 minutes for consultations that finished over an hour ago.');
}

// ---------------------------------------------------------------------
// Email previews — run either of these directly from the Apps Script
// editor (select the function name in the dropdown next to Run) to see
// exactly how each client-facing email renders. Each actually sends a
// real email to your own inbox, using the exact same subject/body/HTML-
// building functions as the real client-facing emails — not a mockup
// that could drift out of sync, and not a draft you have to go dig up.
// ---------------------------------------------------------------------

function previewQuoteInvoiceEmail() {
  var myEmail = Session.getActiveUser().getEmail();
  var sampleSummary = 'Video production (Standard (Tier 2), $350), Photography (2 hrs, $200)';
  var sampleTotal = 550;
  var sampleTimeLabel = 'Tuesday, September 15 at 2:00 PM CDT';

  var email = buildQuoteInvoiceEmail('Sample Client', sampleSummary, sampleTotal, sampleTimeLabel);
  GmailApp.sendEmail(myEmail, email.subject, email.plainBody, { htmlBody: email.htmlBody, inlineImages: { nrnlogo: getLogoBlob() } });
  Logger.log('Preview sent to ' + myEmail + ' — check your inbox.');
}

function previewBookingConfirmationEmail() {
  var myEmail = Session.getActiveUser().getEmail();
  var sampleSummary = 'Photography (2 hrs, $200)';
  var sampleTimeLabel = 'Saturday, September 5 at 12:30 PM CDT';
  var sampleMeetLink = 'https://meet.google.com/abc-defg-hij';

  var email = buildBookingConfirmationEmail('Sample Client', sampleSummary, sampleTimeLabel, sampleMeetLink);
  GmailApp.sendEmail(myEmail, email.subject, email.plainBody, { htmlBody: email.htmlBody, inlineImages: { nrnlogo: getLogoBlob() } });
  Logger.log('Preview sent to ' + myEmail + ' — check your inbox.');
}

// ---------------------------------------------------------------------
// "A little about you" intake — logs every lead (name, role, budget,
// timeline, how they found you) to the Clients sheet, right after they
// pick services and before booking or requesting an estimate.
// ---------------------------------------------------------------------

function saveLead(p) {
  var name = p.name;
  var email = p.email;
  if (!name || !email || !isValidEmail(email)) {
    return { success: false, error: 'Missing or invalid name/email' };
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CLIENTS);
  if (!sheet) return { success: false, error: 'Clients sheet not found — see SETUP.md' };

  sheet.appendRow([
    new Date(),
    name,
    email,
    p.role || '',
    p.heardAbout || '',
    p.budget || '',
    p.timeline || '',
    p.summary || '',
    Number(p.total) || 0,
    p.phone || '',
    p.location || '',
    p.details || ''
  ]);

  return { success: true };
}

// ---------------------------------------------------------------------
// "Email me this estimate" — no-call, low-commitment path.
// ---------------------------------------------------------------------

function emailEstimate(email, summary, total) {
  if (!isValidEmail(email)) {
    return { success: false, error: 'Invalid email' };
  }
  var body = [
    'Hi,',
    '',
    "Here's the estimate for what you selected on nrnszn.com:",
    '',
    summary || '(no services selected)',
    '',
    'Estimated total: $' + (total || 0),
    '',
    "This is a starting estimate based on our published rates. It includes the deposit required to book — deposits are non-refundable, and for some services they're credited toward your final balance, for others they're not. Full terms are spelled out in the service agreement for whichever service you book. When you're ready, you can book a consultation any time from the same page.",
    '',
    'Best,',
    'NuRenaissance Team'
  ].join('\n');

  GmailApp.sendEmail(email, 'Your NuRenaissance Media estimate', body);
  return { success: true };
}

// ---------------------------------------------------------------------
// Fathom -> Gmail draft
// Point a Fathom webhook (event: new-meeting-content-ready) at this same
// /exec URL. Fathom sends a POST after each meeting finishes processing;
// this creates a Gmail draft addressed to the client, never auto-sends.
// ---------------------------------------------------------------------

function doPost(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ success: false, error: 'Invalid JSON' });
  }

  // Widget actions carry an explicit "action" field. Fathom's webhook
  // payload never has one, so anything without a recognized action
  // falls through to the existing Fathom handling below — this keeps
  // that integration working exactly as before.
  if (payload.action === 'lead' || payload.action === 'book' || payload.action === 'estimate') {
    try {
      if (payload.action === 'lead') return jsonOut(saveLead(payload));
      if (payload.action === 'book') return jsonOut(bookSlot(payload.date, payload.time, payload.name, payload.email, payload.summary, payload.total));
      if (payload.action === 'estimate') return jsonOut(emailEstimate(payload.email, payload.summary, payload.total));
    } catch (err) {
      Logger.log('doPost error (action=' + payload.action + '): ' + err + (err && err.stack ? '\n' + err.stack : ''));
      return jsonOut({ success: false, error: 'Something went wrong. Please try again or contact NuRenaissance Media directly.' });
    }
  }

  Logger.log(JSON.stringify(payload));
  try {
    return handleFathomRecap(payload);
  } catch (err) {
    Logger.log('doPost error in handleFathomRecap: ' + err + (err && err.stack ? '\n' + err.stack : ''));
    return jsonOut({ success: false, error: 'Something went wrong processing this webhook.' });
  }
}

function handleFathomRecap(payload) {
  var meeting = payload.meeting || payload;
  var title = meeting.title || meeting.meeting_title || 'our meeting';
  var meetingUrl = meeting.meeting_url || meeting.url || '';
  var summaryObj = meeting.summary;
  var summaryText = (summaryObj && (summaryObj.markdown_formatted || summaryObj.text)) || summaryObj || '';
  var actionItems = meeting.action_items || meeting.actionItems || [];
  var participants = meeting.invitees || meeting.participants || meeting.attendees || [];

  var clientEmail = findClientEmail(participants);
  if (!clientEmail) {
    return jsonOut({ success: false, error: 'No client email found in payload' });
  }

  var subject = 'Recap: ' + title;
  var body = buildRecapEmail(title, summaryText, actionItems, meetingUrl);

  GmailApp.createDraft(clientEmail, subject, body);
  return jsonOut({ success: true, draftedTo: clientEmail });
}

function findClientEmail(participants) {
  var myEmail = Session.getActiveUser().getEmail().toLowerCase();
  for (var i = 0; i < participants.length; i++) {
    var email = (participants[i].email || '').toLowerCase();
    if (email && email !== myEmail) return participants[i].email;
  }
  return null;
}

function buildRecapEmail(title, summaryText, actionItems, meetingUrl) {
  var lines = [
    'Hi,',
    '',
    'Great connecting today. Here\'s a quick recap of what we covered:',
    '',
    summaryText || '(summary unavailable — check the Fathom recording)'
  ];

  if (actionItems && actionItems.length) {
    lines.push('');
    lines.push('Next steps:');
    actionItems.forEach(function (item) {
      lines.push('- ' + (item.description || item.text || item));
    });
  }

  if (meetingUrl) {
    lines.push('');
    lines.push('Full recording: ' + meetingUrl);
  }

  lines.push('');
  lines.push('Let me know if I\'m missing anything, and I\'ll follow up on next steps — including the service agreement and deposit invoice to lock in your date.');
  lines.push('');
  lines.push('Best,');
  lines.push('Nick');

  return lines.join('\n');
}
