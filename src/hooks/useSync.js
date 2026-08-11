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
  signUp as remoteSignUp,
  signIn as remoteSignIn,
  sendCode,
  verifyCode,
  updatePassword,
  signOut as remoteSignOut,
  myPair,
  createPair as rpcCreatePair,
  joinPair as rpcJoinPair,
  leavePair as rpcLeavePair,
  fetchRemoteState,
  fetchReaders,
  saveProfile,
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
  /**
   * False until we know whether there is a session. Reading a stored session
   * means a round trip through storage and, if the token is stale, a refresh
   * over the network — so for a beat on every load, `session` is null for a
   * signed-in person exactly as it is for a signed-out one. Without this flag
   * the app cannot tell those apart, and a returning reader gets a flash of
   * the sign-in page before their own history appears.
   */
  const [ready, setReady] = useState(!remoteConfigured)
  /**
   * A one-line confirmation that has to outlive the component that raised it.
   * Setting a new password signs you in, which unmounts the form mid-action —
   * so the news that it worked cannot live in that form's own state.
   */
  const [notice, setNotice] = useState(null)

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
      // Ready either way: a session that cannot be read is a signed-out one,
      // and nobody should be held at a splash screen over it.
      .finally(() => alive && setReady(true))
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
    signUp: (email, password) => remoteSignUp(email, password),
    signIn: (email, password) => remoteSignIn(email, password),
    sendCode: (email, opts) => sendCode(email, opts),
    verifyCode: (email, token) => verifyCode(email, token),
    setPassword: (password) => updatePassword(password),
    notify: (text) => setNotice(text),
    dismissNotice: () => setNotice(null),
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
    /**
     * Publishes your own name and photo, so the others see them. Failure is
     * swallowed on purpose: the local copy is already saved, and a reader who
     * renamed themselves on a train should not be shown an error about it.
     */
    saveProfile: async (patch) => {
      if (!session?.user?.id) return
      try {
        await saveProfile({ userId: session.user.id, ...patch })
      } catch (e) {
        setError(describe(e))
      }
    },
    /** Just the roster — used when a profile changes but the history has not. */
    refreshReaders: async () => {
      if (!pair) return null
      try {
        return await fetchReaders()
      } catch {
        return null
      }
    },
  }

  return { enabled: remoteConfigured, ready, session, pair, status, error, notice, lastSyncedAt, push, ...actions }
}

function describe(e) {
  const msg = e?.message ?? String(e)
  if (/Could not find the table/i.test(msg)) {
    return 'The database tables are missing — run supabase/migrations/0001_shared_history.sql in the SQL editor.'
  }
  if (/pair_readers|profiles|notes_by/i.test(msg) && /could not find|does not exist|schema cache/i.test(msg)) {
    return 'The readers table is missing — run supabase/migrations/0002_real_readers.sql in the SQL editor.'
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
  // The code path, where the wording Supabase sends is too internal to show.
  if (/token has expired|otp.*expired|expired or is invalid/i.test(msg)) {
    return 'That code is wrong, or it has expired. Ask for a new one.'
  }
  if (/only request this after|rate limit|too many requests/i.test(msg)) {
    return 'Too many attempts just now. Wait a minute and try again.'
  }
  if (/signups not allowed|signup is disabled/i.test(msg)) {
    return 'That address has no account yet, and new sign-ups are turned off for this project.'
  }
  /* ── password ── */
  // Supabase deliberately will not say which half was wrong, so neither can
  // we. What it can do is name the one case people cannot guess: an account
  // made before passwords existed here has no password to be wrong.
  if (/invalid login credentials|invalid credentials/i.test(msg)) {
    return 'That email and password do not match. If you have never set a password, use “Forgot password”.'
  }
  if (/user already registered|already been registered/i.test(msg)) {
    return 'That address already has an account. Sign in instead.'
  }
  if (/email not confirmed|not confirmed/i.test(msg)) {
    return 'That address has not been confirmed yet. Ask for a code and enter it.'
  }
  if (/password should be at least|password.*too short|weak password/i.test(msg)) {
    return 'That password is too short. Use at least 8 characters.'
  }
  if (/same.*(as the )?old password|new password should be different/i.test(msg)) {
    return 'That is the password you already had. Choose a different one.'
  }
  if (/unable to validate email|invalid email/i.test(msg)) return 'That does not look like an email address.'
  if (/JWT|not signed in|sign in first/i.test(msg)) return 'That session has expired. Sign in again.'
  return msg
}

export { describe as describeSyncError }
