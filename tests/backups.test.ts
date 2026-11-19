import { describe, expect, it } from 'vitest'
import { BACKUP_KEEP, backupPrefix, listBackups, runScheduledBackups } from '../worker/backups'
import { parseBackup } from '../src/lib/exportNotes'

const USER = 'a@example.com'
const vaultRow = {
  kdf: JSON.stringify({ name: 'argon2id', salt: 's', memoryKiB: 19456, iterations: 2, parallelism: 1 }),
  wrapped_dek: 'w',
  recovery_dek: 'r',
  version: 1,
}
const noteRow = (id: string, trashed: number | null) => ({
  id, ciphertext: 'c', iv: 'i', pinned: 0, archived: 0, trashed_at: trashed, position: 1, version: 1, created_at: 1, updated_at: 1,
})

/** Canned D1: answers by SQL text; the notes query honours `trashed_at IS NULL`. */
function fakeDb(users: string[], notes: ReturnType<typeof noteRow>[]) {
  return {
    prepare(sql: string) {
      let args: unknown[] = []
      const stmt = {
        bind(...a: unknown[]) {
          args = a
          return stmt
        },
        async first() {
          return users.includes(args[0] as string) ? vaultRow : null
        },
        async all() {
          if (sql.includes('FROM vaults')) return { results: users.map((user_id) => ({ user_id })) }
          return { results: sql.includes('trashed_at IS NULL') ? notes.filter((n) => n.trashed_at === null) : notes }
        },
      }
      return stmt
    },
  } as unknown as D1Database
}

function fakeBucket(initial: string[] = []) {
  const store = new Map<string, string>(initial.map((k) => [k, '{}']))
  const bucket = {
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async get(key: string) {
      return store.has(key) ? { body: store.get(key) } : null
    },
    async list({ prefix }: { prefix: string }) {
      const objects = [...store].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.length }))
      return { objects, truncated: false }
    },
    async delete(keys: string | string[]) {
      for (const k of [keys].flat()) store.delete(k)
    },
  }
  return { bucket: bucket as unknown as R2Bucket, store }
}

const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}`

describe('scheduled backups', () => {
  it('writes a backup the app can parse, without trashed notes', async () => {
    const { bucket, store } = fakeBucket()
    const db = fakeDb([USER], [noteRow('n1', null), noteRow('n2', 5)])
    await runScheduledBackups({ DB: db, ATTACHMENTS: bucket }, new Date('2026-11-16T03:00:00Z'))
    const text = store.get(`${backupPrefix(USER)}2026-11-16.json`)
    expect(text).toBeDefined()
    const backup = parseBackup(text!)
    expect(backup.notes.map((n) => n.id)).toEqual(['n1'])
    expect(backup.vault.wrappedDek).toBe('w')
  })

  it('keeps only the newest backups and leaves other users alone', async () => {
    const old = Array.from({ length: 16 }, (_, i) => `${backupPrefix(USER)}${day(i + 1)}.json`)
    const other = `${backupPrefix('b@example.com')}${day(1)}.json`
    const attachment = `${USER}/0b0b0b0b-0b0b-0b0b-0b0b-0b0b0b0b0b0b`
    const { bucket, store } = fakeBucket([...old, other, attachment])
    await runScheduledBackups({ DB: fakeDb([USER], [noteRow('n1', null)]), ATTACHMENTS: bucket }, new Date('2026-11-16T03:00:00Z'))
    const mine = [...store.keys()].filter((k) => k.startsWith(backupPrefix(USER)))
    expect(mine).toHaveLength(BACKUP_KEEP)
    expect(mine).toContain(`${backupPrefix(USER)}2026-11-16.json`)
    expect(mine).not.toContain(old[0])
    expect(store.has(other)).toBe(true)
    expect(store.has(attachment)).toBe(true)
  })

  it('does nothing without the R2 binding', async () => {
    const db = {
      prepare() {
        throw new Error('touched the database')
      },
    } as unknown as D1Database
    await expect(runScheduledBackups({ DB: db })).resolves.toBeUndefined()
  })

  it('lists backups newest first', async () => {
    const { bucket } = fakeBucket([1, 3, 2].map((n) => `${backupPrefix(USER)}${day(n)}.json`))
    expect((await listBackups(bucket, USER)).map((b) => b.date)).toEqual([day(3), day(2), day(1)])
  })
})
