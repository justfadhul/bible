# Sign-in codes — the one setting that has to be changed

Manna signs people in with a **six-digit code**, not a link. The app is done; the codes will not
appear in anyone's inbox until two email templates in Supabase are edited. Five minutes, once.

---

## Why a code

Supabase mints the same token either way — the link and the code are two renderings of one
credential, and `signInWithOtp` sends whichever the template asks for. The difference is entirely in
what has to be true for it to work:

| | A link | A code |
|---|---|---|
| Opened on the wrong device | signs in the laptop, not the phone in your hand | cannot happen |
| Corporate mail scanner pre-fetches it | token spent before you touch it | nothing to follow |
| New domain, new preview deploy | needs adding to Supabase's redirect allow-list or it bounces | no configuration at all |
| Same tab you started in | only if the mail app cooperates | always |

The redirect allow-list is the one that actually bites. It is a list that has to be kept in step
with every deployment URL forever, and when it falls out of step the failure is silent — Supabase
redirects to the Site URL and the reader lands somewhere unexpected, still signed out. A code has no
allow-list, so there is nothing to fall out of step.

---

## What to change

**Supabase → Authentication → Emails.** Two templates, because Supabase uses a different one
depending on whether the address has been seen before:

| Template | Sent to |
|---|---|
| **Confirm signup** | an address signing in for the first time |
| **Magic Link** | an address that already has an account |

Both currently render `{{ .ConfirmationURL }}` and nothing else. Both need `{{ .Token }}` — that is
the six digits. Miss one and half the people who try to sign in get an email they cannot use, which
is a worse failure than either template being wrong, because it only shows up for some people.

Paste this into **both** (subject: `Your Manna sign-in code`):

```html
<h2>Your sign-in code</h2>
<p>Enter this in Manna to finish signing in:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,monospace">
  {{ .Token }}
</p>
<p>It is good for one hour, and only on the device that asked for it.</p>
<p style="color:#666;font-size:13px">If you did not ask to sign in, ignore this — nothing happens
until the code is entered.</p>
```

Keeping `{{ .ConfirmationURL }}` as well is fine — the app still honours a link if one is opened,
and the token is the same either way. Dropping it is cleaner.

### While you are in there

- **Authentication → Providers → Email**: "Enable email provider" on, "Confirm email" on. Both were
  already set when this was last checked.
- **Authentication → URL Configuration**: nothing here is needed any more. The redirect allow-list
  only governs links, and there are none.

---

## Checking it

1. Open the app, enter your address, tap **Email me a code**.
2. The email should contain six digits. If it contains only a link, the template edit did not save,
   or you edited only one of the two.
3. Type them in. The form submits itself on the sixth digit; on iOS the code is offered above the
   keyboard, so it is usually one tap.
4. Sign out and repeat with the same address — that exercises the **Magic Link** template, which is
   the one people forget.

Test with an address that has never signed in *and* one that has. They take different templates.

---

## Limits worth knowing

- **One code per minute per address.** The Resend button counts down rather than letting anyone hit
  a wall they cannot see.
- **One hour of validity**, which the app states on screen so nobody hunts for a code from yesterday.
- **Supabase's built-in SMTP is rate-limited and not for real use** — a handful of emails an hour,
  and delivery is best-effort. For anything beyond the two of you testing, set a custom SMTP sender
  under Project Settings → Authentication → SMTP. Nothing in the app changes.
- A wrong or stale code comes back from Supabase as `otp_expired` / "Token has expired or is
  invalid". The app rewords that to "That code is wrong, or it has expired. Ask for a new one."
