import { describe, it, expect } from 'vitest'
import { truncate, wrapLabel, layoutLabels, fitFontSize } from './label.js'
import { CATEGORIES, ENTRIES_BY_CATEGORY } from './catalog.js'

/*
 * These are generic text-fitting utilities, so the exact-string cases use
 * invented fixtures. Anywhere real catalog content is needed it is read from
 * the catalog, never pasted in — scripts/check-no-duplication.mjs enforces it.
 */

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('Section 7', 20)).toBe('Section 7')
  })

  it('breaks on a word boundary rather than leaving a dangling word', () => {
    expect(truncate('The Meeting of the Elders', 16)).toBe('The Meeting of…')
  })

  it('cuts mid-word when there is no boundary to fall back to', () => {
    expect(truncate('Antidisestablishmentarianism', 10)).toBe('Antidises…')
  })

  it('degrades to an ellipsis rather than throwing', () => {
    expect(truncate('anything', 1)).toBe('…')
  })

  it('never exceeds the budget, for every label the wheel could ever show', () => {
    const labels = [...CATEGORIES.map((c) => c.name), ...[...ENTRIES_BY_CATEGORY.values()].flat().map((e) => e.topic)]
    for (const label of labels) {
      for (const max of [4, 8, 12, 16, 24, 40]) {
        expect(truncate(label, max).length).toBeLessThanOrEqual(max)
      }
    }
  })
})

describe('wrapLabel balances the two lines', () => {
  it('splits evenly rather than greedily filling line one', () => {
    // Greedy filling would take "Silver, Copper and" (18, still under budget)
    // and strand "the Iron". Balancing splits one word earlier.
    expect(wrapLabel('Silver, Copper and the Iron', 20)).toEqual(['Silver, Copper', 'and the Iron'])
  })

  it('prefers a split where both lines fit over a more even one that does not', () => {
    // The evenest split is 18/9, but 18 overflows; 11/16 fits, so it wins.
    expect(wrapLabel('Running and Constant Effort', 16)).toEqual(['Running and', 'Constant Effort'])
  })

  it('does not try to wrap a single word', () => {
    expect(wrapLabel('Indivisible', 20)).toEqual(['Indivisible'])
  })

  it('keeps every category name inside the budget on two lines', () => {
    for (const c of CATEGORIES) {
      for (const line of wrapLabel(c.name, 18)) expect(line.length).toBeLessThanOrEqual(18)
    }
  })
})

describe('layoutLabels', () => {
  const geom = { textStartR: 16, bandLength: 27 }

  it('shrinks the font as segments multiply', () => {
    expect(fitFontSize({ count: 23, textStartR: 16, lines: 1 })).toBeLessThan(
      fitFontSize({ count: 6, textStartR: 16, lines: 1 }),
    )
  })

  it('uses two lines for the category wheel and one for a crowded entry wheel', () => {
    expect(layoutLabels({ labels: CATEGORIES.map((c) => c.name), count: CATEGORIES.length, ...geom, maxLines: 2 }).lines).toBe(2)
    const busiest = [...ENTRIES_BY_CATEGORY.values()].sort((a, b) => b.length - a.length)[0]
    expect(layoutLabels({ labels: busiest.map((e) => e.topic), count: busiest.length, ...geom, maxLines: 1 }).lines).toBe(1)
  })

  it('never emits a line longer than the budget, for every wheel 2 the app can draw', () => {
    for (const [id, entries] of ENTRIES_BY_CATEGORY) {
      const topics = entries.map((e) => e.topic)
      const { rows, maxChars } = layoutLabels({ labels: topics, count: topics.length, ...geom, maxLines: 1 })
      expect(rows, id).toHaveLength(topics.length)
      for (const row of rows) for (const line of row) expect(line.length).toBeLessThanOrEqual(maxChars)
    }
  })

  it('tightens the budget when measurement reports wider glyphs', () => {
    const loose = layoutLabels({ labels: ['x'], count: 15, ...geom, charWidth: 0.5 })
    const tight = layoutLabels({ labels: ['x'], count: 15, ...geom, charWidth: 0.8 })
    expect(tight.maxChars).toBeLessThan(loose.maxChars)
  })
})
