import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../worker/index'
import { resetUpdateCache } from '../worker/updates'

// Only exists inside the Workers runtime.
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }))

const SECRET = 'github_pat_SECRET_never_in_a_response'
const ME = 'me@example.com'

/** A D1 stand-in: no settings; any API token looks valid and belongs to ME. */
const db = () => {
  const stmt = {
    bind: () => stmt,
    first: async () => ({ id: 't1', user_id: ME, scope: 'write', last_used_at: Date.now(), expires_at: null }),
    all: async () => ({ results: [] }),
    run: async () => ({ meta: { changes: 1 } }),
  }
  return { prepare: () => stmt }
}

const env = (extra: object = {}) =>
  ({
    ACCESS_TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    DEV_USER_EMAIL: ME,
    UPDATE_CHECK_REPO: 'off',
    DB: db(),
    ...extra,
  }) as never
const configured = { GITHUB_UPDATE_TOKEN: SECRET, GITHUB_UPDATE_REPO: 'me/noteflare' }
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never
const call = (e: never, method: string, path: string, headers: Record<string, string> = {}) =>
  worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      body: method === 'POST' ? '{}' : undefined,
      headers: { 'Content-Type': 'application/json', ...headers },
    }) as never,
    e,
    ctx,
  )

/** Fakes GitHub: the repository's default branch, and the workflow dispatch. */
const github = (dispatchStatus = 204) => {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    if (url.endsWith('/dispatches')) return new Response(null, { status: dispatchStatus })
    return Response.json({ default_branch: 'trunk' })
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetUpdateCache()
})

describe('update from the app', () => {
  it('dispatches update.yml on the default branch with the token', async () => {
    const calls = github()
    const res = await call(env(configured), 'POST', '/api/update')
    expect(res.status).toBe(202)
    const text = await res.text()
    expect(text).not.toContain(SECRET)
    const d = calls.find((x) => x.url.endsWith('/dispatches'))!
    expect(d.url).toBe('https://api.github.com/repos/me/noteflare/actions/workflows/update.yml/dispatches')
    expect(d.init.method).toBe('POST')
    expect(JSON.parse(String(d.init.body))).toEqual({ ref: 'trunk' })
    expect((d.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`)
  })

  it('shows the button only when the secret and repository are set', async () => {
    const on = await (await call(env(configured), 'GET', '/api/version')).json()
    expect(on.canUpdate).toBe(true)
    for (const extra of [{}, { GITHUB_UPDATE_REPO: 'me/noteflare' }, { GITHUB_UPDATE_TOKEN: SECRET }, { ...configured, GITHUB_UPDATE_REPO: 'not a repo' }]) {
      const info = await (await call(env(extra), 'GET', '/api/version')).json()
      expect(info.canUpdate).toBe(false)
    }
    expect((await call(env(), 'POST', '/api/update')).status).toBe(404)
  })

  it('refuses API token clients, and never returns the token', async () => {
    const calls = github()
    const bearer = { Authorization: `Bearer nf_${'a'.repeat(43)}` }
    const res = await call(env(configured), 'POST', '/api/v1/update', bearer)
    expect(res.status).toBe(403)
    expect(calls).toHaveLength(0)
    const v = await call(env(configured), 'GET', '/api/v1/version', bearer)
    expect(v.status).toBe(200)
    const text = await v.text()
    expect(JSON.parse(text).canUpdate).toBe(false)
    expect(text).not.toContain(SECRET)
  })

  it('reports a refused dispatch without leaking the token', async () => {
    github(403)
    const res = await call(env(configured), 'POST', '/api/update')
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).toContain('update_failed')
    expect(text).not.toContain(SECRET)
  })
})
