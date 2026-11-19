import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { enmlToMarkdown, parseEnex } from '../src/lib/importEvernote'
import { dedupeKey, isEnexPath, isImportablePath } from '../src/lib/importMarkdown'

const fixture = readFileSync(new URL('./fixtures/evernote.enex', import.meta.url), 'utf8')

describe('parseEnex', () => {
  it('maps title, body, labels and time, and skips attachments', () => {
    const notes = parseEnex('export.enex', fixture, 5)
    expect(notes[0].createdAt).toBe(Date.UTC(2024, 0, 1, 10))
    expect(notes).toHaveLength(2)
    expect(notes[0]).toMatchObject({ title: 'Trip & plans', labels: ['travel', 'todo'], pinned: false, archived: false, color: 'default', sourcePath: 'export.enex#0' })
    expect(notes[0].modifiedAt).toBe(Date.UTC(2024, 0, 2, 3, 4, 5))
    expect(notes[0].body).toBe('# Packing\n\nBring **warm** clothes & see [the map](https://example.com/map).\n- [x] Book flights\n- [ ] Pack bags')
    expect(notes[0].body).not.toContain('iVBOR')
    // no <updated>: falls back to <created>
    expect(notes[1]).toMatchObject({ title: 'Plain', body: 'Just text.\n- one\n- two', labels: [] })
    expect(notes[1].modifiedAt).toBe(Date.UTC(2024, 0, 5, 8, 0, 0))
  })

  it('skips empty notes and uses the fallback time without dates', () => {
    const raw = '<en-export><note><title></title><content><![CDATA[<en-note><div></div></en-note>]]></content></note><note><title>T</title></note></en-export>'
    const notes = parseEnex('a.enex', raw, 77)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ title: 'T', body: '', modifiedAt: 77, sourcePath: 'a.enex#1' })
  })

  it('importing twice adds nothing', () => {
    const a = parseEnex('export.enex', fixture, 1)
    const b = parseEnex('export.enex', fixture, 1)
    expect(b).toEqual(a)
    const seen = new Set(a.map(dedupeKey))
    expect(b.every((n) => seen.has(dedupeKey(n)))).toBe(true)
  })
})

describe('enmlToMarkdown', () => {
  it('converts new-style checklists', () => {
    const md = enmlToMarkdown('<en-note><ul><li style="--en-checked:true;">a</li><li style="--en-checked:false;">b</li><li data-checked="true">c</li></ul></en-note>')
    expect(md).toBe('- [x] a\n- [ ] b\n- [x] c')
  })

  it('handles lists, code, links, entities and breaks', () => {
    expect(enmlToMarkdown('<ol><li>x</li><li>y</li></ol>')).toBe('1. x\n1. y')
    expect(enmlToMarkdown('<div>a<br/>b &lt;c&gt; &#65;&#x42; &nbsp;d</div>')).toBe('a\nb <c> AB  d')
    expect(enmlToMarkdown('<pre>let a = 1;\nlet b = &quot;x&quot;;</pre>')).toBe('```\nlet a = 1;\nlet b = "x";\n```')
    expect(enmlToMarkdown('<a href="javascript:alert(1)">bad</a> <a href="http://a.example/x">ok</a> <i>it</i> <code>c</code>')).toBe('bad [ok](http://a.example/x) *it* `c`')
    expect(enmlToMarkdown('<p>one</p><hr/><p>two</p>')).toBe('one\n\n---\n\ntwo')
  })

  it('drops encrypted blocks', () => {
    expect(enmlToMarkdown('<en-note><div>x</div><en-crypt hint="h">SECRET</en-crypt></en-note>')).toBe('x')
  })
})

describe('enex paths', () => {
  it('accepts .enex files outside tool folders', () => {
    expect(isEnexPath('My Notes.ENEX')).toBe(true)
    expect(isImportablePath('a/b.enex')).toBe(true)
    expect(isEnexPath('node_modules/x/a.enex')).toBe(false)
  })
})
