/**
 * Turning "Micah 6:6-8" into something you can look up.
 *
 * The catalog writes references the way a person would, which is eleven
 * different shapes across 286 entries. Every one of them has to resolve — a
 * reference that half-parses would show the wrong verses, which is worse than
 * showing none — so this returns null rather than guessing, and the build
 * refuses to produce a passage file if anything comes back null.
 *
 * Everything is normalised to a list of spans: `{ chapter, from, to }`, with
 * `from` null meaning the whole chapter. A range that crosses a chapter
 * boundary becomes several spans, so callers never have to think about it.
 */

/**
 * The handful of books whose title differs between the catalog and the bundled
 * edition. It is data, and lives with the other data at the repo root — which
 * also keeps the no-duplication check absolute rather than making it grow an
 * exception list for this file.
 */
import books from '../../bible-books.json' with { type: 'json' }
const ALIASES = books.aliases

const NUM = String.raw`\d+`

/**
 * Splits a reference into its book name and the rest.
 *
 * Book names run from one to three words and can start with a numeral
 * ("2 Kings", "Acts of the Apostles"), so the split point is the first token
 * that is a bare number and is not the leading ordinal.
 */
function splitBook(input) {
  const tokens = input.trim().split(/\s+/)
  if (!tokens.length) return null
  let i = 0
  // A leading numeral belongs to the book: it is First Kings, not verse 1.
  if (/^\d+$/.test(tokens[0])) i = 1
  while (i < tokens.length && !/^\d/.test(tokens[i])) i++
  const book = tokens.slice(0, i).join(' ')
  return book ? { book, rest: tokens.slice(i).join(' ') } : null
}

export function canonicalBook(name) {
  const key = String(name ?? '').trim().toLowerCase()
  if (!key) return null
  return ALIASES[key] ?? String(name).trim()
}

/**
 * @returns {{ book: string, spans: Array<{chapter:number, from:number|null, to:number|null}> } | null}
 */
export function parseReference(input) {
  const raw = String(input ?? '')
    // The catalog uses an en dash in a couple of places, and non-breaking
    // spaces sneak in through copy-paste.
    .replace(/[‐-―]/g, '-')
    .replace(/ /g, ' ')
    .trim()
  if (!raw) return null

  const split = splitBook(raw)
  if (!split) return null
  const book = canonicalBook(split.book)
  const rest = split.rest.trim()

  // A bare book name — the whole book. Only ever meant for the single-chapter
  // letters, but the caller decides that; here it means "no chapter given".
  if (!rest) return { book, spans: [{ chapter: null, from: null, to: null }] }

  const spans = []
  // "1:5-9, 14-18" — later groups continue in the chapter the first one set.
  let lastChapter = null

  for (const piece of rest.split(',')) {
    const part = piece.trim()
    if (!part) continue

    let m
    // 1:1-2:3  — a range across a chapter boundary
    if ((m = part.match(new RegExp(`^(${NUM}):(${NUM})\\s*-\\s*(${NUM}):(${NUM})$`)))) {
      const [c1, v1, c2, v2] = m.slice(1).map(Number)
      if (c2 < c1 || (c2 === c1 && v2 < v1)) return null
      if (c1 === c2) spans.push({ chapter: c1, from: v1, to: v2 })
      else {
        spans.push({ chapter: c1, from: v1, to: null })
        for (let c = c1 + 1; c < c2; c++) spans.push({ chapter: c, from: null, to: null })
        spans.push({ chapter: c2, from: 1, to: v2 })
      }
      lastChapter = c2
      continue
    }
    // 6:6-8
    if ((m = part.match(new RegExp(`^(${NUM}):(${NUM})\\s*-\\s*(${NUM})$`)))) {
      const [c, v1, v2] = m.slice(1).map(Number)
      if (v2 < v1) return null
      spans.push({ chapter: c, from: v1, to: v2 })
      lastChapter = c
      continue
    }
    // 7:18
    if ((m = part.match(new RegExp(`^(${NUM}):(${NUM})$`)))) {
      const [c, v] = m.slice(1).map(Number)
      spans.push({ chapter: c, from: v, to: v })
      lastChapter = c
      continue
    }
    // 10-14 — a continuation of the previous chapter, not a chapter range
    if (lastChapter !== null && (m = part.match(new RegExp(`^(${NUM})\\s*-\\s*(${NUM})$`)))) {
      const [v1, v2] = m.slice(1).map(Number)
      if (v2 < v1) return null
      spans.push({ chapter: lastChapter, from: v1, to: v2 })
      continue
    }
    // 4-5 — whole chapters
    if ((m = part.match(new RegExp(`^(${NUM})\\s*-\\s*(${NUM})$`)))) {
      const [c1, c2] = m.slice(1).map(Number)
      if (c2 < c1) return null
      for (let c = c1; c <= c2; c++) spans.push({ chapter: c, from: null, to: null })
      lastChapter = c2
      continue
    }
    // 2 — one whole chapter. Or, after "1:5-9, ", verse 2 of chapter 1.
    if ((m = part.match(new RegExp(`^(${NUM})$`)))) {
      const n = Number(m[1])
      if (lastChapter !== null) spans.push({ chapter: lastChapter, from: n, to: n })
      else {
        spans.push({ chapter: n, from: null, to: null })
        lastChapter = n
      }
      continue
    }
    return null // an unrecognised shape is a bug in the catalog or in here
  }

  return spans.length ? { book, spans } : null
}

/** True when a verse falls inside a span. Whole-chapter spans take everything. */
export function inSpan(span, chapter, verse) {
  if (span.chapter !== null && span.chapter !== chapter) return false
  if (span.from === null) return true
  if (verse < span.from) return false
  return span.to === null || verse <= span.to
}
