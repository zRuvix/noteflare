import { describe, expect, it, vi } from 'vitest'
import worker from '../worker/index'
import {
  createVault,
  decryptNote,
  encryptNote,
  newPasskeySalt,
  rewrapVault,
  unlockWithPasskey,
  unlockWithPassphrase,
  wrapDekForPasskey,
  WrongSecretError,
} from '../src/lib/crypto'
import { defaultPasskeyName } from '../src/lib/passkeys'
import type { PasskeyRecord, VaultRecord } from '../shared/types'

// Only exists inside the Workers runtime.
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }))

const PASS = 'correct horse battery staple'
const CRED = 'Y3JlZGVudGlhbC1pZC0xMjM0NTY'
const NOTE_ID = '11111111-2222-4333-8444-555555555555'
const prf = () => crypto.getRandomValues(new Uint8Array(32))

describe('passkey key wrapping', () => {
  it('unwraps the same data key with the PRF output, and only with it', async () => {
    const { record, dek } = await createVault(PASS)
    const copy = await unlockWithPassphrase(record, PASS, true)
    const secret = prf()
    const wrapped = await wrapDekForPasskey(copy, secret, CRED)

    const fromPasskey = await unlockWithPasskey(wrapped, secret, CRED)
    const enc = await encryptNote(dek, NOTE_ID, { title: 'T', body: 'secret', color: 'default', labels: [] })
    expect((await decryptNote(fromPasskey, NOTE_ID, enc.ciphertext, enc.iv)).body).toBe('secret')
    expect(fromPasskey.extractable).toBe(false)

    await expect(unlockWithPasskey(wrapped, prf(), CRED)).rejects.toBeInstanceOf(WrongSecretError)
    await expect(unlockWithPasskey(wrapped, secret, 'b3RoZXItY3JlZGVudGlhbC1pZA')).rejects.toBeInstanceOf(WrongSecretError)
    await expect(unlockWithPasskey(wrapped, secret.slice(0, 16), CRED)).rejects.toBeInstanceOf(WrongSecretError)
  }, 60_000)

  it('keeps working after the passphrase changes', async () => {
    const { record } = await createVault(PASS)
    const secret = prf()
    const wrapped = await wrapDekForPasskey(await unlockWithPassphrase(record, PASS, true), secret, CRED)
    const next = await rewrapVault(record, { passphrase: PASS }, 'a brand new passphrase')
    const enc = await encryptNote(next.dek, NOTE_ID, { title: '', body: 'after', color: 'default', labels: [] })
    const key = await unlockWithPasskey(wrapped, secret, CRED)
    expect((await decryptNote(key, NOTE_ID, enc.ciphertext, enc.iv)).body).toBe('after')
  }, 60_000)

  it('makes a fresh 32-byte PRF salt each time', () => {
    expect(atob(newPasskeySalt())).toHaveLength(32)
    expect(newPasskeySalt()).not.toBe(newPasskeySalt())
  })

  it('names a passkey after the device and browser', () => {
    expect(defaultPasskeyName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe('Mac · Safari')
    expect(defaultPasskeyName('')).toBe('Passkey')
  })
})

describe('passkey routes', () => {
  const VAULT = {
    kdf: JSON.stringify({ name: 'argon2id', salt: 'c2FsdHNhbHRzYWx0c2FsdA==', memoryKiB: 65536, iterations: 3, parallelism: 1 }),
    wrapped_dek: 'd3JhcHBlZA==',
    recovery_dek: 'cmVjb3Zlcnk=',
    version: 1,
  }

  /** A tiny D1 stand-in: one vault per user and a passkeys table (or none, like a deployment before the migration). */
  function fakeDb(opts: { noTable?: boolean } = {}) {
    const rows: (PasskeyRecord & { user: string })[] = []
    const run = (sql: string, args: unknown[]) => {
      if (opts.noTable && sql.includes('passkeys')) throw new Error('no such table: passkeys')
      if (sql.includes('FROM settings')) return { results: [] }
      if (sql.includes('FROM vaults')) return { first: VAULT }
      if (sql.startsWith('SELECT COUNT(*)')) return { first: { n: rows.filter((r) => r.user === args[0]).length } }
      if (sql.startsWith('SELECT id, name')) {
        const results = rows.filter((r) => r.user === args[0]).map((r) => ({ id: r.id, name: r.name, salt: r.salt, wrapped_dek: r.wrappedDek, created_at: r.createdAt }))
        return { results }
      }
      if (sql.startsWith('INSERT INTO passkeys')) {
        const [user, id, name, salt, wrappedDek, createdAt] = args as [string, string, string, string, string, number]
        if (rows.some((r) => r.user === user && r.id === id)) return { changes: 0 }
        rows.push({ user, id, name, salt, wrappedDek, createdAt })
        return { changes: 1 }
      }
      if (sql.startsWith('DELETE FROM passkeys')) {
        const i = rows.findIndex((r) => r.user === args[0] && r.id === args[1])
        if (i < 0) return { changes: 0 }
        rows.splice(i, 1)
        return { changes: 1 }
      }
      throw new Error(`unexpected SQL: ${sql}`)
    }
    const stmt = (sql: string, args: unknown[] = []) => ({
      bind: (...a: unknown[]) => stmt(sql, a),
      all: async () => ({ results: run(sql, args).results ?? [] }),
      first: async () => run(sql, args).first ?? null,
      run: async () => ({ meta: { changes: run(sql, args).changes ?? 0 } }),
    })
    return { rows, prepare: (sql: string) => stmt(sql.trim()) }
  }

  const env = (db: ReturnType<typeof fakeDb>, user = 'me@example.com') =>
    ({ ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', DEV_USER_EMAIL: user, DB: db }) as never
  const call = (e: never, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(
      new Request(`http://localhost${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', ...headers },
      }) as never,
      e,
      {} as never,
    )
  const passkey = { id: CRED, name: 'Mac · Safari', salt: btoa('s'.repeat(32)), wrappedDek: btoa('w'.repeat(60)) }

  it('adds a passkey, lists it with the vault, and removes its wrapped key', async () => {
    const db = fakeDb()
    const me = env(db)
    const added = await call(me, 'POST', '/api/passkeys', passkey)
    expect(added.status).toBe(201)
    expect(await added.json()).toMatchObject(passkey)
    expect((await call(me, 'POST', '/api/passkeys', passkey)).status).toBe(409)

    const vault = (await (await call(me, 'GET', '/api/vault')).json()) as VaultRecord
    expect(vault.wrappedDek).toBe(VAULT.wrapped_dek)
    expect(vault.passkeys).toEqual([expect.objectContaining(passkey)])

    // Another user can't see or remove it.
    expect(((await (await call(env(db, 'other@example.com'), 'GET', '/api/vault')).json()) as VaultRecord).passkeys).toEqual([])
    expect((await call(env(db, 'other@example.com'), 'DELETE', `/api/passkeys/${CRED}`)).status).toBe(404)

    expect((await call(me, 'DELETE', `/api/passkeys/${CRED}`)).status).toBe(204)
    expect(db.rows).toHaveLength(0)
    const after = (await (await call(me, 'GET', '/api/vault')).json()) as VaultRecord
    expect(after.passkeys).toEqual([])
    expect(after).toMatchObject({ wrappedDek: VAULT.wrapped_dek, recoveryDek: VAULT.recovery_dek })
  })

  it('rejects malformed passkeys', async () => {
    const me = env(fakeDb())
    for (const bad of [{}, { ...passkey, id: 'bad id!' }, { ...passkey, name: ' ' }, { ...passkey, salt: btoa('short') }, { ...passkey, wrappedDek: 'not base64!' }]) {
      expect((await call(me, 'POST', '/api/passkeys', bad)).status).toBe(400)
    }
  })

  it('serves the vault as before when the passkeys table does not exist yet', async () => {
    const res = await call(env(fakeDb({ noTable: true })), 'GET', '/api/vault')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ wrappedDek: VAULT.wrapped_dek, passkeys: [] })
  })

  it('is not available to API tokens', async () => {
    const res = await call(env(fakeDb()), 'POST', '/api/v1/passkeys', passkey, { Authorization: 'Bearer nf_x' })
    expect([401, 403]).toContain(res.status)
  })
})
