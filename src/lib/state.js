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

/**
 * There is no addReader.
 *
 * A reader is an account. The way a second reader comes into existence is
 * that a second person signs up on their own phone and joins the group with
 * the invite code — not that somebody types them into a list on one device.
 * Removing that function is the whole point of the change, so it is worth a
 * comment rather than a silent deletion.
 */

/**
 * Removes a reader, and with them every tick they made — leaving those behind
 * would show a reading as read by somebody who is no longer in the list.
 *
 * Only ever used on readers with no account: leftovers from before readers
 * were accounts. Somebody with an account leaves by leaving the group, which
 * is their decision to make on their own device, not yours.
 */
export function removeReader(state, readerId) {
  if (state.readers.length <= 1) return state
  const target = state.readers.find((r) => r.id === readerId)
  if (!target || target.userId) return state
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
 * Turns a signed-in account into a reader.
 *
 * On a device that has been read on solo, the existing local reader is
 * adopted rather than a stranger being appended — that history is yours, you
 * have simply acquired an account since making it. Adoption re-keys the
 * reader to the auth user id and rewrites every tick that pointed at the old
 * local id, because an id nobody holds any more is a tick nobody made.
 *
 * A name or photo already chosen here wins over whatever the provider knows:
 * you picked those, the provider guessed.
 */
export function linkAccount(state, { userId, email, name, avatarUrl }) {
  if (!userId) return state

  const already = state.readers.find((r) => r.userId === userId)
  const target = already ?? state.readers.find((r) => !r.userId)

  const fill = (r) => ({
    ...r,
    id: userId,
    userId,
    email: email ?? r.email ?? null,
    name: r.name?.trim() ? r.name : (name ?? ''),
    avatarUrl: r.avatarUrl ?? avatarUrl ?? null,
  })

  if (!target) {
    if (state.readers.length >= MAX_READERS) return state
    return { ...state, readers: [...state.readers, makeReader({ userId, email, name, avatarUrl })] }
  }

  const filled = fill(target)
  const same =
    filled.id === target.id &&
    filled.userId === target.userId &&
    filled.email === target.email &&
    filled.name === target.name &&
    filled.avatarUrl === target.avatarUrl
  if (same) return state

  const from = target.id
  return {
    ...state,
    readers: state.readers.map((r) => (r.id === from ? filled : r)),
    completed:
      from === userId
        ? state.completed
        : state.completed.map((row) =>
            row.readBy.includes(from)
              ? { ...row, readBy: [...new Set(row.readBy.map((x) => (x === from ? userId : x)))] }
              : row,
          ),
  }
}

export const freshState = emptyState
