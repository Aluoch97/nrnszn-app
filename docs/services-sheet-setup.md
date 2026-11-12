# Services prices from the Google Sheet (no Apps Script for visitors): one-time setup

The Services page can read the **NuServices** Google Sheet (the Services, Service_Tiers and Bundles tabs) itself, instead of through
the Apps Script web app. You keep editing prices in the Sheet exactly as before. Until the steps below are done, the old Apps Script
keeps answering, so nothing breaks.

**What does NOT move:** booking a consultation (Google Calendar invite with a Meet link), the Gmail confirmations, estimate and
invoice e-mails, and the 30-minute invoice timer. They use your own Google account's Calendar and Gmail, so they stay in Apps Script.
(The "most booked" click counter and lead capture are Sheet-only and can move later.)

This uses the **same Google service account and Cloudflare secret as the gallery and cinema** (`docs/gallery-drive-setup.md`).
If you have not done that yet, do steps 1 to 3 there first, and turn on the Google Sheets API (step 1 of `docs/cinema-sheet-setup.md`). Then:

1. **Share the Sheet with the service account.** Open the **NuServices** spreadsheet in Google Sheets → **Share** → paste the
   service account's email (`nugallery-reader@….iam.gserviceaccount.com`) → role **Viewer** → untick "Notify people" → **Share**.
2. **Retry the Cloudflare deployment** if you added the secret earlier: Workers & Pages → the nrnszn project → **Deployments** →
   latest → **⋯** → **Retry deployment**.

## Check it
Open `https://www.nrnszn.com/api/feed/services`. Near the end you should see `"source":"sheet"`. Then open the Services page and
check a few prices. If `"source"` is missing, the old Apps Script answered (Sheets API off, sheet not shared, or no secret); the page works either way.

Price changes you make in the Sheet appear within about 5 minutes.
