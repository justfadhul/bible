/**
 * Pure transitions on the persisted state shape.
 *
 * Everything here returns a new state object; nothing mutates and nothing
 * touches storage. App.jsx applies these and hands the result to saveState().
 */
import { emptyState, makeReader, MAX_READERS } from './storage.js'
import { localISODate } from './date.js'

/** Set of entry ids already read. */
export const completedIds = (state) => new Set(state.completed.map((r) => r.id))

/** The row for a given entry id, or undefined. */
export const rowFor = (state, id) => state.completed.find((r) => r.id === id)

/** Newest first — the archive order, and how "today's reading" is found. */
export const byNewest = (state) =>
  [...state.completed].sort((a, b) => {
    if (a.dateISO === b.dateISO) return b.id - a.id
    if (!a.dateISO) return 1
    if (!b.dateISO) return -1
    return a.dateISO < b.dateISO ? 1 : -1
  })

/** The entry recorded for a given day, if any. */
export const rowForDate = (state, dateISO) => byNewest(state).find((r) => r.dateISO === dateISO)

/** True once every id in the catalog has been read. */
export const isExhausted = (state, total) => state.completed.length >= total

/**
 * Records a spin result. Binding: the entry moves out of the pool here, and
 * the only way back is undoSpin() within its 60-second window.
 */
export function recordSpin(state, entryId, dateISO = localISODate()) {
  if (state.completed.some((r) => r.id === entryId)) return state
  return {
    ...state,
    completed: [...state.completed, { id: entryId, dateISO, notes: '', readBy: [] }],
    lastSpinDate: dateISO,
  }
}

/**
 * Reverses exactly one spin — the misclick escape hatch.
 * `previousLastSpinDate` restores the day lock to whatever it was before, so
 * an undo genuinely returns you to the pre-spin state.
 */
export function undoSpin(state, entryId, previousLastSpinDate) {
  return {
    ...state,
    completed: state.completed.filter((r) => r.id !== entryId),
    lastSpinDate: previousLastSpinDate ?? null,
  }
}

export function setNotes(state, entryId, notes) {
  return { ...state, completed: state.completed.map((r) => (r.id === entryId ? { ...r, notes } : r)) }
}

/** Ticks or unticks one reader against one reading. */
export function setReadBy(state, entryId, readerId, value) {
  return {
    ...state,
    completed: state.completed.map((r) => {
      if (r.id !== entryId) return r
      const has = r.readBy.includes(readerId)
      if (value === has) return r
      return {
        ...r,
        readBy: value ? [...r.readBy, readerId] : r.readBy.filter((x) => x !== readerId),
      }
    }),
  }
}

/* ── readers ──────────────────────────────────────────────────────────── */

export function addReader(state, over = {}) {
  if (state.readers.length >= MAX_READERS) return state
  return { ...state, readers: [...state.readers, makeReader(over)] }
}

/**
 * Removes a reader, and with them every tick they made — leaving those behind
 * would show a reading as read by somebody who is no longer in the list.
 * The last reader cannot be removed; there has to be somebody.
 */
export function removeReader(state, readerId) {
  if (state.readers.length <= 1) return state
  return {
    ...state,
    readers: state.readers.filter((r) => r.id !== readerId),
    completed: state.completed.map((r) =>
      r.readBy.includes(readerId) ? { ...r, readBy: r.readBy.filter((x) => x !== readerId) } : r,
    ),
  }
}

export function updateReader(state, readerId, patch) {
  return {
    ...state,
    readers: state.readers.map((r) => (r.id === readerId ? { ...r, ...patch } : r)),
  }
}

/**
 * Attaches a signed-in account to a reader.
 *
 * Prefers a reader already linked to this account, then the first unlinked
 * one — so signing in on a device that has been used solo adopts the existing
 * reader and its history rather than adding a stranger to the list.
 */
export function linkAccount(state, { userId, email, name, avatarUrl }) {
  if (!userId) return state

  const existing = state.readers.find((r) => r.userId === userId)
  const target = existing ?? state.readers.find((r) => !r.userId)

  const fill = (r) => ({
    ...r,
    userId,
    email: email ?? r.email,
    name: r.name?.trim() ? r.name : (name ?? ''),
    avatarUrl: avatarUrl ?? r.avatarUrl,
  })

  if (target) return { ...state, readers: state.readers.map((r) => (r.id === target.id ? fill(r) : r)) }
  if (state.readers.length >= MAX_READERS) return state
  return { ...state, readers: [...state.readers, fill(makeReader({ userId, email, name, avatarUrl }))] }
}

export const freshState = emptyState
