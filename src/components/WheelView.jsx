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
 * 6.7 seconds, end to end. Long enough that the wheel is genuinely coasting
 * rather than snapping to an answer, and long enough for the detents to space
 * out audibly as it slows.
 *
 * The beat between the stages is not dead time — it is the moment you read
 * which category came up, before the wheel becomes that category's passages.
 */
const STAGE_1_MS = 3000
const HANDOVER_MS = 500
const STAGE_2_MS = 2900
const SETTLE_MS = 300
export const TOTAL_SPIN_MS = STAGE_1_MS + HANDOVER_MS + STAGE_2_MS + SETTLE_MS // 6700

const toCategorySegments = (cats) => cats.map((c) => ({ key: c.id, label: c.name, color: c.color }))
const toEntrySegments = (entries, color) =>
  entries.map((e) => ({ key: e.id, label: e.topic, color, tint: true }))

export default function WheelView({ completedIds, onLanded, onAnnounce, exhausted }) {
  const reduced = usePrefersReducedMotion()
  const [phase, setPhase] = useState('idle') // idle | stage1 | handover | stage2 | landing
  const [spunSegments, setSpunSegments] = useState(null) // null → the idle category wheel
  const [rotation, setRotation] = useState(0)
  const [duration, setDuration] = useState(0)
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
        onAnnounce?.(`${plan.category.name}. Now choosing the passage.`)
        // Swap the faces mid-fade, then carry straight on from where the wheel
        // already is. Resetting to zero would make the disc jump back a turn
        // between the stages, which is the one thing a real wheel cannot do.
        after(200, () => setSpunSegments(toEntrySegments(plan.entries, plan.category.color)))
        after(HANDOVER_MS, () => {
          setDuration(STAGE_2_MS)
          setPhase('stage2')
          setRotation((current) =>
            computeFinalRotation({
              current,
              targetIndex: plan.entryIndex,
              count: plan.entries.length,
              turns: 6,
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
      // No theatre: seat the wheel on the chosen passage and cross-fade.
      setSpunSegments(toEntrySegments(plan.entries, plan.category.color))
      setDuration(0)
      setRotation(computeFinalRotation({ targetIndex: plan.entryIndex, count: plan.entries.length, turns: 0 }))
      setPhase('landing')
      after(220, finish)
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
