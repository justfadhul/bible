/**
 * The spin mechanic, as pure functions.
 *
 * Rule: the winner is decided here, in JavaScript, *before* anything moves.
 * The wheel is then animated to land on the already-decided result. There is
 * no physics simulation and nothing is read off a resting position — see
 * wheel.js for the geometry that guarantees the landing is exact.
 *
 * Fairness note: wheel 1 draws uniformly from the categories that still have
 * unread entries, and those categories are drawn as equal-sized segments. So
 * the probability of a category matches the arc you can see. It does mean a
 * small category's entries are individually likelier than a large one's —
 * that is the honest reading of "wheel 1 picks a category", and it keeps the
 * wheel from lying about its own odds.
 */
import { CATEGORIES, ENTRIES_BY_CATEGORY, TOTAL } from './catalog.js'

/** Categories that still have at least one unread entry, in catalog order. */
export function availableCategories(completedIds) {
  const done = completedIds instanceof Set ? completedIds : new Set(completedIds)
  return CATEGORIES.filter((c) => (ENTRIES_BY_CATEGORY.get(c.id) ?? []).some((e) => !done.has(e.id)))
}

/** Unread entries within one category, in catalog order. */
export function unreadInCategory(categoryId, completedIds) {
  const done = completedIds instanceof Set ? completedIds : new Set(completedIds)
  return (ENTRIES_BY_CATEGORY.get(categoryId) ?? []).filter((e) => !done.has(e.id))
}

/** How many entries remain overall. */
export const remainingCount = (completedIds) =>
  TOTAL - (completedIds instanceof Set ? completedIds.size : new Set(completedIds).size)

/**
 * Uniform integer in [0, n).
 *
 * With no rng supplied it draws from crypto.getRandomValues and rejects
 * out-of-range samples, so there is no modulo bias — the point of the app is
 * that neither reader influences the result, so the draw should be unbiased by
 * construction rather than by assumption. Math.random is the fallback when
 * crypto is unavailable.
 *
 * Tests and the simulation pass their own float rng to drive it deterministically.
 */
export function pickIndex(n, rng) {
  if (n <= 0) return -1
  if (n === 1) return 0

  if (typeof rng === 'function') {
    const i = Math.floor(rng() * n)
    // Guards the pathological rng() === 1 case.
    return i >= n ? n - 1 : i
  }

  const crypto = globalThis.crypto
  if (crypto?.getRandomValues) {
    // Rejection sampling: discard the ragged tail above the largest exact
    // multiple of n, so every index is equally likely.
    const limit = Math.floor(0x100000000 / n) * n
    const buf = new Uint32Array(1)
    for (let attempt = 0; attempt < 64; attempt++) {
      crypto.getRandomValues(buf)
      if (buf[0] < limit) return buf[0] % n
    }
  }
  const i = Math.floor(Math.random() * n)
  return i >= n ? n - 1 : i
}

/**
 * Decides the entire two-stage outcome up front.
 *
 * Returns null when the catalog is exhausted. Otherwise:
 *   { categories, categoryIndex, category, entries, entryIndex, entry }
 * where `categories` and `entries` are exactly the segment lists that wheel 1
 * and wheel 2 must render, and the indexes are the segments to land on.
 */
export function planSpin(completedIds, rng) {
  const categories = availableCategories(completedIds)
  if (categories.length === 0) return null

  const categoryIndex = pickIndex(categories.length, rng)
  const category = categories[categoryIndex]

  const entries = unreadInCategory(category.id, completedIds)
  // availableCategories() guarantees this is non-empty.
  const entryIndex = pickIndex(entries.length, rng)
  const entry = entries[entryIndex]

  return { categories, categoryIndex, category, entries, entryIndex, entry }
}
