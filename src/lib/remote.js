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
import { emptyState, DEFAULT_READER_NAMES } from './storage.js'
import { isISODate } from './date.js'

const URL = import.meta.env?.VITE_SUPABASE_URL
const ANON = import.meta.env?.VITE_SUPABASE_ANON_KEY

/** False when no project is configured — the app then runs local-only. */
export const remoteConfigured = Boolean(URL && ANON)

export const supabase = remoteConfigured
  ? createClient(URL, ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

/* ── auth ──────────────────────────────────────────────────────────────── */

/**
 * Sends a magic link. `emailRedirectTo` is the page the link returns to, so
 * the session lands back in this app rather than on Supabase's own page.
 */
export async function sendMagicLink(email) {
  if (!supabase) throw new Error('No Supabase project is configured.')
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  })
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
  readBy: { a: r.read_by_a === true, b: r.read_by_b === true },
  updatedAt: r.updated_at ?? null,
})

/** Pulls the pair's whole history into the app's own state shape. */
export async function fetchRemoteState(pair) {
  const { data, error } = await supabase
    .from('readings')
    .select('entry_id,date_iso,notes,read_by_a,read_by_b,updated_at')
    .eq('pair_id', pair.pair_id)
  if (error) throw error

  return {
    ...emptyState(),
    completed: (data ?? []).map(rowToReading),
    lastSpinDate: isISODate(pair.last_spin_date) ? pair.last_spin_date : null,
    readerNames: {
      a: pair.reader_name_a || DEFAULT_READER_NAMES.a,
      b: pair.reader_name_b || DEFAULT_READER_NAMES.b,
    },
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
    read_by_a: !!r.readBy?.a,
    read_by_b: !!r.readBy?.b,
  }))

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from('readings')
      .upsert(rows.slice(i, i + 200), { onConflict: 'pair_id,entry_id' })
    if (error) throw error
  }

  const { error } = await supabase
    .from('pairs')
    .update({
      last_spin_date: state.lastSpinDate,
      reader_name_a: state.readerNames.a,
      reader_name_b: state.readerNames.b,
    })
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
