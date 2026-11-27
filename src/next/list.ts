import { stripTrailingSlashes } from '../strip-trailing-slashes.js'
import { TarReader, TarReaderSync } from './entries.js'
import type { ListOptions, ListOptionsSync } from './options.js'
import { dirname } from './path.js'
import { readFile, readFileSync } from './read-file.js'

/**
 * Make a filter that passes the entries that `files` lists. An entry
 * passes if `filter` accepts it, and it is in the list or one of its
 * 100 nearest parent directories is. Trailing slashes are ignored.
 */
export const filesFilter = <E>(
  files: string[],
  filter?: (path: string, entry: E) => boolean,
): ((path: string, entry: E) => boolean) => {
  const set = new Set(files.map(f => stripTrailingSlashes(f)))
  return (path, entry) => {
    if (filter && !filter(path, entry)) return false
    let p = stripTrailingSlashes(path)
    const root = p.charAt(0) === '/' ? '/' : '.'
    for (let depth = 0; depth < 100 && p !== root; depth++) {
      if (set.has(p)) return true
      p = dirname(p)
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
  opt: ListOptions,
  files?: string[],
): Promise<void> => {
  const { input, file, fs, onEntry } = opt
  const source =
    input ?? (file && fs ? readFile(fs, file, opt.maxReadSize) : undefined)
  if (!source) throw noInput()
  const reader = new TarReader(
    source,
    files?.length ?
      { ...opt, filter: filesFilter(files, opt.filter) }
    : opt,
  )
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
export const listSync = (opt: ListOptionsSync, files?: string[]): void => {
  const { input, file, fs, onEntry } = opt
  const source =
    input ??
    (file && fs ? readFileSync(fs, file, opt.maxReadSize) : undefined)
  if (!source) throw noInput()
  const reader = new TarReaderSync(
    source,
    files?.length ?
      { ...opt, filter: filesFilter(files, opt.filter) }
    : opt,
  )
  for (const entry of reader) onEntry?.(entry)
}
