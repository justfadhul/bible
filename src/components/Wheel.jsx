/**
 * The wheel, drawn as SVG from the data at runtime.
 *
 * It is a dumb renderer: it draws whatever segments it is given and travels to
 * whatever `rotation` it is told to. It never decides anything. The winner is
 * chosen in selection.js and the rotation that lands on it is computed in
 * wheel.js — this component only animates between rotations.
 *
 * Two things make the spin feel like a wheel rather than a CSS transition:
 *
 *  1. Only the disc moves, and it moves as a wrapper <div>, not as an SVG <g>.
 *     Rotating a group makes the browser re-rasterise two dozen glyphs every
 *     frame; rotating a div promotes the disc to one composited layer the
 *     compositor can spin without touching the main thread.
 *
 *  2. It runs on the Web Animations API rather than a CSS transition, so the
 *     animation can be sampled. Each frame we read the real matrix, work out
 *     which segment is under the pointer, and report a detent when that
 *     changes — which is what drives the haptics. The ticks thin out on their
 *     own as the wheel slows, because the crossings genuinely do.
 *
 * Labels are fitted by measurement, not estimate: the font is a system stack,
 * so after each render we measure what was actually drawn and tighten the
 * character budget until every label sits inside its band.
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  segmentPath,
  segmentStart,
  stepFor,
  labelTransform,
  shade,
  inkOn,
  frictionEasing,
} from '../lib/wheel.js'
import { layoutLabels } from '../lib/label.js'

const CX = 50
const CY = 50
const OUTER = 46.5
const INNER = 12

const TEXT_START_R = INNER + 4
const TEXT_END_R = OUTER - 3.5
const BAND = TEXT_END_R - TEXT_START_R
const TEXT_R = (TEXT_START_R + TEXT_END_R) / 2

const INITIAL_CHAR_W = 0.55
const MAX_FIT_PASSES = 4

/** Constant-friction deceleration — see frictionEasing() for the derivation. */
export const SPIN_EASING = frictionEasing()
/** A degree of overshoot, then back. Well inside the narrowest segment (15.6°). */
const OVERSHOOT_DEG = 1.1
/** Two detents closer together than this cannot be felt apart. */
const MIN_TICK_MS = 55

const mod360 = (x) => ((x % 360) + 360) % 360

/** The angle a rotated element is actually at, read from its matrix. */
function currentAngle(el) {
  const t = getComputedStyle(el).transform
  if (!t || t === 'none') return null
  const m = t.match(/matrix\(([^)]+)\)/)
  if (!m) return null
  const [a, b] = m[1].split(',').map(Number)
  return (Math.atan2(b, a) * 180) / Math.PI
}

export default memo(function Wheel({
  segments,
  rotation = 0,
  durationMs = 0,
  onSettled,
  onTick,
  hubLabel,
  hubSub,
  dimmed = false,
  maxLines = 1,
  title,
}) {
  const count = segments.length
  const step = count ? stepFor(count) : 360
  const discRef = useRef(null)
  const groupRef = useRef(null)
  const animRef = useRef(null)
  const rafRef = useRef(0)
  const fromRef = useRef(0)
  const tickRef = useRef(onTick)
  const settledRef = useRef(onSettled)
  const passRef = useRef(0)
  const [charW, setCharW] = useState(INITIAL_CHAR_W)

  tickRef.current = onTick
  settledRef.current = onSettled

  // A new set of segments means a fresh label fit.
  const signature = `${count}:${segments.map((s) => s.key).join(',')}`
  const sigRef = useRef(signature)
  if (sigRef.current !== signature) {
    sigRef.current = signature
    passRef.current = 0
  }

  const { fontSize, rows } = layoutLabels({
    labels: segments.map((s) => s.label),
    count: Math.max(count, 1),
    textStartR: TEXT_START_R,
    bandLength: BAND,
    maxLines,
    charWidth: charW,
  })

  /* ── travel ── */
  useLayoutEffect(() => {
    const el = discRef.current
    if (!el) return

    animRef.current?.cancel()
    cancelAnimationFrame(rafRef.current)

    const from = fromRef.current
    fromRef.current = rotation

    if (!durationMs || from === rotation || typeof el.animate !== 'function') {
      el.style.transform = `rotate(${rotation}deg)`
      if (durationMs) settledRef.current?.()
      return
    }

    let anim
    const keyframes = (easing) => [
      { transform: `rotate(${from}deg)`, easing },
      {
        transform: `rotate(${rotation + OVERSHOOT_DEG}deg)`,
        offset: 0.94,
        easing: 'cubic-bezier(0.33, 0, 0.2, 1)',
      },
      { transform: `rotate(${rotation}deg)` },
    ]
    try {
      anim = el.animate(keyframes(SPIN_EASING), { duration: durationMs, fill: 'forwards' })
    } catch {
      // A browser without linear() easing still gets a decent deceleration.
      anim = el.animate(keyframes('cubic-bezier(0.17, 0.6, 0.3, 1)'), { duration: durationMs, fill: 'forwards' })
    }
    animRef.current = anim

    // Sample the real matrix for detents rather than re-deriving the easing.
    let lastIndex = -1
    let lastTickAt = 0
    const sample = () => {
      const deg = currentAngle(el)
      if (deg !== null && count > 0) {
        const index = Math.floor(mod360(-deg) / step)
        const now = performance.now()
        if (index !== lastIndex) {
          if (lastIndex !== -1 && now - lastTickAt >= MIN_TICK_MS) {
            lastTickAt = now
            tickRef.current?.()
          }
          lastIndex = index
        }
      }
      rafRef.current = requestAnimationFrame(sample)
    }
    rafRef.current = requestAnimationFrame(sample)

    anim.finished
      .then(() => {
        cancelAnimationFrame(rafRef.current)
        // Commit the exact final angle, then drop the animation so the next
        // spin starts from a clean transform rather than a stacked effect.
        el.style.transform = `rotate(${rotation}deg)`
        anim.cancel()
        animRef.current = null
        settledRef.current?.()
      })
      .catch(() => {}) // cancelled by the next spin or by unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation, durationMs])

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current)
      animRef.current?.cancel()
    },
    [],
  )

  /* ── label fitting ── */
  useLayoutEffect(() => {
    const g = groupRef.current
    if (!g || !count || passRef.current >= MAX_FIT_PASSES) return

    let widest = 0
    for (const node of g.querySelectorAll('tspan')) {
      const chars = node.textContent?.length ?? 0
      if (!chars) continue
      let width
      try {
        width = node.getComputedTextLength()
      } catch {
        return // jsdom and other non-rendering hosts: keep the estimate
      }
      const perChar = width / (chars * fontSize)
      if (perChar > widest) widest = perChar
    }
    if (!widest) return

    const measured = widest * 1.01
    if (Math.abs(measured - charW) / charW > 0.01) {
      passRef.current += 1
      setCharW(measured)
    }
  })

  return (
    <div
      className="relative select-none"
      style={{ opacity: dimmed ? 0.5 : 1, transition: 'opacity 260ms var(--ease)' }}
      role="img"
      aria-label={title}
    >
      {/* The disc: its own composited layer, and the only thing that moves. */}
      <div
        ref={discRef}
        className="touch-manipulation"
        style={{ willChange: 'transform', transform: `rotate(${rotation}deg)` }}
      >
        <svg viewBox="0 0 100 100" className="h-auto w-full" aria-hidden="true">
          <circle cx={CX} cy={CY} r={OUTER + 1.2} fill="none" stroke="var(--hairline-strong)" strokeWidth="0.5" />
          <g ref={groupRef}>
            {count === 0 && <circle cx={CX} cy={CY} r={OUTER} fill="var(--surface-raised)" />}
            {segments.map((s, i) => {
              // Flat fills only. Where every segment shares one category colour
              // (wheel 2) we alternate two tints of that colour so the divisions
              // stay readable — still flat, still the catalog's colour.
              const fill = s.tint ? shade(s.color, i % 2 === 0 ? 0.06 : -0.13) : s.color
              const ink = inkOn(fill)
              const { x, y, rotate } = labelTransform(CX, CY, TEXT_R, i, count)
              const lines = rows[i] ?? ['']
              const firstDy = lines.length > 1 ? '-0.42em' : '0.32em'

              return (
                <g key={s.key}>
                  <path
                    d={segmentPath(CX, CY, OUTER, INNER, segmentStart(i, count), segmentStart(i, count) + step)}
                    fill={fill}
                    stroke="var(--ground)"
                    strokeWidth={count > 18 ? 0.35 : 0.55}
                    strokeLinejoin="round"
                  />
                  <text
                    x={x}
                    y={y}
                    transform={`rotate(${rotate} ${x} ${y})`}
                    textAnchor="middle"
                    fill={ink}
                    fontSize={fontSize}
                    fontFamily="var(--font-sans)"
                    fontWeight="600"
                    style={{ pointerEvents: 'none' }}
                  >
                    {lines.map((line, li) => (
                      <tspan key={li} x={x} dy={li === 0 ? firstDy : '1.05em'}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      {/* Hub and pointer are fixed: the count stays readable mid-spin, and the
          pointer stays where it is reading from. */}
      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <circle cx={CX} cy={CY} r={INNER - 0.6} fill="var(--surface-raised)" stroke="var(--hairline-strong)" strokeWidth="0.4" />
        {hubLabel != null && (
          <text
            x={CX}
            y={hubSub ? CY - 0.4 : CY + 1.6}
            textAnchor="middle"
            fill="var(--ink)"
            fontSize="5.2"
            fontFamily="var(--font-serif)"
          >
            {hubLabel}
          </text>
        )}
        {hubSub && (
          <text x={CX} y={CY + 4.8} textAnchor="middle" fill="var(--ink-2)" fontSize="2.5" fontFamily="var(--font-sans)" letterSpacing="0.1em">
            {hubSub}
          </text>
        )}
        <path
          d={`M ${CX} ${CY - OUTER + 3.4} L ${CX - 3} ${CY - OUTER - 3.2} L ${CX + 3} ${CY - OUTER - 3.2} Z`}
          fill="var(--ink)"
        />
        <circle cx={CX} cy={CY - OUTER - 3.6} r="1.5" fill="var(--ink)" />
      </svg>
    </div>
  )
})
