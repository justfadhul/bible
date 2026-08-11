#!/usr/bin/env node
/**
 * Acceptance check: nothing from the catalog is duplicated inside the source.
 *
 * The catalog is the single source of truth, so no topic, reference, hook,
 * question, book, category name, blurb or colour may appear as a literal
 * anywhere in src/ or scripts/. If someone pastes a passage into a component
 * to "just get it working", this fails.
 *
 * Run: node scripts/check-no-duplication.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative, extname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const catalog = JSON.parse(readFileSync(resolve(root, 'bible-wheel-catalog.json'), 'utf8'))

const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.mjs', '.svg'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.vite'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (CODE_EXT.has(extname(name))) out.push(full)
  }
  return out
}

const files = [
  ...walk(resolve(root, 'src')),
  ...walk(resolve(root, 'scripts')),
  ...walk(resolve(root, 'public')),
  resolve(root, 'index.html'),
]

// Every distinct catalog string worth guarding, longest first so the most
// specific match is reported.
const needles = new Set()
for (const c of catalog.categories) {
  needles.add(c.name)
  needles.add(c.blurb)
  needles.add(c.color.toLowerCase())
}
for (const e of catalog.entries) {
  needles.add(e.topic)
  needles.add(e.reference)
  needles.add(e.hook)
  needles.add(e.question)
  needles.add(e.book)
}

// Short generic tokens ("Job", "Acts", "Ruth") would false-positive against
// ordinary prose and identifiers, so only guard strings long enough to be
// unmistakably catalog content.
const guarded = [...needles].filter((s) => s.length >= 8).sort((a, b) => b.length - a.length)

const hits = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const lower = text.toLowerCase()
  for (const needle of guarded) {
    const idx = lower.indexOf(needle.toLowerCase())
    if (idx === -1) continue
    const line = text.slice(0, idx).split('\n').length
    hits.push({ file: relative(root, file), line, needle })
  }
}

console.log(`\nScanned ${files.length} source files against ${guarded.length} catalog strings.`)

if (hits.length) {
  console.error(`\n✗ ${hits.length} piece(s) of catalog content found in source:\n`)
  for (const h of hits.slice(0, 25)) console.error(`   ${h.file}:${h.line}  "${h.needle}"`)
  if (hits.length > 25) console.error(`   …and ${hits.length - 25} more`)
  console.error('\nRead it from bible-wheel-catalog.json instead.\n')
  process.exit(1)
}

console.log('✓ no catalog content is duplicated in the source\n')
