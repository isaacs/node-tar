import { gzip, type Codec } from './codec.js'
import { create, createSync } from './create.js'
import { dealias, type WithAliases } from './dealias.js'
import {
  findCodec,
  headLength,
  TarReader,
  TarReaderSync,
} from './entries.js'
import { filesFilter } from './list.js'
import type { DeleteOptions, DeleteOptionsSync } from './options.js'
import { readFile, readFileSync } from './read-file.js'

const noop = () => {}

type Filter<E> = (path: string, entry: E) => boolean

// The codecs to look for, and the filter and the report of the paths
// to delete.
const plan = <E>(
  opt: {
    file?: string
    fs?: unknown
    codecs?: Codec[]
    filter?: Filter<E>
  },
  files: string[] | undefined,
): [
  codecs: Codec[],
  remove: Filter<E>,
  report?: ReturnType<typeof filesFilter>[1],
] => {
  if (!opt.file) throw new TypeError('file is required')
  if (!opt.fs) throw new TypeError('the file option needs the fs option')
  const codecs = [...(opt.codecs ?? []), gzip]
  if (files?.length) return [codecs, ...filesFilter(files, opt.filter)]
  if (opt.filter) return [codecs, opt.filter]
  throw new TypeError('no paths specified to delete')
}

// The path of the new archive, until it gets the path of the old one.
const tmpName = (file: string) =>
  `${file}.${Math.random().toString(36).slice(2)}.tmp`

/**
 * Remove entries from an archive file. An entry is removed if
 * `files` lists its path or one of its parent directories. With
 * `opt.filter`, only if the filter also returns true. With no
 * `files`, each entry that the filter accepts is removed. A listed
 * path that no entry matches is a warning.
 *
 * The other entries are written to a new file next to the archive,
 * with the compression and the mode of the archive. The new file
 * then gets the path of the archive. The archive does not change if
 * the command fails.
 */
const del = async (
  options: WithAliases<DeleteOptions>,
  files?: string[],
): Promise<void> => {
  const opt = dealias<DeleteOptions>(options)
  const [codecs, remove, report] = plan(opt, files)
  const { fs, file, filter: _, maxReadSize, ...read } = opt
  const head = new Uint8Array(headLength(codecs))
  let length = 0
  const handle = await fs.open(file, 'r')
  try {
    for (let n = 1; n > 0 && length < head.length; length += n) {
      n = (await handle.read(head, length, head.length - length, length))
        .bytesRead
    }
  } finally {
    await handle.close()
  }
  const { mode } = await fs.stat(file)
  const tmp = tmpName(file)
  try {
    await create(
      {
        ...read,
        fs,
        file: tmp,
        mode: mode & 0o777,
        compress: findCodec(codecs, head.subarray(0, length), file),
        preservePaths: true,
        filter: (path, entry) => !remove(path, entry as never),
      },
      [new TarReader(readFile(fs, file, maxReadSize), { ...read, file })],
    )
    report?.(opt)
    await fs.rename(tmp, file)
  } catch (er) {
    await fs.unlink(tmp).catch(noop)
    throw er
  }
}

/** The sync form of `delete`. */
export const deleteSync = (
  options: WithAliases<DeleteOptionsSync>,
  files?: string[],
): void => {
  const opt = dealias<DeleteOptionsSync>(options)
  const [codecs, remove, report] = plan(opt, files)
  const { fs, file, filter: _, maxReadSize, ...read } = opt
  const head = new Uint8Array(headLength(codecs))
  let length = 0
  const fd = fs.openSync(file, 'r')
  try {
    for (let n = 1; n > 0 && length < head.length; length += n) {
      n = fs.readSync(fd, head, length, head.length - length, length)
    }
  } finally {
    fs.closeSync(fd)
  }
  const { mode } = fs.statSync(file)
  const tmp = tmpName(file)
  try {
    createSync(
      {
        ...read,
        fs,
        file: tmp,
        mode: mode & 0o777,
        compress: findCodec(codecs, head.subarray(0, length), file),
        preservePaths: true,
        filter: (path, entry) => !remove(path, entry as never),
      },
      [
        new TarReaderSync(readFileSync(fs, file, maxReadSize), {
          ...read,
          file,
        }),
      ],
    )
    report?.(opt)
    fs.renameSync(tmp, file)
  } catch (er) {
    try {
      fs.unlinkSync(tmp)
    } catch {}
    throw er
  }
}

export { del as delete }
