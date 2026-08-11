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
    readBy: {
      a: !!local.readBy?.a || !!remote.readBy?.a,
      b: !!local.readBy?.b || !!remote.readBy?.b,
    },
  }
}

/**
 * Merges a local state and a remote state into one.
 * `preferRemoteNames` picks whose reader names win, since those are a pair-level
 * setting rather than per-row: the remote is the shared truth.
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
  const names = preferRemoteNames ? remote.readerNames : local.readerNames

  return {
    version: local.version,
    completed: completed.map(({ updatedAt, ...row }) => row),
    lastSpinDate: locks.length ? locks[locks.length - 1] : null,
    readerNames: { ...(names ?? local.readerNames) },
  }
}
