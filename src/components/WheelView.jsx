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
import { planSpin, availableCategories } from '../lib/selection.js'
import { computeFinalRotation, randomJitter } from '../lib/wheel.js'
import { TOTAL } from '../lib/catalog.js'
import { usePrefersReducedMotion } from '../hooks/useMedia.js'

// About five seconds of travel across both stages, with a beat between them.
const STAGE_1_MS = 2300
const HANDOVER_MS = 380
const STAGE_2_MS = 1850
const SETTLE_MS = 260

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

  const spinning = phase === 'stage1' || phase === 'stage2'
  const busy = phase !== 'idle'

  const after = useCallback((ms, fn) => {
    const id = setTimeout(fn, ms)
    timers.current.push(id)
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

  const spin = useCallback(() => {
    if (busy || exhausted) return

    // ── The winner is decided here, before anything moves. ──
    const plan = planSpin(completedIds)
    if (!plan) return
    planRef.current = plan
    onAnnounce?.('Spinning.')

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
        turns: 4,
        jitter: randomJitter(),
      }),
    )
  }, [busy, exhausted, completedIds, reduced, onAnnounce, after, finish])

  // Handover and landing are driven by the wheel's own transitionend.
  const onSettled = useCallback(() => {
    const plan = planRef.current
    if (!plan) return

    if (phase === 'stage1') {
      setPhase('handover')
      onAnnounce?.(`${plan.category.name}. Now choosing the passage.`)
      after(HANDOVER_MS, () => {
        // Re-seat at zero with no transition and swap in the entries, then
        // start stage 2 on the next frame — otherwise the browser interpolates
        // between two unrelated wheels.
        setDuration(0)
        setRotation(0)
        setSpunSegments(toEntrySegments(plan.entries, plan.category.color))
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            setDuration(STAGE_2_MS)
            setPhase('stage2')
            setRotation(
              computeFinalRotation({
                targetIndex: plan.entryIndex,
                count: plan.entries.length,
                turns: 3,
                jitter: randomJitter(),
              }),
            )
          }),
        )
      })
      return
    }

    if (phase === 'stage2') {
      setPhase('landing')
      after(SETTLE_MS, finish)
    }
  }, [phase, after, finish, onAnnounce])

  const remaining = TOTAL - completedIds.size
  const stage =
    phase === 'stage1'
      ? 'Choosing a category'
      : phase === 'handover' || phase === 'stage2'
        ? 'Choosing a passage'
        : null

  return (
    <div className="space-y-7">
      <Wheel
        segments={segments}
        rotation={rotation}
        spinning={spinning}
        durationMs={duration}
        onSettled={onSettled}
        hubLabel={exhausted ? '✓' : remaining}
        hubSub={exhausted ? 'ALL READ' : 'LEFT'}
        maxLines={showingEntries ? 1 : 2}
        title={
          showingEntries
            ? `Passage wheel: ${segments.length} unread entries`
            : `Category wheel: ${segments.length} categories with unread entries`
        }
      />

      <div className="space-y-3">
        <button
          type="button"
          onClick={spin}
          disabled={busy || exhausted}
          className="w-full min-h-14 rounded-full bg-ink text-ground font-semibold tracking-wide text-base
                     transition-[transform,opacity] active:scale-[0.985]
                     disabled:opacity-35 disabled:cursor-not-allowed"
        >
          {exhausted ? 'Catalog complete' : busy ? 'Spinning…' : 'Spin'}
        </button>

        <p className="text-center text-xs text-ink-3 min-h-4">
          {stage ?? (exhausted ? 'Every passage has been read.' : 'One spin a day. The spin is binding.')}
        </p>
      </div>

      <ProgressStrip completedIds={completedIds} />
    </div>
  )
}
