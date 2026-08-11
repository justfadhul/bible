# Deploying Manna to Vercel

Everything Vercel needs is already in the repo — `vercel.json` sets the framework, the SPA
rewrite, cache headers and a content security policy. What is left is three settings and one
Supabase change that is easy to miss.

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

## 3. Tell Supabase about the new domain ← the one that bites

Supabase → Authentication → URL Configuration:

- **Site URL:** `https://<your-project>.vercel.app`
- **Redirect URLs:** add both
  - `https://<your-project>.vercel.app/**`
  - `https://*-<your-team>.vercel.app/**` — so preview deploys work too

The app asks for a magic link back to `window.location.origin + pathname`. If that origin is not
on the allow list, Supabase silently redirects to the Site URL instead, and the link appears to
"do nothing" or lands people on the wrong deployment still signed out. This is the single most
common reason magic links look broken after a first deploy.

While you are there: Authentication → Providers → Email should have **Confirm email** on and
**Enable email provider** on. Both were already set when this was checked.

## 4. Check it

1. Open the deployment in a private window — you should get the Manna sign-in page.
2. **Read on this device** → the wheel. Spin. That path needs no backend at all.
3. Reopen, sign in with your email, tap the link on the same device. You should land back on the
   app signed in, with your name filled in from the address.
4. Settings → Sharing → **Start a shared history**, then join from a second device with the code.

If step 3 returns you signed out, it is almost always step 3 above — the redirect URL.

---

## Notes

**Custom domain.** Settings → Domains. Add the domain to Supabase's redirect list too, or you
will reintroduce the same problem.

**The CSP** in `vercel.json` allows connections to `*.supabase.co` and nothing else, and permits
images from `data:`, `blob:` and Supabase Storage — that covers locally-chosen avatars and
uploaded ones. If you add any third-party script or font, it will be blocked until you widen
`connect-src` / `script-src` deliberately.

**Caching.** Hashed assets are immutable for a year; `index.html` is `must-revalidate`, so a
deploy takes effect on the next load rather than stranding people on an old bundle.

**Not indexed.** `public/robots.txt` disallows everything. It is a private reading log.
