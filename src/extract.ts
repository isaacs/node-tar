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
 * extraction continues. With `opt.strict`, it is an error.
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
  if (files?.length) opt.filter = filesFilter(files, opt.filter)
  await new Unpack(opt).extract(source)
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
  if (files?.length) opt.filter = filesFilter(files, opt.filter)
  new UnpackSync(opt).extract(source)
}
