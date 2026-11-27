import type { WithAliases } from './dealias.js'
import type { CreateStats } from './fs.js'
import type { ReplaceOptions, ReplaceOptionsSync } from './options.js'
import type { PackInput, PackInputSync } from './pack.js'
import type { EntryData } from './read-entry.js'
import { replace, replaceSync } from './replace.js'

// Add a filter that refuses a path that is not newer than the entry
// of the same path in the archive.

// A ustar header has the time in whole seconds. A file is not newer
// than such an entry if only the part below one second differs.
const isNewer = (file: Date, archived: Date) => {
  const a = archived.getTime()
  const f = file.getTime()
  return (a % 1000 === 0 ? f - (f % 1000) : f) > a
}

const newer = <
  E extends EntryData,
  O extends { mtimeCache?: Map<string, Date> },
>(
  opt: O & { filter?: (path: string, entry: CreateStats | E) => boolean },
): O => {
  const { filter } = opt
  const mtimeCache = opt.mtimeCache ?? new Map<string, Date>()
  return {
    ...opt,
    mtimeCache,
    filter: (path: string, entry: CreateStats | E) => {
      if (filter && !filter(path, entry)) return false
      const archived = mtimeCache.get(path)
      return !archived || !entry.mtime || isNewer(entry.mtime, archived)
    },
  }
}

/**
 * The same as `replace`, but a file is added only if it is newer than
 * the last entry of the archive that has its path.
 */
export const update = (
  opt: WithAliases<ReplaceOptions>,
  files: PackInput[],
): Promise<void> => replace(newer(opt), files)

/** The sync form of `update`. */
export const updateSync = (
  opt: WithAliases<ReplaceOptionsSync>,
  files: PackInputSync[],
): void => replaceSync(newer(opt), files)
