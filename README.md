# Manna

*A daily portion of Scripture, gathered together.*

Named for Exodus 16: gathered fresh each morning, exactly one day's worth, and it could not be
kept overnight. That is this app's rule rather than a decoration on top of it — one spin a day,
binding, no stockpiling, and the same portion for everyone reading together.

A daily Bible reading wheel for two people, or up to eight. Spin once a day, read whatever comes
up, discuss it.

The point is that neither of you chooses. So the app will not let you re-roll, and no passage
comes up twice until all 286 have been read.

**Deploying:** see [DEPLOY.md](DEPLOY.md). The name lives in one place, `src/lib/brand.js`.

```bash
npm install
npm run dev      # http://localhost:5173
npm run check    # validate catalog → no duplication → tests → 200-run simulation → build
npm run build:single   # one self-contained HTML file, zero external requests
```

---

## The catalog is the source of truth

`bible-wheel-catalog.json` holds 286 entries across 15 categories. Nothing in `src/` restates any
of it — no topic, reference, hook, question or category colour is written into a component.
`npm run no-dupes` scans every source file against all 1,179 catalog strings and fails the build if
one leaks in.

To change the reading plan, edit that file. `npm run validate` checks the contract (unique ids,
resolvable categories, valid sizes and testaments, meta counts) and prints a summary. The app
validates again at runtime and drops unrenderable entries rather than white-screening.

## How the spin works

**The winner is decided before anything moves.** `planSpin()` picks a category and an entry in
JavaScript; only then is the wheel animated to land on those exact segments. Nothing is ever read
back off a resting wheel.

That guarantee is testable because the rotation maths has an exact inverse.
`computeFinalRotation()` produces the rotation that puts segment *i* under the pointer, and
`resolveIndexAtPointer()` reads which segment a rotation lands on. The test suite asserts they
round-trip across every segment count, every index, arbitrary starting rotations and the full
jitter range; the simulation asserts it again on every one of 57,200 spins.

**Two stages, 6.7 seconds.** Wheel 1 shows the categories that still have unread entries —
categories with nothing left are removed from the wheel entirely, never greyed out, so it cannot
land on a dead segment. It coasts for 3s, pauses half a second so you can read which category came
up, then the faces cross-fade into that category's unread passages and the wheel carries on from
exactly where it stopped for another 2.9s. It never resets between the stages: a real wheel cannot
jump back a turn.

**The draw is unbiased by construction.** `pickIndex()` uses `crypto.getRandomValues` with
rejection sampling rather than `Math.random() * n`, so there is no modulo bias. Wheel 1 draws
uniformly across categories, which are drawn as equal segments — the probability of a category is
exactly the arc you can see. It follows that entries in a small category are individually likelier
than those in a large one. That is the honest reading of "wheel 1 picks a category", and it keeps
the wheel from lying about its own odds.

**Landing is binding.** The entry leaves the pool the instant the wheel stops. There is no confirm
step and no spin-again button. A single undo is available for 60 seconds, held in memory only —
deliberately not persisted, so it cannot survive a reload and be used to shop for a better passage.

**One spin per calendar day**, local time. The day rolls over live at midnight. To test, append
`?dev=1` to the URL, or press Shift+Alt+D — either lifts the lock and shows a banner explaining
why. The keyboard route exists for hosts where the URL cannot be edited, such as an embedded preview.

## Views

- **The way in** — shown once on a device that has never been used: sign in for a shared history,
  or read on this device. It is a door, not a gate; the local route is offered as plainly as the
  sign-in, and anyone who takes it never sees the screen again. Sharing stays in Settings.
- **Wheel** — the wheel, the spin button, and progress. Shows today's reading instead once spun.
- **Today** — topic, reference, category badge, reading-load hint, hook, discussion question, a
  notes box that saves as you type, a checkbox per reader, and a copy button shaped for WhatsApp.
- **The Finished Side** — the archive, newest first. Stats, streaks, a 15-bar completion chart, and
  rows filterable by category and testament and searchable by topic, reference or book. Tap a row
  to open its hook, question and your notes.

## Storage, and swapping it later

Everything persists to one namespaced `localStorage` key, `spin-catalog:v1`:

```js
{
  version: 1,
  completed: [{ id, dateISO, notes, readBy: { a: bool, b: bool } }],
  lastSpinDate: "YYYY-MM-DD" | null,
  readerNames: { a: string, b: string }   // additive — see below
}
```

**`src/lib/storage.js` is the only file in the app that touches storage.** Its interface is
`getState()` and `saveState()` (plus `clearState()` for reset). If you later want a shared
two-person backend so both phones see the same history, rewrite that one file — make the two
functions async and await them at the three call sites in `App.jsx`. Nothing else in `src/` knows
localStorage exists. A remote store is deliberately *not* built here.

Every read is guarded. `normalizeState()` coerces arbitrary input into a valid state, dropping
malformed rows and unknown fields rather than trusting them, and imported files go through exactly
the same guard as stored data. A corrupt value yields empty state, never a crash.

Settings has **Export JSON**, **Import JSON**, and a **Reset** that requires typing `RESET`.

### Schema version 4 — a reader is an account, with a note of their own

```js
readers:  [{ id, name, avatarUrl, userId, email }]   // id IS the auth user id
readBy:   [readerId, …]
```

v1 stored exactly two readers as `readerNames: {a, b}` with a per-reading `readBy: {a, b}`. v2
generalised that to a list anyone could add to. **v3 removes the ability to add one at all.**

Readers are not made, they arrive. Every reader is somebody's signed-in account, and `reader.id`
*is* their auth user id. The way a second person appears is that they sign up on their own phone
and enter the group's invite code — not that you type them into a list on yours. A typed-in reader
was a row nobody could ever sign in as, whose name only you could correct, and whose ticks meant
"I think they read it" rather than "they said they did".

Making the id the user id rather than a local id with a `userId` beside it is what makes ticks
portable: `readBy: ["<uuid>"]` means the same person on every device that will ever sync, with
nothing to reconcile.

**The one exception** is you, before you have an account. A device that chose "read on this device"
carries exactly one reader with no `userId`, so there is somebody to tick. When that person signs
up, their reader is re-keyed to the new user id and every tick they made is re-keyed with it — the
history made before signing up is still theirs afterwards. Because at most one reader can lack an
account, an unnamed one is unambiguously the device's owner, and shows as "You" rather than
"Reader A".

**Migration.** `normalizeState()` runs v1 → v2 → v3 → v4 in sequence, so a three-versions-old
export travels the whole way rather than being rejected. v2 → v3 re-keys account-backed readers and
rewrites the ticks that pointed at their old ids, then drops the placeholders v2 created on every
device — but only ones that were never named, never given a photo and never ticked anything. A
reader anyone actually used survives and can be dismissed by hand. No reading is ever dropped, and
a device is never left with nobody on it. `getState()` writes the upgraded copy straight back, so
it happens once rather than on every load.

`Reader A` … `Reader H` are treated as **blank**, not as names. They are what v2 generated on every
device, and taking them for chosen names is what left people staring at a "Reader B" who had never
signed up for anything.

**The roster is a query, not a document.** `pair_readers()` joins `pair_members` — which is the
truth about who is in the group — to a `profiles` table holding the part each person owns about
themselves. Two things were wrong with the jsonb document it replaces: somebody who joined but had
not opened the app was invisible to everyone, because nothing had written their row; and anybody in
the group could rename anybody else, because it was all one blob that every client rewrote
wholesale. The RLS on `profiles` makes "your own name" literal.

Because the roster is the database's answer rather than two devices' opinions, the merge **takes**
it rather than unioning. Unioning could never let somebody leave: one stale copy would keep voting
them back in forever. The only thing carried over from the local side is a reader with no account —
this device's own pre-signup reader, whom the server has never heard of.

**One note each.** `notesBy: { [readerId]: text }`. A single shared box meant the second person to
type about a passage silently overwrote the first, and the useful thing to see afterwards is what
the *other* person made of it — which one merged blob of text cannot tell you. Notes merge per
author, since each key belongs to one person and only they ever write it; where both sides hold the
same author's note the newer wins, and with no timestamp the longer does. They are never
concatenated: that turns two drafts of a thought into one unreadable one.

The old shared `notes` string is left exactly where it is and shown unattributed where it has
content. Nobody knows who wrote it — that is the problem v4 fixes — so guessing would be writing a
guess into somebody's history.

A note by a reader who has left is **kept**, unlike their ticks. Dropping a tick loses a claim
about who read something; dropping a note loses the thing itself.

Names are free text with a row of borrowable ones a tap away; you edit your own and nobody else's.
Photos are cropped square and downscaled to 256px before they go anywhere; signed in, your own
photo uploads to Supabase Storage under a folder named after your user id, so the others see it
and nobody can overwrite anyone else's.

Removing is only ever offered for a leftover local reader, and takes their ticks with it —
somebody with an account leaves by leaving the group, on their own device.

## The passage text

The wheel used to hand you a reference and expect you to go and find it. That
sent people out of the app at the exact moment it had done its job, so the text
is on the page — under today's reading and inside every archive row.

It comes from [bible-api.com](https://bible-api.com) and from nowhere else. No
key, no account, public-domain translations only, which is what makes it usable
from a client bundle with nothing to keep secret. **Settings → Translation**
offers WEB, KJV, WEBBE, BBE and OEB.

> An earlier version shipped the World English Bible inside the app: 286
> passages, ~240KB gzipped, with the source edition's paragraph and poetry
> markup so a psalm read as poetry. That is gone deliberately. Keeping both
> left the bundled copy standing in front of the API as a default *and* a
> fallback, so the API was never really the source of anything.

**What that costs, plainly.** Reading a passage for the first time needs a
connection, and there is nothing behind the API to fall back to — an
unreachable one means a message and a **Try again** button where the text
should be. Silently substituting a different translation would be worse: a
passage on that screen is something somebody might write down or quote. The API
also returns a flat verse list, so every passage is one block per chapter with
no paragraph breaks and no poetry.

**The cache is therefore load-bearing**, not an optimisation — it is the only
reason yesterday's reading opens on a train. It holds 300 passages in its own
`localStorage` key, kept apart from the reading history so a full quota can
never cost somebody a note they wrote; on a quota error it drops itself rather
than anything else. One request per passage however many things ask at once,
an 8-second timeout, and a failure is never cached, so **Try again** genuinely
tries again. Today's reading is fetched during the first idle moment after the
app mounts, so opening Today usually shows text rather than a placeholder.

Verse numbers are small, raised and quiet so a passage reads as prose rather
than a numbered list, and chapter numbers appear only where a passage crosses a
chapter boundary — which is where a verse 1 following a verse 10 would look
like a bug.

`connect-src` in `vercel.json` admits `https://bible-api.com`, and
`check-deploy` fails if that is ever removed — without it every passage would
fail to load.

## Sharing a history between two devices (Supabase)

Optional. With no project configured the app is exactly what it was — local,
private, and fully working — and nothing below is required to use it.

The project URL and **anon** key go in `.env` (gitignored; see `.env.example`).
The anon key is designed to ship in the client and is protected by row level
security. The service-role key bypasses RLS entirely and must never appear in
`.env`, in the bundle, or in this repo.

**Run the migrations once**, in order: open Supabase → SQL Editor → New query, paste
`supabase/migrations/0001_shared_history.sql`, Run; then the same for
`0002_real_readers.sql`. Both are idempotent, so re-running after a change to either file is safe
and only replaces what moved. 0002 is what makes the roster come from the database and gives each
reader their own note — without it the app still runs, and Settings → Sharing says which one is
missing.

Then, in Settings → Sharing: **each of you creates your own account** with an
email and a password, one of you starts a shared history and reads out the
eight-character invite code, and the others enter it. Everyone who joins
becomes a reader the whole group can see, up to eight. From then on every
device reads and writes the same rows, and changes appear on the other phones
without a refresh.

**How it is secured.** Every table has RLS on, and every policy resolves
through `is_pair_member()`, which is `SECURITY DEFINER` so checking your own
membership does not require reading a table you may not be allowed to read.
Nothing is world-readable. The invite code is a bearer secret, so joining goes
through a `SECURITY DEFINER` function rather than a select policy — the pairs
table is never directly readable by a non-member, which means codes cannot be
enumerated by listing.

**Local stays authoritative.** Reads and writes hit `localStorage` first and
synchronously; the remote is a second copy merged in when a session exists. A
reading app that cannot open its own history because the network is down has
failed at the only thing it does.

**Merging never loses a reading.** The whole app rests on a passage coming up
once, so the merge is a union over entry ids, never a choice between two
lists. Within a row: the earlier date wins (the day it was first drawn), read
ticks are OR'd (nobody else's device may un-say that you read it), notes take
the newer copy, and the day lock takes the later of the two — if either device
has spun today, the day is spent. Deletion is the one thing a union cannot
express, which is why undo deletes from the remote directly.

## Design

Quiet and typographic — a well-set print devotional rather than a game show. A serif for topics and
references, a system sans for UI. Deep desaturated ground so the catalog's own category colours
carry all the accent work. No gradients, no shadows, no confetti, no sound. The reveal is a page
turn, not a jackpot.

Fonts are system stacks and the favicon is inline SVG, so nothing is fetched over the network — the
app opens instantly and works offline.

Wheel labels are fitted **by measurement, not estimate**. The system font stack means glyph metrics
differ between a phone, a laptop and a test browser, so the wheel measures what it actually drew and
recomputes the character budget from the real advance width. All 15 category names render in full,
split across two balanced lines where needed; wheel 2 truncates and the reveal card carries the full
topic.

## Motion and touch

**The easing is derived, not tuned.** A wheel spun by hand is accelerated briefly and then
coasts against bearing friction. Dry friction is a roughly constant retarding torque, so the
deceleration is constant — ω(t) = ω₀ − αt — and the wheel *stops* rather than creeping
asymptotically toward a halt. Integrating that gives the angle over time, which
`frictionEasing()` samples into a CSS `linear()` curve. The hand-tuned bezier it replaced was 95%
travelled by the halfway mark, which is why the spin felt like it arrived and then loitered;
constant friction is 74% at halfway and still visibly turning at six seconds.

The disc is the only thing that rotates, and it rotates as a wrapper `<div>` rather than an SVG
`<g>`. Rotating a group makes the browser re-rasterise two dozen glyphs every frame; rotating a
div promotes the disc to one composited layer the compositor can spin without touching the main
thread.

It runs on the Web Animations API rather than a CSS transition, which means the animation object
can be sampled. Each frame the wheel reads its real transform matrix, works out which segment is
under the pointer, and reports a detent when that changes — so the haptic ticks come from the
wheel's actual position rather than a guess, and they thin out on their own as it slows, because
the crossings genuinely do. It ends with about a degree of overshoot and settle, well inside the
narrowest segment (15.6°), so the landing stays exact.

**Vibration is Android-only in practice.** iOS Safari has never implemented
`navigator.vibrate`, and no feature detection changes that — on an iPhone the spin is silent and
everything else is identical. Where it does work: short ticks as segments pass, a firmer note on
landing, and light taps on presses and toggles. There is an off switch in Settings, and
`prefers-reduced-motion` mutes it along with the animation.

## Accessibility

- Every text colour clears WCAG AA against the surface it sits on. Category names in the archive
  are lightened from the catalog colour until they pass rather than being replaced — the hue stays,
  only the lightness moves.
- Every tap target is at least 44px.
- `prefers-reduced-motion` skips the spin entirely and cross-fades the result in (~370ms).
- The result is announced through an `aria-live` region and focus moves to the result heading.
- Fully keyboard operable.

These are measured, not assumed — see the audit results below.

## Verification

`npm run check` runs the lot. Results at the time of writing:

| Check | Result |
|---|---|
| Catalog contract | 286 entries, 15 categories, ids 1–286 unique and contiguous, no duplicate topics or references |
| No duplicated content | 26 source files scanned against 1,179 catalog strings — clean |
| Unit tests | 101 passing |
| Simulation | 200 playthroughs × 286 spins = 57,200 spins; every run produced all 286 entries with zero repeats; the 287th spin returned the completion state every time; 725,735 dead-segment checks and 114,400 landing checks all held |

Verified against a live project, with three throwaway accounts driven through the anon key exactly
as the app does — so RLS is genuinely under test rather than bypassed by a service key (22/22):

- Two accounts pair with an invite code, and both `my_pair()` calls agree on the group.
- One writes a reading; the other reads it back, `read_by` array and jsonb roster intact.
- **A third signed-in account sees zero readings, cannot write into the group, and cannot list
  `pairs` at all** — so invite codes cannot be harvested by enumeration.
- A signed-out client sees nothing and cannot read invite codes.
- Leaving revokes access immediately.

Browser checks (Chromium at 380px), all passing:

- The wheel's resting transform resolves to the segment named on the reveal card — at both stages.
- Refreshing mid-day shows the same reading, not a fresh wheel.
- Undo removes the entry and restores the previous day lock.
- Export → reset → import restores byte-identical state, including notes with quotes and newlines.
- Reduced motion reveals in ~370ms with no spin.
- Spin is keyboard-reachable, announced, and focus lands on the result.
- The spin measures 6.70s of wheel travel (6.96s to the card appearing), decelerating throughout,
  with 71 detents that widen from 65ms apart early to 95ms apart late.
- The spin still completes with `transitionend` suppressed entirely — a watchdog advances each stage
  if the browser swallows the event, so backgrounding the tab mid-spin cannot strand the wheel.
- The spin button sits at y=592–648 in a 667px-tall viewport, inside the one-handed thumb zone.
- Near-exhaustion holds: with one category left the wheel draws a full ring (an SVG arc cannot
  span 360°, so a naive path collapses and the last segment vanishes), and the 286th spin leads to
  the completion state rather than an error.
- No console errors; no horizontal overflow at 380px or 768px.

## Layout

```
bible-wheel-catalog.json      the source of truth — do not edit from code
scripts/
  validate-catalog.mjs        contract check, prints a summary
  check-no-duplication.mjs    fails if catalog content appears in src/
  simulate-spins.mjs          200 × 286 spins against the real app modules
src/
  App.jsx                     state, the day lock, the undo window, view switching
  lib/
    catalog.js                loads and validates the JSON, derives indexes
    storage.js                the only file that touches localStorage
    selection.js              pick-then-animate: decides the winner
    wheel.js                  geometry, rotation maths, colour helpers
    label.js                  fitting labels into segments
    state.js                  pure transitions on the persisted shape
    stats.js                  streaks and per-category completion
    date.js                   local-calendar dates and streak arithmetic
  components/
    Wheel.jsx                 the SVG wheel — a dumb renderer, decides nothing
    WheelView.jsx             the two-stage spin sequence
    TodayCard.jsx             the reading
    FinishedSide.jsx          the archive
    Settings.jsx              names, export, import, reset
    ProgressStrip.jsx         progress under the wheel
```

## Stack

Vite, React, Tailwind. No component library, no state management library, no router — three views
is a `useState`. The wheel is SVG drawn from the data at runtime: `<path>` arcs, labels rotated
along each segment, a fixed pointer, and a CSS transform on the group. No canvas, no images.
