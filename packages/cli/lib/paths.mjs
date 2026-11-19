/**
 * File names for `noteflare export`. Titles and labels come from note content, which
 * anyone with a write token (or an AI tool using the MCP server) can set, so nothing
 * here may let a note choose a path outside the export folder.
 */
import { relative, resolve, sep, isAbsolute } from 'node:path'

/** One path segment: no separators, no control characters, no leading dots ("..", ".ssh"). */
export const safeName = (s) =>
  s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '') // all leading dots and spaces, so no ".." is left behind
    .trim()
    .slice(0, 100) || 'note'

/**
 * The folder for a note inside `dir`: its first label with a "/" becomes nested folders.
 * Throws if the result would somehow leave `dir`.
 */
export function noteFolder(dir, labels) {
  const parts = (labels.find((l) => l.includes('/'))?.split('/') ?? []).map(safeName)
  const root = resolve(dir)
  const folder = resolve(root, ...parts)
  const rel = relative(root, folder)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error(`Refusing to write outside ${dir}`)
  return folder
}
