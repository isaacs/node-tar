import { stripTrailingSlashes } from './strip-trailing-slashes.js'
import { dealias, type WithAliases } from './dealias.js'
import { TarReader, TarReaderSync } from './entries.js'
import type { ListOptions, ListOptionsSync } from './options.js'
import { readFile, readFileSync } from './read-file.js'

/**
 * Make a filter that passes the entries that `files` lists. An entry
 * passes if `filter` accepts it, and it is in the list or one of its
 * parent directories is. Trailing slashes are ignored.
 */
export const filesFilter = <E>(
  files: string[],
  filter?: (path: string, entry: E) => boolean,
): ((path: string, entry: E) => boolean) => {
  const set = new Set(files.map(f => stripTrailingSlashes(f)))
  let max = 0
  for (const f of set) max = Math.max(max, f.length)
  return (path, entry) => {
    if (filter && !filter(path, entry)) return false
    const p = stripTrailingSlashes(path)
    const root = p.charAt(0) === '/' ? '/' : '.'
    // Look at the path, and then at each parent directory. One that
    // is longer than each listed path is not looked up, so the work
    // for a very long path stays small.
    for (let end = p.length; end > 0; end = p.lastIndexOf('/', end - 1)) {
      if (end > max) continue
      const dir = p.slice(0, end)
      if (dir !== root && set.has(dir)) return true
    }
    return false
  }
}

const noInput = () => new TypeError('list needs input, or file and fs')

/**
 * Call `opt.onEntry` with each entry of an archive. If `files` is
 * set, only with the entries that it lists, and the entries in the
 * directories that it lists.
 */
export const list = async (
  options: WithAliases<ListOptions>,
  files?: string[],
): Promise<void> => {
  const opt = dealias<ListOptions>(options)
  const { input, file, fs, onEntry } = opt
  const source =
    input ?? (file && fs ? readFile(fs, file, opt.maxReadSize) : undefined)
  if (!source) throw noInput()
  if (files?.length) opt.filter = filesFilter(files, opt.filter)
  const reader = new TarReader(source, opt)
  try {
    for (;;) {
      const entry = reader.poll()
      if (entry === null) break
      if (entry === undefined) await reader.fill()
      else if (onEntry) await onEntry(entry)
    }
  } finally {
    await reader.return()
  }
}

/** The sync form of `list`. */
export const listSync = (
  options: WithAliases<ListOptionsSync>,
  files?: string[],
): void => {
  const opt = dealias<ListOptionsSync>(options)
  const { input, file, fs, onEntry } = opt
  const source =
    input ??
    (file && fs ? readFileSync(fs, file, opt.maxReadSize) : undefined)
  if (!source) throw noInput()
  if (files?.length) opt.filter = filesFilter(files, opt.filter)
  const reader = new TarReaderSync(source, opt)
  for (const entry of reader) onEntry?.(entry)
}
