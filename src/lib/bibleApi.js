/**
 * The passage text, from bible-api.com.
 *
 * This is the only source. The app used to carry the World English Bible
 * inside it, which read better — the source had paragraph and poetry markup —
 * and needed no network at all. That is gone deliberately: the API is what was
 * asked for, and shipping both left the bundled copy standing in front of it
 * as a default and a fallback, so the API was never really the source of
 * anything.
 *
 * WHAT THAT COSTS, PLAINLY
 *
 *   Reading a passage for the first time now needs a connection. There is
 *   nothing behind the API to fall back to, so an unreachable one means a
 *   message and a retry button where the text should be.
 *
 *   The API returns a flat list of verses, so every passage is set as one
 *   continuous block per chapter. No paragraph breaks, and a psalm reads as
 *   prose rather than as poetry.
 *
 *   The cache is therefore load-bearing rather than an optimisation: it is the
 *   only reason yesterday's reading still opens on a train. It is bounded, and
 *   it lives in its own localStorage key away from the reading history — a
 *   full quota must never be able to cost somebody a note they wrote.
 *
 * No key and no account, which is why it is this API: nothing to keep secret
 * in a client bundle. Public-domain translations only, for the same reason the
 * bundled copy was public domain.
 */

const HOST = 'https://bible-api.com'
const CACHE_KEY = 'spin-catalog:passages'
/** Enough for the whole catalog to end up on the device, one reading at a time. */
const CACHE_LIMIT = 300
const TIMEOUT_MS = 8000

/** The English public-domain translations bible-api.com serves. */
export const TRANSLATIONS = [
  {
    id: 'web',
    name: 'World English Bible',
    short: 'WEB',
    note: 'A modern-English revision of the American Standard Version. Public domain.',
  },
  { id: 'kjv', name: 'King James Version', short: 'KJV', note: 'The 1769 text. Public domain.' },
  { id: 'webbe', name: 'World English Bible, British Edition', short: 'WEBBE', note: 'The WEB with British spelling and idiom.' },
  { id: 'bbe', name: 'Bible in Basic English', short: 'BBE', note: 'A 1965 translation using about 1,000 common words.' },
  { id: 'oeb-us', name: 'Open English Bible', short: 'OEB', note: 'A modern translation still in progress; the New Testament is complete.' },
]

export const DEFAULT_TRANSLATION = 'web'
export const findTranslation = (id) =>
  TRANSLATIONS.find((t) => t.id === id) ?? TRANSLATIONS[0]

/* ── the preference ────────────────────────────────────────────────────── */

const PREF_KEY = 'spin-catalog:translation'

export function getTranslation() {
  try {
    const id = localStorage.getItem(PREF_KEY)
    return TRANSLATIONS.some((t) => t.id === id) ? id : DEFAULT_TRANSLATION
  } catch {
    return DEFAULT_TRANSLATION
  }
}

export function setTranslation(id) {
  try {
    if (id === DEFAULT_TRANSLATION) localStorage.removeItem(PREF_KEY)
    else localStorage.setItem(PREF_KEY, id)
  } catch { /* the preference simply will not persist */ }
}

/* ── the cache ─────────────────────────────────────────────────────────── */

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeCache(cache) {
  try {
    const keys = Object.keys(cache)
    // Oldest out first. Insertion order is good enough here: a reader works
    // through the catalog forwards, so the oldest key is the least likely
    // thing they are about to open.
    const trimmed =
      keys.length <= CACHE_LIMIT
        ? cache
        : Object.fromEntries(keys.slice(keys.length - CACHE_LIMIT).map((k) => [k, cache[k]]))
    localStorage.setItem(CACHE_KEY, JSON.stringify(trimmed))
  } catch {
    // Out of quota, or private mode. The passage is already on screen; losing
    // the cache costs a refetch and nothing else.
    try { localStorage.removeItem(CACHE_KEY) } catch { /* nothing left to try */ }
  }
}

export function clearCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch { /* fine */ }
}

/* ── fetching ──────────────────────────────────────────────────────────── */

/**
 * The API returns one flat verse list, so everything becomes a single prose
 * block per chapter. Splitting on the chapter keeps the "Chapter N" marker
 * working for references that cross a boundary.
 */
function toBlocks(verses) {
  const blocks = []
  let chapter = null
  for (const v of verses) {
    const c = Number(v.chapter)
    const n = Number(v.verse)
    const text = String(v.text ?? '').replace(/\s+/g, ' ').trim()
    if (!Number.isInteger(c) || !Number.isInteger(n) || !text) continue
    if (c !== chapter) {
      blocks.push({ k: 'p', v: [] })
      chapter = c
    }
    blocks[blocks.length - 1].v.push([c, n, text])
  }
  return blocks.filter((b) => b.v.length)
}

/**
 * @returns {Promise<{ blocks: Array, translation: object, cached: boolean }>}
 * Rejects on anything at all — an HTTP error, an empty answer, a timeout, no
 * connection. There is nothing behind this, so the caller has to show that
 * rather than quietly substituting something else.
 */
export function fetchPassage(reference, translationId) {
  const t = findTranslation(translationId)
  const key = `${t.id}|${reference}`
  const cache = readCache()
  if (cache[key]) return Promise.resolve({ ...cache[key], translation: t, cached: true })

  // One request per passage, however many things ask at once. Two components
  // rendering the same reading — or React re-running an effect — would
  // otherwise both miss the cache and both go out over the network.
  if (!inflight.has(key)) {
    inflight.set(
      key,
      request(reference, t, key).finally(() => inflight.delete(key)),
    )
  }
  return inflight.get(key).then((value) => ({ ...value, translation: t, cached: false }))
}

const inflight = new Map()

async function request(reference, t, key) {
  const url = `${HOST}/${encodeURIComponent(reference)}?translation=${encodeURIComponent(t.id)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`bible-api.com returned ${res.status}`)

  const data = await res.json()
  const blocks = toBlocks(Array.isArray(data?.verses) ? data.verses : [])
  if (!blocks.length) throw new Error('bible-api.com returned no verses')

  const value = { blocks }
  writeCache({ ...readCache(), [key]: value })
  return value
}

/**
 * Fetch a passage before anyone asks for it — used for today's reading, so the
 * common case is already on the device by the time the Today tab is opened.
 * Never throws: this is a head start, not a step.
 */
export function warm(reference, translationId) {
  if (!reference) return
  const go = () => fetchPassage(reference, translationId).catch(() => {})
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 3000 })
  else setTimeout(go, 800)
}
