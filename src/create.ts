import {
  dealias,
  type FileOption,
  type NoFileOption,
  type WithAliases,
} from './dealias.js'
import { TarReader, TarReaderSync } from './entries.js'
import type { CreateFileHandle, CreateFS, CreateFSSync } from './fs.js'
import type { CreateOptions, CreateOptionsSync } from './options.js'
import {
  Pack,
  PackSync,
  type PackInput,
  type PackInputSync,
} from './pack.js'
import { readFile, readFileSync } from './read-file.js'
import { toStream } from './to-stream.js'

// Chunks that are smaller than this are put together for one write.
const SMALL = 64 * 1024
const BATCH = 4 * SMALL
const noop = () => {}

const check = (opt: { file?: string; fs?: unknown }, files: unknown[]) => {
  if (!files?.length) {
    throw new TypeError('no paths specified to add to archive')
  }
  if (opt.file && !opt.fs) {
    throw new TypeError('the file option needs the fs option')
  }
}

const writeAll = async (
  handle: CreateFileHandle,
  buf: Uint8Array,
  length: number,
  position: number,
) => {
  for (let off = 0; off < length; ) {
    off += (await handle.write(buf, off, length - off, position + off))
      .bytesWritten
  }
}

/**
 * Write the chunks to the file, from `position`. Chunks that are
 * smaller than 64 KiB are put together for one write.
 */
export const writeChunks = async (
  handle: CreateFileHandle,
  chunks: AsyncIterable<Uint8Array>,
  position: number,
): Promise<void> => {
  const batch = new Uint8Array(BATCH)
  let used = 0
  const flush = async () => {
    await writeAll(handle, batch, used, position)
    position += used
    used = 0
  }
  for await (const chunk of chunks) {
    if (used + chunk.length > BATCH || chunk.length >= SMALL) await flush()
    if (chunk.length >= SMALL) {
      await writeAll(handle, chunk, chunk.length, position)
      position += chunk.length
    } else {
      batch.set(chunk, used)
      used += chunk.length
    }
  }
  await flush()
}

/** The sync form of `writeChunks`. */
export const writeChunksSync = (
  fs: CreateFSSync,
  fd: number,
  chunks: Iterable<Uint8Array>,
  position: number,
): void => {
  const batch = new Uint8Array(BATCH)
  let used = 0
  const write = (buf: Uint8Array, length: number) => {
    for (let off = 0; off < length; ) {
      off += fs.writeSync(fd, buf, off, length - off, position + off)
    }
    position += length
  }
  for (const chunk of chunks) {
    if (used + chunk.length > BATCH || chunk.length >= SMALL) {
      write(batch, used)
      used = 0
    }
    if (chunk.length >= SMALL) write(chunk, chunk.length)
    else {
      batch.set(chunk, used)
      used += chunk.length
    }
  }
  write(batch, used)
}

const createFile = async (
  pack: Pack,
  fs: CreateFS,
  file: string,
  mode: number,
): Promise<void> => {
  const handle = await fs.open(file, 'w', mode)
  let ok = false
  try {
    await writeChunks(handle, pack, 0)
    ok = true
  } finally {
    const closed = handle.close()
    await (ok ? closed : closed.catch(noop))
  }
}

/**
 * Make the pack for the files of a command. A name that starts with
 * `@` is the path of an archive: the pack gets its entries.
 */
export const packFiles = (
  opt: CreateOptions,
  files: PackInput[],
): Pack => {
  const { fs, strict, onwarn, codecs, platform } = opt
  const pack = new Pack(opt)
  for (const item of files) {
    if (typeof item !== 'string' || item.charAt(0) !== '@') pack.add(item)
    else {
      const archive = pack.resolve(item.slice(1))
      pack.add(
        new TarReader(readFile(fs as CreateFS, archive, opt.maxReadSize), {
          strict,
          onwarn,
          codecs,
          platform,
          file: archive,
        }),
      )
    }
  }
  return pack.end()
}

/** The sync form of `packFiles`. */
export const packFilesSync = (
  opt: CreateOptionsSync,
  files: PackInputSync[],
): PackSync => {
  const { strict, onwarn, codecs, platform } = opt
  const pack = new PackSync(opt)
  for (const item of files) {
    if (typeof item !== 'string' || item.charAt(0) !== '@') pack.add(item)
    else {
      const archive = pack.resolve(item.slice(1))
      pack.add(
        new TarReaderSync(
          readFileSync(opt.fs as CreateFSSync, archive, opt.maxReadSize),
          { strict, onwarn, codecs, platform, file: archive },
        ),
      )
    }
  }
  return pack
}

/**
 * Make an archive of the files. A directory is added with all that
 * is in it. A name that starts with `@` is the path of an archive:
 * its entries are added. A file can also be an entry, or a source of
 * entries, as in `Pack.add()`.
 *
 * With `opt.file`, the archive is written to that path through
 * `opt.fs`. With no `opt.file`, the result is a stream of the bytes
 * of the archive. Files are read only when the stream is read.
 */
export function create(
  opt: WithAliases<CreateOptions> & FileOption,
  files: PackInput[],
): Promise<void>
export function create(
  opt: WithAliases<CreateOptions> & NoFileOption,
  files: PackInput[],
): ReadableStream<Uint8Array>
export function create(
  opt: WithAliases<CreateOptions>,
  files: PackInput[],
): Promise<void> | ReadableStream<Uint8Array>
export function create(
  options: WithAliases<CreateOptions>,
  files: PackInput[],
): Promise<void> | ReadableStream<Uint8Array> {
  const opt = dealias<CreateOptions>(options)
  if (!opt.file) {
    check(opt, files)
    return toStream(packFiles(opt, files))
  }
  // The file form returns a promise, so a bad argument rejects it.
  try {
    check(opt, files)
    return createFile(
      packFiles(opt, files),
      opt.fs as CreateFS,
      opt.file,
      opt.mode || 0o666,
    )
  } catch (er) {
    return Promise.reject(er)
  }
}

/**
 * The sync form of `create`. With no `opt.file`, the result is an
 * iterator of the bytes of the archive. Files are read only when the
 * iterator is read.
 */
export function createSync(
  opt: WithAliases<CreateOptionsSync> & FileOption,
  files: PackInputSync[],
): void
export function createSync(
  opt: WithAliases<CreateOptionsSync> & NoFileOption,
  files: PackInputSync[],
): IterableIterator<Uint8Array, undefined>
export function createSync(
  opt: WithAliases<CreateOptionsSync>,
  files: PackInputSync[],
): void | IterableIterator<Uint8Array, undefined>
export function createSync(
  options: WithAliases<CreateOptionsSync>,
  files: PackInputSync[],
): void | IterableIterator<Uint8Array, undefined> {
  const opt = dealias<CreateOptionsSync>(options)
  check(opt, files)
  const { file } = opt
  const fs = opt.fs as CreateFSSync
  const pack = packFilesSync(opt, files)
  if (!file) return pack
  const fd = fs.openSync(file, 'w', opt.mode || 0o666)
  try {
    writeChunksSync(fs, fd, pack, 0)
  } catch (er) {
    try {
      fs.closeSync(fd)
    } catch {}
    throw er
  }
  fs.closeSync(fd)
}
