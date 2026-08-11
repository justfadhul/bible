import { describe, it, expect } from 'vitest'
import { normalizeState, migrateV2, SCHEMA_VERSION } from './storage.js'

/**
 * v2 let anyone type a reader into existence on their own device. v3 says a
 * reader is an account. The migration between them is the only place in the
 * app where somebody's existing history can be silently thrown away, so it
 * gets its own file.
 */

const v2 = (readers, completed = [], over = {}) => ({
  version: 2,
  readers,
  completed,
  lastSpinDate: null,
  ...over,
})
const reader = (id, over = {}) => ({ id, name: '', avatarUrl: null, userId: null, email: null, ...over })
const row = (id, readBy = []) => ({ id, dateISO: '2026-03-01', notes: '', readBy })

describe('v2 → v3', () => {
  it('re-keys an account-backed reader to its user id', () => {
    const { state } = normalizeState(v2([reader('local-7', { userId: 'u1', name: 'Sam' })]))
    expect(state.readers[0]).toMatchObject({ id: 'u1', userId: 'u1', name: 'Sam' })
  })

  it('carries the ticks across with it', () => {
    // The whole risk of the migration: a tick left pointing at an id nobody
    // holds any more is a tick that silently stops counting.
    const { state } = normalizeState(
      v2([reader('local-7', { userId: 'u1', name: 'Sam' })], [row(3, ['local-7'])]),
    )
    expect(state.completed[0].readBy).toEqual(['u1'])
  })

  it('re-keys several readers at once without crossing them over', () => {
    const { state } = normalizeState(
      v2(
        [reader('x', { userId: 'u1', name: 'Sam' }), reader('y', { userId: 'u2', name: 'Alex' })],
        [row(1, ['x']), row(2, ['x', 'y']), row(3, ['y'])],
      ),
    )
    expect(state.completed.map((r) => r.readBy)).toEqual([['u1'], ['u1', 'u2'], ['u2']])
  })

  it('clears out the placeholder nobody ever touched', () => {
    // "Reader B" on a device only one person ever used.
    const { state } = normalizeState(
      v2([reader('a', { name: 'Sam' }), reader('b', { name: '' })], [row(1, ['a'])]),
    )
    expect(state.readers.map((r) => r.id)).toEqual(['a'])
  })

  it('keeps a local reader who was named', () => {
    const { state } = normalizeState(v2([reader('a', { name: 'Sam' }), reader('b', { name: 'Alex' })]))
    expect(state.readers.map((r) => r.name)).toEqual(['Sam', 'Alex'])
  })

  it('keeps a local reader who ticked something, even unnamed', () => {
    const { state } = normalizeState(v2([reader('a'), reader('b')], [row(1, ['b'])]))
    expect(state.readers.map((r) => r.id)).toEqual(['b'])
    expect(state.completed[0].readBy).toEqual(['b'])
  })

  it('keeps a local reader who chose a photo', () => {
    const { state } = normalizeState(
      v2([reader('a', { avatarUrl: 'https://example.com/p.png' }), reader('b')]),
    )
    expect(state.readers.map((r) => r.id)).toEqual(['a'])
  })

  it('never leaves a device with nobody on it', () => {
    const { state } = normalizeState(v2([reader('a'), reader('b')]))
    expect(state.readers).toHaveLength(1)
  })

  it('never drops a reading, whatever happens to the readers', () => {
    const { state } = normalizeState(v2([reader('a'), reader('b')], [row(1), row(2), row(3)]))
    expect(state.completed.map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('says what it did', () => {
    const { problems } = normalizeState(v2([reader('a', { name: 'Sam' })]))
    expect(problems.join(' ')).toMatch(/version 2/i)
  })

  it('is idempotent — re-normalising a migrated state changes nothing', () => {
    const once = normalizeState(
      v2([reader('x', { userId: 'u1', name: 'Sam' }), reader('b')], [row(1, ['x'])]),
    ).state
    const twice = normalizeState(JSON.parse(JSON.stringify(once))).state
    expect(twice).toEqual(once)
    expect(once.version).toBe(SCHEMA_VERSION)
  })

  it('walks a version 1 export all the way, not one step', () => {
    const { state } = normalizeState({
      version: 1,
      readerNames: { a: 'Sam', b: 'Alex' },
      completed: [{ id: 3, dateISO: '2026-01-01', notes: '', readBy: { a: true, b: false } }],
      lastSpinDate: '2026-01-01',
    })
    expect(state.version).toBe(SCHEMA_VERSION)
    expect(state.completed[0].readBy).toEqual(['a'])
    expect(state.readers.map((r) => r.name)).toEqual(['Sam', 'Alex'])
  })

  it('migrateV2 tolerates junk in the readers list', () => {
    const out = migrateV2({ version: 2, readers: [null, 'nope', reader('a', { name: 'Sam' })], completed: [] })
    expect(out.readers.map((r) => r.id)).toEqual(['a'])
  })

  it('migrateV2 tolerates a missing readBy', () => {
    const out = migrateV2({ version: 2, readers: [reader('a', { name: 'S' })], completed: [{ id: 1 }] })
    expect(out.completed[0].readBy).toEqual([])
  })

  it('sweeps a placeholder out of data an earlier migration already kept', () => {
    // The bug people actually saw. The first version of this migration read
    // "Reader B" as a chosen name, kept it, and wrote the result back as a
    // newer version — after which the migration never ran again and the
    // phantom reader was permanent. The sweep has to happen on every read.
    const alreadyUpgraded = {
      version: SCHEMA_VERSION,
      readers: [
        { id: 'u1', userId: 'u1', name: 'Fadhul', avatarUrl: null, email: 'f@example.com' },
        { id: 'b', userId: null, name: 'Reader B', avatarUrl: null, email: null },
      ],
      completed: [{ id: 1, dateISO: '2026-03-01', notes: '', notesBy: {}, readBy: ['u1'] }],
      lastSpinDate: null,
    }
    const { state, problems } = normalizeState(alreadyUpgraded)
    expect(state.readers.map((r) => r.id)).toEqual(['u1'])
    expect(problems.join(' ')).toMatch(/placeholder/i)
    expect(state.completed[0].readBy).toEqual(['u1'])
  })

  it('keeps a placeholder that somebody actually ticked with', () => {
    const { state } = normalizeState({
      version: SCHEMA_VERSION,
      readers: [
        { id: 'u1', userId: 'u1', name: 'Fadhul' },
        { id: 'b', userId: null, name: 'Reader B' },
      ],
      completed: [{ id: 1, dateISO: '2026-03-01', notesBy: {}, readBy: ['b'] }],
      lastSpinDate: null,
    })
    expect(state.readers.map((r) => r.id)).toEqual(['u1', 'b'])
  })

  it('leaves a device with nobody on it, never', () => {
    const { state } = normalizeState({
      version: SCHEMA_VERSION,
      readers: [{ id: 'a', userId: null, name: 'Reader A' }],
      completed: [],
      lastSpinDate: null,
    })
    expect(state.readers).toHaveLength(1)
    // And the generated name is cleared, so it reads as "You" rather than as
    // somebody called Reader A.
    expect(state.readers[0].name).toBe('')
  })

  it('does not touch a reader who chose a name that merely looks systematic', () => {
    const { state } = normalizeState({
      version: SCHEMA_VERSION,
      readers: [
        { id: 'u1', userId: 'u1', name: 'Fadhul' },
        { id: 'x', userId: null, name: 'Reader Bee' },
      ],
      completed: [],
      lastSpinDate: null,
    })
    expect(state.readers.map((r) => r.name)).toEqual(['Fadhul', 'Reader Bee'])
  })

  it('does not merge two people who happen to share a tick id', () => {
    // Re-keying must not collapse distinct rows into one another.
    const { state } = normalizeState(
      v2([reader('a', { userId: 'u1', name: 'Sam' }), reader('b', { userId: 'u2', name: 'Alex' })]),
    )
    expect(state.readers.map((r) => r.id)).toEqual(['u1', 'u2'])
  })
})
