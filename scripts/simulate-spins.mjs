#!/usr/bin/env node
/**
 * Acceptance check #1, run against the real application modules — not a copy
 * of the logic. Proves that:
 *
 *   • 286 spins produce all 286 entries with zero repeats
 *   • the 287th spin yields a completion state, not an error
 *   • no category is ever offered on wheel 1 once its entries are exhausted
 *   • both wheels animate to exactly the segment that was selected
 *
 * Run: node scripts/simulate-spins.mjs [runs]
 */
import { ENTRIES, TOTAL, CATEGORIES } from '../src/lib/catalog.js'
import { planSpin, availableCategories, unreadInCategory } from '../src/lib/selection.js'
import { computeFinalRotation, resolveIndexAtPointer, randomJitter } from '../src/lib/wheel.js'
import { recordSpin, completedIds, isExhausted } from '../src/lib/state.js'
import { emptyState } from '../src/lib/storage.js'

const RUNS = Number(process.argv[2] ?? 200)

/**
 * Deterministic PRNG, so a failure can be replayed from its seed.
 * splitmix32 rather than a bare LCG: consecutive seeds decorrelate, so the
 * distribution figures below describe the mechanic and not the generator.
 */
const prng = (seed) => {
  let s = (seed + 0x9e3779b9) >>> 0
  return () => {
    s = (s + 0x9e3779b9) >>> 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296
  }
}

const failures = []
const fail = (m) => failures.push(m)

let deadSegmentChecks = 0
let landingChecks = 0
const positionHistogram = new Map(ENTRIES.map((e) => [e.id, 0]))
const firstCategoryHistogram = new Map(CATEGORIES.map((c) => [c.id, 0]))

console.log(`\nSimulating ${RUNS} full playthroughs of ${TOTAL} spins each…\n`)
const started = Date.now()

for (let run = 0; run < RUNS; run++) {
  const seed = 1000 + run
  const rng = prng(seed)
  let state = emptyState()
  const order = []

  for (let spin = 0; spin < TOTAL; spin++) {
    const done = completedIds(state)
    const plan = planSpin(done, rng)

    if (!plan) { fail(`seed ${seed}: ran out of entries after ${spin} spins, expected ${TOTAL}`); break }

    // — no category on wheel 1 may be exhausted —
    for (const c of plan.categories) {
      deadSegmentChecks++
      if (unreadInCategory(c.id, done).length === 0) fail(`seed ${seed} spin ${spin}: exhausted category "${c.id}" was on wheel 1`)
    }
    // — and every category with something left must be present —
    const offered = new Set(plan.categories.map((c) => c.id))
    for (const c of CATEGORIES) {
      if (unreadInCategory(c.id, done).length > 0 && !offered.has(c.id)) {
        fail(`seed ${seed} spin ${spin}: category "${c.id}" still had unread entries but was missing from wheel 1`)
      }
    }
    if (plan.categories.length !== availableCategories(done).length) {
      fail(`seed ${seed} spin ${spin}: wheel 1 segment count disagrees with the available categories`)
    }

    // — the animation must land on precisely the chosen segment, both stages —
    const stage1 = computeFinalRotation({
      current: rng() * 3000, targetIndex: plan.categoryIndex, count: plan.categories.length,
      turns: 4, jitter: randomJitter(rng),
    })
    const stage2 = computeFinalRotation({
      current: rng() * 3000, targetIndex: plan.entryIndex, count: plan.entries.length,
      turns: 3, jitter: randomJitter(rng),
    })
    landingChecks += 2
    if (resolveIndexAtPointer(stage1, plan.categories.length) !== plan.categoryIndex) {
      fail(`seed ${seed} spin ${spin}: wheel 1 settled on the wrong segment`)
    }
    if (resolveIndexAtPointer(stage2, plan.entries.length) !== plan.entryIndex) {
      fail(`seed ${seed} spin ${spin}: wheel 2 settled on the wrong segment`)
    }

    if (done.has(plan.entry.id)) fail(`seed ${seed} spin ${spin}: repeat of entry ${plan.entry.id}`)
    if (plan.entry.category !== plan.category.id) fail(`seed ${seed} spin ${spin}: entry/category mismatch`)

    if (spin === 0) firstCategoryHistogram.set(plan.category.id, firstCategoryHistogram.get(plan.category.id) + 1)
    positionHistogram.set(plan.entry.id, positionHistogram.get(plan.entry.id) + spin)

    order.push(plan.entry.id)
    state = recordSpin(state, plan.entry.id, `2026-01-${String((spin % 28) + 1).padStart(2, '0')}`)
  }

  if (order.length !== TOTAL) fail(`seed ${seed}: produced ${order.length} results, expected ${TOTAL}`)
  if (new Set(order).size !== order.length) fail(`seed ${seed}: contained repeats`)
  const missing = ENTRIES.filter((e) => !order.includes(e.id))
  if (missing.length) fail(`seed ${seed}: never produced ${missing.length} entries (e.g. ${missing[0]?.id})`)
  if (!isExhausted(state, TOTAL)) fail(`seed ${seed}: state not marked exhausted`)

  // — the 287th spin —
  const after = planSpin(completedIds(state), rng)
  if (after !== null) fail(`seed ${seed}: spin ${TOTAL + 1} returned a result instead of the completion state`)
  if (availableCategories(completedIds(state)).length !== 0) fail(`seed ${seed}: wheel 1 still had segments after exhaustion`)
}

const elapsed = Date.now() - started
const spins = RUNS * TOTAL

console.log(`  playthroughs                  ${RUNS}`)
console.log(`  spins simulated               ${spins.toLocaleString()}`)
console.log(`  distinct entries per run      ${TOTAL} / ${TOTAL}   (zero repeats)`)
console.log(`  287th spin                    completion state (null) in all ${RUNS} runs`)
console.log(`  dead-segment checks           ${deadSegmentChecks.toLocaleString()} — no exhausted category ever offered`)
console.log(`  landing checks                ${landingChecks.toLocaleString()} — every animation resolved to the selected segment`)

const mean = [...positionHistogram.values()].reduce((a, b) => a + b, 0) / positionHistogram.size / RUNS
const spread = [...positionHistogram.entries()].map(([id, sum]) => [id, sum / RUNS])
spread.sort((a, b) => a[1] - b[1])
console.log(`\n  average draw position         ${mean.toFixed(1)} of ${TOTAL}`)
console.log(`  earliest-drawn on average     entry ${spread[0][0]} at ${spread[0][1].toFixed(1)}`)
console.log(`  latest-drawn on average       entry ${spread[spread.length - 1][0]} at ${spread[spread.length - 1][1].toFixed(1)}`)
console.log(`  first-spin category spread    ${[...firstCategoryHistogram.values()].join(' ')}`)
console.log(`\n  elapsed                       ${elapsed}ms`)

if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):`)
  for (const f of failures.slice(0, 20)) console.error(`   ${f}`)
  if (failures.length > 20) console.error(`   …and ${failures.length - 20} more`)
  process.exit(1)
}
console.log('\n✓ all acceptance conditions held across every run\n')
