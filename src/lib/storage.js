/**
 * ─────────────────────────────────────────────────────────────────────────
 *  THE ONLY PLACE THE APP TOUCHES PERSISTENT STORAGE.
 *
 *  The interface is deliberately narrow — getState() and saveState() — so
 *  that swapping localStorage for a shared two-person backend later means
 *  rewriting this file and nothing else. Both are synchronous today; if you
 *  move to a remote store, make them async and await them at the three call
 *  sites in App.jsx. Nothing else in src/ knows localStorage exists.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Persisted shape (schema version 1):
 *
 *   {
 *     version: 1,
 *     completed: [{ id, dateISO, notes, readBy: { a: bool, b: bool } }],
 *     lastSpinDate: "YYYY-MM-DD" | null,
 *     readerNames: { a: string, b: string }   // additive, optional
 *   }
 *
 * Every read is guarded: a corrupt, truncated or foreign value falls back to
 * empty state rather than crashing, and unknown fields are dropped rather
 * than trusted.
 */
import { isISODate } from './date.js'

export const STORAGE_KEY = 'spin-catalog:v1'
export const SCHEMA_VERSION = 1

export const DEFAULT_READER_NAMES = { a: 'Reader A', b: 'Reader B' }

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    completed: [],
    lastSpinDate: null,
    readerNames: { ...DEFAULT_READER_NAMES },
  }
}

const asString = (v, fallback = '') => (typeof v === 'string' ? v : fallback)
const asBool = (v) => v === true

/**
 * Coerces arbitrary input into a valid state object.
 * Used for both localStorage reads and file imports, so an imported file gets
 * exactly the same scrutiny as stored data.
 *
 * Returns { state, problems }. Unrecoverable input yields empty state.
 */
export function normalizeState(input) {
  const problems = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { state: emptyState(), problems: ['not an object'] }
  }

  if (input.version !== SCHEMA_VERSION) {
    problems.push(`unknown schema version ${JSON.stringify(input.version)} — reading it as v${SCHEMA_VERSION}`)
  }

  const seen = new Set()
  const completed = []
  const rawCompleted = Array.isArray(input.completed) ? input.completed : []
  if (!Array.isArray(input.completed)) problems.push('completed was not an array')

  for (const row of rawCompleted) {
    if (!row || typeof row !== 'object') { problems.push('dropped a non-object completed row'); continue }
    const id = typeof row.id === 'number' && Number.isInteger(row.id) ? row.id : null
    if (id === null) { problems.push(`dropped a completed row with a bad id: ${JSON.stringify(row.id)}`); continue }
    if (seen.has(id)) { problems.push(`dropped a duplicate completed entry ${id}`); continue }
    seen.add(id)
    completed.push({
      id,
      dateISO: isISODate(row.dateISO) ? row.dateISO : null,
      notes: asString(row.notes),
      readBy: { a: asBool(row.readBy?.a), b: asBool(row.readBy?.b) },
    })
  }
  const undated = completed.filter((r) => r.dateISO === null).length
  if (undated) problems.push(`${undated} completed row(s) had an unreadable date`)

  const names = input.readerNames && typeof input.readerNames === 'object' ? input.readerNames : {}

  return {
    state: {
      version: SCHEMA_VERSION,
      completed,
      lastSpinDate: isISODate(input.lastSpinDate) ? input.lastSpinDate : null,
      readerNames: {
        a: asString(names.a, DEFAULT_READER_NAMES.a).slice(0, 40) || DEFAULT_READER_NAMES.a,
        b: asString(names.b, DEFAULT_READER_NAMES.b).slice(0, 40) || DEFAULT_READER_NAMES.b,
      },
    },
    problems,
  }
}

function backingStore() {
  try {
    if (typeof localStorage === 'undefined') return null
    // Safari private mode throws on setItem rather than on access.
    const probe = '__spin_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    return null
  }
}

/** Reads persisted state. Never throws — falls back to empty state. */
export function getState() {
  try {
    const store = backingStore()
    if (!store) return emptyState()
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    const { state, problems } = normalizeState(JSON.parse(raw))
    if (problems.length) console.warn('[spin-catalog] recovered stored state with problems:', problems)
    return state
  } catch (err) {
    console.warn('[spin-catalog] could not read stored state, starting empty:', err)
    return emptyState()
  }
}

/** Writes state. Returns true on success; never throws. */
export function saveState(state) {
  try {
    const store = backingStore()
    if (!store) return false
    store.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch (err) {
    console.warn('[spin-catalog] could not save state:', err)
    return false
  }
}

/** Removes the stored key entirely. Used by Reset. */
export function clearState() {
  try {
    backingStore()?.removeItem(STORAGE_KEY)
    return true
  } catch (err) {
    console.warn('[spin-catalog] could not clear state:', err)
    return false
  }
}
