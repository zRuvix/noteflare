import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liveMessage, notifyLive } from '../worker/live'
import { startLiveSync } from '../src/lib/sync/live'

describe('liveMessage', () => {
  it('carries only id and version', () => {
    const extra = { id: 'a', version: 3, ciphertext: 'secret', title: 'My note' }
    const msg = liveMessage([extra])
    expect(JSON.parse(msg)).toEqual({ type: 'changed', notes: [{ id: 'a', version: 3 }] })
    expect(msg).not.toContain('secret')
    expect(msg).not.toContain('My note')
  })
})

describe('notifyLive', () => {
  const fake = () => {
    const fetch = vi.fn(async (..._a: unknown[]) => new Response(null, { status: 204 }))
    const ns = { idFromName: vi.fn((n: string) => n), get: vi.fn(() => ({ fetch })) }
    return { ns: ns as unknown as DurableObjectNamespace, fetch, idFromName: ns.idFromName }
  }

  it('does nothing without the binding or changes', () => {
    const ctx = { waitUntil: vi.fn() }
    notifyLive({}, ctx, 'u@x.com', [{ id: 'a', version: 1 }])
    const { ns } = fake()
    notifyLive({ LIVE: ns }, ctx, 'u@x.com', [])
    expect(ctx.waitUntil).not.toHaveBeenCalled()
  })

  it("posts the message to the user's own object", () => {
    const ctx = { waitUntil: vi.fn() }
    const { ns, fetch, idFromName } = fake()
    notifyLive({ LIVE: ns }, ctx, 'u@x.com', [{ id: 'a', version: 2 }])
    expect(idFromName).toHaveBeenCalledWith('u@x.com')
    expect(fetch).toHaveBeenCalledWith('https://live/notify', { method: 'POST', body: liveMessage([{ id: 'a', version: 2 }]) })
    expect(ctx.waitUntil).toHaveBeenCalledOnce()
  })
})

describe('startLiveSync', () => {
  class FakeSocket {
    static all: FakeSocket[] = []
    onopen: (() => void) | null = null
    onmessage: ((e: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    close = vi.fn(() => this.onclose?.())
    send = vi.fn()
    constructor(public url: string) {
      FakeSocket.all.push(this)
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.all = []
    const target = new EventTarget()
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('window', target)
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('location', { protocol: 'https:', host: 'notes.example.com' })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('pulls once, debounced, when a change arrives', () => {
    const onChange = vi.fn()
    const stop = startLiveSync(onChange)
    const sock = FakeSocket.all[0]
    expect(sock.url).toBe('wss://notes.example.com/api/live')
    sock.onopen?.()
    sock.onmessage?.({ data: JSON.stringify({ type: 'changed', notes: [] }) })
    sock.onmessage?.({ data: JSON.stringify({ type: 'changed', notes: [] }) })
    sock.onmessage?.({ data: 'pong' })
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(onChange).toHaveBeenCalledOnce()
    stop()
  })

  it('reconnects after a close, with a backoff', () => {
    const stop = startLiveSync(vi.fn())
    FakeSocket.all[0].onclose?.()
    expect(FakeSocket.all).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(2)
    FakeSocket.all[1].onclose?.()
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(2)
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(3)
    stop()
  })

  it('stop closes the socket and does not reconnect', () => {
    const stop = startLiveSync(vi.fn())
    const sock = FakeSocket.all[0]
    stop()
    expect(sock.close).toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.all).toHaveLength(1)
  })
})
