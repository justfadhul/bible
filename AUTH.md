# Accounts — how sign-in works, and the one setting to change

Manna signs people in with an **email and a password**. Two things still travel by email, and both
of them are a **six-digit code**, never a link:

| When | Why a code |
|---|---|
| Confirming a brand-new address | Proves the address is real before the account is usable |
| Forgotten password | Proves it is still yours before the password changes |

Everything is built. The codes will not appear in anyone's inbox until two email templates in
Supabase are edited. Five minutes, once.

---

## Why a code and not a link

Supabase mints the same token either way — the link and the code are two renderings of one
credential, and the template decides which arrives. The difference is what has to be true for it to
work:

| | A link | A code |
|---|---|---|
| Opened on the wrong device | signs in the laptop, not the phone in your hand | cannot happen |
| Corporate mail scanner pre-fetches it | token spent before you touch it | nothing to follow |
| New domain, new preview deploy | needs adding to Supabase's redirect allow-list or it bounces | no configuration at all |

The allow-list is the one that actually bites: a list that has to be kept in step with every
deployment URL forever, whose failure is silent — Supabase redirects to the Site URL and the reader
lands somewhere unexpected, still signed out. A code has no allow-list, so nothing can fall out of
step.

---

## What to change

**Supabase → Authentication → Emails.** Two templates, because Supabase picks between them by
whether it has seen the address before:

| Template | Sent to |
|---|---|
| **Confirm signup** | a brand-new account, on the way to being confirmed |
| **Magic Link** | an existing account asking for a password reset |

Both currently render `{{ .ConfirmationURL }}` and nothing else. Both need `{{ .Token }}` — that is
the six digits. Miss one and half the flows break, which is harder to notice than all of them
breaking.

Paste this into **both** (subject: `Your Manna code`):

```html
<h2>Your code</h2>
<p>Enter this in Manna to carry on:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,monospace">
  {{ .Token }}
</p>
<p>It is good for one hour, and only on the device that asked for it.</p>
<p style="color:#666;font-size:13px">If you did not ask for this, ignore it — nothing happens until
the code is entered.</p>
```

Keeping `{{ .ConfirmationURL }}` as well is fine; the token is the same either way. Dropping it is
cleaner.

### Optional: skip the confirmation step entirely

**Authentication → Providers → Email → Confirm email.** Leave it **on** and a new account has to
enter a code before it works — the app handles that and says so. Turn it **off** and `signUp` hands
back a session immediately, so creating an account is one tap and no email is involved at all.

On is the safer default and is what the project currently has. Off is defensible for two people
sharing a reading log. The app works either way with no code change — it reads which happened from
Supabase's response rather than assuming.

Password resets still need the template edit regardless of this setting.

### Nothing to do under URL Configuration

The redirect allow-list only governs links, and there are none.

---

## Checking it

1. **Create an account** with an address you can read. If Confirm email is on, you land on the code
   step; the email should contain six digits. If it contains only a link, the template edit did not
   save.
2. Sign out, sign back in with the password. That path touches no email at all.
3. **Forgot password** → new password → code. That exercises the *Magic Link* template, which is
   the one people forget to edit.
4. Signed in, Settings → Sharing → Account → **Change password** needs no code, because the session
   already proves the address.

---

## Limits worth knowing

- **Passwords are at least 8 characters**, enforced in the app. Supabase's own floor is 6; raising
  the app's floor is free, lowering Supabase's is not worth doing.
- **One code per minute per address.** The Resend button counts down rather than letting anyone hit
  a wall they cannot see.
- **One hour of code validity**, stated on screen so nobody hunts for yesterday's.
- **Supabase's built-in SMTP is rate-limited and not for real use** — a handful of emails an hour,
  best-effort delivery. Set a custom sender under Project Settings → Authentication → SMTP if that
  starts to bite. Nothing in the app changes.
- Supabase will not say whether it was the email or the password that was wrong, and neither does
  the app — that is deliberate, it stops the form being used to discover who has an account. The one
  thing it does name is the case nobody could guess: an account made before passwords existed here
  has no password to get right, so the message points at **Forgot password**.
