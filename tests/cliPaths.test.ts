import { resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module without types
import { noteFolder, safeName } from '../packages/cli/lib/paths.mjs'

describe('CLI export paths', () => {
  const dir = resolve('/tmp/export')

  it('turns a slash label into nested folders', () => {
    expect(noteFolder(dir, ['work/q4'])).toBe(resolve(dir, 'work', 'q4'))
    expect(noteFolder(dir, ['plain'])).toBe(dir)
  })

  it.each([['../../../etc'], ['a/../../x'], ['a/ ../ ../x'], ['/etc/passwd'], ['..\\..\\x/y'], ['a//b'], ['... ../x'], ['. . ./x']])(
    'keeps label %j inside the export folder',
    (label) => {
      const folder = noteFolder(dir, [label])
      expect(folder === dir || folder.startsWith(dir + sep)).toBe(true)
      expect(folder.split(sep)).not.toContain('..')
    },
  )

  it('never returns a dot segment', () => {
    for (const s of ['..', '.', ' ..', '... ', '.ssh', '... ..', '. . .']) expect(safeName(s)).not.toMatch(/^\./)
    expect(safeName('..')).toBe('note')
  })
})
