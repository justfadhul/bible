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
  ensurePair,
  createPair as rpcCreatePair,
  joinPair as rpcJoinPair,
  leavePair as rpcLeavePair,
  fetchRemoteState,
  fetchReaders,
  listPeople,
  addFriend as rpcAddFriend,
  removeFriend as rpcRemoveFriend,
  touchPresence,
  saveProfile,
  pushRemoteState,
  deleteRemoteReading,
  subscribeToPair,
  uploadAvatar,
} from '../lib/remote.js'
import { mergeStates } from '../lib/merge.js'

const PUSH_DEBOUNCE_MS = 900
/** Retry backoff for a write that failed: 2s, 4s, 8s… capped, and never given up on. */
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 30_000

export function useSync({ state, onMerged }) {
  const [session, setSession] = useState(null)
  // Read by callbacks that must not be rebuilt every time the session object
  // is replaced by a token refresh.
  const sessionRef = useRef(null)
  sessionRef.current = session
  const [pair, setPair] = useState(null)
  // Read by the write path, which must not go stale between renders.
  const pairRef = useRef(null)
  pairRef.current = pair
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
  /** Set when pair_readers() could not answer — almost always a missing 0002. */
  const [rosterError, setRosterError] = useState(null)
  /**
   * The other accounts, and where you stand with each. `null` until the first
   * answer, so the panel can tell "still loading" from "nobody else here yet" —
   * a distinction that matters on the one screen whose whole job is to say who
   * else exists.
   */
  const [people, setPeople] = useState(null)
  const [peopleError, setPeopleError] = useState(null)

  // The hook reads the newest state without re-subscribing on every keystroke.
  const stateRef = useRef(state)
  stateRef.current = state
  const mergedRef = useRef(onMerged)
  mergedRef.current = onMerged
  const pushTimer = useRef(null)
  const firstSync = useRef(true)
  /**
   * A local edit the database has not accepted yet.
   *
   * Every write used to be fire-and-forget: no pair meant the edit was dropped
   * on the floor, and a failed request meant the same with an error message
   * over it. Neither ever came back. So an edit now sets this flag and only
   * clears it when the server has taken it — which makes a failure something
   * to retry rather than something to lose.
   */
  const dirty = useRef(false)
  const attempts = useRef(0)
  const retryTimer = useRef(null)
  const flushing = useRef(false)
  const flushRef = useRef(null)

  /**
   * Try the outstanding write again, backing off: 2s, 4s, 8s… to half a
   * minute, and then every half minute for as long as it takes. There is no
   * attempt limit on purpose — the alternative to trying again is losing what
   * somebody read.
   */
  const retryLater = useCallback(() => {
    if (!dirty.current) return
    clearTimeout(retryTimer.current)
    const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempts.current++)
    retryTimer.current = setTimeout(() => flushRef.current?.(), wait)
  }, [])

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
  /**
   * Being signed in is enough to be saved.
   *
   * ensure_pair() hands back the group you are in, and makes you a private one
   * if you are in none — so there is somewhere to write from the moment you
   * have an account, rather than from the moment somebody gets round to
   * sharing a code. On a project that has not run migration 0003 this falls
   * back to the old lookup and can still answer null; the app keeps working
   * locally and Sharing says what is missing.
   */
  const loadPair = useCallback(async () => {
    if (!session) return null
    const p = await ensurePair()
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

  /* ── people ── */
  const refreshPeople = useCallback(async () => {
    if (!sessionRef.current) return null
    try {
      const list = await listPeople()
      setPeople(list)
      setPeopleError(null)
      return list
    } catch (e) {
      // Distinct from a sync error on purpose: the history can be syncing
      // perfectly while the panel is stuck on a migration nobody has run.
      setPeopleError(describe(e))
      setPeople((prev) => prev ?? [])
      return null
    }
  }, [])

  // Signing in is what makes there be people to see, and stamping that you are
  // about is the other half of the same moment.
  useEffect(() => {
    if (!session) {
      setPeople(null)
      setPeopleError(null)
      return
    }
    touchPresence().catch(() => {})
    refreshPeople()
  }, [session, refreshPeople])

  // Coming back to the app is the one moment worth re-reading it: somebody may
  // have asked for you while it was in your pocket.
  useEffect(() => {
    if (!session) return
    const onBack = () => {
      if (document.visibilityState !== 'visible') return
      touchPresence().catch(() => {})
      refreshPeople()
    }
    document.addEventListener('visibilitychange', onBack)
    window.addEventListener('focus', onBack)
    return () => {
      document.removeEventListener('visibilitychange', onBack)
      window.removeEventListener('focus', onBack)
    }
  }, [session, refreshPeople])

  /* ── pull → merge → push ── */
  const sync = useCallback(
    async (p = pair) => {
      if (!p) return
      try {
        setStatus('syncing')
        const remote = await fetchRemoteState(p)
        setRosterError(remote.rosterError ? describe(new Error(remote.rosterError)) : null)
        // On the very first sync after pairing, this device's reader names are
        // the ones the user just typed; after that the shared copy wins.
        const merged = mergeStates(stateRef.current, remote, { preferRemoteNames: !firstSync.current })
        firstSync.current = false
        mergedRef.current?.(merged)
        stateRef.current = merged
        await pushRemoteState(p, merged)
        // The merged copy contains whatever was waiting, so this settles it.
        dirty.current = false
        attempts.current = 0
        clearTimeout(retryTimer.current)
        setLastSyncedAt(Date.now())
        setError(null)
        setStatus('synced')
      } catch (e) {
        setError(describe(e))
        setStatus('error')
        // A sync that fails is also a push that failed, and there may be edits
        // riding on it that have never reached the server.
        retryLater()
      }
    },
    [pair, retryLater],
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
  /**
   * Sends whatever is outstanding, and keeps trying until it lands.
   *
   * Deliberately not tied to a particular edit: the state is a whole document,
   * so the newest copy supersedes every earlier one and a retry is always just
   * "push what we have now". That is also why a failure can back off politely
   * without a queue building up behind it.
   */
  const flush = useCallback(async () => {
    const p = pairRef.current
    if (!p || !dirty.current || flushing.current) return
    flushing.current = true
    clearTimeout(pushTimer.current)
    clearTimeout(retryTimer.current)
    retryTimer.current = null
    const sending = stateRef.current
    try {
      setStatus('syncing')
      await pushRemoteState(p, sending)
      // Only clear the flag if nothing was edited while this was in flight —
      // otherwise the newer copy would be marked saved without ever going.
      if (stateRef.current === sending) dirty.current = false
      attempts.current = 0
      setLastSyncedAt(Date.now())
      setError(null)
      setStatus('synced')
    } catch (e) {
      setError(describe(e))
      setStatus('error')
      retryLater()
    } finally {
      flushing.current = false
    }
    // Edited again mid-flight: send the newer copy rather than leaving it to
    // whatever happens to touch the app next.
    if (dirty.current && !retryTimer.current) {
      pushTimer.current = setTimeout(() => flush(), PUSH_DEBOUNCE_MS)
    }
  }, [retryLater])

  flushRef.current = flush

  const push = useCallback(
    (next) => {
      stateRef.current = next
      dirty.current = true
      clearTimeout(pushTimer.current)
      // With no pair yet the edit is not dropped, only held: the flag stays
      // raised, and the first sync after a pair appears carries it up.
      if (!pairRef.current) return
      pushTimer.current = setTimeout(() => flush(), PUSH_DEBOUNCE_MS)
    },
    [flush],
  )

  // A pair arriving carries held edits up by itself: the effect above runs a
  // full pull → merge → push, and the merge is a superset of anything waiting.
  // Flushing here as well would race it, and the loser would be a push of the
  // pre-merge copy — which is how somebody else's tick disappears for a while.

  /**
   * The phone going away is the likeliest moment to lose a write, and the
   * debounce is exactly the wrong thing to be waiting on then. Backgrounding
   * an app on iOS can freeze the tab within a beat of `hidden`, so that one
   * flushes immediately rather than on the next tick.
   */
  useEffect(() => {
    /**
     * Twice, deliberately. The card holding a half-typed note listens for the
     * same event and commits its draft, and DOM listeners run in registration
     * order — which re-registering puts us on either side of. The microtask
     * runs after every listener for this dispatch and still inside the same
     * turn, so whatever the card just committed goes with this flush rather
     * than waiting for a debounce that a frozen tab will never reach.
     */
    const leaving = () => {
      flush()
      queueMicrotask(() => flush())
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') leaving()
    }
    const onBack = () => {
      attempts.current = 0
      flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', leaving)
    window.addEventListener('online', onBack)
    window.addEventListener('focus', onBack)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', leaving)
      window.removeEventListener('online', onBack)
      window.removeEventListener('focus', onBack)
    }
  }, [flush])

  useEffect(
    () => () => {
      clearTimeout(pushTimer.current)
      clearTimeout(retryTimer.current)
    },
    [],
  )

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
    /**
     * Leaving a group is not leaving the app. The shared history stays with
     * the people still in it; you get a private store of your own back, and
     * this device's copy is pushed into it — so what you have read is still
     * saved, it is just no longer saved with them.
     */
    leavePair: async () => {
      if (pair) await rpcLeavePair(pair.pair_id)
      setPair(null)
      setStatus('connecting')
      firstSync.current = true
      dirty.current = true
      await loadPair()
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

    /* ── people ── */
    refreshPeople,
    /**
     * One gesture for asking and for answering, because from the tapping end
     * they are the same thing: this person and I should be connected. The
     * server works out which it was and says so, and the panel is refreshed
     * from the server rather than guessed at locally — the answer depends on
     * a row the other person may have written a second ago.
     */
    addFriend: async (userId) => {
      const outcome = await rpcAddFriend(userId)
      await refreshPeople()
      return outcome
    },
    removeFriend: async (userId) => {
      await rpcRemoveFriend(userId)
      await refreshPeople()
    },
  }

  return {
    enabled: remoteConfigured,
    ready,
    session,
    pair,
    status,
    error,
    notice,
    rosterError,
    people,
    peopleError,
    lastSyncedAt,
    push,
    ...actions,
  }
}

function describe(e) {
  const msg = e?.message ?? String(e)
  if (/Could not find the table/i.test(msg)) {
    return 'The database tables are missing — run supabase/migrations/0001_shared_history.sql in the SQL editor.'
  }
  if (/people|add_friend|remove_friend|friendships/i.test(msg)) {
    return 'The people list is not in the database yet — run supabase/migrations/0004_people_and_friends.sql in the SQL editor.'
  }
  if (/pair_readers|profiles|notes_by/i.test(msg)) {
    return 'The reader list cannot be read from the database — run supabase/migrations/0002_real_readers.sql in the SQL editor, then Sync now.'
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
