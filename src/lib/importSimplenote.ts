/**
 * Import notes from a Simplenote export (Settings → Export notes → `notes.json`).
 * Only `activeNotes` are read; the trash is skipped.
 */
import { validDate, type ParsedNote } from './importMarkdown'

const MAX_LABEL = 40

/** Parse `notes.json`. Returns null when the text is not a Simplenote export, so the caller can try another format. */
export function parseSimplenote(path: string, raw: string, modifiedAt = Date.now()): ParsedNote[] | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const active = data && typeof data === 'object' ? (data as { activeNotes?: unknown }).activeNotes : undefined
  if (!Array.isArray(active)) return null

  const notes: ParsedNote[] = []
  active.forEach((item: unknown, index) => {
    if (!item || typeof item !== 'object') return
    const n = item as { content?: unknown; tags?: unknown; pinned?: unknown; systemTags?: unknown; lastModified?: unknown; creationDate?: unknown; id?: unknown }
    if (typeof n.content !== 'string') return

    const lines = n.content.replace(/\r\n?/g, '\n').split('\n')
    const first = lines.findIndex((l) => l.trim())
    if (first < 0) return
    const title = lines[first].trim().replace(/^#[ \t]+/, '').trim().slice(0, 300)
    const body = lines.slice(first + 1).join('\n').trim()

    const labels = Array.isArray(n.tags) ? n.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim().slice(0, MAX_LABEL)).filter(Boolean) : []
    const ts = Date.parse(String(n.lastModified ?? n.creationDate))

    notes.push({
      title,
      body,
      color: 'default',
      labels: [...new Set(labels)],
      pinned: n.pinned === true || (Array.isArray(n.systemTags) && n.systemTags.includes('pinned')),
      archived: false,
      modifiedAt: Number.isFinite(ts) ? ts : modifiedAt,
      createdAt: validDate(Date.parse(String(n.creationDate))),
      sourcePath: `${path}#${typeof n.id === 'string' || typeof n.id === 'number' ? n.id : index}`,
    })
  })
  return notes
}
