/**
 * Import notes from a decrypted Standard Notes backup (Backups → download a decrypted file).
 * Notes and the tags that reference them are read; an encrypted backup (item content is a
 * string) has no readable notes and yields nothing.
 */
import { validDate, type ParsedNote } from './importMarkdown'

const MAX_LABEL = 40
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Parse the backup JSON. Returns null when the text is not a Standard Notes backup, so the caller can try another format. */
export function parseStandardNotes(path: string, raw: string, modifiedAt = Date.now()): ParsedNote[] | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const items = isObj(data) ? data.items : undefined
  if (!Array.isArray(items)) return null

  const live = items.filter((i): i is Record<string, unknown> => isObj(i) && i.deleted !== true)

  // note uuid → tag titles
  const tagsOf = new Map<string, string[]>()
  for (const item of live) {
    if (item.content_type !== 'Tag' || !isObj(item.content)) continue
    const title = typeof item.content.title === 'string' ? item.content.title.trim().slice(0, MAX_LABEL) : ''
    const refs = item.content.references
    if (!title || !Array.isArray(refs)) continue
    for (const ref of refs) {
      const uuid = isObj(ref) ? ref.uuid : undefined
      if (typeof uuid === 'string') tagsOf.set(uuid, [...(tagsOf.get(uuid) ?? []), title])
    }
  }

  const notes: ParsedNote[] = []
  for (const item of live) {
    if (item.content_type !== 'Note' || !isObj(item.content) || item.content.trashed === true) continue
    const c = item.content
    const title = typeof c.title === 'string' ? c.title.trim().slice(0, 300) : ''
    const body = typeof c.text === 'string' ? c.text.replace(/\r\n?/g, '\n').trim() : ''
    if (!title && !body) continue

    const sn = isObj(c.appData) && isObj(c.appData['org.standardnotes.sn']) ? (c.appData['org.standardnotes.sn'] as Record<string, unknown>) : {}
    const archived = sn.archived === true
    const uuid = typeof item.uuid === 'string' ? item.uuid : ''
    const ts = Date.parse(String(sn.clientUpdatedAt ?? item.updated_at ?? item.created_at))

    notes.push({
      title,
      body,
      color: 'default',
      labels: [...new Set(tagsOf.get(uuid) ?? [])],
      pinned: sn.pinned === true && !archived,
      archived,
      modifiedAt: Number.isFinite(ts) ? ts : modifiedAt,
      createdAt: validDate(Date.parse(String(item.created_at))),
      sourcePath: `${path}#${uuid || notes.length}`,
    })
  }
  return notes
}
