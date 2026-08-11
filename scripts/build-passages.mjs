#!/usr/bin/env node
/**
 * Builds src/data/passages.json — the text of the 286 passages, and nothing
 * else in the Bible.
 *
 * Source: the World English Bible, via TehShrike/world-english-bible, which
 * carries the paragraph and poetry structure rather than a flat list of
 * verses. That structure is why Psalms reads as poetry here instead of as
 * numbered prose.
 *
 * WHY THE TEXT IS BUNDLED RATHER THAN FETCHED
 *
 *   The app works offline and its content security policy admits exactly one
 *   host. A Bible API would break both, and would put a network round trip
 *   between someone and the passage they already spun for. Only the referenced
 *   passages are included, which is a few hundred KB rather than the ~10MB of
 *   a whole Bible.
 *
 * WHY THE WEB
 *
 *   Public domain, worldwide, with no attribution requirement — so it can be
 *   redistributed in a repo without a licence question. It is a modern-English
 *   revision of the ASV, which makes it readable in a way the KJV is not, and
 *   unlike the BBE it is not written to a restricted vocabulary.
 *
 * Every reference must resolve and every span must find verses. A passage that
 * silently came out short would show the wrong text, which is worse than
 * showing none, so this exits non-zero rather than writing a partial file.
 *
 * Run: node scripts/build-passages.mjs [--cache <dir>]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { parseReference, inSpan } from '../src/lib/reference.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir =
  process.argv.includes('--cache')
    ? process.argv[process.argv.indexOf('--cache') + 1]
    : join(root, '.web-cache')

const SOURCE = 'https://raw.githubusercontent.com/TehShrike/world-english-bible/master/json'
/** The source edition's filenames: lower case, no spaces. */
const slug = (book) => book.toLowerCase().replace(/[^a-z0-9]/g, '')

const catalog = JSON.parse(readFileSync(join(root, 'bible-wheel-catalog.json'), 'utf8'))
const entries = catalog.entries

mkdirSync(cacheDir, { recursive: true })

async function book(name) {
  const file = join(cacheDir, `${slug(name)}.json`)
  if (!existsSync(file)) {
    const url = `${SOURCE}/${slug(name)}.json`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${name}: ${url} → ${res.status}`)
    writeFileSync(file, await res.text())
  }
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * Walks the source's node stream and keeps what falls inside the spans.
 *
 * Blocks come out as { k: 'p' | 'q', v: [[chapter, verse, text], …] } — prose
 * or poetry, each piece tagged with where it is. The chapter travels with every
 * piece because a reference like "Micah 1:1-2:3" restarts its verse numbers
 * partway through, and a bare "1" after a "10" is unreadable without it.
 * Poetry keeps one piece per line: a line break in a psalm is not decoration.
 *
 * Section headers in the source are dropped. They are an editorial addition,
 * and the app already puts its own title above the passage; two competing
 * headings is one too many.
 */
function extract(nodes, spans) {
  const blocks = []
  let kind = null
  let pieces = []
  const flush = () => {
    if (pieces.length) blocks.push({ k: kind === 'stanza' ? 'q' : 'p', v: pieces })
    pieces = []
  }

  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph start':
        flush()
        kind = 'paragraph'
        break
      case 'stanza start':
        flush()
        kind = 'stanza'
        break
      case 'paragraph end':
      case 'stanza end':
        flush()
        kind = null
        break
      case 'paragraph text':
      case 'line text': {
        const { chapterNumber: c, verseNumber: v, value } = node
        if (!spans.some((s) => inSpan(s, c, v))) {
          // A block that straddles the edge of the range is split there rather
          // than pulled in whole, so a five-verse reference is five verses.
          flush()
          break
        }
        const text = String(value ?? '').replace(/\s+/g, ' ').trim()
        if (!text) break
        const last = pieces[pieces.length - 1]
        // Prose runs on: consecutive pieces of one verse are one sentence
        // broken across nodes, so they are rejoined. Poetry never is.
        if (node.type === 'paragraph text' && last && last[0] === c && last[1] === v) last[2] += ` ${text}`
        else pieces.push([c, v, text])
        break
      }
      default:
        break // line break, header, break — nothing to carry through
    }
  }
  flush()
  return blocks
}

const out = {}
const problems = []
const byBook = new Map()

for (const entry of entries) {
  const parsed = parseReference(entry.reference)
  if (!parsed) {
    problems.push(`${entry.id}: could not parse "${entry.reference}"`)
    continue
  }
  if (!byBook.has(parsed.book)) byBook.set(parsed.book, await book(parsed.book))
  const nodes = byBook.get(parsed.book)

  // "2 John" with no chapter means the whole book.
  const spans = parsed.spans.map((s) => (s.chapter === null ? { chapter: null, from: null, to: null } : s))
  const blocks = extract(nodes, spans)

  const verses = new Set(blocks.flatMap((b) => b.v.map(([c, v]) => `${c}:${v}`)))
  if (!blocks.length || verses.size === 0) {
    problems.push(`${entry.id}: "${entry.reference}" (${entry.book}) matched no verses`)
    continue
  }

  /**
   * A span that asked for verses 11-13 and produced two of them is a silent
   * truncation the reader would never catch, so every requested verse is
   * accounted for.
   *
   * There is one legitimate way for a verse to be absent. A handful of verses
   * are in the King James numbering but not
   * in the manuscripts modern translations follow, so the WEB carries the verse
   * number with nothing in it. That is a real fact about the text rather than a
   * gap in this file, and it is distinguishable from a bug: the source has a
   * node for the verse and the node is empty. No node at all is still a
   * failure.
   */
  const omitted = []
  for (const s of spans) {
    if (s.from === null || s.to === null) continue
    for (let v = s.from; v <= s.to; v++) {
      if (verses.has(`${s.chapter}:${v}`)) continue
      const inSource = nodes.some(
        (n) => n.chapterNumber === s.chapter && n.verseNumber === v && 'value' in n,
      )
      const blank =
        inSource &&
        nodes
          .filter((n) => n.chapterNumber === s.chapter && n.verseNumber === v)
          .every((n) => !String(n.value ?? '').trim())
      if (blank) omitted.push(v)
      else problems.push(`${entry.id}: "${entry.reference}" is missing verse ${v}`)
    }
  }

  out[entry.id] = { b: blocks }
  // Told to the reader, not swallowed: 36 followed by 38 with no explanation
  // looks like the app lost something.
  if (omitted.length) out[entry.id].o = omitted
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} passage problem(s):`)
  for (const p of problems.slice(0, 25)) console.error(`   ${p}`)
  if (problems.length > 25) console.error(`   …and ${problems.length - 25} more`)
  console.error('')
  process.exit(1)
}

const dataDir = join(root, 'src', 'data')
mkdirSync(dataDir, { recursive: true })
const file = join(dataDir, 'passages.json')
writeFileSync(file, JSON.stringify(out))

const bytes = readFileSync(file).length
const words = Object.values(out).reduce(
  (n, p) => n + p.b.reduce((m, b) => m + b.v.reduce((k, [, , t]) => k + t.split(' ').length, 0), 0),
  0,
)
console.log(
  `✓ ${Object.keys(out).length} passages, ${byBook.size} books, ` +
    `${words.toLocaleString()} words, ${(bytes / 1024).toFixed(0)}KB\n`,
)
