import { describe, it, expect } from 'vitest'
import { normalizeState, emptyState, migrateV1, SCHEMA_VERSION, MAX_READERS, makeReader } from './storage.js'
import {
  recordSpin,
  setMyNote,
  setReadBy,
  undoSpin,
  rowForDate,
  byNewest,
  removeReader,
  updateReader,
  linkAccount,
} from './state.js'

/** The local reader's id is generated per device, so compare around it. */
const shape = (s) => ({ ...s, readers: s.readers.map(({ id, ...r }) => r) })
const meId = (s) => s.readers[0].id
import { currentStreak, longestStreak } from './stats.js'
import { nameFromEmail, displayName, initials, NAME_SUGGESTIONS } from './readers.js'

describe('normalizeState survives bad input', () => {
  it.each([null, undefined, 0, 'nonsense', [], true])('falls back to empty for %p', (bad) => {
    const { state } = normalizeState(bad)
    expect(shape(state)).toEqual(shape(emptyState()))
    expect(state.readers).toHaveLength(1)
  })

  it('drops malformed rows rather than the whole file', () => {
    const { state, problems } = normalizeState({
      version: 3,
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
    expect(state.completed[1]).toEqual({ id: 6, dateISO: null, notes: '', notesBy: {}, readBy: [] })
    expect(state).not.toHaveProperty('junkField')
    expect(problems.length).toBeGreaterThan(0)
  })

  it('drops ticks by readers who no longer exist', () => {
    const { state } = normalizeState({
      version: 3,
      readers: [{ id: 'a', name: 'Sam' }],
      completed: [{ id: 1, dateISO: '2026-01-01', readBy: ['a', 'ghost', 'a'] }],
    })
    expect(state.completed[0].readBy).toEqual(['a'])
  })

  it('restores one reader rather than leaving nobody', () => {
    const { state } = normalizeState({ version: 3, readers: [], completed: [] })
    expect(state.readers).toHaveLength(1)
    expect(state.readers[0].userId).toBeNull()
  })

  it('caps the reader list at the size join_pair() allows', () => {
    const readers = Array.from({ length: MAX_READERS + 4 }, (_, i) => ({
      id: `u${i}`,
      userId: `u${i}`,
      name: `R${i}`,
    }))
    const { state } = normalizeState({ version: 3, readers, completed: [] })
    expect(state.readers).toHaveLength(MAX_READERS)
  })

  it('rejects an avatar that is not an image data URI or an https URL', () => {
    const bad = ['javascript:alert(1)', 'http://insecure/x.png', 'data:text/html;base64,AAAA', {}, 42]
    for (const avatarUrl of bad) {
      const { state } = normalizeState({ version: 3, readers: [{ id: 'a', avatarUrl }], completed: [] })
      expect(state.readers[0].avatarUrl).toBeNull()
    }
    const ok = normalizeState({
      version: 3,
      readers: [{ id: 'a', avatarUrl: 'https://example.com/a.png' }],
      completed: [],
    })
    expect(ok.state.readers[0].avatarUrl).toBe('https://example.com/a.png')
  })

  it('round-trips a real state exactly (export → import)', () => {
    let s = emptyState()
    const me = meId(s)
    s = recordSpin(s, 12, '2026-02-01')
    s = setMyNote(s, 12, me, 'we argued about verse 4')
    s = setReadBy(s, 12, me, true)
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

  it('does not carry v1 placeholder names forward as real ones', () => {
    // v1 with no names produced "Reader A"/"Reader B". Those are generated
    // labels, not people, and v3 has no room for a reader nobody signed up as.
    const { state } = normalizeState({ version: 1, completed: [] })
    expect(state.readers).toHaveLength(1)
    expect(state.readers[0].name).toBe('')
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
    s = setReadBy(s, 1, 'u1', true)
    s = setReadBy(s, 1, 'u2', true)
    expect(s.completed[0].readBy).toEqual(['u1', 'u2'])
    s = setReadBy(s, 1, 'u1', false)
    expect(s.completed[0].readBy).toEqual(['u2'])
    // Setting the same value again is a no-op, not a duplicate.
    const same = setReadBy(s, 1, 'u2', true)
    expect(same.completed[0].readBy).toEqual(['u2'])
  })
})

describe('readers are accounts, not rows anyone can add', () => {
  it('a fresh device has exactly one reader, and it is unclaimed', () => {
    const s = emptyState()
    expect(s.readers).toHaveLength(1)
    expect(s.readers[0]).toMatchObject({ name: '', userId: null, email: null, avatarUrl: null })
  })

  it('there is no way to invent a second one', async () => {
    const stateModule = await import('./state.js')
    expect(stateModule.addReader).toBeUndefined()
  })

  it('removing a leftover local reader also removes their ticks', () => {
    let s = { ...emptyState(), readers: [makeReader({ id: 'me' }), makeReader({ id: 'old', name: 'Chris' })] }
    s = recordSpin(s, 1, '2026-03-01')
    s = setReadBy(s, 1, 'me', true)
    s = setReadBy(s, 1, 'old', true)
    s = removeReader(s, 'old')
    expect(s.readers.map((r) => r.id)).toEqual(['me'])
    expect(s.completed[0].readBy).toEqual(['me'])
  })

  it('refuses to remove somebody who has an account', () => {
    // Their account is theirs to leave with; it is not yours to delete.
    const s = {
      ...emptyState(),
      readers: [makeReader({ userId: 'u1', name: 'Sam' }), makeReader({ userId: 'u2', name: 'Alex' })],
    }
    expect(removeReader(s, 'u2')).toBe(s)
  })

  it('refuses to remove the last reader', () => {
    const s = emptyState()
    expect(removeReader(s, meId(s))).toBe(s)
  })

  it('updates a reader in place', () => {
    const s0 = emptyState()
    const s = updateReader(s0, meId(s0), { name: 'Sam', avatarUrl: 'https://x/y.png' })
    expect(s.readers[0]).toMatchObject({ name: 'Sam', avatarUrl: 'https://x/y.png' })
  })
})

describe('signing up turns you into a reader', () => {
  it('adopts the local reader rather than adding a stranger beside it', () => {
    const s = linkAccount(emptyState(), { userId: 'u1', email: 'sam@example.com', name: 'Sam' })
    expect(s.readers).toHaveLength(1)
    expect(s.readers[0]).toMatchObject({ id: 'u1', userId: 'u1', email: 'sam@example.com' })
  })

  it('carries the ticks over to the new id', () => {
    // The whole point: history made before signing up is still yours after.
    let s = emptyState()
    const me = meId(s)
    s = recordSpin(s, 4, '2026-03-01')
    s = setReadBy(s, 4, me, true)
    s = linkAccount(s, { userId: 'u1', email: 'sam@example.com' })
    expect(s.completed[0].readBy).toEqual(['u1'])
    expect(s.readers[0].id).toBe('u1')
  })

  it('leaves other readers\' ticks alone while re-keying yours', () => {
    let s = { ...emptyState(), readers: [makeReader({ id: 'me' }), makeReader({ userId: 'u2', name: 'Alex' })] }
    s = recordSpin(s, 4, '2026-03-01')
    s = setReadBy(s, 4, 'me', true)
    s = setReadBy(s, 4, 'u2', true)
    s = linkAccount(s, { userId: 'u1' })
    expect(s.completed[0].readBy.sort()).toEqual(['u1', 'u2'])
  })

  it('re-links the same account to the same reader, not a new one', () => {
    let s = linkAccount(emptyState(), { userId: 'u1', email: 'sam@example.com' })
    const once = s
    s = linkAccount(s, { userId: 'u1', email: 'sam@example.com' })
    expect(s.readers.filter((r) => r.userId === 'u1')).toHaveLength(1)
    // And is a genuine no-op, so App does not commit a pointless write.
    expect(s).toBe(once)
  })

  it('does not overwrite a name the reader has chosen', () => {
    const s0 = emptyState()
    let s = updateReader(s0, meId(s0), { name: 'Barnabas' })
    s = linkAccount(s, { userId: 'u1', email: 'sam@example.com', name: 'Sam' })
    expect(s.readers[0].name).toBe('Barnabas')
  })

  it('does not let auth metadata clobber a photo you uploaded', () => {
    const s0 = emptyState()
    let s = updateReader(s0, meId(s0), { avatarUrl: 'https://mine/photo.png' })
    s = linkAccount(s, { userId: 'u1', avatarUrl: 'https://provider/guess.png' })
    expect(s.readers[0].avatarUrl).toBe('https://mine/photo.png')
  })

  it('appends when every reader already belongs to somebody else', () => {
    const s0 = { ...emptyState(), readers: [makeReader({ userId: 'u2', name: 'Alex' })] }
    const s = linkAccount(s0, { userId: 'u1', email: 'sam@example.com' })
    expect(s.readers.map((r) => r.id)).toEqual(['u2', 'u1'])
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

  it('falls back name → email → who they are', () => {
    expect(displayName({ name: 'Barnabas', email: 'x@y.z' }, 0)).toBe('Barnabas')
    expect(displayName({ name: '  ', email: 'sam@y.z' }, 0)).toBe('Sam')
    // No account can only mean this device's own reader, so say so.
    expect(displayName({ name: '', email: '', userId: null }, 1)).toBe('You')
    // Somebody else's account with nothing filled in yet still gets a label.
    expect(displayName({ name: '', email: '', userId: 'u2' }, 1)).toBe('Reader B')
  })

  it('builds initials from whatever it has', () => {
    expect(initials({ name: 'Sam Okonkwo' })).toBe('SO')
    expect(initials({ name: 'Barnabas' })).toBe('BA')
    expect(initials({ name: '', email: '', userId: 'u2' }, 0)).toBe('RA')
    expect(initials({ name: '', email: '', userId: null }, 0)).toBe('YO')
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
