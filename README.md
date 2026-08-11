# The Spin Catalog

A two-person daily Bible reading wheel. Spin once a day, read whatever comes up, discuss it.

The point is that neither of you chooses. So the app will not let you re-roll, and no passage
comes up twice until all 286 have been read.

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

**Two stages.** Wheel 1 shows the categories that still have unread entries — categories with
nothing left are removed from the wheel entirely, never greyed out, so it cannot land on a dead
segment. Wheel 2 then shows that category's unread entries. About five seconds across both.

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

### Schema version 2 — readers

v1 stored exactly two readers as `readerNames: {a, b}` with a per-reading
`readBy: {a: bool, b: bool}`. v2 generalises that to a list, because the app now supports up to
eight people:

```js
readers:  [{ id, name, avatarUrl, userId, email }]
readBy:   [readerId, …]
```

`normalizeState()` upgrades v1 data and v1 exports in place, so nobody loses a history to the
change — 9 tests cover that path specifically, including files with no `version` field and
re-normalising an already-upgraded file.

A reader has a name and a picture, both optional. Signing in fills the name in from the email
address (`sam.okonkwo@…` → "Sam Okonkwo") and links the account to a reader already on the device
rather than adding a stranger to the list. Names are free text with a row of borrowable ones a tap
away. Photos are cropped square and downscaled to 256px before they go anywhere; signed in, your
own photo uploads to Supabase Storage under a folder named after your user id, so the others see
it and nobody can overwrite anyone else's.

Removing a reader also removes their ticks — leaving them behind would show a reading as read by
somebody who is no longer in the list.

## Sharing a history between two devices (Supabase)

Optional. With no project configured the app is exactly what it was — local,
private, and fully working — and nothing below is required to use it.

The project URL and **anon** key go in `.env` (gitignored; see `.env.example`).
The anon key is designed to ship in the client and is protected by row level
security. The service-role key bypasses RLS entirely and must never appear in
`.env`, in the bundle, or in this repo.

**Run the migration once**: open Supabase → SQL Editor → New query, paste
`supabase/migrations/0001_shared_history.sql`, Run. It is idempotent.

Then, in Settings → Sharing: each of you signs in with a magic link, one
creates a shared history and reads out the eight-character invite code, the
other enters it. From then on both devices read and write the same rows, and
changes appear on the other phone without a refresh.

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
| Unit tests | 96 passing |
| Simulation | 200 playthroughs × 286 spins = 57,200 spins; every run produced all 286 entries with zero repeats; the 287th spin returned the completion state every time; 725,735 dead-segment checks and 114,400 landing checks all held |

Browser checks (Chromium at 380px), all passing:

- The wheel's resting transform resolves to the segment named on the reveal card — at both stages.
- Refreshing mid-day shows the same reading, not a fresh wheel.
- Undo removes the entry and restores the previous day lock.
- Export → reset → import restores byte-identical state, including notes with quotes and newlines.
- Reduced motion reveals in ~370ms with no spin.
- Spin is keyboard-reachable, announced, and focus lands on the result.
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
