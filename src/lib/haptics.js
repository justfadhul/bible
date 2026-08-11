/**
 * Tactile feedback.
 *
 * There are exactly two ways a web page can make a phone buzz, and most phones
 * only have one of them:
 *
 *  1. `navigator.vibrate` — Android. Takes a duration or an on/off pattern in
 *     milliseconds. Silently absent on iOS; present but inert on desktop.
 *
 *  2. Safari's switch control — iOS 17.4 and later. Toggling an
 *     `<input type="checkbox" switch>` plays a system haptic, and on an iPhone
 *     it is the only haptic a web page can reach at all: Apple has never
 *     shipped the Vibration API and has given no sign of intending to. There
 *     is no duration and no pattern — every buzz is the same single impact —
 *     and it is a control being pulled sideways for its side effect, so it is
 *     best-effort and entirely silent when it does not work.
 *
 * Durations matter far more than they look. A phone's vibration motor needs
 * roughly 15–20 ms just to spin up enough to be felt, so the 8 ms detent this
 * module used to fire was dispatched correctly, accepted by the browser, and
 * produced nothing a hand could notice. Every pulse below is now above that
 * floor. That is the difference between "the API was called" and "the phone
 * buzzed", and only the second one is the feature.
 */

const KEY = 'spin-catalog:haptics'

/* ── what this device can do ───────────────────────────────────────────── */

const hasVibrate = () =>
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

/** iPadOS reports itself as a Mac, hence the touch-point half of this. */
const isIOS = () => {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

let switchSupport = null
const hasSwitch = () => {
  if (switchSupport === null) {
    switchSupport =
      typeof document !== 'undefined' && 'switch' in document.createElement('input')
  }
  return switchSupport
}

/**
 * 'vibrate' | 'switch' | 'none'. Checked live rather than cached — a desktop
 * browser resized into a phone emulator changes its mind about all of this,
 * and so does an iPhone across a Safari update.
 */
export function support() {
  if (hasVibrate()) return 'vibrate'
  if (isIOS() && hasSwitch()) return 'switch'
  return 'none'
}

/** Kept for call sites that only care whether anything at all is possible. */
export const canVibrate = () => support() !== 'none'

/* ── preference ────────────────────────────────────────────────────────── */

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

/* ── the iOS fallback ──────────────────────────────────────────────────── */

/**
 * One hidden switch, reused. It has to be genuinely rendered — a `display:none`
 * control does not fire the haptic — so it is parked off-screen instead, out of
 * the tab order and out of the accessibility tree.
 */
let switchLabel = null
function switchControl() {
  if (switchLabel?.isConnected) return switchLabel
  const label = document.createElement('label')
  label.setAttribute('aria-hidden', 'true')
  label.style.cssText =
    'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('switch', '')
  input.tabIndex = -1
  label.appendChild(input)
  document.body.appendChild(label)
  switchLabel = label
  return label
}

/** Two impacts closer together than this are a rattle, not a pattern. */
const SWITCH_GAP_MS = 90
let lastSwitchAt = -Infinity

function fireSwitch(impacts) {
  if (impacts < 1 || typeof document === 'undefined') return false
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  if (now - lastSwitchAt < SWITCH_GAP_MS) return false
  lastSwitchAt = now
  try {
    switchControl().click()
    for (let i = 1; i < impacts; i++) {
      setTimeout(() => {
        try {
          lastSwitchAt = performance.now()
          switchControl().click()
        } catch { /* the wheel does not stop for a missing buzz */ }
      }, i * 110)
    }
    return true
  } catch {
    return false
  }
}

/* ── delivery ──────────────────────────────────────────────────────────── */

/**
 * A pattern is [on, off, on, …] milliseconds, so the number of impacts an
 * iPhone should feel is every other entry.
 */
const impactsIn = (pattern) =>
  Array.isArray(pattern) ? Math.ceil(pattern.length / 2) : pattern > 0 ? 1 : 0

function deliver(pattern) {
  switch (support()) {
    case 'vibrate':
      try {
        return navigator.vibrate(pattern)
      } catch {
        return false
      }
    case 'switch':
      return fireSwitch(impactsIn(pattern))
    default:
      return false
  }
}

function fire(pattern) {
  if (muted || !hapticsEnabled()) return false
  return deliver(pattern)
}

/* ── the vocabulary ────────────────────────────────────────────────────── */

/** One detent passing the pointer. Short, but past the motor's spin-up. */
export const tick = () => fire(18)

/** A control taking the press. */
export const tap = () => fire(22)

/** A checkbox or toggle changing state — two quick notes, not one. */
export const toggle = () => fire([16, 40, 24])

/** The wheel stopping: firmer, and clearly the end of the sequence. */
export const land = () => fire([34, 55, 30])

/** Something went wrong — a rejected code, an unreadable file. */
export const error = () => fire([45, 70, 45])

export const stop = () => fire(0)

/**
 * Settings' Test button. Bypasses both the mute and the stored preference,
 * because someone pressing Test wants to find out what this phone does, not
 * to be told what it was last set to. Returns what was attempted so the UI
 * can say something specific rather than leaving the reader guessing.
 */
export function test() {
  const wasMuted = muted
  muted = false
  const fired = deliver([40, 80, 40, 80, 60])
  muted = wasMuted
  return { mode: support(), fired: Boolean(fired) }
}
