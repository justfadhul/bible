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

## 3. Put the code in the email ← the one that bites

Sign-in is by six-digit code, and Supabase only puts the digits in the email if the template asks
for them. **Authentication → Emails**: add `{{ .Token }}` to both **Confirm signup** and
**Magic Link**. [AUTH.md](AUTH.md) has the markup to paste and explains why it is two templates.

Until that is done, sign-in emails arrive containing only a link, and there is nothing to type into
the app. Everything else works — this is the only step that can leave the deployment half-usable.

Nothing needs adding to **URL Configuration**. The redirect allow-list governs links, and there are
none; that whole class of "the link does nothing" problem does not exist here.

## 4. Check it

1. Open the deployment in a private window — you should get the Manna sign-in page.
2. **Read on this device** → the wheel. Spin. That path needs no backend at all.
3. Reopen, enter your email, and type the six digits it sends. You should land signed in with your
   name filled in from the address.
4. Settings → Sharing → **Start a shared history**, then join from a second device with the code.

If step 3 emails you a link and no digits, it is step 3 above — the template.

---

## Notes

**Custom domain.** Settings → Domains, and that is the whole job — there is no redirect allow-list
to keep in step, because sign-in is by code.

**What is in `vercel.json`, and why.** Since the file cannot carry its own comments:

| Setting | Reason |
|---|---|
| rewrite everything except `assets/`, `favicon`, `manifest`, `robots` → `/index.html` | Single-page app. A refresh or a deep link would otherwise 404. |
| `assets/*` immutable for a year | The filenames are content-hashed, so they can never go stale. |
| `index.html` `must-revalidate` | Otherwise a deploy strands people on the previous bundle. |
| CSP `connect-src` limited to `*.supabase.co` plus `wss:` | The app talks to exactly one host. Realtime needs the websocket scheme spelled out separately. |
| CSP `img-src` allows `data:` and `blob:` | Locally-chosen avatars before upload. |
| `nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin` | Ordinary hardening. |

If you add any third-party script or font it will be blocked until you widen `script-src` /
`font-src` deliberately.

**Caching.** Hashed assets are immutable for a year; `index.html` is `must-revalidate`, so a
deploy takes effect on the next load rather than stranding people on an old bundle.

**Not indexed.** `public/robots.txt` disallows everything. It is a private reading log.
