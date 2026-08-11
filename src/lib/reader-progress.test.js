import { describe, it, expect } from 'vitest'
import { readerProgress } from './stats.js'
import { CATEGORIES, ENTRIES_BY_CATEGORY } from './catalog.js'

const READERS = [
  { id: 'a', name: 'Sam' },
  { id: 'b', name: 'Alex' },
]
const cat = CATEGORIES[0]
const other = CATEGORIES[1]
const inCat = (c, n) => (ENTRIES_BY_CATEGORY.get(c.id) ?? []).slice(0, n)

const state = (completed, readers = READERS) => ({ completed, readers, lastSpinDate: null })
const row = (id, readBy, dateISO = '2026-01-01') => ({ id, dateISO, notes: '', readBy })

describe('readerProgress', () => {
  it('scores each reader out of what has been drawn, not the category total', () => {
    // The wheel has produced three of this category; Sam has read all three.
    const [e1, e2, e3] = inCat(cat, 3)
    const p = readerProgress(
      state([row(e1.id, ['a', 'b']), row(e2.id, ['a']), row(e3.id, ['a'])]),
    )
    const c = p.categories.find((x) => x.id === cat.id)

    expect(c.drawn).toBe(3)
    expect(c.total).toBeGreaterThan(3)
    // Sam is finished with what he has been given, and must look finished.
    expect(c.perReader.a).toBe(3)
    expect(c.perReader.b).toBe(1)
  })

  it('counts what has not been drawn without listing it', () => {
    const [e1] = inCat(cat, 1)
    const p = readerProgress(state([row(e1.id, ['a'])]))
    const c = p.categories.find((x) => x.id === cat.id)

    expect(c.topics).toHaveLength(1)
    expect(c.undrawn).toBe(c.total - 1)
    // The premise is that the wheel chooses; a browsable list of what is still
    // to come would quietly replace that with a menu.
    expect(c.topics.map((t) => t.id)).toEqual([e1.id])
  })

  it('keeps every category, including ones the wheel has never reached', () => {
    const p = readerProgress(state([]))
    expect(p.categories).toHaveLength(CATEGORIES.length)
    expect(p.categories.every((c) => c.drawn === 0)).toBe(true)
    expect(p.drawnTotal).toBe(0)
  })

  it('totals across categories, not within one', () => {
    const [a1, a2] = inCat(cat, 2)
    const [b1] = inCat(other, 1)
    const p = readerProgress(state([row(a1.id, ['a', 'b']), row(a2.id, ['a']), row(b1.id, ['b'])]))

    expect(p.drawnTotal).toBe(3)
    expect(p.totals.a).toBe(2)
    expect(p.totals.b).toBe(2)
  })

  it('ignores ticks from readers who have been removed', () => {
    const [e1] = inCat(cat, 1)
    const p = readerProgress(state([row(e1.id, ['a', 'ghost'])]))
    expect(p.totals).toEqual({ a: 1, b: 0 })
    // The tick itself is preserved on the row, so re-adding them restores it.
    expect(p.categories.find((c) => c.id === cat.id).topics[0].readBy).toContain('ghost')
  })

  it('lists topics newest first', () => {
    const [e1, e2, e3] = inCat(cat, 3)
    const p = readerProgress(
      state([
        row(e1.id, [], '2026-01-01'),
        row(e2.id, [], '2026-03-01'),
        row(e3.id, [], '2026-02-01'),
      ]),
    )
    const dates = p.categories.find((c) => c.id === cat.id).topics.map((t) => t.dateISO)
    expect(dates).toEqual(['2026-03-01', '2026-02-01', '2026-01-01'])
  })

  it('survives a row with no readBy at all', () => {
    const [e1] = inCat(cat, 1)
    const p = readerProgress(state([{ id: e1.id, dateISO: '2026-01-01', notes: '' }]))
    expect(p.categories.find((c) => c.id === cat.id).topics[0].readBy).toEqual([])
    expect(p.totals).toEqual({ a: 0, b: 0 })
  })

  it('works with no readers configured', () => {
    const [e1] = inCat(cat, 1)
    const p = readerProgress(state([row(e1.id, ['a'])], []))
    expect(p.readers).toEqual([])
    expect(p.totals).toEqual({})
    expect(p.drawnTotal).toBe(1)
  })
})
