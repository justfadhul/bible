/**
 * Keeps the local history and the pair's shared history in step.
 *
 * The local copy stays authoritative for reads — the app never waits on the
 * network to show you today's passage. This hook watches for a session and a
 * pair, then does one pull → merge → push whenever it (re)connects or the
 * other reader's device changes something, and pushes on a short debounce
 * after local edits.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  remoteConfigured,
  currentSession,
  onAuthChange,
  sendMagicLink,
  signOut as remoteSignOut,
  myPair,
  createPair as rpcCreatePair,
  joinPair as rpcJoinPair,
  leavePair as rpcLeavePair,
  fetchRemoteState,
  pushRemoteState,
  deleteRemoteReading,
  subscribeToPair,
  uploadAvatar,
} from '../lib/remote.js'
import { mergeStates } from '../lib/merge.js'

const PUSH_DEBOUNCE_MS = 900

export function useSync({ state, onMerged }) {
  const [session, setSession] = useState(null)
  const [pair, setPair] = useState(null)
  const [status, setStatus] = useState(remoteConfigured ? 'connecting' : 'off')
  const [error, setError] = useState(null)
  const [lastSyncedAt, setLastSyncedAt] = useState(null)

  // The hook reads the newest state without re-subscribing on every keystroke.
  const stateRef = useRef(state)
  stateRef.current = state
  const mergedRef = useRef(onMerged)
  mergedRef.current = onMerged
  const pushTimer = useRef(null)
  const firstSync = useRef(true)

  /* ── session ── */
  useEffect(() => {
    if (!remoteConfigured) return
    let alive = true
    currentSession()
      .then((s) => {
        if (!alive) return
        setSession(s)
        setStatus(s ? 'connecting' : 'signed-out')
      })
      .catch(() => alive && setStatus('signed-out'))
    return onAuthChange((s) => {
      setSession(s)
      setPair(null)
      setStatus(s ? 'connecting' : 'signed-out')
      firstSync.current = true
    })
  }, [])

  /* ── pair ── */
  const loadPair = useCallback(async () => {
    if (!session) return null
    const p = await myPair()
    setPair(p)
    setStatus(p ? 'connecting' : 'no-pair')
    return p
  }, [session])

  useEffect(() => {
    if (!session) return
    loadPair().catch((e) => {
      setError(describe(e))
      setStatus('error')
    })
  }, [session, loadPair])

  /* ── pull → merge → push ── */
  const sync = useCallback(
    async (p = pair) => {
      if (!p) return
      try {
        setStatus('syncing')
        const remote = await fetchRemoteState(p)
        // On the very first sync after pairing, this device's reader names are
        // the ones the user just typed; after that the shared copy wins.
        const merged = mergeStates(stateRef.current, remote, { preferRemoteNames: !firstSync.current })
        firstSync.current = false
        mergedRef.current?.(merged)
        stateRef.current = merged
        await pushRemoteState(p, merged)
        setLastSyncedAt(Date.now())
        setError(null)
        setStatus('synced')
      } catch (e) {
        setError(describe(e))
        setStatus('error')
      }
    },
    [pair],
  )

  useEffect(() => {
    if (pair) sync(pair)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair?.pair_id])

  /* ── the other device ── */
  useEffect(() => {
    if (!pair) return
    return subscribeToPair(pair, () => sync(pair))
  }, [pair, sync])

  /* ── local edits ── */
  const push = useCallback(
    (next) => {
      stateRef.current = next
      if (!pair) return
      clearTimeout(pushTimer.current)
      pushTimer.current = setTimeout(() => {
        pushRemoteState(pair, next)
          .then(() => {
            setLastSyncedAt(Date.now())
            setError(null)
            setStatus('synced')
          })
          .catch((e) => {
            setError(describe(e))
            setStatus('error')
          })
      }, PUSH_DEBOUNCE_MS)
    },
    [pair],
  )

  useEffect(() => () => clearTimeout(pushTimer.current), [])

  /* ── actions ── */
  const actions = {
    sendLink: (email) => sendMagicLink(email),
    signOut: async () => {
      await remoteSignOut()
      setPair(null)
    },
    createPair: async (name) => {
      await rpcCreatePair(name)
      await loadPair()
    },
    joinPair: async (code, name) => {
      await rpcJoinPair(code, name)
      firstSync.current = false // the existing shared history wins on a join
      await loadPair()
    },
    leavePair: async () => {
      if (pair) await rpcLeavePair(pair.pair_id)
      setPair(null)
      setStatus('no-pair')
    },
    /** Undo has to delete remotely — a union merge cannot express a removal. */
    forget: async (entryId) => {
      if (!pair) return
      try {
        await deleteRemoteReading(pair, entryId)
      } catch (e) {
        setError(describe(e))
      }
    },
    resync: () => sync(),
    uploadAvatar: (blob, userId) => uploadAvatar(blob, userId),
  }

  return { enabled: remoteConfigured, session, pair, status, error, lastSyncedAt, push, ...actions }
}

function describe(e) {
  const msg = e?.message ?? String(e)
  if (/Could not find the table/i.test(msg)) {
    return 'The database tables are missing — run supabase/migrations/0001_shared_history.sql in the SQL editor.'
  }
  if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) {
    return 'Cannot reach Supabase. Your history is still saved on this device.'
  }
  // The message the function raised is the useful part; match on it rather
  // than the status, so an older migration still reads properly.
  if (/no group has that code|no pair with that code/i.test(msg)) {
    return 'No group has that code. Check it and try again.'
  }
  if (/already has eight readers|group is full/i.test(msg)) return 'That group already has eight readers.'
  if (/JWT|not signed in|sign in first/i.test(msg)) return 'That session has expired. Sign in again.'
  return msg
}

export { describe as describeSyncError }
