/**
 * Local-calendar date helpers.
 *
 * "One spin per day" means the user's local calendar day, so every date in
 * state is a local YYYY-MM-DD string rather than a UTC timestamp. Arithmetic
 * goes through dayNumber(), which converts the string to a UTC day index —
 * exact, and immune to daylight-saving shifts.
 */

const pad = (n) => String(n).padStart(2, '0')

/** Today (or any Date) as a local-calendar YYYY-MM-DD string. */
export function localISODate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Days since the epoch for a YYYY-MM-DD string. NaN if malformed. */
export function dayNumber(iso) {
  if (!isISODate(iso)) return NaN
  const [y, m, d] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}

/** Milliseconds from now until the next local midnight, so the day can roll over live. */
export function msUntilLocalMidnight(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 100)
  return Math.max(1000, next.getTime() - now.getTime())
}

/** "Sunday 10 August 2026" — the archive reads better with the weekday. */
export function formatLongDate(iso) {
  if (!isISODate(iso)) return iso ?? ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** "10 Aug 2026" — compact form for dense archive rows. */
export function formatShortDate(iso) {
  if (!isISODate(iso)) return iso ?? ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
