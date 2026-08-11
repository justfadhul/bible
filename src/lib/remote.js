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
 * Emails a six-digit code.
 *
 * Supabase mints that code for every passwordless sign-in whether or not
 * anything displays it — the link and the code are two renderings of the same
 * token. Which one arrives is decided entirely by the project's email
 * templates, which must contain `{{ .Token }}`; see AUTH.md.
 *
 * There is deliberately no `emailRedirectTo`, because there is nowhere to
 * redirect to. That is most of the point: a code cannot be opened on the wrong
 * device, cannot land on a preview deployment instead of the real one, cannot
 * be burned by a corporate link scanner following it first, and needs no
 * allow-list of redirect URLs to be kept in step with every new domain.
 */
export async function sendCode(email) {
  if (!supabase) throw new Error('No Supabase project is configured.')
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  })
  if (error) throw error
}

/**
 * Exchanges the code for a session.
 *
 * A first-time address is confirmed by a signup token and a returning one by a
 * magiclink token. `email` is the type that covers both, but a project can be
 * configured such that it does not, and to the person typing, a rejected type
 * and a mistyped code look exactly the same. So on the one error that could be
 * either, try the other type before telling anyone their code is wrong.
 */
export async function verifyCode(email, token) {
  if (!supabase) throw new Error('No Supabase project is configured.')
  const clean = String(token).replace(/\D/g, '')
  const attempt = (type) => supabase.auth.verifyOtp({ email: email.trim(), token: clean, type })

  let { data, error } = await attempt('email')
  if (error && /expired|invalid/i.test(error.message ?? '')) {
    ;({ data, error } = await attempt('signup'))
  }
  if (error) throw error
  return data?.session ?? null
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

/* ── state ─────────────────────────────────────────────────────────────── */

const rowToReading = (r) => ({
  id: r.entry_id,
  dateISO: isISODate(r.date_iso) ? r.date_iso : null,
  notes: typeof r.notes === 'string' ? r.notes : '',
  readBy: Array.isArray(r.read_by) ? r.read_by.filter((x) => typeof x === 'string') : [],
  updatedAt: r.updated_at ?? null,
})

/** Pulls the pair's whole history into the app's own state shape. */
export async function fetchRemoteState(pair) {
  const { data, error } = await supabase
    .from('readings')
    .select('entry_id,date_iso,notes,read_by,updated_at')
    .eq('pair_id', pair.pair_id)
  if (error) throw error

  // The roster arrives as whatever was last written, so it goes through the
  // same guard as a file import rather than being trusted.
  const { state } = normalizeState({
    version: emptyState().version,
    readers: Array.isArray(pair.readers) ? pair.readers : [],
    completed: [],
    lastSpinDate: pair.last_spin_date,
  })

  return {
    ...state,
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
    read_by: r.readBy ?? [],
  }))

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from('readings')
      .upsert(rows.slice(i, i + 200), { onConflict: 'pair_id,entry_id' })
    if (error) throw error
  }

  const { error } = await supabase
    .from('pairs')
    .update({ last_spin_date: state.lastSpinDate, readers: state.readers })
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
    .subscribe()
  return () => supabase.removeChannel(channel)
}
