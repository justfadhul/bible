#!/usr/bin/env node
/**
 * Checks the committed passage file against the catalog, without a network.
 *
 * build-passages.mjs needs the internet and is run by hand when the catalog
 * changes. This runs on every `npm run check`, and its job is to catch the
 * thing that actually goes wrong: somebody edits a reference in the catalog
 * and the text quietly stays pointing at the old one, or at nothing.
 *
 * Run: node scripts/check-passages.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { parseReference } from '../src/lib/reference.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(root, 'src', 'data', 'passages.json')

if (!existsSync(file)) {
  console.error('✗ src/data/passages.json is missing — run: node scripts/build-passages.mjs\n')
  process.exit(1)
}

const entries = JSON.parse(readFileSync(join(root, 'bible-wheel-catalog.json'), 'utf8')).entries
const passages = JSON.parse(readFileSync(file, 'utf8'))
const problems = []

for (const entry of entries) {
  const parsed = parseReference(entry.reference)
  if (!parsed) {
    problems.push(`${entry.id}: "${entry.reference}" does not parse`)
    continue
  }
  if (parsed.book.toLowerCase().replace(/[^a-z0-9]/g, '') !==
      entry.book.toLowerCase().replace(/[^a-z0-9]/g, '').replace('songofsongs', 'songofsolomon')) {
    problems.push(`${entry.id}: reference "${entry.reference}" is not in ${entry.book}`)
  }

  const p = passages[entry.id]
  if (!p) {
    problems.push(`${entry.id}: "${entry.reference}" has no text — rebuild the passage file`)
    continue
  }
  const pieces = (p.b ?? []).flatMap((b) => b.v ?? [])
  if (!pieces.length) {
    problems.push(`${entry.id}: "${entry.reference}" has an empty passage`)
    continue
  }
  for (const piece of pieces) {
    if (!Array.isArray(piece) || piece.length !== 3 || !Number.isInteger(piece[0]) ||
        !Number.isInteger(piece[1]) || typeof piece[2] !== 'string' || !piece[2]) {
      problems.push(`${entry.id}: malformed verse ${JSON.stringify(piece)}`)
      break
    }
  }
  // The chapters the text actually contains must be the chapters the reference
  // named. This is what catches a catalog edit that nobody rebuilt for.
  const want = new Set(parsed.spans.filter((s) => s.chapter !== null).map((s) => s.chapter))
  if (want.size) {
    const got = new Set(pieces.map((x) => x[0]))
    const stray = [...got].filter((c) => !want.has(c))
    const absent = [...want].filter((c) => !got.has(c))
    if (stray.length) problems.push(`${entry.id}: "${entry.reference}" includes chapter(s) ${stray.join(', ')}`)
    if (absent.length) problems.push(`${entry.id}: "${entry.reference}" is missing chapter(s) ${absent.join(', ')}`)
  }
  // And the first verse has to be the one asked for, or the range slipped.
  const first = parsed.spans[0]
  if (first?.from !== null && first?.chapter !== null) {
    const opener = pieces.find((x) => x[0] === first.chapter)
    if (opener && opener[1] !== first.from) {
      problems.push(`${entry.id}: "${entry.reference}" starts at verse ${opener[1]}, not ${first.from}`)
    }
  }
}

const extra = Object.keys(passages).filter((id) => !entries.some((e) => String(e.id) === id))
if (extra.length) problems.push(`${extra.length} passage(s) with no catalog entry: ${extra.slice(0, 8).join(', ')}`)

if (problems.length) {
  console.error(`\n✗ ${problems.length} passage problem(s):`)
  for (const p of problems.slice(0, 20)) console.error(`   ${p}`)
  if (problems.length > 20) console.error(`   …and ${problems.length - 20} more`)
  console.error('\n   Rebuild with: node scripts/build-passages.mjs\n')
  process.exit(1)
}

const words = Object.values(passages).reduce(
  (n, p) => n + p.b.reduce((m, b) => m + b.v.reduce((k, [, , t]) => k + t.split(' ').length, 0), 0),
  0,
)
console.log(`✓ all ${entries.length} passages have their text (${words.toLocaleString()} words)\n`)
