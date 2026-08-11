/**
 * The wheel, drawn as SVG from the data at runtime.
 *
 * It is a dumb renderer: it draws whatever segments it is given and sits at
 * whatever `rotation` it is told to. It never decides anything. The winner is
 * chosen in selection.js and the rotation that lands on it is computed in
 * wheel.js — this component only animates between rotations.
 *
 * Labels are fitted by measurement, not by estimate. The font is a system
 * stack, so its metrics differ between a phone, a laptop and a test browser;
 * after each render we measure what was actually drawn and tighten the
 * character budget until every label sits inside its band. It converges in a
 * pass or two and keeps one uniform type size across the wheel.
 */
import { memo, useLayoutEffect, useRef, useState } from 'react'
import { segmentPath, segmentStart, stepFor, labelTransform, shade, inkOn } from '../lib/wheel.js'
import { layoutLabels } from '../lib/label.js'

const CX = 50
const CY = 50
const OUTER = 46.5
const INNER = 12

const TEXT_START_R = INNER + 4
const TEXT_END_R = OUTER - 3.5
const BAND = TEXT_END_R - TEXT_START_R
const TEXT_R = (TEXT_START_R + TEXT_END_R) / 2

/** Starting guess for glyph advance as a fraction of font size; refined by measurement. */
const INITIAL_CHAR_W = 0.55
const MAX_FIT_PASSES = 4

export default memo(function Wheel({
  segments,
  rotation = 0,
  spinning = false,
  durationMs = 0,
  onSettled,
  hubLabel,
  hubSub,
  dimmed = false,
  maxLines = 1,
  title,
}) {
  const count = segments.length
  const step = count ? stepFor(count) : 360
  const groupRef = useRef(null)
  const passRef = useRef(0)
  const [charW, setCharW] = useState(INITIAL_CHAR_W)

  // A new set of segments means a fresh fit.
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

  useLayoutEffect(() => {
    const g = groupRef.current
    if (!g || !count || passRef.current >= MAX_FIT_PASSES) return

    // Measure the real glyph advance rather than iterating toward it: the
    // widest label tells us directly what this device's font costs per
    // character, so one pass lands on the true budget instead of creeping
    // down to a needlessly conservative one.
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

    const measured = widest * 1.01 // a hair of margin against sub-pixel rounding
    if (Math.abs(measured - charW) / charW > 0.01) {
      passRef.current += 1
      setCharW(measured)
    }
  })

  return (
    <svg
      viewBox="0 0 100 100"
      className="w-full h-auto select-none touch-manipulation"
      role="img"
      aria-label={title}
      style={{ opacity: dimmed ? 0.5 : 1, transition: 'opacity 260ms ease' }}
    >
      {/* Rim: a thin ring rather than a bezel. */}
      <circle cx={CX} cy={CY} r={OUTER + 1.2} fill="none" stroke="var(--color-line)" strokeWidth="0.5" />

      <g
        ref={groupRef}
        transform={`rotate(${rotation} ${CX} ${CY})`}
        style={{
          transition:
            spinning && durationMs > 0 ? `transform ${durationMs}ms cubic-bezier(0.12, 0.66, 0.12, 1)` : 'none',
          willChange: spinning ? 'transform' : 'auto',
        }}
        onTransitionEnd={(e) => {
          if (e.propertyName === 'transform') onSettled?.()
        }}
      >
        {count === 0 && <circle cx={CX} cy={CY} r={OUTER} fill="var(--color-surface)" />}

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
                stroke="var(--color-ground)"
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

      {/* Hub — fixed, does not rotate, so the count stays readable mid-spin. */}
      <circle
        cx={CX}
        cy={CY}
        r={INNER - 0.6}
        fill="var(--color-ground-2)"
        stroke="var(--color-line)"
        strokeWidth="0.4"
      />
      {hubLabel != null && (
        <text
          x={CX}
          y={hubSub ? CY - 0.4 : CY + 1.6}
          textAnchor="middle"
          fill="var(--color-ink)"
          fontSize="5.2"
          fontFamily="var(--font-serif)"
        >
          {hubLabel}
        </text>
      )}
      {hubSub && (
        <text
          x={CX}
          y={CY + 4.8}
          textAnchor="middle"
          fill="var(--color-ink-3)"
          fontSize="2.5"
          fontFamily="var(--font-sans)"
          letterSpacing="0.1em"
        >
          {hubSub}
        </text>
      )}

      {/* Pointer: fixed at 12 o'clock, reading into the wheel. */}
      <g>
        <path
          d={`M ${CX} ${CY - OUTER + 3.4} L ${CX - 3} ${CY - OUTER - 3.2} L ${CX + 3} ${CY - OUTER - 3.2} Z`}
          fill="var(--color-accent)"
        />
        <circle cx={CX} cy={CY - OUTER - 3.6} r="1.5" fill="var(--color-accent)" />
      </g>
    </svg>
  )
})
