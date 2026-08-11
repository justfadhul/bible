# The Spin Catalog

A two-person daily Bible reading wheel. Spin once a day, read whatever comes up, discuss it.

The point is that neither of you chooses. So the app will not let you re-roll, and no passage
comes up twice until all 286 have been read.

```bash
npm install
npm run dev      # http://localhost:5173
npm run check    # validate catalog → no duplication → tests → 200-run simulation → build
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
`?dev=1` to the URL — this lifts the lock and shows a banner explaining why.

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

### One addition to the schema

`readerNames` is not in the original spec. Without it the two checkboxes read "Reader A" and
"Reader B", which is a cold thing to look at every morning. It is additive and optional —
`normalizeState()` supplies defaults when it is absent, so older exports import cleanly. If you
would rather not have it, delete the field from `emptyState()`, the "Who is reading" panel in
`Settings.jsx`, and the two labels in `TodayCard.jsx`.

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
| Unit tests | 56 passing |
| Simulation | 200 playthroughs × 286 spins = 57,200 spins; every run produced all 286 entries with zero repeats; the 287th spin returned the completion state every time; 725,735 dead-segment checks and 114,400 landing checks all held |

Browser checks (Chromium at 380px), all passing:

- The wheel's resting transform resolves to the segment named on the reveal card — at both stages.
- Refreshing mid-day shows the same reading, not a fresh wheel.
- Undo removes the entry and restores the previous day lock.
- Export → reset → import restores byte-identical state, including notes with quotes and newlines.
- Reduced motion reveals in ~370ms with no spin.
- Spin is keyboard-reachable, announced, and focus lands on the result.
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
