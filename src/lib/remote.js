/**
 * ─────────────────────────────────────────────────────────────────────────
 *  The shared store — Supabase.
 *
 *  This is the module storage.js always pointed at: the same state shape,
 *  fetched from and pushed to a table instead of localStorage. Nothing else
 *  in the app talks to Supabase.
 *
 *  Local storage is still the primary. The app reads and writes locally and
 *  stays fully usable signed out, offline, or with the project unreachable;
 *  the remote is a second copy that gets merged in when a session exists.
 *  That ordering matters — a reading app that cannot open its own history
 *  because the network is down has failed at the only thing it does.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { createClient } from '@supabase/supabase-js'
import { emptyState, normalizeState } from './storage.js'
import { isISODate } from './date.js'

const URL = import.meta.env?.VITE_SUPABASE_URL
const ANON = import.meta.env?.VITE_SUPABASE_ANON_KEY

/** False when no project is configured — the app then runs local-only. */
export const remoteConfigured = Boolean(URL && ANON)

export const supabase = remoteConfigured
  ? createClient(URL, ANON, {
      // detectSessionInUrl stays on even though sign-in is by code now: any
      // link already sitting in someone's inbox should still work.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

/* ── auth ──────────────────────────────────────────────────────────────── */

/**
 * ── Sign-in is by email and password ───────────────────────────────────────
 *
 * The six-digit code did not go away; it stopped being the front door and
 * became the two things a password account genuinely needs an email for:
 * proving the address is real, and getting back in after forgetting it.
 * Neither of those is a link, so none of the link problems come back — no
 * redirect allow-list, no wrong-device opens, no token spent by a mail
 * scanner following it first.
 */

const need = () => {
  if (!supabase) throw new Error('No Supabase project is configured.')
}

/**
 * Creates the account.
 *
 * Whether a session comes back depends on one project setting. With "Confirm
 * email" off, Supabase hands over a session immediately. With it on — which is
 * the default, and the safer choice — it returns a user and no session until
 * the address is proved, so the caller is told to go and collect a code. Both
 * are normal, so this reports which happened rather than treating one as a
 * failure.
 */
export async function signUp(email, password) {
  need()
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
  if (error) throw error
  return { session: data.session ?? null, needsConfirmation: !data.session }
}

export async function signIn(email, password) {
  need()
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw error
  return data.session ?? null
}

/**
 * Emails a six-digit code — for confirming a new address, or for getting back
 * into an account whose password is gone.
 *
 * `shouldCreateUser` is false because both callers already know the address
 * should exist. Left true, a typo in the forgotten-password box would quietly
 * mint a second empty account and send a code to it, and the resulting "it let
 * me in but my history is gone" is a genuinely horrible thing to debug.
 *
 * The digits only arrive if the project's email templates render
 * `{{ .Token }}`; see AUTH.md.
 */
export async function sendCode(email, { createUser = false } = {}) {
  need()
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: createUser },
  })
  if (error) throw error
}

/**
 * Exchanges the code for a session.
 *
 * A first-time address is confirmed by a signup token and a returning one by a
 * magiclink token. `email` is the type meant to cover both, but a project can
 * be configured such that it does not, and to the person typing, a rejected
 * type and a mistyped code look exactly the same. So on the one error that
 * could be either, try the other type before telling anyone their code is
 * wrong.
 */
export async function verifyCode(email, token) {
  need()
  const clean = String(token).replace(/\D/g, '')
  const attempt = (type) => supabase.auth.verifyOtp({ email: email.trim(), token: clean, type })

  let { data, error } = await attempt('email')
  if (error && /expired|invalid/i.test(error.message ?? '')) {
    ;({ data, error } = await attempt('signup'))
  }
  if (error) throw error
  return data?.session ?? null
}

/** Sets a password on the session the code just produced. */
export async function updatePassword(password) {
  need()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

export async function signOut() {
  await supabase?.auth.signOut()
}

export function onAuthChange(fn) {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, session) => fn(session ?? null))
  return () => data.subscription.unsubscribe()
}

export async function currentSession() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session ?? null
}

/* ── pairing ───────────────────────────────────────────────────────────── */

export async function myPair() {
  const { data, error } = await supabase.rpc('my_pair')
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ?? null
}

/** PostgREST's "that function is not in the schema cache" — an unrun migration. */
const isMissingFunction = (e) =>
  e?.code === 'PGRST202' || /Could not find the function|schema cache/i.test(e?.message ?? '')

/**
 * The pair to read and write, creating a private one if there is none.
 *
 * This is what makes signing in enough to be saved. Before it, the database
 * only held a reading if you had created or joined a group, so an account on
 * its own was an account with nowhere to write — and everything stayed on one
 * phone while the app looked, in every respect, like it was syncing.
 *
 * A project that has not run migration 0003 has no ensure_pair(), and falls
 * back to the old read-only lookup rather than failing to sign in. Progress
 * then still only saves inside a group, which is exactly what it did before;
 * Settings → Sharing says which migration is missing.
 */
export async function ensurePair() {
  need()
  const { data, error } = await supabase.rpc('ensure_pair')
  if (error) {
    if (isMissingFunction(error)) return myPair()
    throw error
  }
  const row = Array.isArray(data) ? data[0] : data
  return row ?? null
}

export async function createPair(name) {
  const { data, error } = await supabase.rpc('create_pair', { p_name: name ?? null })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row
}

export async function joinPair(code, name) {
  const { data, error } = await supabase.rpc('join_pair', {
    p_code: code,
    p_name: name ?? null,
  })
  if (error) throw error
  return data
}

export async function leavePair(pairId) {
  const { error } = await supabase.from('pair_members').delete().eq('pair_id', pairId)
  if (error) throw error
}

/* ── the roster ────────────────────────────────────────────────────────── */

/**
 * Who is actually in this group, from the database.
 *
 * This replaces reading the roster out of `pairs.readers`, a jsonb document
 * every client rewrote wholesale. Two things were wrong with that. Somebody
 * who joined but had not opened the app yet was invisible to everyone, because
 * nothing had written their row — and anybody in the group could overwrite
 * anybody else's name, because it was all one document.
 *
 * Membership is already a table. So the roster is a query now: real accounts,
 * each carrying the name and photo only its owner can set.
 */
export async function fetchReaders() {
  need()
  const { data, error } = await supabase.rpc('pair_readers')
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.user_id,
    userId: r.user_id,
    name: typeof r.display_name === 'string' ? r.display_name : '',
    avatarUrl: typeof r.avatar_url === 'string' ? r.avatar_url : null,
    email: r.email ?? null,
  }))
}

/** Your own name and photo. The policy makes "your own" literal. */
export async function saveProfile({ userId, name, avatarUrl }) {
  need()
  if (!userId) return
  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, display_name: name ?? '', avatar_url: avatarUrl ?? null }, { onConflict: 'user_id' })
  if (error) throw error
}

/* ── state ─────────────────────────────────────────────────────────────── */

const asNotesBy = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out = {}
  for (const [k, text] of Object.entries(v)) {
    if (typeof k === 'string' && typeof text === 'string' && text) out[k] = text
  }
  return out
}

const rowToReading = (r) => ({
  id: r.entry_id,
  dateISO: isISODate(r.date_iso) ? r.date_iso : null,
  notes: typeof r.notes === 'string' ? r.notes : '',
  notesBy: asNotesBy(r.notes_by),
  readBy: Array.isArray(r.read_by) ? r.read_by.filter((x) => typeof x === 'string') : [],
  updatedAt: r.updated_at ?? null,
})

/**
 * Pulls the pair's whole history into the app's own state shape.
 *
 * The roster comes from pair_readers(); the readings come from the table. If
 * the roster query fails — an older project that has not run migration 0002 —
 * the readings still arrive and `readers` is null, which tells the caller to
 * leave the roster it already has alone rather than emptying it.
 */
export async function fetchRemoteState(pair) {
  const { data, error } = await supabase
    .from('readings')
    .select('entry_id,date_iso,notes,notes_by,read_by,updated_at')
    .eq('pair_id', pair.pair_id)
  if (error) throw error

  let readers = null
  let rosterError = null
  try {
    readers = await fetchReaders()
  } catch (e) {
    // Never lose a pull over the roster — but do not swallow the reason
    // either. Without migration 0002 this fails every time, and the symptom
    // is somebody who joined the group simply never appearing.
    rosterError = e?.message ?? String(e)
  }

  const { state } = normalizeState({
    version: emptyState().version,
    readers: readers ?? [],
    completed: [],
    lastSpinDate: pair.last_spin_date,
  })

  return {
    ...state,
    readers: readers ? state.readers : null,
    // Tells the merge this roster is the database's answer, not another
    // device's opinion — so it replaces rather than unions.
    fromServer: Boolean(readers),
    rosterError,
    completed: (data ?? []).map(rowToReading),
  }
}

/** Upserts readings and the pair's own fields. Chunked so a long history
 *  does not become one oversized request. */
export async function pushRemoteState(pair, state) {
  const rows = state.completed.map((r) => ({
    pair_id: pair.pair_id,
    entry_id: r.id,
    date_iso: r.dateISO,
    notes: r.notes ?? '',
    notes_by: r.notesBy ?? {},
    read_by: r.readBy ?? [],
  }))

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from('readings')
      .upsert(rows.slice(i, i + 200), { onConflict: 'pair_id,entry_id' })
    if (error) throw error
  }

  // pairs.readers is deliberately no longer written: the roster is
  // pair_members joined to profiles, and each person owns their own row there.
  // Pushing a whole roster from one device is what let a stale phone rename
  // somebody else.
  const { error } = await supabase
    .from('pairs')
    .update({ last_spin_date: state.lastSpinDate })
    .eq('id', pair.pair_id)
  if (error) throw error
}

/** Removes an entry from the shared history — the undo path. */
export async function deleteRemoteReading(pair, entryId) {
  const { error } = await supabase
    .from('readings')
    .delete()
    .eq('pair_id', pair.pair_id)
    .eq('entry_id', entryId)
  if (error) throw error
}

/* ── avatars ───────────────────────────────────────────────────────────── */

/**
 * Uploads a prepared avatar and returns its public URL.
 *
 * The path is namespaced by user id because the storage policy only lets you
 * write inside your own folder — so a reader can replace their own picture and
 * nobody else's. The filename changes each time to sidestep CDN caching, which
 * otherwise leaves the old photo on the other person's phone for hours.
 */
export async function uploadAvatar(blob, userId) {
  if (!supabase) throw new Error('No Supabase project is configured.')
  if (!userId) throw new Error('Sign in to upload a photo.')
  const path = `${userId}/avatar-${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' })
  if (error) throw error
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return data.publicUrl
}

/** Live updates from the other reader's device. Returns an unsubscribe fn. */
export function subscribeToPair(pair, onChange) {
  if (!supabase) return () => {}
  const channel = supabase
    .channel(`pair:${pair.pair_id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'readings', filter: `pair_id=eq.${pair.pair_id}` },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pairs', filter: `id=eq.${pair.pair_id}` },
      onChange,
    )
    // Unfiltered: the policy already limits what arrives to people you share a
    // group with, and a name change is worth reflecting straight away.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}
