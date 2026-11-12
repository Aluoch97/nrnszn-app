# Daily Certified Lounge recap e-mail at the edge: one-time setup

Every morning the recap check looks for a new finished livestream on the @nrnszn YouTube channel, works out which show it was from the
survey responses of the previous days, and e-mails that show's opted-in subscribers a link to the recap. The old Apps Script does this
with a Google timer. The new version does the same thing from the site, started once a day by a small GitHub job.
**Until the steps below are done, the old Apps Script timer keeps doing it, so nothing breaks and nobody is e-mailed twice.**

You need the three survey secrets from `docs/survey-migration-plan.md` first (survey service account, Resend key, unsubscribe secret), plus:

1. **Make up a long random password** for the recap job (for example, 40 random letters and numbers). Call it the recap token.
2. **Cloudflare:** Workers & Pages → the nrnszn project → **Settings** → **Variables and Secrets** → **Add** → name `RECAP_CRON_TOKEN`, type **Secret**,
   value = the token → **Save**. Then **Deployments** → latest → **⋯** → **Retry deployment** (secrets only apply to a new deployment).
   (Optional: `RECAP_DAILY_CAP` as a plain variable, the most recap e-mails sent in one day. Default 50. Resend's free plan allows 100 a day
   for everything, and the NuDirectory Monday Roundup uses up to 90 of them on Monday to Thursday mornings, so keep this low or buy a bigger Resend plan.)
   The YouTube key is the `YOUTUBE_API_KEY` the site already uses. Without it the recap falls back to the channel's feed.
3. **GitHub:** the nrnszn-app repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** → name `RECAP_CRON_TOKEN`,
   value = the same token → **Add secret**.

## Check it before trusting it
- Open **Actions** → **Daily recap** → **Run workflow**, tick **preview**, **Run workflow**. In a minute you should get a sample recap e-mail
  marked PREVIEW at your Gmail. Check that it looks right and that its Unsubscribe link opens the site's unsubscribe page.
- Open `https://www.nrnszn.com/api/survey-recap` in a browser: it should say `"mode":"edge"` (it says `"mode":"apps-script"` until everything above is set).
- Run it once for real (same button, preview unticked). The run's log shows what happened, for example `"result":"nothing-ready"` (no finished livestream yet),
  `"already-handled"`, `"no-show"` (it could not tell which show; you also get an e-mail), `"no-recipients"`, `"sent"` or `"partial"`.

## Switch the old one off
Once you have watched a real recap go out from the new job, turn off the old timer so only one sends: in the old survey Apps Script project open **Triggers**
(clock icon) and delete the `checkForRecapVideo` trigger. Until then both can run safely: they share the same "already sent" list
(the `Certified_Lounge_Recap_Log` tab), so a person is never e-mailed twice for the same show.

## How it behaves
- It never e-mails the same person twice for the same show, never e-mails anyone who unsubscribed, and skips responses that did not tick the box.
- If a daily cap splits a big list, the rest goes out the next morning (the video is only marked done when the list is finished), and you get an e-mail saying so.
- A failed send is not logged as sent, so the next run tries again. Any failure is e-mailed to you.
- Calling it twice the same day does nothing the second time.
- Recap e-mails now come from `survey@mail.nrnszn.com` through Resend (not from your Gmail), replies still go to you, and the Unsubscribe link goes to the site's page.
