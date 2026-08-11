/**
 * The text of the 286 passages, loaded on demand.
 *
 * It is ~240KB gzipped — worth having, and not worth putting in front of the
 * wheel. So it is a dynamic import: the app boots and becomes usable without
 * it, and the chunk is fetched the first time anyone needs a passage. The
 * filename is content-hashed and served immutable for a year, so that fetch
 * happens once ever rather than once a day.
 *
 * `warm()` starts it during the first idle moment after the app mounts, which
 * means it is almost always already there by the time a spin lands on
 * something. The wait it removes is small; the point is that it is removed
 * from the one moment where somebody is looking at a passage they want to read.
 */
import { WEB } from './brand.js'

let cache = null
let inflight = null

function load() {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = import('../data/passages.json')
      .then((m) => {
        cache = m.default ?? m
        return cache
      })
      .catch((err) => {
        // Let the next attempt try again rather than caching the failure —
        // this is usually a phone that lost signal mid-navigation.
        inflight = null
        throw err
      })
  }
  return inflight
}

/** Kick the fetch off when nothing else is happening. Never throws. */
export function warm() {
  const go = () => load().catch(() => {})
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 4000 })
  else setTimeout(go, 1200)
}

/** Already in memory? Lets a caller render without a loading state. */
export const peek = (entryId) => cache?.[String(entryId)] ?? null

/**
 * @returns {Promise<{ blocks: Array, omitted: number[] } | null>}
 * null means the catalog has an entry this file does not — impossible if the
 * build ran, but a missing passage should read as "no text" rather than throw.
 */
export async function getPassage(entryId) {
  const all = await load()
  return shape(all[String(entryId)])
}

export function shape(raw) {
  if (!raw?.b) return null
  return { blocks: raw.b, omitted: raw.o ?? [] }
}

export const TRANSLATION = WEB
