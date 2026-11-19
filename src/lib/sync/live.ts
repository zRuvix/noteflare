const DEBOUNCE_MS = 300
const PING_MS = 50_000
const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 30_000

/**
 * Keeps a WebSocket to /api/live open and calls `onChange` (debounced) when another device
 * changed a note. The polling timer stays the fallback while the socket is down.
 * Returns a function that stops everything.
 */
export function startLiveSync(onChange: () => void): () => void {
  let ws: WebSocket | null = null
  let stopped = false
  let backoff = BACKOFF_MIN_MS
  let wasDown = false // changes may have been missed while the socket was closed
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let pingTimer: ReturnType<typeof setInterval> | undefined

  const clearPing = () => {
    clearInterval(pingTimer)
    pingTimer = undefined
  }

  const schedulePull = () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(onChange, DEBOUNCE_MS)
  }

  const canConnect = () => navigator.onLine !== false && document.visibilityState !== 'hidden'

  const connect = () => {
    if (stopped || ws || !canConnect()) return
    const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`)
    ws = sock
    sock.onopen = () => {
      backoff = BACKOFF_MIN_MS
      if (wasDown) schedulePull()
      wasDown = false
      clearPing()
      pingTimer = setInterval(() => {
        try {
          sock.send('ping')
        } catch {
          // closing
        }
      }, PING_MS)
    }
    sock.onmessage = (e) => {
      let msg: unknown
      try {
        msg = JSON.parse(String(e.data))
      } catch {
        return
      }
      if ((msg as { type?: unknown } | null)?.type !== 'changed') return
      schedulePull()
    }
    sock.onclose = () => {
      if (ws !== sock) return
      ws = null
      wasDown = true
      clearPing()
      if (stopped) return
      // Offline or hidden: the online / visibility handlers call connect again.
      if (!canConnect()) return
      reconnectTimer = setTimeout(connect, backoff)
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
    }
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') connect()
  }
  window.addEventListener('online', connect)
  document.addEventListener('visibilitychange', onVisible)
  connect()

  return () => {
    stopped = true
    clearTimeout(reconnectTimer)
    clearTimeout(debounceTimer)
    clearPing()
    window.removeEventListener('online', connect)
    document.removeEventListener('visibilitychange', onVisible)
    const sock = ws
    ws = null
    sock?.close()
  }
}
