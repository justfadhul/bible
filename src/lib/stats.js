/**
 * Archive statistics: totals, streaks, per-category completion.
 * Pure functions over the completed list.
 */
import { CATEGORIES, ENTRIES_BY_CATEGORY, TOTAL, getEntry } from './catalog.js'
import { dayNumber, localISODate } from './date.js'

/** Distinct reading days, as day numbers, ascending. */
function readingDays(completed) {
  const days = new Set()
  for (const r of completed) {
    const n = dayNumber(r.dateISO)
    if (!Number.isNaN(n)) days.add(n)
  }
  return [...days].sort((a, b) => a - b)
}

/**
 * Consecutive days ending today, or ending yesterday if today has no reading
 * yet — a streak should not look broken at 8am before you have spun.
 */
export function currentStreak(completed, today = localISODate()) {
  const days = readingDays(completed)
  if (!days.length) return 0
  const t = dayNumber(today)
  const last = days[days.length - 1]
  if (last !== t && last !== t - 1) return 0

  const present = new Set(days)
  let streak = 0
  for (let d = last; present.has(d); d--) streak++
  return streak
}

/** Longest run of consecutive reading days ever recorded. */
export function longestStreak(completed) {
  const days = readingDays(completed)
  if (!days.length) return 0
  let best = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    run = days[i] === days[i - 1] + 1 ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}

/** Per-category read/total/remaining, in catalog order — the 15-bar chart. */
export function categoryProgress(completedIdSet) {
  return CATEGORIES.map((c) => {
    const all = ENTRIES_BY_CATEGORY.get(c.id) ?? []
    const read = all.filter((e) => completedIdSet.has(e.id)).length
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      blurb: c.blurb,
      read,
      total: all.length,
      remaining: all.length - read,
      fraction: all.length ? read / all.length : 0,
    }
  })
}

/** Everything the archive header needs, in one pass. */
export function archiveStats(state) {
  const ids = new Set(state.completed.map((r) => r.id))
  const testament = { OT: 0, NT: 0 }
  const size = { short: 0, medium: 0, long: 0 }
  let bothRead = 0
  let withNotes = 0
  for (const r of state.completed) {
    const e = getEntry(r.id)
    if (e) {
      if (e.testament in testament) testament[e.testament]++
      if (e.size in size) size[e.size]++
    }
    if (r.readBy?.a && r.readBy?.b) bothRead++
    if (r.notes?.trim()) withNotes++
  }
  return {
    total: TOTAL,
    read: state.completed.length,
    remaining: TOTAL - state.completed.length,
    fraction: TOTAL ? state.completed.length / TOTAL : 0,
    current: currentStreak(state.completed),
    longest: longestStreak(state.completed),
    days: readingDays(state.completed).length,
    testament,
    size,
    bothRead,
    withNotes,
    perCategory: categoryProgress(ids),
  }
}
