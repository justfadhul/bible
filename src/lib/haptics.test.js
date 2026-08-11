import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as haptics from './haptics.js'

/**
 * These exist because of a real bug: every pulse was dispatched correctly and
 * accepted by the browser, and none of them could be felt. `navigator.vibrate`
 * returning true says the request was well-formed, not that the phone moved —
 * a vibration motor needs roughly 15–20ms to spin up at all, so an 8ms detent
 * is a no-op with a success return value. The floor is the point of the test.
 */
const PERCEPTIBLE_MS = 15

const calls = []
const stubVibrate = () =>
  vi.stubGlobal('navigator', {
    vibrate: (p) => {
      calls.push(p)
      return true
    },
  })

beforeEach(() => {
  calls.length = 0
  vi.unstubAllGlobals()
  haptics.setHapticsMuted(false)
})

describe('pulse lengths', () => {
  it('every buzz is long enough to be felt', () => {
    stubVibrate()
    for (const play of [haptics.tick, haptics.tap, haptics.toggle, haptics.land, haptics.error]) {
      play()
    }
    expect(calls).toHaveLength(5)
    for (const pattern of calls) {
      // Even entries are the motor-on stretches; odd entries are the gaps.
      const on = Array.isArray(pattern) ? pattern.filter((_, i) => i % 2 === 0) : [pattern]
      for (const ms of on) expect(ms).toBeGreaterThanOrEqual(PERCEPTIBLE_MS)
    }
  })

  it('a detent is still short — it is a tick, not a rumble', () => {
    stubVibrate()
    haptics.tick()
    expect(calls[0]).toBeLessThan(30)
  })
})

describe('gates', () => {
  it('muting stops everything', () => {
    stubVibrate()
    haptics.setHapticsMuted(true)
    haptics.tick()
    haptics.land()
    expect(calls).toHaveLength(0)
  })

  it('test() fires even while muted, because that is what Test is for', () => {
    stubVibrate()
    haptics.setHapticsMuted(true)
    const { fired, mode } = haptics.test()
    expect(fired).toBe(true)
    expect(mode).toBe('vibrate')
    expect(calls).toHaveLength(1)
  })

  it('a thrown vibrate is swallowed rather than breaking the spin', () => {
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('denied')
      },
    })
    expect(() => haptics.tick()).not.toThrow()
    expect(haptics.tick()).toBe(false)
  })
})

describe('support', () => {
  it('is "vibrate" when the Vibration API exists', () => {
    stubVibrate()
    expect(haptics.support()).toBe('vibrate')
    expect(haptics.canVibrate()).toBe(true)
  })

  it('is "none" with no Vibration API and no iOS switch, and stays silent', () => {
    vi.stubGlobal('navigator', { userAgent: 'node', platform: 'Linux', maxTouchPoints: 0 })
    expect(haptics.support()).toBe('none')
    expect(haptics.canVibrate()).toBe(false)
    expect(haptics.tick()).toBe(false)
  })
})
