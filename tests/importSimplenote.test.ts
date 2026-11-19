import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSimplenote } from '../src/lib/importSimplenote'
import { dedupeKey } from '../src/lib/importMarkdown'
import { parseKeepNote } from '../src/lib/importKeep'

const fixture = readFileSync(new URL('./fixtures/simplenote.json', import.meta.url), 'utf8')

describe('parseSimplenote', () => {
  it('maps title, body, tags, pin and time; skips the trash', () => {
    const notes = parseSimplenote('notes.json', fixture, 5)!
    expect(notes).toHaveLength(2)
    expect(notes[0]).toMatchObject({ title: 'Groceries', body: 'Milk\nEggs', labels: ['home', 'food'], pinned: true, archived: false, sourcePath: 'notes.json#a1' })
    expect(notes[0].modifiedAt).toBe(Date.parse('2024-01-02T10:00:00.000Z'))
    expect(notes[1]).toMatchObject({ title: 'Idea', body: 'Build a thing', labels: [], pinned: false })
    expect(notes.some((n) => n.title === 'Old')).toBe(false)
  })

  it('returns null for invalid or foreign JSON, so other formats get a try', () => {
    expect(parseSimplenote('a.json', 'nope')).toBeNull()
    expect(parseSimplenote('a.json', '[]')).toBeNull()
    expect(parseSimplenote('a.json', '{"items":[]}')).toBeNull()
    expect(parseSimplenote('a.json', '{"activeNotes":{}}')).toBeNull()
    const keep = JSON.stringify({ title: 'k', textContent: 'x', isTrashed: false, isArchived: false })
    expect(parseSimplenote('k.json', keep)).toBeNull()
    expect(parseKeepNote('k.json', keep)).not.toBeNull()
  })

  it('importing twice adds nothing', () => {
    const a = parseSimplenote('notes.json', fixture, 1)!
    const b = parseSimplenote('notes.json', fixture, 1)!
    expect(b).toEqual(a)
    const seen = new Set(a.map(dedupeKey))
    expect(b.every((n) => seen.has(dedupeKey(n)))).toBe(true)
  })
})
