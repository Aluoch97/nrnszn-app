# Apps Script backups

Copies of the Google Apps Script backends behind nrnszn.com, so every change has history on GitHub.
Google's editor is still where the code runs. This folder is the backup and the change log.

| Backend | Folder | Where it lives in Google | Backed up |
|---|---|---|---|
| Portal API (latest videos, Publish button) | `Code.gs`, `appsscript.json` | Sheet **NuRenaissance Site** → Extensions → Apps Script | Yes |
| NuGallery | `gallery/` | Drive file **NuGallery** (in the NuGallery folder) | Yes (matches the live copy) |
| Services (prices + booking) | `services/` | Attached to the Services sheet | Yes (`appsscript.json` not yet; it needs the Google Calendar API service turned on) |
| NuCinema catalog | `cinema/` | Attached to its sheet | Not yet |
| Support (payment logger) | `support/` | Attached to its sheet | Not yet |
| Survey | `survey/` | Attached to its sheet | Not yet |

The Certified Lounge photo saver is backed up in the `certified-certified` repo under `apps-script/photos/`.

## Adding a missing one
1. Open the sheet, then **Extensions → Apps Script**.
2. Copy each file (usually just `Code.gs`) and paste it into a chat with Claude, or into
   `apps-script/<folder>/Code.gs` with GitHub's web editor.
3. In the editor, **Project Settings → Show "appsscript.json"** and copy that file too.

## Keys stay out
Never paste a key, token or password into these files. Put it in **Project Settings → Script properties**
and read it with `PropertiesService.getScriptProperties().getProperty('NAME')`.
`npm run check` fails if anything here looks like a key.

## Changing a backend
1. Edit the file here first and commit it on a branch.
2. Paste the new code into the Apps Script editor and save.
3. **Deploy → Manage deployments → pencil icon → Version: New version → Deploy.**
   This keeps the same `/exec` URL. A brand-new deployment would change the URL and break the site.
4. Run `node scripts/check-backends.mjs` (or wait for the daily GitHub check) to confirm it still answers.

## Refreshing a backup from Google
Claude can export a standalone script from Drive (export type `application/vnd.google-apps.script+json`)
and unpack it with:

```
node scripts/apps-script-unpack.mjs export.json apps-script/<folder>
```

Scripts attached to a sheet don't show up in Drive, so those need to be copied by hand as above.
