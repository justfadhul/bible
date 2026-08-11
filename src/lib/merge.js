/**
 * Merging two copies of the history.
 *
 * The invariant the whole app rests on is that a passage is read once. So the
 * merge is a union over entry ids, never a choice between two lists: if either
 * device recorded an entry, it stays recorded. Losing a row would put a
 * passage back in the pool and let it come up twice.
 *
 * Within a row the fields are merged on their own terms rather than taking one
 * side wholesale:
 *
 *   dateISO   the earlier one — the day it was actually first drawn
 *   readBy    OR'd — a tick is a statement that someone read it, and nobody
 *             else's device is entitled to un-say it
 *   notes     the newer one by updatedAt, falling back to the longer text
 *             when there is no timestamp to go on
 *
 * Deletions are the one thing a union cannot express, which is why undo
 * deletes from the remote directly rather than relying on a push.
 */
import { isISODate } from './date.js'

const time = (r) => (r?.updatedAt ? Date.parse(r.updatedAt) || 0 : 0)

function mergeRow(local, remote) {
  if (!local) return remote
  if (!remote) return local

  const dates = [local.dateISO, remote.dateISO].filter(isISODate).sort()
  const newer = time(remote) > time(local) ? remote : time(local) > time(remote) ? local : null

  let notes
  if (newer) notes = newer.notes ?? ''
  else {
    const l = local.notes ?? ''
    const r = remote.notes ?? ''
    notes = l === r ? l : l.length >= r.length ? l : r
  }

  return {
    id: local.id,
    dateISO: dates[0] ?? null,
    notes,
    readBy: [...new Set([...(local.readBy ?? []), ...(remote.readBy ?? [])])],
  }
}

/**
 * Merges the reader rosters.
 *
 * Readers are matched on id, and on userId as well, because the same person
 * signing in on a second device arrives with a locally-generated id that the
 * other device has never seen. Without that the pair would end up with two
 * entries for one human.
 */
function mergeReaders(local, remote, preferRemote) {
  const out = []
  const byId = new Map()
  const byUser = new Map()

  const put = (r, winner) => {
    const seen = byId.get(r.id) ?? (r.userId ? byUser.get(r.userId) : null)
    if (seen) {
      // Same person: fill in whatever the other side knew, letting the
      // preferred side win where both have an opinion.
      const from = winner ? r : seen
      const other = winner ? seen : r
      seen.name = from.name?.trim() || other.name?.trim() || ''
      seen.avatarUrl = from.avatarUrl ?? other.avatarUrl ?? null
      seen.email = from.email ?? other.email ?? null
      seen.userId = seen.userId ?? r.userId ?? null
      if (seen.userId) byUser.set(seen.userId, seen)
      return
    }
    const copy = { ...r }
    out.push(copy)
    byId.set(copy.id, copy)
    if (copy.userId) byUser.set(copy.userId, copy)
  }

  for (const r of local.readers ?? []) put(r, !preferRemote)
  for (const r of remote.readers ?? []) put(r, preferRemote)
  return out
}

/**
 * Merges a local state and a remote state into one.
 * `preferRemoteNames` picks whose reader details win where both sides have
 * one, since the remote is the copy both people share.
 */
export function mergeStates(local, remote, { preferRemoteNames = true } = {}) {
  const byId = new Map()
  for (const r of remote.completed) byId.set(r.id, r)

  const completed = []
  const seen = new Set()
  for (const l of local.completed) {
    completed.push(mergeRow(l, byId.get(l.id)))
    seen.add(l.id)
  }
  for (const r of remote.completed) {
    if (!seen.has(r.id)) completed.push(mergeRow(null, r))
  }
  completed.sort((a, b) => a.id - b.id)

  // The later day lock wins: if either device has already spun today, the day
  // is spent. Anything else would hand out a second passage.
  const locks = [local.lastSpinDate, remote.lastSpinDate].filter(isISODate).sort()
  const readers = mergeReaders(local, remote, preferRemoteNames)
  const known = new Set(readers.map((r) => r.id))

  return {
    version: local.version,
    readers,
    completed: completed.map(({ updatedAt, ...row }) => ({
      ...row,
      readBy: row.readBy.filter((id) => known.has(id)),
    })),
    lastSpinDate: locks.length ? locks[locks.length - 1] : null,
  }
}
