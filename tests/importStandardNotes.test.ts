import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseStandardNotes } from '../src/lib/importStandardNotes'
import { dedupeKey } from '../src/lib/importMarkdown'
import { parseKeepNote } from '../src/lib/importKeep'

const fixture = readFileSync(new URL('./fixtures/standardnotes.json', import.meta.url), 'utf8')

describe('parseStandardNotes', () => {
  it('maps notes, tags, pinned and archived; skips trashed, deleted and encrypted items', () => {
    const notes = parseStandardNotes('backup.json', fixture, 5)!
    expect(notes.map((n) => n.title)).toEqual(['Pinned one', 'Archived one'])
    expect(notes[0]).toMatchObject({ body: 'First\nbody', labels: ['work'], pinned: true, archived: false, sourcePath: 'backup.json#n1' })
    expect(notes[0].modifiedAt).toBe(Date.parse('2024-01-03T10:00:00.000Z'))
    expect(notes[0].createdAt).toBe(Date.parse('2024-01-01T10:00:00.000Z'))
    // archived wins over pinned
    expect(notes[1]).toMatchObject({ labels: [], pinned: false, archived: true })
    expect(notes[1].modifiedAt).toBe(Date.parse('2024-02-02T10:00:00.000Z'))
  })

  it('returns null for invalid or foreign JSON, so other formats get a try', () => {
    expect(parseStandardNotes('a.json', 'nope')).toBeNull()
    expect(parseStandardNotes('a.json', '{"activeNotes":[]}')).toBeNull()
    expect(parseStandardNotes('a.json', '[]')).toBeNull()
    const keep = JSON.stringify({ title: 'k', textContent: 'x', isTrashed: false, isArchived: false })
    expect(parseStandardNotes('k.json', keep)).toBeNull()
    expect(parseKeepNote('k.json', keep)).not.toBeNull()
  })

  it('yields nothing for a fully encrypted backup', () => {
    const raw = JSON.stringify({ items: [{ uuid: 'x', content_type: 'Note', content: '004:abc' }] })
    expect(parseStandardNotes('a.json', raw)).toEqual([])
  })

  it('importing twice adds nothing', () => {
    const a = parseStandardNotes('backup.json', fixture, 1)!
    const b = parseStandardNotes('backup.json', fixture, 1)!
    expect(b).toEqual(a)
    const seen = new Set(a.map(dedupeKey))
    expect(b.every((n) => seen.has(dedupeKey(n)))).toBe(true)
  })
})
