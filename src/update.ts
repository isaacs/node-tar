import type { CreateStats } from './fs.js'
import type { ReplaceOptions, ReplaceOptionsSync } from './options.js'
import type { PackInput, PackInputSync } from './pack.js'
import type { EntryData } from './read-entry.js'
import { replace, replaceSync } from './replace.js'

// Add a filter that refuses a path that is older than the entry of
// the same path in the archive.
const newer = <
  E extends EntryData,
  O extends ReplaceOptions | ReplaceOptionsSync,
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
      const mtime = entry.mtime ?? 0
      return !((mtimeCache.get(path) ?? mtime) > mtime)
    },
  }
}

/**
 * The same as `replace`, but a file is added only if it is not older
 * than the last entry of the archive that has its path.
 */
export const update = (
  opt: ReplaceOptions,
  files: PackInput[],
): Promise<void> => replace(newer(opt), files)

/** The sync form of `update`. */
export const updateSync = (
  opt: ReplaceOptionsSync,
  files: PackInputSync[],
): void => replaceSync(newer(opt), files)
