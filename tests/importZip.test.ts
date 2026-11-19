import { readFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { crc32, makeZip, readZip } from '../src/lib/zip'
import { expandZips, filesFromInput } from '../src/lib/importMarkdown'
import { parseStandardNotes } from '../src/lib/importStandardNotes'

const enc = new TextEncoder()
const dec = new TextDecoder()
const all = () => true

/** One deflated entry, as Standard Notes, macOS and most zip tools write it (makeZip only stores). */
function deflatedZip(name: string, text: string): Uint8Array<ArrayBuffer> {
  const raw = enc.encode(text)
  const packed = deflateRawSync(raw)
  const n = enc.encode(name)
  const out = new Uint8Array(30 + n.length + packed.length + 46 + n.length + 22)
  const v = new DataView(out.buffer)
  v.setUint32(0, 0x04034b50, true)
  v.setUint16(8, 8, true)
  v.setUint32(14, crc32(raw), true)
  v.setUint32(18, packed.length, true)
  v.setUint32(22, raw.length, true)
  v.setUint16(26, n.length, true)
  out.set(n, 30)
  out.set(packed, 30 + n.length)
  const c = 30 + n.length + packed.length
  v.setUint32(c, 0x02014b50, true)
  v.setUint16(c + 10, 8, true)
  v.setUint32(c + 16, crc32(raw), true)
  v.setUint32(c + 20, packed.length, true)
  v.setUint32(c + 24, raw.length, true)
  v.setUint16(c + 28, n.length, true)
  out.set(n, c + 46)
  const e = c + 46 + n.length
  v.setUint32(e, 0x06054b50, true)
  v.setUint16(e + 8, 1, true)
  v.setUint16(e + 10, 1, true)
  v.setUint32(e + 12, 46 + n.length, true)
  v.setUint32(e + 16, c, true)
  return out
}

describe('readZip', () => {
  it('reads back what makeZip writes, keeping only wanted names', async () => {
    const zip = makeZip([
      { name: 'a/one.md', data: enc.encode('# One') },
      { name: 'skip.png', data: new Uint8Array([1, 2, 3]) },
    ])
    const files = await readZip(zip, (n) => n.endsWith('.md'), 1000)
    expect(files.map((f) => [f.name, dec.decode(f.data)])).toEqual([['a/one.md', '# One']])
  })

  it('inflates deflated entries and skips ones over the size limit', async () => {
    const text = 'hello '.repeat(500)
    expect(dec.decode((await readZip(deflatedZip('x.txt', text), all, 10_000))[0].data)).toBe(text)
    expect(await readZip(deflatedZip('x.txt', text), all, 100)).toEqual([])
  })

  it('throws on data that is not a zip', async () => {
    await expect(readZip(enc.encode('not a zip at all, just some text here'), all, 1000)).rejects.toThrow()
  })
})

describe('importing a .zip', () => {
  const backup = readFileSync(new URL('./fixtures/standardnotes.json', import.meta.url), 'utf8')
  const zipFile = (entries: { name: string; data: Uint8Array }[]) => new File([makeZip(entries)], 'Standard Notes Backup.zip')

  it('picks a Standard Notes backup zip and finds the backup .txt inside', async () => {
    const zip = zipFile([
      { name: 'Standard Notes Backup and Import File.txt', data: enc.encode(backup) },
      { name: 'Items/Note/Pinned one.txt', data: enc.encode('First\nbody') },
      { name: '__MACOSX/._x.txt', data: enc.encode('junk') },
    ])
    const picked = filesFromInput([zip] as unknown as FileList)
    expect(picked.map((f) => f.path)).toEqual(['Standard Notes Backup.zip'])
    const files = await expandZips(picked)
    expect(files.map((f) => f.path)).toEqual([
      'Standard Notes Backup.zip/Standard Notes Backup and Import File.txt',
      'Standard Notes Backup.zip/Items/Note/Pinned one.txt',
    ])
    const notes = parseStandardNotes(files[0].path, await files[0].file.text())!
    expect(notes.map((n) => n.title)).toContain('Pinned one')
    // the per-note .txt is plain text, not a backup: no second copy
    expect(parseStandardNotes(files[1].path, await files[1].file.text())).toBeNull()
  })

  it('accepts the unzipped Standard Notes .txt, but not any .txt', () => {
    const pick = (name: string) => filesFromInput([new File(['x'], name)] as unknown as FileList).length
    expect(pick('Standard Notes Backup and Import File.txt')).toBe(1)
    expect(pick('shopping list.txt')).toBe(0)
  })
})
