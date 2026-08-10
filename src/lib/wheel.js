/**
 * Wheel geometry.
 *
 * Angle convention throughout: "compass degrees" measured CLOCKWISE from
 * 12 o'clock, which is where the pointer sits. A point at compass angle θ and
 * radius r is at (cx + r·sinθ, cy − r·cosθ).
 *
 * Segment i occupies [i·step, (i+1)·step) where step = 360/n.
 *
 * Rotating the wheel group by R degrees (SVG `rotate(R)`, clockwise for
 * positive R) moves a feature at θ to θ + R. The pointer reads compass angle
 * 0, so whatever satisfies θ + R ≡ 0 (mod 360) ends up under it.
 *
 * That gives an exact inverse — resolveIndexAtPointer() — which the tests use
 * to prove the wheel lands on the segment that was actually selected, rather
 * than close to it.
 */

export const TAU_DEG = 360

export const stepFor = (count) => TAU_DEG / count
export const segmentStart = (i, count) => i * stepFor(count)
export const segmentCenter = (i, count) => (i + 0.5) * stepFor(count)

const mod360 = (x) => ((x % TAU_DEG) + TAU_DEG) % TAU_DEG

/** Cartesian point for a compass angle, given a centre and radius. */
export function polar(cx, cy, r, angleDeg) {
  const a = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) }
}

/**
 * SVG path for one annular (or pie) segment.
 * innerR = 0 produces a pie slice; > 0 produces a ring segment.
 */
export function segmentPath(cx, cy, outerR, innerR, startAngle, endAngle) {
  const large = endAngle - startAngle > 180 ? 1 : 0
  const o1 = polar(cx, cy, outerR, startAngle)
  const o2 = polar(cx, cy, outerR, endAngle)
  if (innerR <= 0) {
    return `M ${cx} ${cy} L ${o1.x} ${o1.y} A ${outerR} ${outerR} 0 ${large} 1 ${o2.x} ${o2.y} Z`
  }
  const i2 = polar(cx, cy, innerR, endAngle)
  const i1 = polar(cx, cy, innerR, startAngle)
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i2.x} ${i2.y}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${i1.x} ${i1.y}`,
    'Z',
  ].join(' ')
}

/**
 * The compass angle the pointer is reading, for a given rotation.
 * Exact inverse of the rotation maths below.
 */
export const pointerAngle = (rotation) => mod360(-rotation)

/** Which segment index the pointer is over. The proof-of-correctness function. */
export function resolveIndexAtPointer(rotation, count) {
  if (count <= 0) return -1
  const idx = Math.floor(pointerAngle(rotation) / stepFor(count))
  // Guards float error landing exactly on 360.
  return idx >= count ? count - 1 : idx
}

/**
 * Rotation that puts `targetIndex` under the pointer.
 *
 * Always rotates forwards from `current` (the wheel never rewinds), by at
 * least `turns` full revolutions plus whatever partial turn is needed.
 *
 * `jitter` in [-1, 1] offsets the landing within the segment, as a fraction of
 * half the segment width, so results do not always sit dead-centre. It is
 * clamped to ±0.7 of a half-segment, which keeps the pointer strictly inside
 * the target segment — resolveIndexAtPointer() of the result is always
 * targetIndex.
 */
export function computeFinalRotation({ current = 0, targetIndex, count, turns = 4, jitter = 0 }) {
  if (count <= 0) return current
  const step = stepFor(count)
  const clamped = Math.max(-0.7, Math.min(0.7, jitter))
  const target = segmentCenter(targetIndex, count) + clamped * (step / 2)
  // We need final ≡ -target (mod 360), reached going forwards.
  const delta = mod360(-target - current)
  return current + turns * TAU_DEG + delta
}

/** Random jitter in [-1, 1], injectable for tests. */
export const randomJitter = (rng = Math.random) => rng() * 2 - 1

/**
 * Label placement for a segment: a point partway along the radius, rotated so
 * the text runs outwards along the segment's centre line. Text on the left
 * half is flipped 180° so it never reads upside down.
 */
export function labelTransform(cx, cy, radius, i, count) {
  const angle = segmentCenter(i, count)
  const { x, y } = polar(cx, cy, radius, angle)
  const flipped = angle > 180
  // SVG rotate() is clockwise from the +x axis; our compass angle needs -90.
  const rotate = flipped ? angle - 90 + 180 : angle - 90
  return { x, y, rotate, flipped, angle }
}

// ── colour helpers ─────────────────────────────────────────────────────────
// Segment fills come from the catalog's category colours. We only ever derive
// tints of those, never substitute a palette of our own.

const clamp01 = (v) => Math.max(0, Math.min(1, v))

export function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

export const rgbToHex = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0')).join('')

/** Mixes a hex colour toward white (amount > 0) or black (amount < 0). */
export function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex)
  const t = amount >= 0 ? 255 : 0
  const p = Math.abs(amount)
  return rgbToHex({ r: r + (t - r) * p, g: g + (t - g) * p, b: b + (t - b) * p })
}

/** WCAG relative luminance, for deciding whether label ink should be light or dark. */
export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex)
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** Readable ink for a given background, chosen by contrast rather than by taste. */
export const inkOn = (hex) => (relativeLuminance(hex) > 0.42 ? '#14161a' : '#F6F2EA')
