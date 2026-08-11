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

/**
 * Who has read what, category by category.
 *
 * Two different numbers get confused here, so they are kept apart deliberately:
 *
 *   drawn  — how many of a category's passages the wheel has produced at all.
 *            Shared by everyone; nobody controls it.
 *   read   — how many of those a particular reader has ticked.
 *
 * A reader's score is out of `drawn`, never out of the category total, because
 * nobody can read what has not come up yet. Scoring against the total would
 * make somebody who has read every single passage they were given look like
 * they were 20% through, which is both wrong and discouraging.
 *
 * Passages the wheel has not drawn are counted but not listed. The premise of
 * the app is that the wheel chooses; a browsable list of what is still to come
 * quietly replaces that with a menu.
 */
export function readerProgress(state) {
  const readers = state.readers ?? []
  const rowById = new Map(state.completed.map((r) => [r.id, r]))
  const totals = Object.fromEntries(readers.map((r) => [r.id, 0]))
  let drawnTotal = 0

  const categories = CATEGORIES.map((c) => {
    const all = ENTRIES_BY_CATEGORY.get(c.id) ?? []
    const perReader = Object.fromEntries(readers.map((r) => [r.id, 0]))
    const topics = []

    for (const e of all) {
      const row = rowById.get(e.id)
      if (!row) continue
      const readBy = row.readBy ?? []
      for (const id of readBy) {
        if (id in perReader) perReader[id] += 1
        if (id in totals) totals[id] += 1
      }
      topics.push({
        id: e.id,
        topic: e.topic,
        reference: e.reference,
        dateISO: row.dateISO,
        readBy,
        hasNotes: Boolean(row.notes?.trim()) || Object.values(row.notesBy ?? {}).some((t) => t?.trim()),
        notesBy: row.notesBy ?? {},
      })
    }

    topics.sort((a, b) => (a.dateISO === b.dateISO ? a.id - b.id : a.dateISO < b.dateISO ? 1 : -1))
    drawnTotal += topics.length

    return {
      id: c.id,
      name: c.name,
      color: c.color,
      total: all.length,
      drawn: topics.length,
      undrawn: all.length - topics.length,
      perReader,
      topics,
    }
  })

  return { readers, categories, totals, drawnTotal }
}

/** Everything the archive header needs, in one pass. */
export function archiveStats(state) {
  const ids = new Set(state.completed.map((r) => r.id))
  const testament = { OT: 0, NT: 0 }
  const size = { short: 0, medium: 0, long: 0 }
  let allRead = 0
  let withNotes = 0
  const readerCount = state.readers?.length ?? 0
  for (const r of state.completed) {
    const e = getEntry(r.id)
    if (e) {
      if (e.testament in testament) testament[e.testament]++
      if (e.size in size) size[e.size]++
    }
    // "everyone" only means something once there is somebody.
    if (readerCount > 0 && (r.readBy?.length ?? 0) >= readerCount) allRead++
    if (r.notes?.trim() || Object.values(r.notesBy ?? {}).some((t) => t?.trim())) withNotes++
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
    allRead,
    readerCount,
    withNotes,
    perCategory: categoryProgress(ids),
  }
}
