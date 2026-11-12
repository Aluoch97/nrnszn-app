# NuGallery from Google Drive (no Apps Script): one-time setup

The site can read the NuGallery folder in Google Drive itself, instead of through the Apps Script. You keep managing photos in
Drive exactly as before (same folders, same `cover_` files, same Description format). Until the secret below is set, the old
Apps Script keeps answering, so nothing breaks while you do this.

## 1. Make a read-only Google "service account"
1. Go to console.cloud.google.com and sign in with the Google account that owns the NuGallery folder.
2. Top bar → project picker → **New project** → name it `nugallery` → **Create**, then make sure it is the selected project.
3. Menu (☰) → **APIs & Services** → **Library** → search **Google Drive API** → **Enable**.
4. Menu → **IAM & Admin** → **Service Accounts** → **Create service account**. Name: `nugallery-reader`. Click **Create and continue**,
   skip the two optional steps (no roles), click **Done**.
5. Click the new account in the list. Copy its **email address** (looks like `nugallery-reader@nugallery-123456.iam.gserviceaccount.com`).
6. Open the **Keys** tab → **Add key** → **Create new key** → **JSON** → **Create**. A `.json` file downloads. This file is a password:
   do not email it or put it in GitHub.

## 2. Let it see the gallery folder
In Google Drive: right-click the **NuGallery** root folder → **Share** → paste the service account's email → role **Viewer**
→ untick "Notify people" → **Share**. (Photos stay shared "Anyone with the link", as now; the site still shows them through its cache.)

## 3. Give the key to Cloudflare
1. Cloudflare dashboard → **Workers & Pages** → the nrnszn project → **Settings** → **Variables and Secrets** → **Add**.
2. Type **Secret**, name exactly `GOOGLE_SERVICE_ACCOUNT_JSON`. For the value, open the downloaded `.json` file in Notepad/TextEdit,
   select everything, copy, and paste it in. **Save**.
3. Secrets apply to the next deployment: **Deployments** → the latest one → **⋯** → **Retry deployment**.
4. Delete the downloaded `.json` file from your computer (the copy in Cloudflare is the one that matters).

## 4. Check it
Open `https://www.nrnszn.com/api/feed/gallery`. Near the end of the text you should see `"source":"drive"`. Then open the Gallery page and
click through a few rooms. If `"source"` is missing, the old Apps Script answered (the secret is not set yet, the folder is not
shared with the service account, or the Drive API is not enabled); the Gallery still works either way.

New photos and folders show up within about 5 minutes (the feed refreshes itself). To stop using the old Apps Script entirely,
wait a few days, then retire it (see `apps-script/README.md`).
