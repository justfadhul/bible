import { describe, it, expect } from 'vitest'
import { availableCategories, planSpin, unreadInCategory, remainingCount, pickIndex } from './selection.js'
import { CATEGORIES, ENTRIES_BY_CATEGORY, TOTAL, ENTRIES } from './catalog.js'
import { computeFinalRotation, resolveIndexAtPointer } from './wheel.js'
import { recordSpin, completedIds, isExhausted } from './state.js'
import { emptyState } from './storage.js'

function lcg(seed = 1) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

describe('the pool', () => {
  it('offers every category while nothing is read', () => {
    expect(availableCategories(new Set())).toHaveLength(CATEGORIES.length)
    expect(remainingCount(new Set())).toBe(TOTAL)
  })

  it('removes a category from wheel 1 the moment its last entry is read', () => {
    const target = CATEGORIES.find((c) => ENTRIES_BY_CATEGORY.get(c.id).length > 0)
    const all = ENTRIES_BY_CATEGORY.get(target.id)
    const done = new Set(all.slice(0, -1).map((e) => e.id))

    expect(availableCategories(done).map((c) => c.id)).toContain(target.id)
    expect(unreadInCategory(target.id, done)).toHaveLength(1)

    done.add(all[all.length - 1].id)
    expect(availableCategories(done).map((c) => c.id)).not.toContain(target.id)
    expect(unreadInCategory(target.id, done)).toHaveLength(0)
  })

  it('never plans a spin into an empty category', () => {
    const rng = lcg(99)
    const done = new Set()
    // Read most of the catalog at random, checking the invariant each step.
    while (done.size < TOTAL) {
      const plan = planSpin(done, rng)
      expect(plan).not.toBeNull()
      expect(plan.entries.length).toBeGreaterThan(0)
      expect(done.has(plan.entry.id)).toBe(false)
      for (const c of plan.categories) expect(unreadInCategory(c.id, done).length).toBeGreaterThan(0)
      done.add(plan.entry.id)
    }
    expect(planSpin(done, rng)).toBeNull()
  })
})

describe('286 spins, zero repeats', () => {
  it.each([1, 42, 2718, 20260810])('exhausts the catalog exactly once (seed %i)', (seed) => {
    const rng = lcg(seed)
    let state = emptyState()
    const seen = []

    for (let i = 0; i < TOTAL; i++) {
      const plan = planSpin(completedIds(state), rng)
      expect(plan).not.toBeNull()
      // The animation must land on precisely what was picked, at both stages.
      expect(resolveIndexAtPointer(
        computeFinalRotation({ targetIndex: plan.categoryIndex, count: plan.categories.length, jitter: rng() * 2 - 1 }),
        plan.categories.length,
      )).toBe(plan.categoryIndex)
      expect(resolveIndexAtPointer(
        computeFinalRotation({ targetIndex: plan.entryIndex, count: plan.entries.length, jitter: rng() * 2 - 1 }),
        plan.entries.length,
      )).toBe(plan.entryIndex)

      seen.push(plan.entry.id)
      state = recordSpin(state, plan.entry.id, `2026-01-${String((i % 28) + 1).padStart(2, '0')}`)
    }

    expect(seen).toHaveLength(TOTAL)
    expect(new Set(seen).size).toBe(TOTAL)
    expect(new Set(seen)).toEqual(new Set(ENTRIES.map((e) => e.id)))
    expect(isExhausted(state, TOTAL)).toBe(true)
    // The 287th spin is a completion state, not an error.
    expect(planSpin(completedIds(state), rng)).toBeNull()
  })
})

describe('the default (crypto) draw', () => {
  it('covers the whole range with no index starved or favoured', () => {
    const n = 15
    const draws = 150_000
    const counts = new Array(n).fill(0)
    for (let i = 0; i < draws; i++) counts[pickIndex(n)]++

    const expected = draws / n
    expect(counts.every((c) => c > 0)).toBe(true)
    // A uniform draw stays well inside 5% at this sample size; modulo bias or
    // a truncated range would blow straight past it.
    for (const c of counts) expect(Math.abs(c - expected) / expected).toBeLessThan(0.05)
  })

  it('always returns an in-range index, including the degenerate sizes', () => {
    expect(pickIndex(0)).toBe(-1)
    expect(pickIndex(1)).toBe(0)
    for (let i = 0; i < 2000; i++) {
      const v = pickIndex(23)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(23)
    }
  })

  it('honours an injected rng and never overruns on rng() === 1', () => {
    expect(pickIndex(10, () => 0)).toBe(0)
    expect(pickIndex(10, () => 0.9999999)).toBe(9)
    expect(pickIndex(10, () => 1)).toBe(9)
  })
})

describe('recordSpin is binding', () => {
  it('refuses to record the same entry twice', () => {
    let s = emptyState()
    s = recordSpin(s, 1, '2026-01-01')
    const again = recordSpin(s, 1, '2026-01-02')
    expect(again.completed).toHaveLength(1)
    expect(again).toBe(s)
  })
})
