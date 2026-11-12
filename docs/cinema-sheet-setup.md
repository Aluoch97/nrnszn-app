# NuCinema catalog from the Google Sheet (no Apps Script for visitors): one-time setup

The Cinema page can read the **NuCinema** Google Sheet itself, instead of through the Apps Script web app. You keep editing the
catalog in the Sheet exactly as before. The Sheet's own **🎬 Cinema Admin** menu (check for new uploads, import a show's episodes)
keeps working too; it still runs in Google and writes rows into the Sheet, which the site then reads.

Until the steps below are done, the old Apps Script keeps answering, so nothing breaks.

This uses the **same Google service account and Cloudflare secret as the gallery** (`docs/gallery-drive-setup.md`). If you have not
done that yet, do steps 1 to 3 there first. Then:

1. **Turn on the Sheets API.** console.cloud.google.com → pick the same project (`nugallery`) → menu (☰) → **APIs & Services** →
   **Library** → search **Google Sheets API** → **Enable**.
2. **Share the Sheet with the service account.** Open the **NuCinema** spreadsheet in Google Sheets → **Share** → paste the service
   account's email (`nugallery-reader@….iam.gserviceaccount.com`) → role **Viewer** → untick "Notify people" → **Share**.
3. **Retry the Cloudflare deployment** if you added the secret earlier (secrets only apply to a new deployment): Workers & Pages →
   the nrnszn project → **Deployments** → latest → **⋯** → **Retry deployment**.

## Check it
Open `https://www.nrnszn.com/api/feed/cinema`. Near the end you should see `"source":"sheet"`. Then open the Cinema page and
check the featured video, the Films rows and a show's episode list. If `"source"` is missing, the old Apps Script answered
(the Sheets API is not enabled, the sheet is not shared with the service account, or the secret is not set); the page works either way.

Changes you make in the Sheet appear within about 5 minutes.
