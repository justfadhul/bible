# Deploying Manna to Vercel

Everything Vercel needs is already in the repo — `vercel.json` sets the framework, the SPA
rewrite, cache headers and a content security policy. What is left is three settings and one
Supabase change that is easy to miss.

> **A note on `vercel.json`:** Vercel validates it strictly and **rejects any property it does
> not recognise**, rather than ignoring it. JSON has nowhere to put a comment, so the temptation
> to add a `"comment"` key is real — and it fails the build outright. That is what the
> explanations below are for, and `npm run check-deploy` is a tripwire against it.

> **Why you and not me:** this build environment's network policy blocks `api.vercel.com`
> outright (403 at the proxy on CONNECT), so a deploy cannot be driven from here regardless of
> credentials. Everything below is a couple of minutes.

---

## 1. Import the repo

**Dashboard:** vercel.com → Add New → Project → import `justfadhul/bible`.

Vercel reads `vercel.json`, so leave the build settings alone — framework Vite, build
`npm run build`, output `dist`.

The work is on `claude/spin-catalog-bible-wheel-uv9ptc`. Either merge it to your default branch
first, or set Settings → Git → Production Branch to that branch.

**Or the CLI:**

```bash
npm i -g vercel
vercel login
vercel link
vercel --prod
```

## 2. Environment variables

Settings → Environment Variables. Add both to **Production, Preview and Development**:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://ttmgbotjnlcocckumrxr.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | your anon (publishable) key |

Only the **anon** key. It is designed to ship in the client and is protected by row level
security. The service-role key bypasses RLS entirely and must never be set here — it would end up
in the browser bundle, since Vite inlines every `VITE_`-prefixed variable at build time.

These are read at **build** time, so after adding or changing them you must redeploy; editing a
variable alone changes nothing about the running site.

Without them the app still deploys and works — it just runs local-only, and Settings → Sharing
says so.

## 3. Run all three migrations

Supabase → SQL Editor → New query. Paste `supabase/migrations/0001_shared_history.sql`, Run; then
`0002_real_readers.sql`, Run; then `0003_everything_saves.sql`, Run. All three are idempotent, and
they must go in that order — 0003 refuses to run before 0002 rather than half-applying.

| | What it does | Without it |
|---|---|---|
| 0001 | The tables, the row-level security, the invite codes | Nothing syncs at all |
| 0002 | The roster comes from the database, and each reader gets their own note | Somebody who joins never appears, and two people writing about the same passage overwrite each other |
| 0003 | Every account gets a store of its own, so signing in is enough to be saved | Reading only reaches the database once you are in a group — on your own it lives on one phone |

The app still runs with any of them missing, and Settings → Sharing says which one it is.

These are checked, not hoped over: `npm run check-sql` applies all three to a throwaway Postgres,
re-runs them on top of themselves, and then asserts the behaviour — two accounts kept apart, a
private history folded into a group on joining, an invented invite code refused.

## 4. Put the code in the email ← the one that bites

Sign-in is by email and password, but two things still arrive by email as a six-digit code:
confirming a new address, and resetting a forgotten password. Supabase only puts the digits in if
the template asks for them. **Authentication → Emails**: add `{{ .Token }}` to both
**Confirm signup** and **Magic Link**. [AUTH.md](AUTH.md) has the markup to paste, explains why it
is two templates, and covers the optional setting that skips confirmation entirely.

Until that is done those emails arrive containing only a link, with nothing to type into the app.
Ordinary sign-in still works — this breaks the first account and every password reset.

Nothing needs adding to **URL Configuration**. The redirect allow-list governs links, and there are
none; that whole class of "the link does nothing" problem does not exist here.

## 5. Check it

1. Open the deployment in a private window — you should get the Manna sign-in page.
2. **Read on this device** → the wheel. Spin. That path needs no backend at all.
3. Reopen, **Create an account**, and finish it — code included, if confirmation is on. You should
   land signed in with your name filled in from the address.
4. Sign out and back in with the password. That path touches no email at all.
5. Settings → Sharing → **Start a shared history**, then join from a second device with the code.

If step 3 emails you a link and no digits, it is step 4 above — the template.

---

## Notes

**Custom domain.** Settings → Domains, and that is the whole job — there is no redirect allow-list
to keep in step, because nothing Manna sends is a link.

**What is in `vercel.json`, and why.** Since the file cannot carry its own comments:

| Setting | Reason |
|---|---|
| rewrite everything except `assets/`, `favicon`, `manifest`, `robots` → `/index.html` | Single-page app. A refresh or a deep link would otherwise 404. |
| `assets/*` immutable for a year | The filenames are content-hashed, so they can never go stale. |
| `index.html` `must-revalidate` | Otherwise a deploy strands people on the previous bundle. |
| CSP `connect-src` allows `*.supabase.co`, `wss:` and `bible-api.com` | Supabase for the shared history, its websocket scheme for realtime, and bible-api.com for the passage text. Remove the last one and every passage fails to load. |
| CSP `img-src` allows `data:` and `blob:` | Locally-chosen avatars before upload. |
| `nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin` | Ordinary hardening. |

If you add any third-party script or font it will be blocked until you widen `script-src` /
`font-src` deliberately.

**Caching.** Hashed assets are immutable for a year; `index.html` is `must-revalidate`, so a
deploy takes effect on the next load rather than stranding people on an old bundle.

**Not indexed.** `public/robots.txt` disallows everything. It is a private reading log.
