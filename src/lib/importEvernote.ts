/**
 * Import notes from an Evernote export (`.enex`, File → Export notes).
 * One file holds many `<note>` elements whose body is ENML (a strict XHTML subset);
 * this turns each into the same shape the Markdown importer produces. Attachments
 * (`<resource>`, `<en-media>`) are not imported. Pure string parsing, so it runs anywhere.
 */
import type { ParsedNote } from './importMarkdown'

const MAX_LABEL = 40

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })

/** `20240102T030405Z` → milliseconds, or null. */
function enexDate(s: string | undefined): number | null {
  const m = s?.trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  if (!m) return null
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return Number.isFinite(ms) ? ms : null
}

const attr = (attrs: string, name: string) => attrs.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))?.slice(1).find((v) => v !== undefined)

// One pass over the tags: <pre> blocks whole, then any other tag.
const TOKEN = /<pre\b[^>]*>([\s\S]*?)<\/pre>|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/gi

/** ENML (the content of an Evernote note) → Markdown. */
export function enmlToMarkdown(enml: string): string {
  const src = enml
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<en-crypt\b[\s\S]*?<\/en-crypt>/gi, '')
    .replace(/<en-media\b[^>]*?(?:\/>|>\s*<\/en-media>|>)/gi, '')

  let out = ''
  const atLineStart = () => out === '' || out.endsWith('\n')
  const line = () => {
    if (!atLineStart()) out += '\n'
  }
  const blank = () => {
    out = out.replace(/[ \t]+$/, '')
    if (out === '') return
    line()
    if (!out.endsWith('\n\n')) out += '\n'
  }

  const lists: Array<'ul' | 'ol'> = []
  const links: Array<string | null> = []
  let last = 0

  const text = (s: string) => {
    let t = s.replace(/\s+/g, ' ')
    t = decodeEntities(t)
    if (atLineStart()) t = t.replace(/^[  ]+/, '')
    out += t
  }

  for (const m of src.matchAll(TOKEN)) {
    text(src.slice(last, m.index))
    last = m.index + m[0].length

    if (m[3] === undefined) {
      // <pre>: keep the lines, drop the markup inside.
      const code = decodeEntities(m[1].replace(/<br\s*\/?>|<\/div>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/\n+$/, '')
      blank()
      out += `\`\`\`\n${code}\n\`\`\``
      blank()
      continue
    }

    const closing = m[2] === '/'
    const tag = m[3].toLowerCase()
    const attrs = m[4]

    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        blank()
        if (!closing) out += `${'#'.repeat(Number(tag[1]))} `
        break
      case 'p':
        blank()
        break
      case 'div': case 'tr':
        line()
        break
      case 'hr':
        blank()
        out += '---'
        blank()
        break
      case 'br':
        out += '\n'
        break
      case 'b': case 'strong':
        out += '**'
        break
      case 'i': case 'em':
        out += '*'
        break
      case 'code':
        out += '`'
        break
      case 'td': case 'th':
        if (!closing && !atLineStart()) out += ' | '
        break
      case 'a':
        if (closing) {
          const href = links.pop()
          if (href) out += `](${href})`
        } else {
          const href = attr(attrs, 'href')?.trim()
          const ok = href && /^https?:\/\//i.test(decodeEntities(href))
          links.push(ok ? decodeEntities(href).replace(/\)/g, '%29').replace(/ /g, '%20') : null)
          if (ok) out += '['
        }
        break
      case 'ul': case 'ol':
        line()
        if (closing) lists.pop()
        else lists.push(tag)
        break
      case 'li':
        line()
        if (!closing) {
          const checked = /--en-checked\s*:\s*true/i.test(attrs) || /data-checked\s*=\s*["']?true/i.test(attrs)
          const unchecked = /--en-checked\s*:\s*false/i.test(attrs) || /data-checked\s*=\s*["']?false/i.test(attrs)
          out += checked ? '- [x] ' : unchecked ? '- [ ] ' : lists[lists.length - 1] === 'ol' ? '1. ' : '- '
        }
        break
      case 'en-todo':
        line()
        out += /checked\s*=\s*["']?true/i.test(attrs) ? '- [x] ' : '- [ ] '
        break
      default:
        break // en-note and every other tag: dropped, text kept
    }
  }
  text(src.slice(last))

  return out
    .split('\n')
    .map((l) => l.replace(/[ \t ]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Parse the text of an `.enex` file. Returns one note per `<note>`; empty notes are skipped. */
export function parseEnex(path: string, raw: string, modifiedAt = Date.now()): ParsedNote[] {
  const notes: ParsedNote[] = []
  let index = 0
  for (const m of raw.matchAll(/<note>([\s\S]*?)<\/note>/g)) {
    let block = m[1].replace(/<resource>[\s\S]*?<\/resource>/g, '')

    let enml = ''
    block = block.replace(/<content>([\s\S]*?)<\/content>/, (_, c: string) => {
      const cdata = c.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
      enml = cdata ? cdata[1] : decodeEntities(c)
      return ''
    })

    const title = decodeEntities(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').trim().slice(0, 300)
    const body = enmlToMarkdown(enml)
    const i = index++
    if (!title && !body) continue

    const labels = [...block.matchAll(/<tag>([\s\S]*?)<\/tag>/g)].map((t) => decodeEntities(t[1]).trim().slice(0, MAX_LABEL)).filter(Boolean)

    notes.push({
      title,
      body,
      color: 'default',
      labels: [...new Set(labels)],
      pinned: false,
      archived: false,
      modifiedAt: enexDate(block.match(/<updated>([\s\S]*?)<\/updated>/)?.[1]) ?? enexDate(block.match(/<created>([\s\S]*?)<\/created>/)?.[1]) ?? modifiedAt,
      createdAt: enexDate(block.match(/<created>([\s\S]*?)<\/created>/)?.[1]) ?? undefined,
      sourcePath: `${path}#${i}`,
    })
  }
  return notes
}
