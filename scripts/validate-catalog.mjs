#!/usr/bin/env node
/**
 * Validates bible-wheel-catalog.json against the data contract.
 * Run: node scripts/validate-catalog.mjs
 *
 * This is a build-time guard. It asserts the shape the app relies on, so a
 * malformed catalog fails loudly here rather than silently at runtime.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const catalogPath = resolve(here, '..', 'bible-wheel-catalog.json')

const SIZES = new Set(['short', 'medium', 'long'])
const TESTAMENTS = new Set(['OT', 'NT'])
const HEX = /^#[0-9a-fA-F]{6}$/

const errors = []
const warnings = []
const fail = (m) => errors.push(m)
const warn = (m) => warnings.push(m)

let raw
try {
  raw = readFileSync(catalogPath, 'utf8')
} catch (e) {
  console.error(`FATAL: cannot read ${catalogPath}: ${e.message}`)
  process.exit(1)
}

let catalog
try {
  catalog = JSON.parse(raw)
} catch (e) {
  console.error(`FATAL: catalog is not valid JSON: ${e.message}`)
  process.exit(1)
}

// --- top level -------------------------------------------------------------
for (const key of ['meta', 'categories', 'entries']) {
  if (!(key in catalog)) fail(`missing top-level key "${key}"`)
}
if (!Array.isArray(catalog.categories)) fail('categories is not an array')
if (!Array.isArray(catalog.entries)) fail('entries is not an array')
if (errors.length) {
  console.error(errors.map((e) => `  ✗ ${e}`).join('\n'))
  process.exit(1)
}

// --- categories ------------------------------------------------------------
const catIds = new Set()
catalog.categories.forEach((c, i) => {
  const at = `categories[${i}]`
  for (const f of ['id', 'name', 'blurb', 'color']) {
    if (typeof c[f] !== 'string' || !c[f].length) fail(`${at}: "${f}" missing or not a non-empty string`)
  }
  if (typeof c.color === 'string' && !HEX.test(c.color)) fail(`${at} (${c.id}): color "${c.color}" is not a 6-digit hex`)
  if (catIds.has(c.id)) fail(`${at}: duplicate category id "${c.id}"`)
  catIds.add(c.id)
})

// --- entries ---------------------------------------------------------------
const ids = new Set()
const refSeen = new Map()
const topicSeen = new Map()
const perCategory = new Map(catalog.categories.map((c) => [c.id, 0]))
const perTestament = { OT: 0, NT: 0 }
const perSize = { short: 0, medium: 0, long: 0 }
const books = new Map()

catalog.entries.forEach((e, i) => {
  const at = `entries[${i}]`
  if (!Number.isInteger(e.id)) fail(`${at}: id is not an integer (${JSON.stringify(e.id)})`)
  else if (ids.has(e.id)) fail(`${at}: duplicate id ${e.id}`)
  else ids.add(e.id)

  for (const f of ['topic', 'reference', 'book', 'testament', 'category', 'size', 'hook', 'question']) {
    if (typeof e[f] !== 'string' || !e[f].length) fail(`${at} (id ${e.id}): "${f}" missing or not a non-empty string`)
  }
  if (!TESTAMENTS.has(e.testament)) fail(`${at} (id ${e.id}): testament "${e.testament}" not in OT|NT`)
  if (!SIZES.has(e.size)) fail(`${at} (id ${e.id}): size "${e.size}" not in short|medium|long`)
  if (!catIds.has(e.category)) fail(`${at} (id ${e.id}): category "${e.category}" has no matching categories[].id`)

  if (refSeen.has(e.reference)) warn(`duplicate reference "${e.reference}" (ids ${refSeen.get(e.reference)} and ${e.id})`)
  else refSeen.set(e.reference, e.id)
  if (topicSeen.has(e.topic)) warn(`duplicate topic "${e.topic}" (ids ${topicSeen.get(e.topic)} and ${e.id})`)
  else topicSeen.set(e.topic, e.id)

  if (perCategory.has(e.category)) perCategory.set(e.category, perCategory.get(e.category) + 1)
  if (e.testament in perTestament) perTestament[e.testament]++
  if (e.size in perSize) perSize[e.size]++
  books.set(e.book, (books.get(e.book) ?? 0) + 1)
})

// --- meta cross-check ------------------------------------------------------
if (catalog.meta?.entryCount !== catalog.entries.length) {
  fail(`meta.entryCount is ${catalog.meta?.entryCount} but there are ${catalog.entries.length} entries`)
}
if (catalog.meta?.categoryCount !== catalog.categories.length) {
  fail(`meta.categoryCount is ${catalog.meta?.categoryCount} but there are ${catalog.categories.length} categories`)
}
for (const [id, n] of perCategory) if (n === 0) fail(`category "${id}" has zero entries — it would render as a dead wheel segment`)

// contiguity is not required by the contract, but a gap usually means a typo
const sorted = [...ids].sort((a, b) => a - b)
const gaps = []
for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1] + 1) gaps.push(`${sorted[i - 1]}→${sorted[i]}`)
if (gaps.length) warn(`entry ids are not contiguous: ${gaps.join(', ')}`)

// --- report ----------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n)
console.log(`\n${catalog.meta?.title ?? 'catalog'}  (schema v${catalog.meta?.version})`)
console.log('─'.repeat(64))
console.log(`entries      ${catalog.entries.length}`)
console.log(`categories   ${catalog.categories.length}`)
console.log(`id range     ${sorted[0]}–${sorted[sorted.length - 1]}  (all unique: ${ids.size === catalog.entries.length})`)
console.log(`testament    OT ${perTestament.OT}   NT ${perTestament.NT}`)
console.log(`size         short ${perSize.short}   medium ${perSize.medium}   long ${perSize.long}`)
console.log(`books        ${books.size} distinct`)
console.log('─'.repeat(64))
for (const c of catalog.categories) {
  const n = perCategory.get(c.id)
  console.log(`  ${pad(c.id, 12)} ${pad(c.name, 32)} ${String(n).padStart(3)}  ${c.color}`)
}
console.log('─'.repeat(64))

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`)
  for (const w of warnings) console.log(`  ! ${w}`)
}
if (errors.length) {
  console.error(`\n${errors.length} error(s):`)
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log('\n✓ catalog valid\n')
