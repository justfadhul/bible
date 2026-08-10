/**
 * The catalog is the single source of truth.
 *
 * Nothing in this file — or anywhere else in src/ — restates its content.
 * We import the JSON, assert the shape we depend on, and derive lookup
 * indexes. Every topic, reference, hook, question and colour the app shows
 * comes from here at runtime.
 */
// The import attribute lets plain Node load this module too, so
// scripts/simulate-spins.mjs exercises the real app code rather than a copy.
import raw from '../../bible-wheel-catalog.json' with { type: 'json' }

const SIZES = new Set(['short', 'medium', 'long'])
const TESTAMENTS = new Set(['OT', 'NT'])

/**
 * Validates the catalog shape. Returns { problems, entries, categories }.
 * Throwing here would white-screen the app, so instead we drop entries that
 * cannot be rendered and report the problems — a partially valid catalog is
 * still a usable reading plan.
 */
export function validateCatalog(data) {
  const problems = []
  const categories = Array.isArray(data?.categories) ? data.categories : []
  const allEntries = Array.isArray(data?.entries) ? data.entries : []

  if (!categories.length) problems.push('catalog has no categories')
  if (!allEntries.length) problems.push('catalog has no entries')

  const catIds = new Set()
  for (const c of categories) {
    if (typeof c?.id !== 'string' || !c.id) { problems.push('a category is missing an id'); continue }
    if (catIds.has(c.id)) problems.push(`duplicate category id "${c.id}"`)
    catIds.add(c.id)
    if (typeof c.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c.color)) {
      problems.push(`category "${c.id}" has an invalid color`)
    }
  }

  const seenIds = new Set()
  const entries = []
  for (const e of allEntries) {
    if (!Number.isInteger(e?.id)) { problems.push(`entry with non-integer id ${JSON.stringify(e?.id)} dropped`); continue }
    if (seenIds.has(e.id)) { problems.push(`duplicate entry id ${e.id} dropped`); continue }
    if (!catIds.has(e.category)) { problems.push(`entry ${e.id} references unknown category "${e.category}" — dropped`); continue }
    if (!TESTAMENTS.has(e.testament)) problems.push(`entry ${e.id} has odd testament "${e.testament}"`)
    if (!SIZES.has(e.size)) problems.push(`entry ${e.id} has odd size "${e.size}"`)
    for (const f of ['topic', 'reference', 'book', 'hook', 'question']) {
      if (typeof e[f] !== 'string' || !e[f]) problems.push(`entry ${e.id} is missing "${f}"`)
    }
    seenIds.add(e.id)
    entries.push(e)
  }

  return { problems, entries, categories: categories.filter((c) => typeof c?.id === 'string') }
}

const { problems, entries, categories } = validateCatalog(raw)

export const meta = raw?.meta ?? {}
export const CATEGORIES = categories
export const ENTRIES = entries
export const TOTAL = entries.length
export const catalogProblems = problems

/** id -> entry */
export const ENTRY_BY_ID = new Map(entries.map((e) => [e.id, e]))
/** categoryId -> category */
export const CATEGORY_BY_ID = new Map(categories.map((c) => [c.id, c]))
/** categoryId -> entries, in catalog order */
export const ENTRIES_BY_CATEGORY = (() => {
  const m = new Map(categories.map((c) => [c.id, []]))
  for (const e of entries) m.get(e.category)?.push(e)
  return m
})()

export const getEntry = (id) => ENTRY_BY_ID.get(id)
export const getCategory = (id) => CATEGORY_BY_ID.get(id)

/** Distinct books, sorted, for the archive filters. */
export const BOOKS = [...new Set(entries.map((e) => e.book))].sort((a, b) => a.localeCompare(b))

export function catalogSummary() {
  const perCategory = Object.fromEntries([...ENTRIES_BY_CATEGORY].map(([id, list]) => [id, list.length]))
  const count = (key) => entries.reduce((acc, e) => ((acc[e[key]] = (acc[e[key]] ?? 0) + 1), acc), {})
  return {
    title: meta.title,
    version: meta.version,
    entries: TOTAL,
    categories: categories.length,
    perCategory,
    byTestament: count('testament'),
    bySize: count('size'),
    books: BOOKS.length,
    problems,
  }
}

if (import.meta.env?.DEV) {
  const s = catalogSummary()
  console.groupCollapsed(`%c${s.title} — ${s.entries} entries in ${s.categories} categories`, 'font-weight:600')
  console.table(s.perCategory)
  console.log('testament', s.byTestament, 'size', s.bySize, 'books', s.books)
  if (s.problems.length) console.warn('catalog problems:', s.problems)
  else console.log('%c✓ catalog valid', 'color:#4ade80')
  console.groupEnd()
}
