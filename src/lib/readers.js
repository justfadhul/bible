/**
 * Readers: who is doing the reading, what they are called, and their picture.
 *
 * A reader is an account. `reader.id` is the auth user id, so a tick means the
 * same person on every device that will ever sync.
 *
 * The one exception is the reader a device carries before anyone has signed
 * up — no userId, and only ever one of them. That is what lets the app work
 * with no account at all, and it is claimed by the first account to sign in
 * here rather than being left behind.
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

/**
 * What to show for a reader: a chosen name, then the email, then who they are.
 *
 * A reader with no account can only be one person — the owner of this device,
 * before they signed up — because that is the one reader the app will create
 * without an account behind it. So "You" is a fact here, not a guess, and it
 * beats calling somebody "Reader A" on their own phone.
 */
export function displayName(reader, index = 0) {
  const chosen = reader?.name?.trim()
  if (chosen) return chosen
  const fromEmail = nameFromEmail(reader?.email)
  if (fromEmail) return fromEmail
  if (reader && !reader.userId) return 'You'
  return `Reader ${String.fromCharCode(65 + index)}`
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
