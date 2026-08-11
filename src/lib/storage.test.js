import { describe, it, expect } from 'vitest'
import { normalizeState, emptyState, migrateV1, SCHEMA_VERSION, MAX_READERS, makeReader } from './storage.js'
import {
  recordSpin,
  setNotes,
  setReadBy,
  undoSpin,
  rowForDate,
  byNewest,
  addReader,
  removeReader,
  updateReader,
  linkAccount,
} from './state.js'
import { currentStreak, longestStreak } from './stats.js'
import { nameFromEmail, displayName, initials, NAME_SUGGESTIONS } from './readers.js'

describe('normalizeState survives bad input', () => {
  it.each([null, undefined, 0, 'nonsense', [], true])('falls back to empty for %p', (bad) => {
    const { state } = normalizeState(bad)
    expect(state).toEqual(emptyState())
  })

  it('drops malformed rows rather than the whole file', () => {
    const { state, problems } = normalizeState({
      version: 2,
      readers: [{ id: 'a', name: 'Sam' }],
      completed: [
        { id: 5, dateISO: '2026-01-02', notes: 'ok', readBy: ['a'] },
        { id: 'five' },
        null,
        { id: 5, dateISO: '2026-01-03' },
        { id: 6, dateISO: 'not-a-date', notes: 42, readBy: 'yes' },
      ],
      lastSpinDate: '2026-01-02',
      junkField: 'ignored',
    })
    expect(state.completed.map((r) => r.id)).toEqual([5, 6])
    expect(state.completed[1]).toEqual({ id: 6, dateISO: null, notes: '', readBy: [] })
    expect(state).not.toHaveProperty('junkField')
    expect(problems.length).toBeGreaterThan(0)
  })

  it('drops ticks by readers who no longer exist', () => {
    const { state } = normalizeState({
      version: 2,
      readers: [{ id: 'a', name: 'Sam' }],
      completed: [{ id: 1, dateISO: '2026-01-01', readBy: ['a', 'ghost', 'a'] }],
    })
    expect(state.completed[0].readBy).toEqual(['a'])
  })

  it('restores default readers rather than leaving nobody', () => {
    const { state } = normalizeState({ version: 2, readers: [], completed: [] })
    expect(state.readers).toHaveLength(2)
  })

  it('caps the reader list', () => {
    const readers = Array.from({ length: MAX_READERS + 4 }, (_, i) => ({ id: `r${i}`, name: `R${i}` }))
    const { state } = normalizeState({ version: 2, readers, completed: [] })
    expect(state.readers).toHaveLength(MAX_READERS)
  })

  it('rejects an avatar that is not an image data URI or an https URL', () => {
    const bad = ['javascript:alert(1)', 'http://insecure/x.png', 'data:text/html;base64,AAAA', {}, 42]
    for (const avatarUrl of bad) {
      const { state } = normalizeState({ version: 2, readers: [{ id: 'a', avatarUrl }], completed: [] })
      expect(state.readers[0].avatarUrl).toBeNull()
    }
    const ok = normalizeState({
      version: 2,
      readers: [{ id: 'a', avatarUrl: 'https://example.com/a.png' }],
      completed: [],
    })
    expect(ok.state.readers[0].avatarUrl).toBe('https://example.com/a.png')
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

describe('upgrading a version 1 history', () => {
  const v1 = {
    version: 1,
    completed: [
      { id: 3, dateISO: '2026-01-01', notes: 'first', readBy: { a: true, b: false } },
      { id: 9, dateISO: '2026-01-02', notes: '', readBy: { a: true, b: true } },
      { id: 14, dateISO: '2026-01-03', notes: 'x', readBy: { a: false, b: false } },
    ],
    lastSpinDate: '2026-01-03',
    readerNames: { a: 'Sam', b: 'Alex' },
  }

  it('keeps every reading', () => {
    const { state } = normalizeState(v1)
    expect(state.completed.map((r) => r.id)).toEqual([3, 9, 14])
    expect(state.lastSpinDate).toBe('2026-01-03')
  })

  it('turns the two names into two readers', () => {
    const { state } = normalizeState(v1)
    expect(state.readers.map((r) => [r.id, r.name])).toEqual([
      ['a', 'Sam'],
      ['b', 'Alex'],
    ])
  })

  it('converts the boolean pair into a list of reader ids', () => {
    const { state } = normalizeState(v1)
    expect(state.completed.map((r) => r.readBy)).toEqual([['a'], ['a', 'b'], []])
  })

  it('says what it did', () => {
    const { problems } = normalizeState(v1)
    expect(problems.join(' ')).toMatch(/version 1/i)
  })

  it('recognises a v1 file even with no version field', () => {
    const { state } = normalizeState({ completed: [], readerNames: { a: 'X', b: 'Y' } })
    expect(state.readers.map((r) => r.name)).toEqual(['X', 'Y'])
  })

  it('supplies defaults when the old names were missing', () => {
    const { state } = normalizeState({ version: 1, completed: [] })
    expect(state.readers.map((r) => r.name)).toEqual(['Reader A', 'Reader B'])
  })

  it('is idempotent — re-normalising changes nothing', () => {
    const once = normalizeState(v1).state
    const twice = normalizeState(JSON.parse(JSON.stringify(once))).state
    expect(twice).toEqual(once)
  })

  it('migrateV1 keeps notes and dates untouched', () => {
    const out = migrateV1(v1)
    expect(out.completed[0].notes).toBe('first')
    expect(out.completed[0].dateISO).toBe('2026-01-01')
  })
})

describe('state transitions', () => {
  it('undo removes the entry and restores the previous day lock', () => {
    const s = recordSpin(emptyState(), 7, '2026-03-04')
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
    s = { ...s, completed: [...s.completed, { id: 4, dateISO: null, notes: '', readBy: [] }] }
    expect(byNewest(s).map((r) => r.id)).toEqual([2, 3, 1, 4])
  })

  it('ticks and unticks a reader without disturbing the others', () => {
    let s = recordSpin(emptyState(), 1, '2026-03-04')
    s = setReadBy(s, 1, 'a', true)
    s = setReadBy(s, 1, 'b', true)
    expect(s.completed[0].readBy).toEqual(['a', 'b'])
    s = setReadBy(s, 1, 'a', false)
    expect(s.completed[0].readBy).toEqual(['b'])
    // Setting the same value again is a no-op, not a duplicate.
    const same = setReadBy(s, 1, 'b', true)
    expect(same.completed[0].readBy).toEqual(['b'])
  })
})

describe('managing readers', () => {
  it('adds up to the limit and no further', () => {
    let s = emptyState()
    for (let i = 0; i < MAX_READERS + 3; i++) s = addReader(s, { name: `R${i}` })
    expect(s.readers).toHaveLength(MAX_READERS)
  })

  it('removing a reader also removes their ticks', () => {
    let s = addReader(emptyState(), { id: 'c', name: 'Chris' })
    s = recordSpin(s, 1, '2026-03-01')
    s = setReadBy(s, 1, 'a', true)
    s = setReadBy(s, 1, 'c', true)
    s = removeReader(s, 'c')
    expect(s.readers.map((r) => r.id)).toEqual(['a', 'b'])
    expect(s.completed[0].readBy).toEqual(['a'])
  })

  it('refuses to remove the last reader', () => {
    let s = emptyState()
    s = removeReader(s, 'b')
    s = removeReader(s, 'a')
    expect(s.readers).toHaveLength(1)
  })

  it('updates a reader in place', () => {
    const s = updateReader(emptyState(), 'a', { name: 'Sam', avatarUrl: 'https://x/y.png' })
    expect(s.readers[0]).toMatchObject({ name: 'Sam', avatarUrl: 'https://x/y.png' })
    expect(s.readers[1].name).toBe('Reader B')
  })
})

describe('linking a signed-in account', () => {
  it('adopts the first unlinked reader rather than adding a stranger', () => {
    const s = linkAccount(emptyState(), { userId: 'u1', email: 'sam@example.com', name: 'Sam' })
    expect(s.readers).toHaveLength(2)
    expect(s.readers[0]).toMatchObject({ id: 'a', userId: 'u1', email: 'sam@example.com' })
  })

  it('re-links the same account to the same reader, not a new one', () => {
    let s = linkAccount(emptyState(), { userId: 'u1', email: 'sam@example.com' })
    s = linkAccount(s, { userId: 'u1', email: 'sam@example.com' })
    expect(s.readers.filter((r) => r.userId === 'u1')).toHaveLength(1)
  })

  it('does not overwrite a name the reader has chosen', () => {
    let s = updateReader(emptyState(), 'a', { name: 'Barnabas' })
    s = linkAccount(s, { userId: 'u1', email: 'sam@example.com', name: 'Sam' })
    expect(s.readers[0].name).toBe('Barnabas')
  })

  it('ignores a missing user id', () => {
    const s = emptyState()
    expect(linkAccount(s, { userId: null })).toBe(s)
  })
})

describe('reader display', () => {
  it('derives a name from an email address', () => {
    expect(nameFromEmail('sam.okonkwo@example.com')).toBe('Sam Okonkwo')
    expect(nameFromEmail('alex_p+tag@example.com')).toBe('Alex P Tag')
    expect(nameFromEmail('jo99@example.com')).toBe('Jo')
    expect(nameFromEmail('')).toBe('')
    expect(nameFromEmail(undefined)).toBe('')
  })

  it('falls back name → email → position', () => {
    expect(displayName({ name: 'Barnabas', email: 'x@y.z' }, 0)).toBe('Barnabas')
    expect(displayName({ name: '  ', email: 'sam@y.z' }, 0)).toBe('Sam')
    expect(displayName({ name: '', email: '' }, 1)).toBe('Reader B')
  })

  it('builds initials from whatever it has', () => {
    expect(initials({ name: 'Sam Okonkwo' })).toBe('SO')
    expect(initials({ name: 'Barnabas' })).toBe('BA')
    expect(initials({ name: '', email: '' }, 0)).toBe('RA')
  })

  it('offers suggestions that are all usable names', () => {
    expect(NAME_SUGGESTIONS.length).toBeGreaterThan(8)
    for (const n of NAME_SUGGESTIONS) expect(n).toMatch(/^[A-Z][a-z]+$/)
  })
})

describe('streaks', () => {
  const rows = (...dates) => dates.map((d, i) => ({ id: i + 1, dateISO: d, notes: '', readBy: [] }))

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
