import { describe, it, expect } from 'vitest'
import {
  computeFinalRotation,
  resolveIndexAtPointer,
  segmentCenter,
  stepFor,
  pointerAngle,
  inkOn,
  shade,
} from './wheel.js'

/** Deterministic LCG so failures are reproducible. */
function lcg(seed = 1) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

describe('rotation is the exact inverse of the pointer reading', () => {
  it('lands on the selected segment for every count and index, dead-centre', () => {
    for (let count = 1; count <= 40; count++) {
      for (let target = 0; target < count; target++) {
        const r = computeFinalRotation({ current: 0, targetIndex: target, count })
        expect(resolveIndexAtPointer(r, count)).toBe(target)
      }
    }
  })

  it('lands on the selected segment with jitter, from an arbitrary current rotation', () => {
    const rng = lcg(20260810)
    for (let trial = 0; trial < 20000; trial++) {
      const count = 1 + Math.floor(rng() * 40)
      const target = Math.floor(rng() * count)
      const current = rng() * 5000 - 1000
      const jitter = rng() * 2 - 1
      const turns = 1 + Math.floor(rng() * 6)
      const r = computeFinalRotation({ current, targetIndex: target, count, turns, jitter })
      expect(resolveIndexAtPointer(r, count)).toBe(target)
    }
  })

  it('never rewinds: the final rotation always exceeds the current one', () => {
    const rng = lcg(7)
    for (let i = 0; i < 5000; i++) {
      const count = 1 + Math.floor(rng() * 30)
      const current = rng() * 4000
      const r = computeFinalRotation({ current, targetIndex: Math.floor(rng() * count), count, turns: 3 })
      expect(r).toBeGreaterThan(current)
      expect(r - current).toBeGreaterThanOrEqual(3 * 360)
      expect(r - current).toBeLessThan(4 * 360)
    }
  })

  it('clamps extreme jitter inside the target segment', () => {
    for (const jitter of [-1000, -1, -0.999, 0.999, 1, 1000]) {
      for (const count of [2, 3, 7, 12, 23]) {
        for (let t = 0; t < count; t++) {
          expect(resolveIndexAtPointer(computeFinalRotation({ targetIndex: t, count, jitter }), count)).toBe(t)
        }
      }
    }
  })

  it('places the pointer within the target segment bounds, not merely near it', () => {
    const count = 23 // the largest category, the tightest segments
    for (let t = 0; t < count; t++) {
      for (const jitter of [-0.9, -0.5, 0, 0.5, 0.9]) {
        const angle = pointerAngle(computeFinalRotation({ targetIndex: t, count, jitter }))
        expect(angle).toBeGreaterThanOrEqual(t * stepFor(count) - 1e-9)
        expect(angle).toBeLessThan((t + 1) * stepFor(count))
      }
    }
  })
})

describe('segment geometry', () => {
  it('centres segments evenly, starting at the pointer', () => {
    expect(stepFor(4)).toBe(90)
    expect(segmentCenter(0, 4)).toBe(45)
    expect(segmentCenter(3, 4)).toBe(315)
  })

  it('single-segment wheels still resolve', () => {
    expect(resolveIndexAtPointer(computeFinalRotation({ targetIndex: 0, count: 1 }), 1)).toBe(0)
  })
})

describe('colour helpers', () => {
  it('picks dark ink on light fills and light ink on dark fills', () => {
    expect(inkOn('#F6F2EA')).toBe('#14161a')
    expect(inkOn('#1E3A5F')).toBe('#F6F2EA')
    expect(inkOn('#374151')).toBe('#F6F2EA')
  })

  it('shades toward white and black without leaving the hex range', () => {
    expect(shade('#808080', 1)).toBe('#ffffff')
    expect(shade('#808080', -1)).toBe('#000000')
    expect(shade('#C2410C', 0)).toBe('#c2410c')
  })
})
