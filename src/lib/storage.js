/**
 * ─────────────────────────────────────────────────────────────────────────
 *  THE ONLY PLACE THE APP TOUCHES LOCAL STORAGE.
 *
 *  The interface is deliberately narrow — getState() and saveState() — so
 *  the shared store in remote.js can be swapped or extended without anything
 *  else in src/ learning that localStorage exists.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Persisted shape (schema version 2):
 *
 *   {
 *     version: 2,
 *     readers: [{ id, name, avatarUrl, userId, email }],
 *     completed: [{ id, dateISO, notes, readBy: [readerId, …] }],
 *     lastSpinDate: "YYYY-MM-DD" | null
 *   }
 *
 * v1 stored exactly two readers as `readerNames: {a, b}` and a per-reading
 * `readBy: {a: bool, b: bool}`. v2 generalises that to a list, because the
 * app now supports more than two people. migrateV1() converts old data and
 * old exports in place, so nobody loses a history to the change.
 *
 * Every read is guarded: a corrupt, truncated or foreign value falls back to
 * empty state rather than crashing, and unknown fields are dropped rather
 * than trusted.
 */
import { isISODate } from './date.js'

export const STORAGE_KEY = 'spin-catalog:v1' // the key name is historical; contents are versioned
export const SCHEMA_VERSION = 2

export const MAX_READERS = 8

/** Ids for locally-created readers. Short, stable, and never reused. */
export const newReaderId = () => {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().slice(0, 8)
  } catch { /* fall through */ }
  return Math.random().toString(36).slice(2, 10)
}

export function makeReader(over = {}) {
  return { id: newReaderId(), name: '', avatarUrl: null, userId: null, email: null, ...over }
}

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    readers: [makeReader({ id: 'a', name: 'Reader A' }), makeReader({ id: 'b', name: 'Reader B' })],
    completed: [],
    lastSpinDate: null,
  }
}

const asString = (v, fallback = '') => (typeof v === 'string' ? v : fallback)
const clean = (v, max = 60) => asString(v).replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * Avatars are either a remote URL or an inline data: URI (a locally chosen
 * photo, downscaled before it ever reaches here). Anything else — javascript:,
 * a bare string, an object — is dropped rather than rendered.
 */
function cleanAvatar(v) {
  if (typeof v !== 'string' || !v) return null
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)) return v.slice(0, 400_000)
  if (/^https:\/\//i.test(v)) return v.slice(0, 2048)
  return null
}

/** v1 → v2. Exported so imports of old files travel the same path. */
export function migrateV1(input) {
  const names = input?.readerNames && typeof input.readerNames === 'object' ? input.readerNames : {}
  const readers = [
    makeReader({ id: 'a', name: clean(names.a) || 'Reader A' }),
    makeReader({ id: 'b', name: clean(names.b) || 'Reader B' }),
  ]
  const completed = (Array.isArray(input?.completed) ? input.completed : []).map((row) => {
    const readBy = []
    if (row?.readBy?.a === true) readBy.push('a')
    if (row?.readBy?.b === true) readBy.push('b')
    return { ...row, readBy }
  })
  return { version: SCHEMA_VERSION, readers, completed, lastSpinDate: input?.lastSpinDate ?? null }
}

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

  let src = input
  if (input.version === 1 || (!input.readers && input.readerNames)) {
    src = migrateV1(input)
    problems.push('upgraded a version 1 history to version 2')
  } else if (input.version !== SCHEMA_VERSION) {
    problems.push(`unknown schema version ${JSON.stringify(input.version)} — reading it as v${SCHEMA_VERSION}`)
  }

  // ── readers ──
  const readers = []
  const readerIds = new Set()
  for (const r of Array.isArray(src.readers) ? src.readers : []) {
    if (!r || typeof r !== 'object') { problems.push('dropped a non-object reader'); continue }
    const id = asString(r.id).slice(0, 40)
    if (!id) { problems.push('dropped a reader with no id'); continue }
    if (readerIds.has(id)) { problems.push(`dropped a duplicate reader "${id}"`); continue }
    if (readers.length >= MAX_READERS) { problems.push(`dropped readers beyond the limit of ${MAX_READERS}`); break }
    readerIds.add(id)
    readers.push({
      id,
      name: clean(r.name),
      avatarUrl: cleanAvatar(r.avatarUrl),
      userId: asString(r.userId).slice(0, 64) || null,
      email: clean(r.email, 200) || null,
    })
  }
  if (!readers.length) {
    problems.push('no usable readers — restoring the default two')
    readers.push(makeReader({ id: 'a', name: 'Reader A' }), makeReader({ id: 'b', name: 'Reader B' }))
    readerIds.add('a')
    readerIds.add('b')
  }

  // ── completed ──
  const seen = new Set()
  const completed = []
  const rawCompleted = Array.isArray(src.completed) ? src.completed : []
  if (!Array.isArray(src.completed)) problems.push('completed was not an array')

  for (const row of rawCompleted) {
    if (!row || typeof row !== 'object') { problems.push('dropped a non-object completed row'); continue }
    const id = Number.isInteger(row.id) ? row.id : null
    if (id === null) { problems.push(`dropped a completed row with a bad id: ${JSON.stringify(row?.id)}`); continue }
    if (seen.has(id)) { problems.push(`dropped a duplicate completed entry ${id}`); continue }
    seen.add(id)

    // A tick by a reader who no longer exists is dropped, not kept as a ghost.
    const readBy = [...new Set((Array.isArray(row.readBy) ? row.readBy : []).filter((x) => readerIds.has(x)))]
    completed.push({
      id,
      dateISO: isISODate(row.dateISO) ? row.dateISO : null,
      notes: asString(row.notes),
      readBy,
    })
  }
  const undated = completed.filter((r) => r.dateISO === null).length
  if (undated) problems.push(`${undated} completed row(s) had an unreadable date`)

  return {
    state: {
      version: SCHEMA_VERSION,
      readers,
      completed,
      lastSpinDate: isISODate(src.lastSpinDate) ? src.lastSpinDate : null,
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
