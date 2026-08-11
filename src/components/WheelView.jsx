/**
 * The wheel view: the two-stage spin, the button, and the progress strip.
 *
 * The sequence is strictly pick-then-animate. planSpin() decides the category
 * and the entry before a pixel moves; the two rotations are then computed to
 * land on those exact segments. Nothing is ever read back off the wheel.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Wheel from './Wheel.jsx'
import ProgressStrip from './ProgressStrip.jsx'
import { Button } from './ui.jsx'
import { planSpin, availableCategories } from '../lib/selection.js'
import { computeFinalRotation, randomJitter } from '../lib/wheel.js'
import { TOTAL } from '../lib/catalog.js'
import { usePrefersReducedMotion } from '../hooks/useMedia.js'
import * as haptics from '../lib/haptics.js'

/**
 * Seven seconds, end to end. Long enough that the wheel is genuinely coasting
 * rather than snapping to an answer, and long enough for the detents to space
 * out audibly as it slows.
 *
 * The beat between the stages is not dead time — it is the moment you read
 * which category came up, before the wheel becomes that category's passages.
 * It is the longest single stretch of the sequence on purpose. A pause sized
 * to the *minimum* it takes to read something reads as rushed even when the
 * words did technically land: you finish the phrase exactly as it leaves, with
 * no moment of simply having read it. So the plate is given room either side —
 * a beat before it arrives so the wheel stopping registers on its own, and
 * over a second of stillness after it has fully arrived.
 *
 * The two spin stages pay for it, so the whole sequence is still 6-7 seconds.
 */
const STAGE_1_MS = 2500
const HANDOVER_MS = 2200
const STAGE_2_MS = 2000
const SETTLE_MS = 300
export const TOTAL_SPIN_MS = STAGE_1_MS + HANDOVER_MS + STAGE_2_MS + SETTLE_MS // 7000

/* How the handover is spent. Derived, so the parts cannot drift from the whole. */
const REVEAL_DELAY_MS = 200
const REVEAL_IN_MS = 380
const REVEAL_OUT_MS = 320
const REVEAL_HOLD_MS = HANDOVER_MS - REVEAL_DELAY_MS - REVEAL_IN_MS - REVEAL_OUT_MS // 1300

/** The face swap happens behind the plate, while it is still fully up. */
const FACE_SWAP_MS = REVEAL_DELAY_MS + REVEAL_IN_MS + 500
/** Reduced motion still gets the name — reading it is information, not motion. */
const REDUCED_REVEAL_MS = 1500

/**
 * The category, named, over the wheel it just came off.
 *
 * Deliberately opaque and centred rather than a caption somewhere below: the
 * wheel behind it has stopped and is about to become a different wheel, so
 * this is the one moment where nothing else on screen is worth looking at.
 *
 * The hairline underneath depletes across the hold. It is not decoration —
 * a screen that has deliberately stopped for over a second looks identical to
 * one that has hung, and this is the only thing on it that says which. It also
 * turns waiting into watching, which is most of why the pause stops feeling
 * like one.
 *
 * aria-hidden because the same words go to the live region in the same tick,
 * and hearing them twice is worse than not seeing them once.
 */
function CategoryPlate({ category, showing, unread, animated = true }) {
  const [up, setUp] = useState(false)

  useEffect(() => {
    if (!showing) {
      setUp(false)
      return
    }
    const t = setTimeout(() => setUp(true), animated ? REVEAL_DELAY_MS : 0)
    return () => clearTimeout(t)
  }, [showing, animated])

  if (!category) return null
  const visible = showing && up

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 grid place-items-center px-5"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'scale(1)' : 'scale(0.93)',
        transition: `opacity ${visible ? REVEAL_IN_MS : REVEAL_OUT_MS}ms var(--ease), transform ${
          visible ? REVEAL_IN_MS + 120 : REVEAL_OUT_MS
        }ms var(--ease-spring)`,
      }}
    >
      <div className="rounded-r4 bg-raised px-5 py-4 text-center" style={{ boxShadow: 'var(--e4)' }}>
        <span
          className="mx-auto mb-2.5 block h-1.5 w-9 rounded-full"
          style={{ background: category.color }}
        />
        <p className="eyebrow">Category</p>
        <p className="mt-1.5 text-balance font-serif text-xl leading-tight font-semibold text-ink">
          {category.name}
        </p>
        {/* Something to actually read during the beat, rather than a second of
            nothing to do. */}
        <p className="mt-1.5 text-xs text-ink-2">
          {unread === 1 ? 'one passage left in it' : `${unread} passages left in it`}
        </p>
        {animated && (
          <span className="mx-auto mt-3 block h-0.5 w-16 overflow-hidden rounded-full bg-inset">
            <span
              className="block h-full origin-right rounded-full bg-accent"
              style={{
                transform: `scaleX(${visible ? 0 : 1})`,
                transition: visible
                  ? `transform ${REVEAL_HOLD_MS}ms linear ${REVEAL_IN_MS}ms`
                  : 'none',
              }}
            />
          </span>
        )}
      </div>
    </div>
  )
}

const toCategorySegments = (cats) => cats.map((c) => ({ key: c.id, label: c.name, color: c.color }))
const toEntrySegments = (entries, color) =>
  entries.map((e) => ({ key: e.id, label: e.topic, color, tint: true }))

export default function WheelView({ completedIds, onLanded, onAnnounce, exhausted }) {
  const reduced = usePrefersReducedMotion()
  const [phase, setPhase] = useState('idle') // idle | stage1 | handover | stage2 | landing
  const [spunSegments, setSpunSegments] = useState(null) // null → the idle category wheel
  const [rotation, setRotation] = useState(0)
  const [duration, setDuration] = useState(0)
  // The category the first wheel landed on, held in state rather than read off
  // planRef, because this one is drawn on screen and a ref does not re-render.
  const [reveal, setReveal] = useState(null)
  const [revealUnread, setRevealUnread] = useState(0)
  const planRef = useRef(null)
  const timers = useRef([])
  // Each stage advances exactly once, whether it was the transition ending or
  // the watchdog below that got there first.
  const settled = useRef(new Set())

  const busy = phase !== 'idle'

  const after = useCallback((ms, fn) => {
    timers.current.push(setTimeout(fn, ms))
  }, [])
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // At rest the wheel shows the categories that still have something unread —
  // derived from the pool every render, never cached, so an exhausted category
  // disappears the moment its last entry is read.
  const segments = spunSegments ?? toCategorySegments(availableCategories(completedIds))
  const showingEntries = spunSegments !== null && phase !== 'stage1'

  const finish = useCallback(() => {
    const plan = planRef.current
    planRef.current = null
    if (!plan) return
    setPhase('idle')
    setSpunSegments(null)
    setRotation(0)
    setDuration(0)
    setReveal(null)
    onLanded(plan)
  }, [onLanded])

  /**
   * Advances one stage of the spin. Normally triggered by the wheel's
   * transitionend; also by a watchdog, because a backgrounded tab can swallow
   * that event and a spin that never finishes would strand the reader on a
   * stopped wheel. Whichever arrives first wins; the second is ignored.
   */
  const settle = useCallback(
    (stage) => {
      const plan = planRef.current
      if (!plan || settled.current.has(stage)) return
      settled.current.add(stage)

      if (stage === 'stage1') {
        setPhase('handover')
        // Name it out loud and on screen at the same moment. The plate holds
        // for the whole handover; it is the only place the category is ever
        // stated, since by the next stage the wheel has already become its
        // passages and there is nothing left on screen that says where they
        // came from.
        setReveal(plan.category)
        setRevealUnread(plan.entries.length)
        onAnnounce?.(`${plan.category.name}. Now choosing the passage.`)
        // Swap the faces behind the plate, then carry straight on from where
        // the wheel already is. Resetting to zero would make the disc jump back
        // a turn between the stages, which is the one thing a real wheel cannot
        // do.
        after(FACE_SWAP_MS, () => setSpunSegments(toEntrySegments(plan.entries, plan.category.color)))
        after(HANDOVER_MS, () => {
          setDuration(STAGE_2_MS)
          setPhase('stage2')
          setRotation((current) =>
            computeFinalRotation({
              current,
              targetIndex: plan.entryIndex,
              count: plan.entries.length,
              turns: 5,
              jitter: randomJitter(),
            }),
          )
          after(STAGE_2_MS + 600, () => settle('stage2'))
        })
        return
      }

      if (stage === 'stage2') {
        setPhase('landing')
        haptics.land()
        after(SETTLE_MS, finish)
      }
    },
    [after, finish, onAnnounce],
  )

  const spin = useCallback(() => {
    if (busy || exhausted) return

    // ── The winner is decided here, before anything moves. ──
    const plan = planSpin(completedIds)
    if (!plan) return
    planRef.current = plan
    settled.current = new Set()
    clearTimers()
    onAnnounce?.('Spinning.')

    haptics.setHapticsMuted(reduced)
    haptics.tap()

    if (reduced) {
      // No theatre: seat the wheel on the chosen passage and cross-fade. The
      // category still gets its beat — with no visible first wheel this is the
      // only chance to see where the passage came from, so skipping it here
      // would make the reduced-motion path the one that tells you less.
      setSpunSegments(toEntrySegments(plan.entries, plan.category.color))
      setDuration(0)
      setRotation(computeFinalRotation({ targetIndex: plan.entryIndex, count: plan.entries.length, turns: 0 }))
      setReveal(plan.category)
      setRevealUnread(plan.entries.length)
      setPhase('handover')
      onAnnounce?.(`${plan.category.name}. Now choosing the passage.`)
      after(REDUCED_REVEAL_MS, () => {
        setPhase('landing')
        after(160, finish)
      })
      return
    }

    // ── Stage 1: the category wheel. ──
    setSpunSegments(toCategorySegments(plan.categories))
    setDuration(STAGE_1_MS)
    setPhase('stage1')
    setRotation((current) =>
      computeFinalRotation({
        current,
        targetIndex: plan.categoryIndex,
        count: plan.categories.length,
        turns: 7,
        jitter: randomJitter(),
      }),
    )
    after(STAGE_1_MS + 600, () => settle('stage1'))
  }, [busy, exhausted, completedIds, reduced, onAnnounce, after, clearTimers, finish, settle])

  const remaining = TOTAL - completedIds.size
  const stage =
    phase === 'stage1'
      ? 'Choosing a category'
      : phase === 'handover' || phase === 'stage2'
        ? 'Choosing a passage'
        : null

  return (
    <div className="space-y-6">
      {/* The wheel sits in a recessed well — inset means something lives in
          it, and the rim reads as the edge of the dial rather than a border. */}
      <div className="relative">
        <div className="sunken rounded-full p-3">
          <Wheel
            segments={segments}
            rotation={rotation}
            durationMs={duration}
            dimmed={phase === 'handover'}
            onSettled={() => settle(phase)}
            onTick={haptics.tick}
            hubLabel={exhausted ? '✓' : remaining}
            hubSub={exhausted ? 'ALL READ' : 'LEFT'}
            maxLines={showingEntries ? 1 : 2}
            title={
              showingEntries
                ? `Passage wheel: ${segments.length} unread entries`
                : `Category wheel: ${segments.length} categories with unread entries`
            }
          />
        </div>
        <CategoryPlate
          category={reveal}
          showing={phase === 'handover'}
          unread={revealUnread}
          animated={!reduced}
        />
      </div>

      <div className="space-y-3">
        <Button
          size="lg"
          className="w-full"
          onClick={spin}
          disabled={busy || exhausted}
          busy={busy}
        >
          {exhausted ? 'Catalog complete' : busy ? 'Spinning…' : 'Spin'}
        </Button>

        <p className="min-h-5 text-center text-xs text-ink-2">
          {stage ?? (exhausted ? 'Every passage has been read.' : 'One spin a day. The spin is binding.')}
        </p>
      </div>

      <ProgressStrip completedIds={completedIds} />
    </div>
  )
}
