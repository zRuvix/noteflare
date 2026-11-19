import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchIdle } from '../src/lib/idleLock'

const LIMIT = 60_000
let clock = 0
const now = () => clock

beforeEach(() => {
  vi.useFakeTimers()
  clock = 0
  const win = Object.assign(new EventTarget(), { setInterval, clearInterval })
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const tick = (ms: number) => {
  clock += ms
  vi.advanceTimersByTime(ms)
}

describe('auto-lock when idle', () => {
  it('locks once after the limit without activity', () => {
    const onIdle = vi.fn()
    watchIdle(LIMIT, onIdle, now)
    tick(LIMIT - 1)
    expect(onIdle).not.toHaveBeenCalled()
    tick(LIMIT)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('activity keeps it unlocked', () => {
    const onIdle = vi.fn()
    watchIdle(LIMIT, onIdle, now)
    for (let i = 0; i < 5; i++) {
      tick(LIMIT / 2)
      window.dispatchEvent(new Event('keydown'))
    }
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('counts time asleep: the first input after waking locks instead of extending', () => {
    const onIdle = vi.fn()
    watchIdle(LIMIT, onIdle, now)
    clock += 3 * LIMIT // asleep: the clock moves, timers don't fire
    window.dispatchEvent(new Event('pointermove'))
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('checks when the tab comes back to the front', () => {
    const onIdle = vi.fn()
    watchIdle(LIMIT, onIdle, now)
    clock += 2 * LIMIT
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('stops watching when cancelled', () => {
    const onIdle = vi.fn()
    watchIdle(LIMIT, onIdle, now)()
    tick(2 * LIMIT)
    expect(onIdle).not.toHaveBeenCalled()
  })
})
