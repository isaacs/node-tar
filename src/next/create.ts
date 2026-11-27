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

const write = async (
  handle: CreateFileHandle,
  buf: Uint8Array,
  length: number,
) => {
  for (let off = 0; off < length; ) {
    off += (await handle.write(buf, off, length - off)).bytesWritten
  }
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
    const batch = new Uint8Array(BATCH)
    let used = 0
    for await (const chunk of pack) {
      if (used + chunk.length > BATCH || chunk.length >= SMALL) {
        await write(handle, batch, used)
        used = 0
      }
      if (chunk.length >= SMALL) await write(handle, chunk, chunk.length)
      else {
        batch.set(chunk, used)
        used += chunk.length
      }
    }
    await write(handle, batch, used)
    ok = true
  } finally {
    const closed = handle.close()
    await (ok ? closed : closed.catch(noop))
  }
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
  opt: CreateOptions & { file: string },
  files: PackInput[],
): Promise<void>
export function create(
  opt: CreateOptions & { file?: undefined },
  files: PackInput[],
): ReadableStream<Uint8Array>
export function create(
  opt: CreateOptions,
  files: PackInput[],
): Promise<void> | ReadableStream<Uint8Array>
export function create(
  opt: CreateOptions,
  files: PackInput[],
): Promise<void> | ReadableStream<Uint8Array> {
  check(opt, files)
  const { file, fs, strict, onwarn, codecs, platform } = opt
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
  pack.end()
  return file ?
      createFile(pack, fs as CreateFS, file, opt.mode || 0o666)
    : toStream(pack)
}

/**
 * The sync form of `create`. With no `opt.file`, the result is an
 * iterator of the bytes of the archive. Files are read only when the
 * iterator is read.
 */
export function createSync(
  opt: CreateOptionsSync & { file: string },
  files: PackInputSync[],
): void
export function createSync(
  opt: CreateOptionsSync & { file?: undefined },
  files: PackInputSync[],
): IterableIterator<Uint8Array, undefined>
export function createSync(
  opt: CreateOptionsSync,
  files: PackInputSync[],
): void | IterableIterator<Uint8Array, undefined>
export function createSync(
  opt: CreateOptionsSync,
  files: PackInputSync[],
): void | IterableIterator<Uint8Array, undefined> {
  check(opt, files)
  const { file, strict, onwarn, codecs, platform } = opt
  const fs = opt.fs as CreateFSSync
  const pack = new PackSync(opt)
  for (const item of files) {
    if (typeof item !== 'string' || item.charAt(0) !== '@') pack.add(item)
    else {
      const archive = pack.resolve(item.slice(1))
      pack.add(
        new TarReaderSync(readFileSync(fs, archive, opt.maxReadSize), {
          strict,
          onwarn,
          codecs,
          platform,
          file: archive,
        }),
      )
    }
  }
  if (!file) return pack
  const fd = fs.openSync(file, 'w', opt.mode || 0o666)
  try {
    const batch = new Uint8Array(BATCH)
    let used = 0
    const write = (buf: Uint8Array, length: number) => {
      for (let off = 0; off < length; ) {
        off += fs.writeSync(fd, buf, off, length - off)
      }
    }
    for (const chunk of pack) {
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
  } catch (er) {
    try {
      fs.closeSync(fd)
    } catch {}
    throw er
  }
  fs.closeSync(fd)
}
