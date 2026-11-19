import type { EncryptedNote, VaultRecord } from '../shared/types'

/** Dated backups kept per user; older ones are deleted after each run. */
export const BACKUP_KEEP = 14

export interface NoteRow {
  id: string
  ciphertext: string
  iv: string
  pinned: number
  archived: number
  trashed_at: number | null
  position: number
  version: number
  created_at: number
  updated_at: number
}

export interface VaultRow {
  kdf: string
  wrapped_dek: string
  recovery_dek: string
  version: number
}

export function toNote(r: NoteRow): EncryptedNote {
  return {
    id: r.id,
    ciphertext: r.ciphertext,
    iv: r.iv,
    pinned: !!r.pinned,
    archived: !!r.archived,
    trashedAt: r.trashed_at,
    position: r.position,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function toVault(row: VaultRow): VaultRecord {
  return { kdf: JSON.parse(row.kdf), wrappedDek: row.wrapped_dek, recoveryDek: row.recovery_dek, version: row.version }
}

/** The file the app exports by hand (see buildBackup in src/lib/exportNotes.ts). */
interface BackupFile {
  format: 'noteflare-backup'
  version: 1
  exportedAt: string
  vault: VaultRecord
  notes: EncryptedNote[]
}

/** Users are emails, so this never collides with attachment keys (`<email>/<id>`). */
export const backupPrefix = (user: string) => `backups/${user}/`

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const isBackupDate = (s: string) => DATE_RE.test(s)
export const backupKey = (user: string, date: string) => `${backupPrefix(user)}${date}.json`

/** The user's vault and live notes, still encrypted. Null when the user has no vault. */
export async function buildServerBackup(db: D1Database, user: string, now: Date): Promise<BackupFile | null> {
  const vault = await db
    .prepare('SELECT kdf, wrapped_dek, recovery_dek, version FROM vaults WHERE user_id = ?')
    .bind(user)
    .first<VaultRow>()
  if (!vault) return null
  const { results } = await db
    .prepare(
      `SELECT id, ciphertext, iv, pinned, archived, trashed_at, position, version, created_at, updated_at
       FROM notes WHERE user_id = ? AND trashed_at IS NULL`,
    )
    .bind(user)
    .all<NoteRow>()
  return { format: 'noteflare-backup', version: 1, exportedAt: now.toISOString(), vault: toVault(vault), notes: results.map(toNote) }
}

async function listKeys(bucket: R2Bucket, prefix: string): Promise<R2Object[]> {
  const out: R2Object[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, cursor })
    out.push(...page.objects)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return out
}

/** Write today's backup for every user and keep the newest BACKUP_KEEP. A failing user doesn't stop the others. */
export async function runScheduledBackups(env: { DB: D1Database; ATTACHMENTS?: R2Bucket }, now = new Date()) {
  const bucket = env.ATTACHMENTS
  if (!bucket) return
  const { results: users } = await env.DB.prepare('SELECT user_id FROM vaults').all<{ user_id: string }>()
  for (const { user_id: user } of users) {
    try {
      const backup = await buildServerBackup(env.DB, user, now)
      if (!backup) continue
      await bucket.put(backupKey(user, now.toISOString().slice(0, 10)), JSON.stringify(backup), {
        httpMetadata: { contentType: 'application/json' },
      })
      const keys = (await listKeys(bucket, backupPrefix(user))).map((o) => o.key).sort().reverse()
      if (keys.length > BACKUP_KEEP) await bucket.delete(keys.slice(BACKUP_KEEP))
    } catch (err) {
      console.error('backup failed', err)
    }
  }
}

/** The user's backups, newest first. */
export async function listBackups(bucket: R2Bucket, user: string): Promise<{ date: string; size: number }[]> {
  const prefix = backupPrefix(user)
  return (await listKeys(bucket, prefix))
    .map((o) => ({ date: o.key.slice(prefix.length).replace(/\.json$/, ''), size: o.size }))
    .filter((b) => isBackupDate(b.date))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}
