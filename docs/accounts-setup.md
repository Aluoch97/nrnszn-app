# One NuRenaissance account: setup

What it does: people sign in once (Google, or an e-mail link) at **www.nrnszn.com/account** and are signed in on nrnszn.com,
Certified (play.nrnszn.com), NuDirectory (directory.nrnszn.com) and luoh (luoh.nrnszn.com). Soul Vault (soulnicolas.com) is a different
website, so it gets a quick one-time hop through nrnszn.com instead of the shared cookie. Clients see their projects (status, total,
paid, balance); you manage them in /admin > Clients & projects.

The accounts are **luoh's existing accounts database**, so everyone who already made a luoh account keeps it.

Until steps 1 and 2 are done, the Account page says "coming soon" and nothing else changes.

## 1. Connect luoh's database to the nrnszn project
Cloudflare > **Workers & Pages** > **nrnszn-app** > **Settings** > **Bindings** > **Add** > **D1 database**
- Variable name: `ACCOUNTS_DB`
- D1 database: pick **the same database luoh uses** (on the luoh / podi project it is bound as `PODI_DB`; Workers & Pages > luoh > Settings > Bindings shows its name).

## 2. One shared secret, in BOTH projects
Make up a long random value (at least 16 characters; 40 is better, for example from a password manager). Then add it, with the exact same value, twice:
- **nrnszn-app** > Settings > **Variables and Secrets** > **Add** > type **Secret**, name `NRN_ACCOUNT_SECRET`, value = it.
- **luoh** (the Pages project behind luoh.nrnszn.com) > Settings > Variables and Secrets > Add > Secret, name `NRN_ACCOUNT_SECRET`, same value.

It signs the sign-in cookie. Changing it later signs everyone out of every app (nothing is lost).
luoh's own `AUTH_SECRET` stays as it is, so nobody on luoh is signed out by this.

## 3. Google sign-in
- nrnszn-app > Variables and Secrets > Add > type **Text**, name `GOOGLE_CLIENT_ID`, value = **the same client id luoh uses** (luoh's `VITE_GOOGLE_CLIENT_ID`; it ends in `.apps.googleusercontent.com`).
- Google Cloud console > **APIs & Services** > **Credentials** > that OAuth client > **Authorized JavaScript origins** > **Add URI**: `https://www.nrnszn.com` (and `https://nrnszn.com`) > **Save**. It can take a few minutes to start working.

## 4. E-mail links
Nothing new: they use the `RESEND_API_KEY` the survey already uses, sent from `account@mail.nrnszn.com` (change with a Text variable `ACCOUNTS_FROM_EMAIL`).
To protect the shared Resend free tier (100 a day, also NuDirectory and the newsletters), at most 40 sign-in e-mails go out per 24 hours (luoh's count too) and 3 per address per 10 minutes. Past that, the page asks people to use Google.

## 5. Redeploy and check
- nrnszn-app > **Deployments** > latest > **⋯** > **Retry deployment**; do the same on luoh.
- /admin > Setup checklist: the "NuRenaissance accounts" group should say Set three times.
- Open www.nrnszn.com/account on your phone, sign in with Google. Then open luoh.nrnszn.com: you should already be signed in.
- /admin > Clients & projects > Add a project with YOUR e-mail and a total, add a payment, then reload /account: you should see it with the balance.

## 6. Stripe payments on accounts (card and Apple Pay)
So card / Apple Pay payments show in people's accounts, and "Pay by card" on a project lowers its balance by itself:
1. Stripe dashboard → **Developers** → **Webhooks** → **Add endpoint**.
2. Endpoint URL: `https://www.nrnszn.com/api/stripe-webhook`. Events: **checkout.session.completed** and **checkout.session.async_payment_succeeded** → **Add endpoint**.
3. On the new endpoint, **Signing secret** → **Reveal** → copy it (starts with `whsec_`).
4. Cloudflare → nrnszn-app → Settings → Variables and Secrets → **Add** → type **Secret**, name `STRIPE_WEBHOOK_SECRET`, value = that → Save → retry the deployment.
5. /admin → What visitors send → "Stripe payments" should say On.
"Pay by card" uses the same Stripe link as the Support page's Apple Pay button. If that link has a fixed price, set it to "Let customers choose what to pay" in Stripe (Payment Links → the link → Edit), or clients cannot pay a balance with it.
PayPal, Cash App, Venmo and Zelle cannot tell the site anything: mark those payments by hand in /admin → Clients & projects.

## What is not built yet (honest list)
- **Certified Passport** (shows you bought tickets for) waits on moving tickets to Stripe checkout.
- Soul Vault and NuDirectory only show who is signed in for now; nothing there is locked behind an account.
- Nothing here has been tried against the real Google sign-in or on a real phone from this session (it cannot reach Google or Cloudflare).
