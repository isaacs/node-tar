import { gzip, type Codec } from './codec.js'
import { dealias, type WithAliases } from './dealias.js'
import {
  packFiles,
  packFilesSync,
  writeChunks,
  writeChunksSync,
} from './create.js'
import type { ReplaceOptions, ReplaceOptionsSync } from './options.js'
import type { PackInput, PackInputSync } from './pack.js'
import { Parser } from './parser.js'

// The most bytes to read from the archive at one time.
const CHUNK = 64 * 1024
// Thrown in the parser to stop at the first block that is not valid.
const STOP = {}
const noop = () => {}

const compressed = () => new Error('cannot append to compressed archives')

const check = (
  opt: ReplaceOptions | ReplaceOptionsSync,
  files: unknown[],
) => {
  const { file } = opt
  if (!file) throw new TypeError('file is required')
  if (
    opt.gzip ||
    opt.brotli ||
    opt.zstd ||
    file.endsWith('.br') ||
    file.endsWith('.tbr')
  ) {
    throw new TypeError(compressed().message)
  }
  if (!files?.length) {
    throw new TypeError('no paths specified to add/replace')
  }
}

/**
 * Finds the place in an archive file where new entries go: the end
 * of the last complete entry before the first block that is not a
 * valid header. A PAX or GNU header with no entry after it is not a
 * complete entry.
 *
 * Read the file into `buf` at `pos`, and call `push()`, until it
 * returns false. The bodies of the entries are not read.
 */
export class AppendScan {
  buf: Uint8Array = new Uint8Array(CHUNK)
  /** The place in the file of the next read. */
  pos: number = 0
  #size: number
  #parser: Parser
  #codecs: Codec[]
  #mtimes?: Map<string, Date>

  /**
   * @param size the size of the file
   * @param mtimes gets the path and the `mtime` of each complete entry
   */
  constructor(
    size: number,
    codecs: Codec[] = [],
    mtimes?: Map<string, Date>,
  ) {
    this.#size = size
    this.#codecs = [...codecs, gzip]
    this.#mtimes = mtimes
    this.#parser = new Parser({
      // The parser must not give the bodies.
      filter: () => false,
      onwarn: (_code, _message, data) => {
        // An error of the header code goes to the caller.
        throw data instanceof Error ? data : STOP
      },
    })
  }

  /** The place in the file where new entries go. */
  get position(): number {
    return this.#parser.position
  }

  /** The number of bytes to read into `buf` at `pos`. */
  get want(): number {
    return Math.min(CHUNK, this.#size - this.pos)
  }

  /**
   * Parse the first `length` bytes of `buf`. False if the place is
   * found. Throws if the file is compressed.
   */
  push(length: number): boolean {
    const chunk = this.buf.subarray(0, length)
    if (this.pos === 0 && this.#codecs.some(c => c.detect(chunk))) {
      throw compressed()
    }
    const parser = this.#parser
    this.pos += length
    // the end of the body of the last entry in the chunk
    let end = 0
    parser.push(chunk)
    try {
      for (let ev; (ev = parser.next()); ) {
        if (ev.type !== 'entry') return false
        const { entry } = ev
        end = parser.offset + 512 * Math.ceil(entry.size / 512)
        if (end > this.#size) return false
        if (entry.mtime) this.#mtimes?.set(entry.path, entry.mtime)
      }
      // The parser does not look at the bytes of a body. Give it the
      // bytes of the buffer in place of the rest of the body.
      while (this.pos < end) {
        const n = Math.min(CHUNK, end - this.pos)
        parser.push(this.buf.subarray(0, n))
        parser.next()
        this.pos += n
      }
    } catch (er) {
      if (er !== STOP) throw er
      return false
    }
    return length > 0 && this.pos < this.#size
  }
}

/**
 * Add the files to the end of an archive file that is not
 * compressed. The files are the same as for `create`. If the archive
 * does not exist, it is made.
 *
 * The new entries go after the last complete entry of the archive.
 * A reader of the archive gets the old entry and then the new entry
 * of a path that is in it two times.
 */
export const replace = async (
  options: WithAliases<ReplaceOptions>,
  files: PackInput[],
): Promise<void> => {
  const opt = dealias<ReplaceOptions>(options)
  check(opt, files)
  const { fs, file } = opt
  const pack = packFiles(opt, files)
  if (pack.codec) throw new TypeError(compressed().message)
  const handle = await fs.open(file, 'r+').catch(er => {
    if ((er as { code?: string })?.code !== 'ENOENT') throw er
    return fs.open(file, 'w+', opt.mode || 0o666)
  })
  let ok = false
  try {
    const { size } = await handle.stat()
    const scan = new AppendScan(size, opt.codecs, opt.mtimeCache)
    while (
      scan.push(
        (await handle.read(scan.buf, 0, scan.want, scan.pos)).bytesRead,
      )
    );
    await writeChunks(handle, pack, scan.position)
    ok = true
  } finally {
    const closed = handle.close()
    await (ok ? closed : closed.catch(noop))
  }
}

/** The sync form of `replace`. */
export const replaceSync = (
  options: WithAliases<ReplaceOptionsSync>,
  files: PackInputSync[],
): void => {
  const opt = dealias<ReplaceOptionsSync>(options)
  check(opt, files)
  const { fs, file } = opt
  const pack = packFilesSync(opt, files)
  if (pack.codec) throw new TypeError(compressed().message)
  let fd: number
  try {
    fd = fs.openSync(file, 'r+')
  } catch (er) {
    if ((er as { code?: string })?.code !== 'ENOENT') throw er
    fd = fs.openSync(file, 'w+', opt.mode || 0o666)
  }
  try {
    const { size } = fs.fstatSync(fd)
    const scan = new AppendScan(size, opt.codecs, opt.mtimeCache)
    while (scan.push(fs.readSync(fd, scan.buf, 0, scan.want, scan.pos)));
    writeChunksSync(fs, fd, pack, scan.position)
  } catch (er) {
    try {
      fs.closeSync(fd)
    } catch {}
    throw er
  }
  fs.closeSync(fd)
}
