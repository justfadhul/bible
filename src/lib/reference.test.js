import { describe, it, expect } from 'vitest'
import { parseReference, canonicalBook, inSpan } from './reference.js'
import { ENTRIES } from './catalog.js'

/**
 * Fixtures are deliberately drawn from books the catalog does not use — Micah,
 * Nahum, Obadiah. That keeps two things true at once: the no-duplication rule
 * stays absolute (no catalog content as a literal anywhere in src/), and these
 * tests keep passing if the reading plan is ever rewritten. Where a real
 * catalog value is genuinely the thing under test, it is read from the catalog
 * rather than copied out.
 */
const spans = (ref) => parseReference(ref)?.spans
const book = (ref) => parseReference(ref)?.book

describe('parsing a reference', () => {
  it('splits a one-word book from its chapter', () => {
    expect(parseReference('Nahum 2')).toEqual({
      book: 'Nahum',
      spans: [{ chapter: 2, from: null, to: null }],
    })
  })

  it('keeps a leading numeral with the book, not with the chapter', () => {
    // "2 Kings 4" is chapter 4 of the second book, not verse 4 of chapter 2.
    expect(book('2 Kings 4')).toBe('2 Kings')
    expect(spans('2 Kings 4')).toEqual([{ chapter: 4, from: null, to: null }])
  })

  it('handles a multi-word book name', () => {
    const threeWord = ENTRIES.find((e) => e.book.split(' ').length === 3).book
    expect(book(`${threeWord} 8:6-7`)).toBe(canonicalBook(threeWord))
    expect(spans(`${threeWord} 8:6-7`)).toEqual([{ chapter: 8, from: 6, to: 7 }])
  })

  it('reads a verse range', () => {
    expect(spans('Micah 6:6-8')).toEqual([{ chapter: 6, from: 6, to: 8 }])
  })

  it('reads a single verse', () => {
    expect(spans('Micah 7:18')).toEqual([{ chapter: 7, from: 18, to: 18 }])
  })

  it('expands a chapter range into whole chapters', () => {
    expect(spans('Micah 4-5')).toEqual([
      { chapter: 4, from: null, to: null },
      { chapter: 5, from: null, to: null },
    ])
  })

  it('splits a range that crosses a chapter boundary', () => {
    // The half-chapters at each end are what a naive parser gets wrong.
    expect(spans('Micah 1:5-2:6')).toEqual([
      { chapter: 1, from: 5, to: null },
      { chapter: 2, from: 1, to: 6 },
    ])
  })

  it('fills in the whole chapters in the middle of a long crossing range', () => {
    expect(spans('Nahum 1:1-4:3')).toEqual([
      { chapter: 1, from: 1, to: null },
      { chapter: 2, from: null, to: null },
      { chapter: 3, from: null, to: null },
      { chapter: 4, from: 1, to: 3 },
    ])
  })

  it('continues a second group in the chapter the first one set', () => {
    // "3:1-4, 9-12" is two verse ranges; the chapter carries over.
    expect(spans('Micah 3:1-4, 9-12')).toEqual([
      { chapter: 3, from: 1, to: 4 },
      { chapter: 3, from: 9, to: 12 },
    ])
  })

  it('treats a bare book name as the whole book', () => {
    expect(parseReference('Obadiah')).toEqual({
      book: 'Obadiah',
      spans: [{ chapter: null, from: null, to: null }],
    })
  })

  it('normalises the titles the catalog and the bundled edition disagree on', () => {
    // Every book the catalog names has to resolve to something, or its text
    // would be looked up under a title the edition does not have.
    for (const e of ENTRIES) expect(canonicalBook(e.book)).toBeTruthy()
    expect(canonicalBook('Psalm')).toBe('Psalms')
    expect(canonicalBook('Nahum')).toBe('Nahum')
    expect(canonicalBook('   ')).toBeNull()
  })

  it('survives an en dash and a non-breaking space', () => {
    expect(spans('Micah 6:6–8')).toEqual([{ chapter: 6, from: 6, to: 8 }])
    expect(spans('Micah 6:6-8')).toEqual([{ chapter: 6, from: 6, to: 8 }])
  })

  it('refuses rather than guesses', () => {
    // A half-parse would show the wrong verses, which is worse than none.
    for (const bad of ['', null, undefined, '   ', '2:11-13', 'Micah 6:8-6', 'Micah 4-2', 'Micah 6:x']) {
      expect(parseReference(bad)).toBeNull()
    }
  })
})

describe('inSpan', () => {
  it('takes a whole chapter when no verses are given', () => {
    const s = { chapter: 3, from: null, to: null }
    expect(inSpan(s, 3, 1)).toBe(true)
    expect(inSpan(s, 3, 999)).toBe(true)
    expect(inSpan(s, 4, 1)).toBe(false)
  })

  it('takes an open-ended tail', () => {
    const s = { chapter: 1, from: 5, to: null }
    expect(inSpan(s, 1, 4)).toBe(false)
    expect(inSpan(s, 1, 5)).toBe(true)
    expect(inSpan(s, 1, 40)).toBe(true)
  })

  it('takes everything when the chapter is unspecified — a whole book', () => {
    const s = { chapter: null, from: null, to: null }
    expect(inSpan(s, 1, 1)).toBe(true)
    expect(inSpan(s, 13, 7)).toBe(true)
  })
})

describe('every reference in the catalog', () => {
  it('parses', () => {
    const failed = ENTRIES.filter((e) => !parseReference(e.reference))
    expect(failed.map((e) => `${e.id}: ${e.reference}`)).toEqual([])
  })

  it('names the book the entry says it is in', () => {
    const norm = (s) => canonicalBook(s).toLowerCase().replace(/[^a-z0-9]/g, '')
    const wrong = ENTRIES.filter((e) => norm(parseReference(e.reference).book) !== norm(e.book))
    expect(wrong.map((e) => `${e.id}: ${e.reference} vs ${e.book}`)).toEqual([])
  })

  it('produces at least one span, and never a backwards one', () => {
    for (const e of ENTRIES) {
      const { spans: got } = parseReference(e.reference)
      expect(got.length).toBeGreaterThan(0)
      for (const s of got) {
        if (s.from !== null && s.to !== null) expect(s.to).toBeGreaterThanOrEqual(s.from)
      }
    }
  })
})
