import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  TRANSLATIONS,
  DEFAULT_TRANSLATION,
  findTranslation,
  fetchPassage,
  getTranslation,
  setTranslation,
  clearCache,
} from './bibleApi.js'

/**
 * This is now the only source of passage text, so what matters is not the
 * happy path — it is that every way it can fail is a clean rejection the UI
 * can turn into a message and a retry, and that the cache is doing its job,
 * because the cache is the only reason yesterday's reading opens on a train.
 *
 * These stub `fetch` rather than calling bible-api.com: it keeps the suite
 * offline, and it lets the failures be produced on purpose.
 */

const store = new Map()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

const ok = (verses) => ({
  ok: true,
  status: 200,
  json: async () => ({ verses }),
})
const verse = (chapter, v, text) => ({ chapter, verse: v, text })

describe('the translation list', () => {
  it('leads with the default', () => {
    expect(TRANSLATIONS[0].id).toBe(DEFAULT_TRANSLATION)
  })

  it('offers no translation twice, and every one has a note', () => {
    expect(new Set(TRANSLATIONS.map((t) => t.id)).size).toBe(TRANSLATIONS.length)
    for (const t of TRANSLATIONS) expect(t.note).toBeTruthy()
  })

  it('falls back to the bundled one for an id it does not know', () => {
    expect(findTranslation('nonsense').id).toBe(DEFAULT_TRANSLATION)
    expect(findTranslation(undefined).id).toBe(DEFAULT_TRANSLATION)
  })
})

describe('the preference', () => {
  it('defaults to the bundled translation', () => {
    expect(getTranslation()).toBe(DEFAULT_TRANSLATION)
  })

  it('round-trips a real choice', () => {
    setTranslation('kjv')
    expect(getTranslation()).toBe('kjv')
  })

  it('refuses a translation that does not exist', () => {
    store.set('spin-catalog:translation', 'made-up')
    expect(getTranslation()).toBe(DEFAULT_TRANSLATION)
  })

  it('survives storage being unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('denied') },
      removeItem() { throw new Error('denied') },
    })
    expect(getTranslation()).toBe(DEFAULT_TRANSLATION)
    expect(() => setTranslation('kjv')).not.toThrow()
  })
})

describe('fetching', () => {
  it('fetches the default translation like any other — nothing is built in', async () => {
    const fetchSpy = vi.fn(async () => ok([verse(6, 8, 'text')]))
    vi.stubGlobal('fetch', fetchSpy)
    const { blocks } = await fetchPassage('Micah 6:8', DEFAULT_TRANSLATION)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(blocks[0].v[0][2]).toBe('text')
  })

  it('makes one request when several things ask at once', async () => {
    // Two components can render the same reading, and React re-runs effects.
    // Without this every one of them would miss the cache and go out.
    let resolve
    const fetchSpy = vi.fn(() => new Promise((r) => { resolve = r }))
    vi.stubGlobal('fetch', fetchSpy)
    const all = Promise.all([
      fetchPassage('Micah 6:8', 'kjv'),
      fetchPassage('Micah 6:8', 'kjv'),
      fetchPassage('Micah 6:8', 'kjv'),
    ])
    resolve(ok([verse(6, 8, 'text')]))
    const results = await all
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(results.every((r) => r.blocks[0].v[0][2] === 'text')).toBe(true)
  })

  it('lets a failed passage be retried rather than caching the failure', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      if (calls === 1) throw new Error('offline')
      return ok([verse(6, 8, 'text')])
    })
    await expect(fetchPassage('Micah 6:8', 'kjv')).rejects.toThrow()
    const { blocks } = await fetchPassage('Micah 6:8', 'kjv')
    expect(blocks[0].v[0][2]).toBe('text')
  })

  it('turns a flat verse list into one block per chapter', async () => {
    vi.stubGlobal('fetch', async () =>
      ok([verse(1, 5, 'first'), verse(1, 6, 'second'), verse(2, 1, 'third')]),
    )
    const { blocks } = await fetchPassage('Micah 1:5-2:1', 'kjv')
    expect(blocks).toHaveLength(2)
    expect(blocks[0].v).toEqual([
      [1, 5, 'first'],
      [1, 6, 'second'],
    ])
    expect(blocks[1].v).toEqual([[2, 1, 'third']])
  })

  it('asks for the right translation and escapes a reference with a space in it', async () => {
    let url = ''
    vi.stubGlobal('fetch', async (u) => {
      url = u
      return ok([verse(6, 8, 'text')])
    })
    await fetchPassage('Micah 3:1-4', 'kjv')
    expect(url).toContain('translation=kjv')
    expect(url).not.toContain(' ')
  })

  it('serves the second read from the cache, without a second request', async () => {
    const fetchSpy = vi.fn(async () => ok([verse(6, 8, 'text')]))
    vi.stubGlobal('fetch', fetchSpy)
    const first = await fetchPassage('Micah 6:8', 'kjv')
    const second = await fetchPassage('Micah 6:8', 'kjv')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(second.cached).toBe(true)
    expect(second.blocks).toEqual(first.blocks)
  })

  it('caches per translation, so switching does not serve the wrong text', async () => {
    vi.stubGlobal('fetch', async (u) =>
      ok([verse(6, 8, u.includes('kjv') ? 'kjv text' : 'bbe text')]),
    )
    const a = await fetchPassage('Micah 6:8', 'kjv')
    const b = await fetchPassage('Micah 6:8', 'bbe')
    expect(a.blocks[0].v[0][2]).toBe('kjv text')
    expect(b.blocks[0].v[0][2]).toBe('bbe text')
  })

  it('throws on an HTTP error, so the caller can fall back', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503, json: async () => ({}) }))
    await expect(fetchPassage('Micah 6:8', 'kjv')).rejects.toThrow(/503/)
  })

  it('throws when the answer has no verses in it', async () => {
    vi.stubGlobal('fetch', async () => ok([]))
    await expect(fetchPassage('Micah 6:8', 'kjv')).rejects.toThrow(/no verses/)
  })

  it('throws rather than hanging when the network does not answer', async () => {
    vi.stubGlobal('fetch', async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })
    await expect(fetchPassage('Micah 6:8', 'kjv')).rejects.toThrow()
  })

  it('drops malformed verses rather than rendering them', async () => {
    vi.stubGlobal('fetch', async () =>
      ok([verse(1, 1, 'good'), { chapter: 'x', verse: 2, text: 'bad' }, verse(1, 3, '   ')]),
    )
    const { blocks } = await fetchPassage('Micah 1:1-3', 'kjv')
    expect(blocks.flatMap((b) => b.v)).toEqual([[1, 1, 'good']])
  })

  it('keeps working when the cache cannot be written', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem() { throw new Error('quota') },
      removeItem() {},
    })
    vi.stubGlobal('fetch', async () => ok([verse(6, 8, 'text')]))
    const { blocks } = await fetchPassage('Micah 6:8', 'kjv')
    expect(blocks[0].v[0][2]).toBe('text')
  })

  it('clearCache does not throw when there is nothing to clear', () => {
    expect(() => clearCache()).not.toThrow()
  })
})
