# NuRenaissance app hub

The interactive side of nrnszn.com, served at **app.nrnszn.com**. It's built with Astro, hosted on Cloudflare Pages, and backed by Google Sheets and Apps Script.

## What's here

| Path | What it is |
|---|---|
| `src/pages/portal.astro` | The Portal (link-in-bio). Live at `/portal`. |
| `src/data/portal.js` | Portal links, socials and playlists. Edit text and links here. |
| `src/styles/tokens.css` | Shared colors, fonts and spacing for every route. |
| `src/lib/api.js` | The only file that talks to Apps Script. |
| `apps-script/` | Backend code to paste into Apps Script. |
| `public/icons/` | Logo, app icons and link-preview image, all made from the NuRenaissance cloud logo. |

## One-time setup

### 1. Put the code on GitHub
Create an empty repo called `nrnszn-app`. Then, from this folder:
```
git remote add origin https://github.com/YOUR-USERNAME/nrnszn-app.git
git push -u origin main
```

### 2. Connect Cloudflare Pages
1. In Cloudflare, go to **Workers & Pages → Create → Pages → Connect to Git** and pick `nrnszn-app`.
2. Choose the **Astro** framework preset. The build command is `npm run build` and the output folder is `dist`.
3. Deploy. You'll get a `nrnszn-app.pages.dev` link to check on your phone.

### 3. Connect the Apps Script backend
1. Create a Google Sheet called **NuRenaissance Site**, then open **Extensions → Apps Script**.
2. Paste in `apps-script/Code.gs`. Turn on **Show appsscript.json** in Project Settings, then paste `apps-script/appsscript.json` over it.
3. **Deploy → New deployment → Web app** (Execute as: Me, Access: Anyone). Copy the `/exec` URL.
4. In Cloudflare, go to **Settings → Environment variables**, add `PUBLIC_API_URL` = that URL, then redeploy.

### 4. Turn on the Publish button
1. In Cloudflare, go to **Settings → Builds → Deploy hooks** and create a hook named `sheet`. Copy the URL.
2. In Apps Script, go to **Project Settings → Script properties** and add `DEPLOY_HOOK_URL` = that URL.
3. Run `setupDailyRebuild` once from the editor and approve the permissions.
4. Reload the Sheet. A **NuRenaissance site → Publish site** menu appears.

### 5. Point the subdomain
In Cloudflare Pages, open **Custom domains** and add `app.nrnszn.com`. Cloudflare shows a CNAME record. Add that record in Wix DNS for now, or in Cloudflare once the domain moves.

## Day-to-day
- **New video uploaded:** nothing to do. The page picks it up live, and the 6 a.m. rebuild bakes it in.
- **Change a link or text:** edit `src/data/portal.js` (GitHub's web editor works on a phone) and commit. It's live in about a minute.
- **Bigger changes:** ask Claude and review the preview link before merging.

## Moving the next widget in
1. Add `src/pages/<name>.astro` and use `Base` and the tokens.
2. Add its action to the router in `Code.gs`, then redeploy the web app as a **new version** of the same deployment so the URL stays the same.
3. Point the matching link in `src/data/portal.js` at `/<name>`.
