import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../worker/index'
import { purgeShares } from '../worker/shares'
import { openShare, sealShare, shareUrl } from '../src/lib/share'
import type { ShareInfo, SharedNote } from '../shared/types'

// Only exists inside the Workers runtime.
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }))

const NOTE_ID = '11111111-2222-4333-8444-555555555555'
const ME = 'me@example.com'

interface Share { id: string; user: string; noteId: string; ciphertext: string; iv: string; expiresAt: number | null; createdAt: number }
interface NoteRow { id: string; user: string; trashedAt: number | null }

/** A tiny D1 stand-in with the notes and shares tables. */
function fakeDb() {
  const notes: NoteRow[] = [{ id: NOTE_ID, user: ME, trashedAt: null }]
  const shares: Share[] = []
  const noteRow = (n: NoteRow) => ({ id: n.id, ciphertext: 'Y3Q=', iv: 'aXY=', pinned: 0, archived: 0, trashed_at: n.trashedAt, position: 0, version: 1, created_at: 1, updated_at: 1 })
  const run = (sql: string, a: unknown[]) => {
    if (sql.includes('FROM settings')) return { results: [] }
    if (sql.startsWith('SELECT s.ciphertext')) {
      const [id, now] = a as [string, number]
      const s = shares.find((x) => x.id === id && (x.expiresAt === null || x.expiresAt > now))
      const n = s && notes.find((x) => x.user === s.user && x.id === s.noteId && x.trashedAt === null)
      return { first: s && n ? { ciphertext: s.ciphertext, iv: s.iv, expires_at: s.expiresAt } : null }
    }
    if (sql.startsWith('SELECT id, ciphertext') && sql.includes('FROM notes')) {
      const n = notes.find((x) => x.user === a[0] && x.id === a[1])
      return { first: n ? noteRow(n) : null }
    }
    if (sql.startsWith('SELECT COUNT(*) AS n FROM shares')) return { first: { n: shares.filter((s) => s.user === a[0]).length } }
    if (sql.startsWith('SELECT id, note_id')) {
      const results = shares
        .filter((s) => s.user === a[0] && (s.expiresAt === null || s.expiresAt > (a[1] as number)))
        .map((s) => ({ id: s.id, note_id: s.noteId, expires_at: s.expiresAt, created_at: s.createdAt }))
      return { results }
    }
    if (sql.startsWith('INSERT INTO shares')) {
      const [id, user, noteId, ciphertext, iv, expiresAt, createdAt] = a as [string, string, string, string, string, number | null, number]
      if (shares.some((s) => s.id === id)) return { changes: 0 }
      shares.push({ id, user, noteId, ciphertext, iv, expiresAt, createdAt })
      return { changes: 1 }
    }
    if (sql.startsWith('DELETE FROM shares WHERE user_id = ? AND id = ?')) return { changes: remove((s) => s.user === a[0] && s.id === a[1]) }
    if (sql.startsWith('DELETE FROM shares WHERE user_id = ? AND note_id = ?')) return { changes: remove((s) => s.user === a[0] && s.noteId === a[1]) }
    if (sql.startsWith('DELETE FROM shares WHERE expires_at')) return { changes: remove((s) => s.expiresAt !== null && s.expiresAt <= (a[0] as number)) }
    if (sql.startsWith('DELETE FROM shares WHERE NOT EXISTS')) return { changes: remove((s) => !notes.some((n) => n.user === s.user && n.id === s.noteId)) }
    if (sql.startsWith('UPDATE notes SET')) {
      const n = notes.find((x) => x.user === a[a.length - 3] && x.id === a[a.length - 2])
      if (!n) return { changes: 0 }
      n.trashedAt = a[6] as number | null
      return { changes: 1 }
    }
    if (sql.startsWith('DELETE FROM notes')) {
      const i = notes.findIndex((x) => x.user === a[0] && x.id === a[1] && x.trashedAt !== null)
      if (i < 0) return { changes: 0 }
      notes.splice(i, 1)
      return { changes: 1 }
    }
    throw new Error(`unexpected SQL: ${sql}`)
  }
  const remove = (f: (s: Share) => boolean) => {
    const before = shares.length
    for (let i = shares.length - 1; i >= 0; i--) if (f(shares[i])) shares.splice(i, 1)
    return before - shares.length
  }
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: run(sql, args).results ?? [] }),
    first: async () => run(sql, args).first ?? null,
    run: async () => ({ meta: { changes: run(sql, args).changes ?? 0 } }),
  })
  return { notes, shares, prepare: (sql: string) => stmt(sql.trim().replace(/\s+/g, ' ')) }
}

type Db = ReturnType<typeof fakeDb>
const devEnv = (db: Db) => ({ ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', DEV_USER_EMAIL: ME, DB: db }) as never
/** A deployment behind Access, called without an Access token. */
const accessEnv = (db: Db) => ({ ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com', ACCESS_AUD: 'aud', DB: db }) as never
const call = (e: never, method: string, path: string, body?: unknown, host = 'localhost') =>
  worker.fetch(
    new Request(`http://${host}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }) as never,
    e,
    { waitUntil: () => {}, passThroughOnException: () => {} } as never,
  )

const note = { id: NOTE_ID, title: 'Groceries', body: 'eggs\nmilk' }

afterEach(() => vi.useRealTimers())

describe('share crypto', () => {
  it('round-trips a snapshot, and only with the right key and id', async () => {
    const { body, key } = await sealShare(note, 7)
    expect(await openShare(body.id, key, body.ciphertext, body.iv)).toEqual({ title: 'Groceries', body: 'eggs\nmilk' })
    const other = await sealShare(note, 7)
    await expect(openShare(body.id, other.key, body.ciphertext, body.iv)).rejects.toThrow()
    await expect(openShare(other.body.id, key, body.ciphertext, body.iv)).rejects.toThrow()
  })

  it('never puts the key in what is sent to the server', async () => {
    const { body, key } = await sealShare(note, null)
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(JSON.stringify(body)).not.toContain(key)
    expect(Object.keys(body).sort()).toEqual(['ciphertext', 'days', 'id', 'iv', 'noteId'])
    expect(JSON.stringify(body)).not.toContain('Groceries')
    expect(shareUrl(body.id, key, 'https://n.example')).toBe(`https://n.example/s/${body.id}#${key}`)
  })
})

describe('share routes', () => {
  const create = async (db: Db, days: 1 | 7 | 30 | null = 7) => {
    const sealed = await sealShare(note, days)
    const res = await call(devEnv(db), 'POST', '/api/shares', sealed.body)
    return { res, sealed }
  }

  it('stores only ciphertext and serves it publicly, behind Access too', async () => {
    const db = fakeDb()
    const { res, sealed } = await create(db)
    expect(res.status).toBe(201)
    const info = (await res.json()) as ShareInfo
    expect(info).toMatchObject({ id: sealed.body.id, noteId: NOTE_ID })
    expect(JSON.stringify(db.shares)).not.toContain(sealed.key)

    const pub = await call(accessEnv(db), 'GET', `/api/share/${sealed.body.id}`, undefined, 'notes.example.com')
    expect(pub.status).toBe(200)
    const shared = (await pub.json()) as SharedNote
    expect(Object.keys(shared).sort()).toEqual(['ciphertext', 'expiresAt', 'iv'])
    expect(await openShare(sealed.body.id, sealed.key, shared.ciphertext, shared.iv)).toEqual({ title: 'Groceries', body: 'eggs\nmilk' })

    const list = (await (await call(devEnv(db), 'GET', '/api/shares')).json()) as ShareInfo[]
    expect(list.map((s) => s.id)).toEqual([sealed.body.id])
  })

  it('keeps every other API route behind Access', async () => {
    const db = fakeDb()
    for (const [m, p] of [
      ['GET', '/api/shares'],
      ['POST', '/api/shares'],
      ['GET', '/api/notes'],
      ['GET', '/api/vault'],
      ['GET', '/api/v1/notes'],
      ['GET', '/api/share'],
    ] as const) {
      const res = await call(accessEnv(db), m, p, m === 'POST' ? {} : undefined, 'notes.example.com')
      expect([401, 403], `${m} ${p}`).toContain(res.status)
    }
  })

  it('returns 404 for revoked, expired, trashed-note and unknown links', async () => {
    const db = fakeDb()
    const pub = (id: string) => call(devEnv(db), 'GET', `/api/share/${id}`)

    const revoked = await create(db)
    expect((await call(devEnv(db), 'DELETE', `/api/shares/${revoked.sealed.body.id}`)).status).toBe(204)
    expect((await pub(revoked.sealed.body.id)).status).toBe(404)

    const expiring = await create(db, 1)
    vi.useFakeTimers({ now: Date.now() + 25 * 3600_000, toFake: ['Date'] })
    expect((await pub(expiring.sealed.body.id)).status).toBe(404)
    await purgeShares(db as never)
    expect(db.shares.some((s) => s.id === expiring.sealed.body.id)).toBe(false)
    vi.useRealTimers()

    const trashed = await create(db, null)
    db.notes[0].trashedAt = Date.now()
    expect((await pub(trashed.sealed.body.id)).status).toBe(404)

    expect((await pub('A'.repeat(22))).status).toBe(404)
    expect((await pub('bad')).status).toBe(404)
  })

  it('revokes a note’s links when it is deleted, and refuses links to trashed notes', async () => {
    const db = fakeDb()
    await create(db)
    db.notes[0].trashedAt = Date.now()
    expect((await create(db)).res.status).toBe(404)
    expect((await call(devEnv(db), 'DELETE', `/api/notes/${NOTE_ID}`)).status).toBe(204)
    expect(db.shares).toHaveLength(0)
  })

  it('rejects malformed links', async () => {
    const db = fakeDb()
    const { body } = await sealShare(note, 7)
    for (const bad of [{}, { ...body, id: 'short' }, { ...body, days: 3 }, { ...body, ciphertext: 'not base64!' }, { ...body, noteId: 'x' }]) {
      expect((await call(devEnv(db), 'POST', '/api/shares', bad)).status).toBe(400)
    }
    expect(db.shares).toHaveLength(0)
  })

  it('serves the share page publicly with a strict CSP', async () => {
    const res = await call(accessEnv(fakeDb()), 'GET', `/s/${'A'.repeat(22)}`, undefined, 'notes.example.com')
    expect(res.status).toBe(200)
    const csp = res.headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toMatch(/script-src 'nonce-[\w-]+'/)
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const html = await res.text()
    expect(html).toContain('textContent')
    expect(html).not.toContain('innerHTML')
  })
})
