import { describe, it, expect } from 'vitest'
import { mergeStates } from './merge.js'
import { emptyState } from './storage.js'

const row = (id, over = {}) => ({
  id,
  dateISO: '2026-03-01',
  notes: '',
  readBy: { a: false, b: false },
  ...over,
})

const state = (completed, over = {}) => ({ ...emptyState(), completed, ...over })

describe('mergeStates never loses a reading', () => {
  it('unions both sides', () => {
    const merged = mergeStates(state([row(1), row(2)]), state([row(2), row(3)]))
    expect(merged.completed.map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('keeps every id across a large asymmetric merge', () => {
    const local = state(Array.from({ length: 40 }, (_, i) => row(i + 1)))
    const remote = state(Array.from({ length: 40 }, (_, i) => row(i + 21)))
    const merged = mergeStates(local, remote)
    expect(merged.completed).toHaveLength(60)
    expect(new Set(merged.completed.map((r) => r.id)).size).toBe(60)
  })

  it('is order-independent for the set of ids', () => {
    const a = state([row(5), row(9)])
    const b = state([row(9), row(2)])
    const ids = (s) => s.completed.map((r) => r.id)
    expect(ids(mergeStates(a, b))).toEqual(ids(mergeStates(b, a)))
  })
})

describe('field-level merging', () => {
  it('keeps the earlier date — the day it was first drawn', () => {
    const merged = mergeStates(state([row(1, { dateISO: '2026-05-09' })]), state([row(1, { dateISO: '2026-05-02' })]))
    expect(merged.completed[0].dateISO).toBe('2026-05-02')
  })

  it('ORs the read ticks so neither device can un-say the other', () => {
    const merged = mergeStates(
      state([row(1, { readBy: { a: true, b: false } })]),
      state([row(1, { readBy: { a: false, b: true } })]),
    )
    expect(merged.completed[0].readBy).toEqual({ a: true, b: true })
  })

  it('takes the newer notes when there is a timestamp', () => {
    const merged = mergeStates(
      state([row(1, { notes: 'older', updatedAt: '2026-05-01T10:00:00Z' })]),
      state([row(1, { notes: 'newer', updatedAt: '2026-05-02T10:00:00Z' })]),
    )
    expect(merged.completed[0].notes).toBe('newer')
  })

  it('falls back to the longer notes when neither is timestamped', () => {
    const merged = mergeStates(state([row(1, { notes: 'a longer note' })]), state([row(1, { notes: 'short' })]))
    expect(merged.completed[0].notes).toBe('a longer note')
  })

  it('drops the updatedAt bookkeeping from the merged result', () => {
    const merged = mergeStates(state([row(1, { updatedAt: '2026-05-01T10:00:00Z' })]), state([]))
    expect(merged.completed[0]).not.toHaveProperty('updatedAt')
  })
})

describe('the day lock', () => {
  it('takes the later lock, so one spin a day survives a merge', () => {
    const merged = mergeStates(
      state([], { lastSpinDate: '2026-06-01' }),
      state([], { lastSpinDate: '2026-06-04' }),
    )
    expect(merged.lastSpinDate).toBe('2026-06-04')
  })

  it('handles either side being unset', () => {
    expect(mergeStates(state([], { lastSpinDate: null }), state([], { lastSpinDate: '2026-06-04' })).lastSpinDate).toBe('2026-06-04')
    expect(mergeStates(state([], { lastSpinDate: '2026-06-01' }), state([], { lastSpinDate: null })).lastSpinDate).toBe('2026-06-01')
    expect(mergeStates(state([]), state([])).lastSpinDate).toBeNull()
  })
})

describe('reader names', () => {
  it('takes the shared copy by default', () => {
    const merged = mergeStates(
      state([], { readerNames: { a: 'local', b: 'local' } }),
      state([], { readerNames: { a: 'Sam', b: 'Alex' } }),
    )
    expect(merged.readerNames).toEqual({ a: 'Sam', b: 'Alex' })
  })

  it('can be told to keep the local ones — the first push after pairing', () => {
    const merged = mergeStates(
      state([], { readerNames: { a: 'Sam', b: 'Alex' } }),
      state([], { readerNames: { a: 'Reader A', b: 'Reader B' } }),
      { preferRemoteNames: false },
    )
    expect(merged.readerNames).toEqual({ a: 'Sam', b: 'Alex' })
  })
})
