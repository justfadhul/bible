import { describe, it, expect } from 'vitest'
import { emptyState, makeReader, normalizeState, SCHEMA_VERSION } from './storage.js'
import { recordSpin, setMyNote, setRoster } from './state.js'
import { mergeStates } from './merge.js'

const reader = (id, over = {}) => makeReader({ id, userId: id, ...over })
const two = () => ({
  ...emptyState(),
  readers: [reader('u1', { name: 'Sam' }), reader('u2', { name: 'Edith' })],
})
const row = (id, over = {}) => ({ id, dateISO: '2026-03-01', notes: '', notesBy: {}, readBy: [], ...over })

describe('one note each', () => {
  it('keeps two people writing about the same passage apart', () => {
    // The whole point: a single shared box meant the second person to type
    // silently replaced the first.
    let s = recordSpin(two(), 4, '2026-03-01')
    s = setMyNote(s, 4, 'u1', 'the ending surprised me')
    s = setMyNote(s, 4, 'u2', 'I had read it before and missed this')
    expect(s.completed[0].notesBy).toEqual({
      u1: 'the ending surprised me',
      u2: 'I had read it before and missed this',
    })
  })

  it('clearing a note removes the author rather than storing an empty one', () => {
    let s = recordSpin(two(), 4, '2026-03-01')
    s = setMyNote(s, 4, 'u1', 'something')
    s = setMyNote(s, 4, 'u1', '   ')
    expect(s.completed[0].notesBy).toEqual({})
  })

  it('refuses to write a note with no author', () => {
    const s = recordSpin(two(), 4, '2026-03-01')
    expect(setMyNote(s, 4, null, 'orphan')).toBe(s)
  })

  it('leaves other readings alone', () => {
    let s = recordSpin(recordSpin(two(), 4, '2026-03-01'), 5, '2026-03-02')
    s = setMyNote(s, 4, 'u1', 'about four')
    expect(s.completed.find((r) => r.id === 5).notesBy).toEqual({})
  })
})

describe('merging notes', () => {
  it('takes each side\'s own author without touching the other', () => {
    const merged = mergeStates(
      { ...two(), completed: [row(1, { notesBy: { u1: 'mine' } })] },
      { ...two(), completed: [row(1, { notesBy: { u2: 'hers' } })] },
    )
    expect(merged.completed[0].notesBy).toEqual({ u1: 'mine', u2: 'hers' })
  })

  it('never concatenates two drafts of one thought', () => {
    const merged = mergeStates(
      { ...two(), completed: [row(1, { notesBy: { u1: 'a longer version of the note' } })] },
      { ...two(), completed: [row(1, { notesBy: { u1: 'short' } })] },
    )
    expect(merged.completed[0].notesBy.u1).toBe('a longer version of the note')
  })

  it('prefers the newer copy when there is a timestamp to go on', () => {
    const merged = mergeStates(
      { ...two(), completed: [row(1, { notesBy: { u1: 'older but longer' }, updatedAt: '2026-05-01T10:00:00Z' })] },
      { ...two(), completed: [row(1, { notesBy: { u1: 'newer' }, updatedAt: '2026-05-02T10:00:00Z' })] },
    )
    expect(merged.completed[0].notesBy.u1).toBe('newer')
  })

  it('keeps the legacy unattributed note beside the new ones', () => {
    const merged = mergeStates(
      { ...two(), completed: [row(1, { notes: 'from before', notesBy: { u1: 'mine' } })] },
      { ...two(), completed: [row(1, { notes: 'from before' })] },
    )
    expect(merged.completed[0].notes).toBe('from before')
    expect(merged.completed[0].notesBy).toEqual({ u1: 'mine' })
  })
})

describe('the roster is the database\'s answer, not a vote', () => {
  it('replaces the local list wholesale', () => {
    const server = [reader('u1', { name: 'Sam' }), reader('u3', { name: 'Noor' })]
    const merged = mergeStates(two(), { ...two(), readers: server, fromServer: true, completed: [] })
    expect(merged.readers.map((r) => r.id)).toEqual(['u1', 'u3'])
  })

  it('so somebody who left the group actually leaves', () => {
    // A union merge could never do this: the local copy would keep voting
    // them back in forever.
    const merged = mergeStates(two(), { ...two(), readers: [reader('u1')], fromServer: true, completed: [] })
    expect(merged.readers.map((r) => r.id)).toEqual(['u1'])
  })

  it('but keeps this device\'s own account-less reader', () => {
    const local = { ...emptyState(), readers: [makeReader({ id: 'me' })] }
    const merged = mergeStates(local, { ...local, readers: [reader('u1')], fromServer: true, completed: [] })
    expect(merged.readers.map((r) => r.id)).toEqual(['u1', 'me'])
  })

  it('leaves the roster alone when the server could not answer', () => {
    const merged = mergeStates(two(), { ...two(), readers: null, completed: [] })
    expect(merged.readers.map((r) => r.id)).toEqual(['u1', 'u2'])
  })

  it('setRoster is a no-op when nothing actually changed', () => {
    const s = two()
    expect(setRoster(s, s.readers)).toBe(s)
  })

  it('setRoster ignores a non-array, rather than emptying the group', () => {
    const s = two()
    expect(setRoster(s, null)).toBe(s)
    expect(setRoster(s, undefined)).toBe(s)
  })
})

describe('notes survive the guard', () => {
  it('a note by a reader who has left is kept — the words are the point', () => {
    const { state } = normalizeState({
      version: SCHEMA_VERSION,
      readers: [{ id: 'u1', userId: 'u1', name: 'Sam' }],
      completed: [{ id: 1, dateISO: '2026-01-01', notesBy: { u1: 'mine', gone: 'theirs' }, readBy: ['gone'] }],
    })
    // The tick goes, because it is a claim about somebody who is not here.
    expect(state.completed[0].readBy).toEqual([])
    // The note stays, because it is a thing that was written.
    expect(state.completed[0].notesBy).toEqual({ u1: 'mine', gone: 'theirs' })
  })

  it('drops junk in the notes map rather than rendering it', () => {
    const { state } = normalizeState({
      version: SCHEMA_VERSION,
      readers: [{ id: 'u1', userId: 'u1' }],
      completed: [{ id: 1, dateISO: '2026-01-01', notesBy: { u1: 42, u2: null, u3: 'real' } }],
    })
    expect(state.completed[0].notesBy).toEqual({ u3: 'real' })
  })

  it('survives notesBy being the wrong type entirely', () => {
    for (const notesBy of [null, 'text', 42, ['a'], undefined]) {
      const { state } = normalizeState({
        version: SCHEMA_VERSION,
        readers: [{ id: 'u1', userId: 'u1' }],
        completed: [{ id: 1, dateISO: '2026-01-01', notesBy }],
      })
      expect(state.completed[0].notesBy).toEqual({})
    }
  })
})
