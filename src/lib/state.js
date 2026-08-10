/**
 * Pure transitions on the persisted state shape.
 *
 * Everything here returns a new state object; nothing mutates and nothing
 * touches storage. App.jsx applies these and hands the result to saveState().
 */
import { emptyState } from './storage.js'
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
export const rowForDate = (state, dateISO) =>
  byNewest(state).find((r) => r.dateISO === dateISO)

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
    completed: [...state.completed, { id: entryId, dateISO, notes: '', readBy: { a: false, b: false } }],
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

export function setReadBy(state, entryId, reader, value) {
  return {
    ...state,
    completed: state.completed.map((r) =>
      r.id === entryId ? { ...r, readBy: { ...r.readBy, [reader]: value } } : r,
    ),
  }
}

export function setReaderName(state, reader, name) {
  return { ...state, readerNames: { ...state.readerNames, [reader]: name } }
}

export const freshState = emptyState
