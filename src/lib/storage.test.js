import { describe, it, expect } from 'vitest'
import { normalizeState, emptyState, SCHEMA_VERSION } from './storage.js'
import { recordSpin, setNotes, setReadBy, undoSpin, rowForDate, byNewest } from './state.js'
import { currentStreak, longestStreak } from './stats.js'

describe('normalizeState survives bad input', () => {
  it.each([null, undefined, 0, 'nonsense', [], true])('falls back to empty for %p', (bad) => {
    const { state } = normalizeState(bad)
    expect(state).toEqual(emptyState())
  })

  it('drops malformed rows rather than the whole file', () => {
    const { state, problems } = normalizeState({
      version: 1,
      completed: [
        { id: 5, dateISO: '2026-01-02', notes: 'ok', readBy: { a: true, b: false } },
        { id: 'five' },
        null,
        { id: 5, dateISO: '2026-01-03' },
        { id: 6, dateISO: 'not-a-date', notes: 42, readBy: 'yes' },
      ],
      lastSpinDate: '2026-01-02',
      junkField: 'ignored',
    })
    expect(state.completed.map((r) => r.id)).toEqual([5, 6])
    expect(state.completed[1]).toEqual({ id: 6, dateISO: null, notes: '', readBy: { a: false, b: false } })
    expect(state).not.toHaveProperty('junkField')
    expect(problems.length).toBeGreaterThan(0)
  })

  it('rejects a bad lastSpinDate without losing history', () => {
    const { state } = normalizeState({ version: 1, completed: [{ id: 1, dateISO: '2026-01-01' }], lastSpinDate: 'yesterday' })
    expect(state.lastSpinDate).toBeNull()
    expect(state.completed).toHaveLength(1)
  })

  it('round-trips a real state exactly (export → import)', () => {
    let s = emptyState()
    s = recordSpin(s, 12, '2026-02-01')
    s = setNotes(s, 12, 'we argued about verse 4')
    s = setReadBy(s, 12, 'a', true)
    s = recordSpin(s, 200, '2026-02-02')
    const exported = JSON.parse(JSON.stringify(s))
    const { state: imported, problems } = normalizeState(exported)
    expect(problems).toEqual([])
    expect(imported).toEqual(s)
    expect(imported.version).toBe(SCHEMA_VERSION)
  })
})

describe('state transitions', () => {
  it('undo removes the entry and restores the previous day lock', () => {
    let s = recordSpin(emptyState(), 7, '2026-03-04')
    expect(s.lastSpinDate).toBe('2026-03-04')
    const back = undoSpin(s, 7, null)
    expect(back.completed).toHaveLength(0)
    expect(back.lastSpinDate).toBeNull()
  })

  it('undo after a previous day restores that day, not null', () => {
    let s = recordSpin(emptyState(), 7, '2026-03-04')
    s = recordSpin(s, 8, '2026-03-05')
    const back = undoSpin(s, 8, '2026-03-04')
    expect(back.completed.map((r) => r.id)).toEqual([7])
    expect(back.lastSpinDate).toBe('2026-03-04')
  })

  it('finds the row recorded for a given day', () => {
    let s = recordSpin(emptyState(), 7, '2026-03-04')
    s = recordSpin(s, 8, '2026-03-05')
    expect(rowForDate(s, '2026-03-05').id).toBe(8)
    expect(rowForDate(s, '2026-03-06')).toBeUndefined()
  })

  it('orders the archive newest first, with undated rows last', () => {
    let s = recordSpin(emptyState(), 1, '2026-03-04')
    s = recordSpin(s, 2, '2026-03-06')
    s = recordSpin(s, 3, '2026-03-05')
    s = { ...s, completed: [...s.completed, { id: 4, dateISO: null, notes: '', readBy: { a: false, b: false } }] }
    expect(byNewest(s).map((r) => r.id)).toEqual([2, 3, 1, 4])
  })
})

describe('streaks', () => {
  const rows = (...dates) => dates.map((d, i) => ({ id: i + 1, dateISO: d, notes: '', readBy: { a: false, b: false } }))

  it('counts consecutive days up to today', () => {
    expect(currentStreak(rows('2026-08-08', '2026-08-09', '2026-08-10'), '2026-08-10')).toBe(3)
  })

  it('still counts when today has not been spun yet', () => {
    expect(currentStreak(rows('2026-08-08', '2026-08-09'), '2026-08-10')).toBe(2)
  })

  it('breaks after a missed day', () => {
    expect(currentStreak(rows('2026-08-07', '2026-08-08'), '2026-08-10')).toBe(0)
  })

  it('handles an empty history', () => {
    expect(currentStreak([], '2026-08-10')).toBe(0)
    expect(longestStreak([])).toBe(0)
  })

  it('finds the longest historical run and spans month ends', () => {
    expect(longestStreak(rows('2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02', '2026-03-01'))).toBe(4)
  })

  it('ignores duplicate days', () => {
    expect(longestStreak(rows('2026-05-01', '2026-05-01', '2026-05-02'))).toBe(2)
  })
})
