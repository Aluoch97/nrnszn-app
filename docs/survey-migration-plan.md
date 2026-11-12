# Moving the survey off Apps Script: plan and status

The survey backend (`apps-script/survey/Code.gs`, ~1,450 lines) is really four jobs in one script. They are being moved one at a time,
each proven identical to the old code before it is switched on, with the old Apps Script kept as the fallback until the end.

| # | Job | Status |
|---|---|---|
| 1 | **The rules and the e-mails**: what counts as a real submission, the row saved for a show or service response, the thank-you e-mail with the one-time discount code, your notification e-mail for every response, the tamper-proof unsubscribe links, and sending through Resend | **Done** (`src/edge/survey.js`, `tests/survey.unit.mjs`). Not connected to anything yet: the survey still runs on Apps Script. |
| 2 | **Saving to the Sheet**: the response row, the subscriber lists (add / reactivate), the discount-code list, the Summary tab | Next |
| 3 | **The live endpoint** `/api/survey` that the survey page posts to, falling back to Apps Script when its secrets are missing or Google refuses | After 2 |
| 4 | **The unsubscribe page** (`?unsub=1` links in the e-mails) | After 3. Until then the links in e-mails go to the Apps Script address, which keeps working. |
| 5 | **The daily recap newsletter** (finds the recap video on YouTube and e-mails the people who attended) | Probably stays in Apps Script: it runs on a Google timer and does not serve visitors. Moving it needs a scheduler plus a bulk-email budget. |

## What stage 1 proved
The real functions from `Code.gs` were run in a sandbox next to the new code, on hundreds of random inputs, and these matched exactly:
what is dropped (hidden-field trap, "too fast" trap), the row that would be saved (show and service), your notification e-mails, the thank-you
e-mail (subject and every character of the HTML, with and without the "already redeemed" version), the e-mail frame, escaping, and the
unsubscribe tokens and links (so links already sent keep working).

## What stages 2 and 3 will need from you (not needed yet)
- A **separate Google service account that can write** to the **NuRenaissance Surveys** sheet (Editor on that sheet only), like the payments one.
- Your **Resend** API key as the Cloudflare secret `RESEND_API_KEY`. The e-mails would then come from `survey@mail.nrnszn.com` (the domain you already
  verified for NuDirectory) instead of from your Gmail address.
- The survey's **`UNSUB_SECRET`** copied from the Apps Script project (Project Settings, Script properties, or the top of the live `Code.gs`) into Cloudflare, so unsubscribe links
  already sent keep working.

## Things to decide before stage 3
- **Resend's free plan allows 100 e-mails a day for the whole account**, and the NuDirectory Monday Roundup uses up to 90 of them on Mon to Thu mornings.
  Each survey response sends your notification e-mail, plus a thank-you when the person opts in. On a busy show night that could run into the limit.
  (A response is always saved first, so nothing is lost, but a notification or thank-you could fail.) Options: a paid Resend plan, a second Resend account for
  surveys, or one daily digest instead of an e-mail per response.
- E-mails will no longer come from your Gmail address. Replies still go to `nurrenaissance@gmail.com`.
