/**
 * ─────────────────────────────────────────────────────────────────────────
 *  THE ONLY PLACE THE APP TOUCHES LOCAL STORAGE.
 *
 *  The interface is deliberately narrow — getState() and saveState() — so
 *  the shared store in remote.js can be swapped or extended without anything
 *  else in src/ learning that localStorage exists.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Persisted shape (schema version 4):
 *
 *   {
 *     version: 4,
 *     readers: [{ id, name, avatarUrl, userId, email }],
 *     completed: [{
 *       id, dateISO,
 *       notes,                        // the old shared note, read-only now
 *       notesBy: { [readerId]: text } // one note each
 *       readBy: [readerId, …],
 *     }],
 *     lastSpinDate: "YYYY-MM-DD" | null
 *   }
 *
 * ── A reader is an account ────────────────────────────────────────────────
 *
 * v3's rule: readers are not made, they arrive. Every reader is somebody's
 * signed-in account, and `reader.id` IS their auth user id. Nobody types a
 * second person into existence on their own phone; the second person signs up
 * on their own phone and joins the group, and that is what puts them in the
 * list.
 *
 * The one exception is you, before you have an account. A device that has
 * chosen "read on this device" still needs somebody to tick, so it carries
 * exactly one reader with no userId. When that person signs up, their reader
 * is re-keyed to the new user id — and every tick they had made is re-keyed
 * with it, so nothing is stranded under an id that no longer exists.
 *
 * Making the id the user id (rather than a local id with a userId beside it)
 * is what makes ticks portable. `readBy: ["<uuid>"]` means the same person on
 * every device that will ever sync, with nothing to reconcile.
 *
 * ── History ───────────────────────────────────────────────────────────────
 *
 * v1 stored exactly two readers as `readerNames: {a, b}` and a per-reading
 * `readBy: {a: bool, b: bool}`. v2 generalised that to a list of arbitrary
 * locally-made readers. v3 made a reader an account. v4 gives each of them
 * their own note, because one shared box meant two people writing about the
 * same passage silently overwrote each other. The migrations run in sequence,
 * so a three-versions-old export travels the whole way rather than being
 * rejected.
 *
 * Every read is guarded: a corrupt, truncated or foreign value falls back to
 * empty state rather than crashing, and unknown fields are dropped rather
 * than trusted.
 */
import { isISODate } from './date.js'

export const STORAGE_KEY = 'spin-catalog:v1' // the key name is historical; contents are versioned
export const SCHEMA_VERSION = 4

/** The cap join_pair() enforces server-side; mirrored here so the UI can say so. */
export const MAX_READERS = 8

/** The id for the one reader a device can have before anyone signs in. */
export const newReaderId = () => {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().slice(0, 8)
  } catch { /* fall through */ }
  return Math.random().toString(36).slice(2, 10)
}

/** An account-backed reader is keyed by its user id; a local one gets a fresh id. */
export function makeReader(over = {}) {
  const { id, userId = null, ...rest } = over
  return {
    id: id ?? userId ?? newReaderId(),
    name: '',
    avatarUrl: null,
    email: null,
    ...rest,
    userId,
  }
}

/**
 * One reader, unnamed — you, on this device, before any of this is an account.
 * Not two: a second person is not a checkbox somebody adds, they are somebody
 * who signs up.
 */
export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    readers: [makeReader()],
    completed: [],
    lastSpinDate: null,
  }
}

const asString = (v, fallback = '') => (typeof v === 'string' ? v : fallback)
const clean = (v, max = 60) => asString(v).replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * A name somebody actually chose, as opposed to one v2 generated for them.
 *
 * v2 stamped every new device with readers literally called "Reader A" and
 * "Reader B". Those look like names to a string check, which is why the first
 * pass at the v3 migration kept them and people were left staring at a
 * "Reader B" who does not exist and never signed up. They are placeholders,
 * and they are treated as blank.
 */
const PLACEHOLDER_NAME = /^reader\s+[a-h]$/i
const chosenName = (v) => {
  const name = clean(v)
  return PLACEHOLDER_NAME.test(name) ? '' : name
}

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
  return { version: 2, readers, completed, lastSpinDate: input?.lastSpinDate ?? null }
}

/**
 * v2 → v3. Two jobs, and the second one is the delicate one.
 *
 * First: re-key every account-backed reader to its user id, rewriting the
 * ticks that pointed at the old local id so nothing is orphaned.
 *
 * Second: clear out the placeholders. v2 handed every new device two readers
 * called "Reader A" and "Reader B" whether or not two people existed, and the
 * new model has no room for a reader nobody signed up as. But a reader that
 * was actually used is somebody's real history, so the rule is narrow: an
 * unlinked reader is dropped only if it was never named, never given a photo
 * and never ticked anything — an untouched placeholder and nothing else.
 * Anything anyone bothered with survives and can be dismissed by hand once its
 * owner has an account. There is always at least one reader left, because a
 * device with nobody on it cannot record having read.
 */
export function migrateV2(input) {
  const remap = new Map()
  const readers = []

  for (const r of Array.isArray(input?.readers) ? input.readers : []) {
    if (!r || typeof r !== 'object') continue
    const userId = asString(r.userId).slice(0, 64) || null
    const oldId = asString(r.id)
    const id = userId || oldId || newReaderId()
    if (oldId && oldId !== id) remap.set(oldId, id)
    readers.push({ ...r, id, userId })
  }

  const completed = (Array.isArray(input?.completed) ? input.completed : []).map((row) => ({
    ...row,
    readBy: [...new Set((Array.isArray(row?.readBy) ? row.readBy : []).map((x) => remap.get(x) ?? x))],
  }))

  const used = new Set(completed.flatMap((row) => row.readBy))
  const kept = readers.filter(
    (r) => r.userId || used.has(r.id) || chosenName(r.name) || cleanAvatar(r.avatarUrl),
  )
  // A generated name is not a name: blanking it lets the first account to sign
  // in here claim the row cleanly, and lets normalizeState's sweep recognise a
  // placeholder however many versions later it runs.
  const survivors = (kept.length ? kept : readers.slice(0, 1)).map((r) =>
    r.userId ? r : { ...r, name: chosenName(r.name) },
  )

  return {
    version: 3,
    readers: survivors.length ? survivors : [makeReader()],
    completed,
    lastSpinDate: input?.lastSpinDate ?? null,
  }
}

/**
 * v3 → v4. Purely additive: every reading grows an empty per-reader note map.
 *
 * The old shared `notes` string is left exactly where it is. Nobody knows who
 * wrote it — that is the whole problem v4 fixes — so attributing it to
 * somebody would be a guess written into their history. It stays unattributed,
 * shown where it has content, and no new one is ever created.
 */
export function migrateV3(input) {
  return {
    ...input,
    version: SCHEMA_VERSION,
    completed: (Array.isArray(input?.completed) ? input.completed : []).map((row) => ({
      ...row,
      notesBy: {},
    })),
  }
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

  // The migrations run in sequence, so a version 1 export travels the whole
  // way rather than being rejected for being two steps behind.
  let src = input
  if (src.version === 1 || (!src.readers && src.readerNames)) {
    src = migrateV1(src)
    problems.push('upgraded a version 1 history')
  }
  if (src.version === 2 || (src.version < SCHEMA_VERSION && Array.isArray(src.readers) && src.version !== 3)) {
    if (src.version !== 2) {
      problems.push(`unknown schema version ${JSON.stringify(input.version)} — reading it as v${SCHEMA_VERSION}`)
    } else {
      problems.push('upgraded a version 2 history — readers are accounts now')
    }
    src = migrateV2(src)
  }
  if (src.version === 3) {
    src = migrateV3(src)
    problems.push('upgraded a version 3 history — each reader has their own note now')
  } else if (src.version !== SCHEMA_VERSION) {
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
    // Somebody has to be able to tick. One, not two — the second reader is a
    // person who signs up, not a row this file invents.
    problems.push('no usable readers — restoring a single local one')
    const me = makeReader()
    readers.push(me)
    readerIds.add(me.id)
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
    // A note, on the other hand, is words somebody wrote. It is kept even when
    // its author has left the roster — dropping a tick loses a claim about who
    // read something, dropping a note loses the thing itself.
    const notesBy = {}
    if (row.notesBy && typeof row.notesBy === 'object' && !Array.isArray(row.notesBy)) {
      for (const [who, text] of Object.entries(row.notesBy)) {
        const body = asString(text).slice(0, 4000)
        if (who && body) notesBy[String(who).slice(0, 64)] = body
      }
    }
    completed.push({
      id,
      dateISO: isISODate(row.dateISO) ? row.dateISO : null,
      notes: asString(row.notes),
      notesBy,
      readBy,
    })
  }
  const undated = completed.filter((r) => r.dateISO === null).length
  if (undated) problems.push(`${undated} completed row(s) had an unreadable date`)

  /**
   * Sweep out placeholders, on every read rather than only during a migration.
   *
   * This has to live here and not in migrateV2, and the reason is a bug I
   * shipped: the first version of that migration read "Reader B" as a name
   * somebody had chosen, kept it, and wrote the result back as v3. Once the
   * data had moved on, the rule that would have removed it never ran again,
   * and people were left looking at a reader who does not exist and never
   * signed up for anything. A rule that only fires during an upgrade cannot
   * fix data an earlier upgrade got wrong.
   *
   * Narrow, so it can never lose anything: no account, a name v2 generated
   * rather than one anyone typed, no photo, and no reading ticked by them.
   * Anything a person actually used stays.
   */
  const used = new Set(completed.flatMap((r) => r.readBy))
  const kept = readers.filter(
    (r, i) =>
      r.userId ||
      used.has(r.id) ||
      cleanAvatar(r.avatarUrl) ||
      chosenName(r.name) ||
      // Never leave a device with nobody on it, and never remove the reader
      // this device belongs to just because they have not named themselves.
      (i === 0 && !PLACEHOLDER_NAME.test(clean(r.name))),
  )
  const finalReaders = (kept.length ? kept : readers.slice(0, 1)).map((r, i) =>
    // This device's own reader never keeps a generated name: it should read as
    // "You", not as somebody called Reader A. A leftover that survived on its
    // ticks does keep the label, because that is genuinely what it was called
    // and the roster marks it as an account-less remnant anyway.
    i === 0 && !r.userId && !chosenName(r.name) ? { ...r, name: '' } : r,
  )
  if (finalReaders.length !== readers.length) {
    problems.push(`removed ${readers.length - finalReaders.length} placeholder reader(s) nobody signed up as`)
  }
  const live = new Set(finalReaders.map((r) => r.id))

  return {
    state: {
      version: SCHEMA_VERSION,
      readers: finalReaders,
      completed: completed.map((r) =>
        r.readBy.every((id) => live.has(id)) ? r : { ...r, readBy: r.readBy.filter((id) => live.has(id)) },
      ),
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
    if (problems.length) {
      console.warn('[spin-catalog] recovered stored state with problems:', problems)
      // Write the repaired copy straight back. Otherwise a migration is redone
      // on every single load, and what is on disk never matches what the app
      // believes — which is exactly the sort of disagreement that only shows
      // up later, in an export, as a version nobody expected.
      saveState(state)
    }
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
