# Moving the survey off Apps Script: plan and status

The survey backend (`apps-script/survey/Code.gs`, ~1,450 lines) is really four jobs in one script. They are being moved one at a time,
each proven identical to the old code before it is switched on, with the old Apps Script kept as the fallback until the end.

| # | Job | Status |
|---|---|---|
| 1 | **The rules and the e-mails**: what counts as a real submission, the row saved for a show or service response, the thank-you e-mail with the one-time discount code, your notification e-mail for every response, the tamper-proof unsubscribe links, and sending through Resend | **Done** (`src/edge/survey.js`, `tests/survey.unit.mjs`). Not connected to anything yet: the survey still runs on Apps Script. |
| 2 | **Saving to the Sheet**: the response row, the subscriber lists (add / reactivate), the discount-code list, the thank-you and notification e-mails, the Summary tab | **Done** (`src/edge/survey-sheets.js`, `tests/survey-sheets.unit.mjs`). Still not connected to any URL. |
| 3 | **The live endpoint** `/api/survey` that the survey page posts to, falling back to Apps Script when its secrets are missing or Google refuses | **Built** (`src/edge/survey-api.js`, `functions/api/survey.js`, `tests/survey-api.unit.mjs`). Does nothing until you add the three secrets below; the page already posts to it first and the old Apps Script keeps answering until then. |
| 4 | **The unsubscribe page** (`?unsub=1` links in the e-mails) | **Built** (`handleUnsubscribe` in `src/edge/survey-api.js`, `tests/survey-unsub.unit.mjs`). Lives at `https://www.nrnszn.com/api/survey?unsub=1&…`; switches on with the same three secrets as stage 3. New thank-you e-mails link to it; links already sent point at the Apps Script, which keeps working. |
| 5 | **The daily recap newsletter** (finds the recap video on YouTube and e-mails the people who attended) | **Built** (`src/edge/survey-recap.js`, `survey-recap-api.js`, `.github/workflows/recap-daily.yml`, `tests/survey-recap.unit.mjs`; setup in `docs/survey-recap-setup.md`). A daily GitHub job calls `/api/survey-recap`; Resend sends it in batches under a daily cap. Does nothing until its secret is set; the old Apps Script timer keeps working until you switch it off. |

## What stage 2 proved
The real `doPost` from `Code.gs` was run in a sandbox with an in-memory copy of your sheet (pre-filled with subscribers, an unsubscribed person, a blank-status person, a used discount code, mixed-capital e-mails), next to the new code talking to a fake Google Sheets, over 25 random sequences of show and service responses. The resulting tabs (response rows, both subscriber lists, discount codes, Summary) and every e-mail sent matched. Also checked: a failing e-mail or summary never loses the saved response, missing tabs are created with their header row, rows are written as plain values so nothing is run as a formula, and milliseconds are kept so quick submissions stay in order.
One deliberate difference: a response is added with one atomic "append" instead of Apps Script's read-the-last-row-then-write, so two people submitting at the same instant can no longer collide on a row.

## What stage 1 proved
The real functions from `Code.gs` were run in a sandbox next to the new code, on hundreds of random inputs, and these matched exactly:
what is dropped (hidden-field trap, "too fast" trap), the row that would be saved (show and service), your notification e-mails, the thank-you
e-mail (subject and every character of the HTML, with and without the "already redeemed" version), the e-mail frame, escaping, and the
unsubscribe tokens and links (so links already sent keep working).

## What switches stage 3 on (your part, all three needed together)
- A **separate Google service account that can write** to the **NuRenaissance Surveys** sheet (Editor on that sheet only), like the payments one; its key goes in the Cloudflare secret `SURVEY_SERVICE_ACCOUNT_JSON`.
- Your **Resend** API key as the Cloudflare secret `RESEND_API_KEY`. The e-mails would then come from `survey@mail.nrnszn.com` (the domain you already
  verified for NuDirectory) instead of from your Gmail address.
- The survey's **`UNSUB_SECRET`** copied from the Apps Script project (Project Settings, Script properties, or the top of the live `Code.gs`) into Cloudflare, so unsubscribe links
  already sent keep working (Cloudflare secret `SURVEY_UNSUB_SECRET`).

## Things to decide before stage 3
- **Resend's free plan allows 100 e-mails a day for the whole account**, and the NuDirectory Monday Roundup uses up to 90 of them on Mon to Thu mornings.
  Each survey response sends your notification e-mail, plus a thank-you when the person opts in. On a busy show night that could run into the limit.
  (A response is always saved first, so nothing is lost, but a notification or thank-you could fail.) Options: a paid Resend plan, a second Resend account for
  surveys, or one daily digest instead of an e-mail per response.
- E-mails will no longer come from your Gmail address. Replies still go to `nurrenaissance@gmail.com`.

## How stage 3 behaves
- All three secrets present: the response is saved by the new code. Any one missing: the old Apps Script takes it, as today. `https://www.nrnszn.com/api/survey` (open it in a browser) says `"mode":"sheet"` or `"mode":"apps-script"`.
- A response goes to exactly one backend. If Google refuses before the row is written, the old Apps Script takes it. If a timeout means nobody can tell whether the row was written, it is NOT sent again (no double rows). Once the row is saved, a failing e-mail, subscriber update or summary can never lose it.
- The hidden-field and too-fast traps and the 60-a-minute flood guard behave like the old script (dropped quietly, answered "ok").
- The survey page (`public/widgets/survey.html`) posts to `/api/survey` first and only asks the Apps Script directly if that request cannot be made.

## How stage 4 behaves
- The signed link is checked first (same secret, same token as before), then the person is set to Unsubscribed (with the date) in the right list (show or service), and a small confirmation page says so. Same words as the old page. A forged or mistyped link gets the "doesn't look right" message without touching Google.
- Unsubscribing is safe to repeat, so if anything goes wrong on the new side (a secret missing, Google sign-in or the Sheet failing) the link is passed on to the old Apps Script page instead of showing an error.
- The daily recap e-mails (stage 5, still Apps Script) keep their Apps Script unsubscribe links, which work as before.

## How stage 5 behaves
- A daily GitHub job (about 10am Nashville) calls `POST /api/survey-recap` with a secret token. The site finds the latest finished livestream (YouTube Data API, with the channel feed as fallback), matches it to a show from the survey responses of the previous 4 days, and e-mails that show's opted-in subscribers who have not had it yet and have not unsubscribed.
- Same rules and same e-mail as the old script (proven against its real `checkForRecapVideo` on 150 random sheets and across two and three consecutive days). The sent-log tab is shared with the old script, so nobody gets it twice while both exist.
- Differences on purpose: Resend instead of Gmail (batches of 50, a `RECAP_DAILY_CAP` default of 50 a day instead of Gmail's quota), the "already handled" video is remembered in a small tab (`Certified_Lounge_Recap_State`) instead of an Apps Script property, and the Unsubscribe link goes to the site's page.
- A preview (`?preview=1`, or the "preview" tick when running the job by hand) sends the sample e-mail to Nick only.
