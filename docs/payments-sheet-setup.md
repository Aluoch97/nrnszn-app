# Payment-click logger without Apps Script: one-time setup

When someone taps PayPal, Cash App, Venmo, Zelle or Apple Pay on your Support/About page, the site adds one row to the **Payments** tab
of your **NuRenaissance Payments Log** sheet. That used to run through an Apps Script; it can now run on the site itself
(`/api/payment`). The sheet, the Dashboard and Expenses tabs, and the "Confirmed" checkboxes work exactly as before. It only
logs the click: it never touches money and never stops anyone from paying.

Until the steps below are done, the site simply passes each click on to the old Apps Script, so nothing breaks.

## Use a separate Google account for this one (it WRITES)
The gallery and cinema key can only read. This one can add rows, so give it its own service account, shared on this one sheet only.

1. console.cloud.google.com → the same project as before (`nugallery`) → menu (☰) → **IAM & Admin** → **Service Accounts** →
   **Create service account**. Name: `nrn-payments-writer`. **Create and continue**, skip the optional steps, **Done**.
2. Click it → copy its **email address** → **Keys** tab → **Add key** → **Create new key** → **JSON** → **Create** (a `.json` file downloads).
3. Make sure the **Google Sheets API** is enabled for the project (APIs & Services → Library → Google Sheets API → Enable; you did this for the cinema).
4. Open the **NuRenaissance Payments Log** spreadsheet → **Share** → paste the new account's email → role **Editor** →
   untick "Notify people" → **Share**. Do not share anything else with it.
5. Cloudflare dashboard → **Workers & Pages** → the nrnszn project → **Settings** → **Variables and Secrets** → **Add** → type **Secret**,
   name exactly `PAYMENTS_SERVICE_ACCOUNT_JSON`, value = the whole contents of the downloaded `.json` file → **Save**.
6. **Deployments** → the latest → **⋯** → **Retry deployment** (secrets apply to the next deployment).
7. Delete the downloaded `.json` file from your computer.

## Check it
1. Open `https://www.nrnszn.com/api/payment`. You should see `"status":"ok"` and `"mode":"sheet"` (it says `"mode":"apps-script"` until the secret is set).
2. Tap one payment button on the site, then look at the **Payments** tab: a new row should appear within a few seconds, with the time in Nashville
   time and "Confirmed" unticked. Delete that test row afterwards.

## Good to know
- If Google refuses the write (for example the sheet was not shared), the click is handed to the old Apps Script, so it is still logged.
- If a write times out and it cannot be known whether the row was saved, the click is **not** sent to the old script as well, so a payment is never logged twice.
  (In that rare case one click may be missing; the widget never shows an error to the customer.)
- The flood guard (1000 logged clicks per platform per hour) is now counted per Cloudflare data centre, so it is approximate. It still only ever
  blocks the logging of a click, never a payment.
- The Apps Script `setupDashboard` (the one-time dashboard builder) stays in Apps Script: it is run by hand and is not part of the website.
