const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
const CHECK_MS = 15_000

/**
 * Call `onIdle` once after `ms` without user activity. Idle time is measured
 * by the wall clock, so time the device spent asleep or the tab spent in the
 * background counts too. Returns a function that stops watching.
 */
export function watchIdle(ms: number, onIdle: () => void, now: () => number = Date.now): () => void {
  let last = now()
  let done = false
  // Activity after the limit (the first mouse move after waking up) locks instead of extending.
  const touch = () => {
    check()
    if (!done) last = now()
  }
  const check = () => {
    if (done || now() - last < ms) return
    stop()
    onIdle()
  }
  // Coming back from sleep or another tab: check before anything is shown.
  const onVisible = () => {
    if (document.visibilityState === 'visible') check()
  }
  const timer = window.setInterval(check, Math.min(CHECK_MS, ms))
  ACTIVITY.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }))
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', check)
  window.addEventListener('pageshow', check)

  function stop() {
    done = true
    window.clearInterval(timer)
    ACTIVITY.forEach((e) => window.removeEventListener(e, touch, { capture: true }))
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', check)
    window.removeEventListener('pageshow', check)
  }
  return stop
}
