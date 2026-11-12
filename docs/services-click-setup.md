# Services "most booked" counter at the edge: one-time setup

When someone adds a service on the Services page, the page counts a click for it (that is what the "most booked" badge is based on).
The new counter does that straight in the **NuServices** Google Sheet (Services tab, Clicks column) instead of through the Apps Script.
Until the steps below are done, the old Apps Script keeps counting, so nothing breaks.

Because this one **writes** to your sheet, it has its own Google service account key, separate from the read-only one the gallery,
cinema and prices use. (You can reuse the account you make for payments or the survey: it is the same kind of key, you just paste it
into a different Cloudflare secret. Using one account for all three writers is fine.)

1. **Use or make a writer service account.** Same steps as `docs/payments-sheet-setup.md` (Google Cloud Console → IAM & Admin → Service
   Accounts → create → Keys → Add key → JSON). Make sure the **Google Sheets API** is turned on.
2. **Share the NuServices sheet with it as Editor.** Open the **NuServices** spreadsheet → **Share** → paste the service account's email →
   role **Editor** → untick "Notify people" → **Share**.
3. **Add the Cloudflare secret.** Cloudflare → Workers & Pages → the nrnszn project → **Settings** → **Variables and Secrets** → **Add** →
   name `SERVICES_SERVICE_ACCOUNT_JSON`, type **Secret**, paste the whole JSON file → **Save**.
4. **Retry the deployment** (secrets only apply to a new deployment): **Deployments** → latest → **⋯** → **Retry deployment**.

## Check it
Open `https://www.nrnszn.com/api/service-click` in a browser. You should see `"mode":"sheet"` (it says `"mode":"apps-script"` until the secret is set).
Opening that address never counts a click. Then add a service on the Services page and look at that service's **Clicks** cell in the sheet: it goes up by 1.

## How it behaves
- A click goes to exactly one place. If Google refuses before anything is written, the old Apps Script counts it instead. If a timeout means nobody can
  tell whether the number was updated, it is not sent again, so it never counts twice.
- At most 120 counted clicks an hour per service (a guard against bots); real visitors never come close.
- The prices feed is kept for about 5 minutes, so a new count shows up in "most booked" within that time.
