/**
 * Other translations, from bible-api.com.
 *
 * The World English Bible is bundled and is the default: it is instant, works
 * offline, and keeps the paragraph and poetry structure that makes a psalm
 * read like a psalm. This is for anyone who would rather read something else.
 *
 * WHAT THE API COSTS, HONESTLY
 *
 *   No key, no account, and only public-domain translations — which is why it
 *   is this one. But it returns a flat list of verses with no paragraphing and
 *   no poetry, so a fetched translation is set as one continuous block per
 *   chapter. That is a real downgrade in readability, and the picker says so
 *   rather than presenting the options as equals.
 *
 *   It is also a network dependency in an app that otherwise has none for
 *   reading. So every fetch is cached, and every failure falls back to the
 *   bundled text rather than to an error: you always get the passage.
 *
 * The cache is bounded and lives in its own localStorage key, away from the
 * reading history — a full quota must never be able to cost somebody a note
 * they wrote.
 */
import { WEB } from './brand.js'

const HOST = 'https://bible-api.com'
const CACHE_KEY = 'spin-catalog:passages'
const CACHE_LIMIT = 120
const TIMEOUT_MS = 8000

/**
 * The English public-domain translations bible-api.com serves.
 *
 * `bundled: true` is the copy already in the app — the same translation as the
 * API's `web`, but with its structure intact, so there is no reason ever to
 * fetch it.
 */
export const TRANSLATIONS = [
  { id: 'web', name: WEB.name, short: WEB.short, bundled: true, note: WEB.note },
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
 * @returns {Promise<{ blocks: Array, omitted: number[], translation: object }>}
 * Throws on anything at all — the caller falls back to the bundled text, which
 * is always present, rather than showing an error where a passage should be.
 */
export function fetchPassage(reference, translationId) {
  const t = findTranslation(translationId)
  if (t.bundled) return Promise.reject(new Error('bundled'))

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

  const value = { blocks, omitted: [] }
  writeCache({ ...readCache(), [key]: value })
  return value
}
