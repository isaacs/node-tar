import { dealias, type WithAliases } from './dealias.js'
import { filesFilter } from './list.js'
import type { ExtractOptions, ExtractOptionsSync } from './options.js'
import { readFile, readFileSync } from './read-file.js'
import { Unpack, UnpackSync } from './unpack.js'

const noInput = () => new TypeError('extract needs input or file')

/**
 * Extract the entries of an archive into the directory `opt.cwd`.
 * If `files` is set, only the entries that it lists, and the entries
 * in the directories that it lists.
 *
 * A problem with one entry is a warning for `opt.onwarn`, and the
 * extraction continues. A listed path that no entry matches is a
 * warning when the archive ends. With `opt.strict`, each is an error.
 */
export const extract = async (
  options: WithAliases<ExtractOptions>,
  files?: string[],
): Promise<void> => {
  const opt = dealias<ExtractOptions>(options)
  const source =
    opt.input ??
    (opt.file ? readFile(opt.fs, opt.file, opt.maxReadSize) : undefined)
  if (!source) throw noInput()
  const [filter, report] =
    files?.length ? filesFilter(files, opt.filter) : []
  if (filter) opt.filter = filter
  await new Unpack(opt).extract(source)
  report?.(opt)
}

/** The sync form of `extract`. */
export const extractSync = (
  options: WithAliases<ExtractOptionsSync>,
  files?: string[],
): void => {
  const opt = dealias<ExtractOptionsSync>(options)
  const source =
    opt.input ??
    (opt.file ?
      readFileSync(opt.fs, opt.file, opt.maxReadSize)
    : undefined)
  if (!source) throw noInput()
  const [filter, report] =
    files?.length ? filesFilter(files, opt.filter) : []
  if (filter) opt.filter = filter
  new UnpackSync(opt).extract(source)
  report?.(opt)
}
