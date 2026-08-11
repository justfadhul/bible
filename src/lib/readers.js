/**
 * Readers: who is doing the reading, what they are called, and their picture.
 *
 * A reader is a row in state.readers. When someone signs in, their auth user
 * is linked to a reader so the name and photo follow them between devices; a
 * reader with no userId is a local one, which is how the app keeps working
 * signed out.
 */

/**
 * A first guess at someone's name from their email address.
 *
 * "sam.okonkwo@example.com" → "Sam Okonkwo". It is only a default — the point
 * is that a signed-in reader is never labelled "Reader A", and never has to
 * type their own name just to get started.
 */
export function nameFromEmail(email) {
  const local = String(email ?? '').split('@')[0]
  if (!local) return ''
  return local
    .replace(/[._\-+]+/g, ' ')
    .replace(/\d+/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .slice(0, 60)
}

/** What to show for a reader, falling back through name → email → position. */
export function displayName(reader, index = 0) {
  return (
    reader?.name?.trim() ||
    nameFromEmail(reader?.email) ||
    `Reader ${String.fromCharCode(65 + index)}`
  )
}

/** Up to two letters for the fallback avatar. */
export function initials(reader, index = 0) {
  const name = displayName(reader, index)
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

/**
 * A stable colour per reader, so an avatar without a photo is still
 * recognisable at a glance. Hue is derived from the id, and the lightness is
 * fixed low enough that white initials always clear AA on top.
 */
export function readerColor(id) {
  let h = 0
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) >>> 0
  // Step by the golden angle rather than taking the hash modulo 360: ids that
  // sit next to each other ("a", "b", "c") hash to neighbouring numbers, and
  // neighbouring hues are the one thing an avatar palette must not produce.
  return `hsl(${(h * 137.508) % 360} 44% 31%)`
}

/**
 * Name suggestions, offered rather than imposed: some people would like to be
 * "Barnabas" for this and some would find that mortifying, so the field is
 * always free text and these are one tap away.
 *
 * Deliberately drawn from people rather than books, and checked against the
 * catalog so none of them collide with a book name.
 */
export const NAME_SUGGESTIONS = [
  'Barnabas',
  'Priscilla',
  'Aquila',
  'Tabitha',
  'Silas',
  'Lydia',
  'Onesimus',
  'Phoebe',
  'Timothy',
  'Miriam',
  'Caleb',
  'Deborah',
  'Boaz',
  'Hannah',
  'Cornelius',
  'Junia',
]

export const findReader = (state, id) => state.readers.find((r) => r.id === id) ?? null
export const readerForUser = (state, userId) =>
  userId ? (state.readers.find((r) => r.userId === userId) ?? null) : null
