/**
 * Tactile feedback.
 *
 * The Vibration API is Android-only in practice: iOS Safari has never
 * implemented navigator.vibrate, and no amount of feature-detection changes
 * that. So every call here is best-effort and silent — a phone that cannot
 * buzz simply does not, and nothing above this module needs to care.
 *
 * The patterns are deliberately short. A wheel that rattles your hand for five
 * seconds is unpleasant; what you want is the sense of detents ticking past
 * under the pointer, then one firmer note when it stops.
 */

const KEY = 'spin-catalog:haptics'

export const canVibrate = () =>
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

export function hapticsEnabled() {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setHapticsEnabled(on) {
  try {
    if (on) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, 'off')
  } catch { /* preference simply will not persist */ }
}

let muted = false
/** Used by the reduced-motion path, which should also mean reduced everything. */
export const setHapticsMuted = (v) => { muted = v }

function fire(pattern) {
  if (muted || !canVibrate() || !hapticsEnabled()) return false
  try {
    return navigator.vibrate(pattern)
  } catch {
    return false
  }
}

/** One detent passing the pointer. As short as the API will honour. */
export const tick = () => fire(8)

/** A control taking the press. */
export const tap = () => fire(12)

/** A checkbox or toggle changing state — two quick notes, not one. */
export const toggle = () => fire([10, 30, 14])

/** The wheel stopping: firmer, and clearly the end of the sequence. */
export const land = () => fire([26, 46, 18])

/** Something went wrong — a rejected code, an unreadable file. */
export const error = () => fire([40, 60, 40])

export const stop = () => fire(0)
