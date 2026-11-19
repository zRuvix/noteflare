import { describe, expect, it, vi } from 'vitest'
import worker from '../worker/index'
import type { RateLimiter } from '../worker/rateLimit'

// Only exists inside the Workers runtime.
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }))

/** A D1 stand-in where every lookup finds nothing (no settings, no tokens). */
const emptyDb = () => {
  const stmt = { bind: () => stmt, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }
  return { prepare: () => stmt }
}

/** Lets `allowed` requests through per key, then refuses. */
const limiter = (allowed: number) => {
  const seen = new Map<string, number>()
  return {
    keys: seen,
    async limit({ key }: { key: string }) {
      seen.set(key, (seen.get(key) ?? 0) + 1)
      return { success: seen.get(key)! <= allowed }
    },
  } satisfies RateLimiter & { keys: Map<string, number> }
}

const env = (extra: object = {}) =>
  ({ ACCESS_TEAM_DOMAIN: 'todo', ACCESS_AUD: 'todo', DB: emptyDb(), ...extra }) as never
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never
const tokenCall = (e: never, ip = '203.0.113.7') =>
  worker.fetch(
    new Request('https://notes.example.com/api/v1/notes', {
      headers: { Authorization: 'Bearer nf_guess', 'CF-Connecting-IP': ip },
    }) as never,
    e,
    ctx,
  )
const setupCall = (e: never) =>
  worker.fetch(
    new Request('https://notes.example.com/api/setup', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
    }) as never,
    e,
    ctx,
  )

describe('rate limits', () => {
  it('answers 429 with Retry-After once a client is over the token limit, per IP', async () => {
    const l = limiter(2)
    const e = env({ TOKEN_LIMITER: l })
    expect((await tokenCall(e)).status).toBe(401)
    expect((await tokenCall(e)).status).toBe(401)
    const res = await tokenCall(e)
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await res.json()).toMatchObject({ error: 'rate_limited' })
    expect((await tokenCall(e, '198.51.100.1')).status).toBe(401)
  })

  it('limits the first-run setup', async () => {
    const e = env({ SETUP_LIMITER: limiter(1) })
    expect((await setupCall(e)).status).toBe(400)
    expect((await setupCall(e)).status).toBe(429)
  })

  it('passes everything through without the bindings, or when a binding fails', async () => {
    const broken = { limit: async () => { throw new Error('down') } }
    for (const e of [env(), env({ TOKEN_LIMITER: broken, SETUP_LIMITER: broken })]) {
      for (let i = 0; i < 5; i++) expect((await tokenCall(e)).status).toBe(401)
      expect((await setupCall(e)).status).toBe(400)
    }
  })
})
