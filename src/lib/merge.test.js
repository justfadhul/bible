import { describe, it, expect } from 'vitest'
import { mergeStates } from './merge.js'
import { emptyState } from './storage.js'

const row = (id, over = {}) => ({ id, dateISO: '2026-03-01', notes: '', readBy: [], ...over })

/** Readers are accounts now, so a roster is a list of user ids. */
const asReader = (id, over = {}) => ({ id, name: '', avatarUrl: null, userId: id, email: null, ...over })
const state = (completed, over = {}) => ({
  ...emptyState(),
  readers: [asReader('u1'), asReader('u2')],
  completed,
  ...over,
})

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

  it('unions the read ticks so neither device can un-say the other', () => {
    const merged = mergeStates(state([row(1, { readBy: ['u1'] })]), state([row(1, { readBy: ['u2'] })]))
    expect(new Set(merged.completed[0].readBy)).toEqual(new Set(['u1', 'u2']))
  })

  it('drops ticks by readers who survived neither roster', () => {
    const merged = mergeStates(state([row(1, { readBy: ['u1', 'ghost'] })]), state([row(1)]))
    expect(merged.completed[0].readBy).toEqual(['u1'])
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

const reader = (id, over = {}) => ({ id, name: '', avatarUrl: null, userId: null, email: null, ...over })

describe('merging the reader roster', () => {
  it('takes the shared copy by default', () => {
    const merged = mergeStates(
      state([], { readers: [reader('u1', { userId: 'u1', name: 'local' })] }),
      state([], { readers: [reader('u1', { userId: 'u1', name: 'Sam' })] }),
    )
    expect(merged.readers[0].name).toBe('Sam')
  })

  it('can be told to keep the local names — the first push after pairing', () => {
    const merged = mergeStates(
      state([], { readers: [reader('u1', { userId: 'u1', name: 'Sam' })] }),
      state([], { readers: [reader('u1', { userId: 'u1', name: 'Old' })] }),
      { preferRemoteNames: false },
    )
    expect(merged.readers[0].name).toBe('Sam')
  })

  it('brings in a reader this device has never seen — that is how the others arrive', () => {
    // Somebody signed up on their own phone and joined; their row reaches you
    // through the shared copy, not through anything you did here.
    const merged = mergeStates(
      state([], { readers: [reader('u1', { userId: 'u1', name: 'Sam' })] }),
      state([], {
        readers: [reader('u1', { userId: 'u1', name: 'Sam' }), reader('u2', { userId: 'u2', name: 'Alex' })],
      }),
    )
    expect(merged.readers.map((r) => r.name)).toEqual(['Sam', 'Alex'])
  })

  it('matches the same person across devices by account, not just by id', () => {
    // The second device generated its own id for the same signed-in human.
    const merged = mergeStates(
      state([], { readers: [reader('local-1', { userId: 'u1', name: 'Sam' })] }),
      state([], { readers: [reader('remote-9', { userId: 'u1', avatarUrl: 'https://x/p.png' })] }),
    )
    expect(merged.readers).toHaveLength(1)
    expect(merged.readers[0]).toMatchObject({ userId: 'u1', name: 'Sam', avatarUrl: 'https://x/p.png' })
  })

  it('keeps genuinely different readers apart', () => {
    const merged = mergeStates(
      state([], { readers: [reader('a', { name: 'Sam' })] }),
      state([], { readers: [reader('b', { name: 'Alex' })] }),
    )
    expect(merged.readers.map((r) => r.name).sort()).toEqual(['Alex', 'Sam'])
  })

  it('fills in a photo the other device had', () => {
    const merged = mergeStates(
      state([], { readers: [reader('a', { name: 'Sam' })] }),
      state([], { readers: [reader('a', { avatarUrl: 'https://x/p.png' })] }),
    )
    expect(merged.readers[0]).toMatchObject({ name: 'Sam', avatarUrl: 'https://x/p.png' })
  })
})
