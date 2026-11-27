import { isBlob, isReadableStream, isUint8Array } from './bytes.js'
import { modeFix } from './mode-fix.js'
import type { EntryTypeName } from './types.js'
import * as winchars from './winchars.js'
import { gzip, type Codec, type CodecStream } from './codec.js'
import { concat } from './concat.js'
import type {
  CreateFileHandle,
  CreateFS,
  CreateFSSync,
  CreateStats,
} from './fs.js'
import {
  countOption,
  ownOptions,
  type PackOptions,
  type PackOptionsBase,
  type PackOptionsSync,
} from './options.js'
import { isAbsolute, relative, resolve } from './path.js'
import type { ReadEntry, ReadEntrySync } from './read-entry.js'
import { stripAbsolutePath } from './strip-absolute-path.js'
import { toStream } from './to-stream.js'
import { warn } from './warn.js'
import { win32IsAbsolute, win32Resolve } from './win32-path.js'
import { WriteEntry, type EncodeOptions } from './write-entry.js'

const MAX_READ = 16 * 1024 * 1024
const noop = () => {}

const blockLength = (size: number) => 512 * Math.ceil(size / 512)
const slashes = (path: string) => path.replaceAll('\\', '/')
const idOf = (stat: CreateStats) => `${stat.dev}:${stat.ino}`
const same = (
  a: { dev: number; ino: number },
  b: { dev: number; ino: number },
) => a.dev === b.dev && a.ino === b.ino

const eof = (message: string, path: string) =>
  Object.assign(new Error(message), { path, syscall: 'read', code: 'EOF' })
// The file does not have the number of bytes that its stat gave.
const fewer = (path: string, size: number) =>
  eof(
    `encountered unexpected EOF: ${path} has fewer than the ${size} bytes of its stat`,
    path,
  )
const more = (path: string, size: number) =>
  eof(
    `did not encounter expected EOF: ${path} has more than the ${size} bytes of its stat`,
    path,
  )
const pathOf = (entry: WriteEntry) => entry.absolute ?? entry.path
const tooLong = (entry: WriteEntry) =>
  Object.assign(new Error('writing more data than expected'), {
    path: pathOf(entry),
  })

// The package has more than one copy of each class: the entry points
// `tar` and `tar/core` are separate bundles, and each has an ESM and
// a CommonJS build. `instanceof` is false for an entry of a different
// copy, so these checks use the shape of the item. A `PackJob` is
// always of this copy, because only the pack makes it.

// A source of entries is an iterable. An entry is not.
const isSource = (
  item: object,
): item is AsyncIterable<unknown> | Iterable<unknown> =>
  Symbol.asyncIterator in item || Symbol.iterator in item

// A `WriteEntry` can encode its header. An entry of an archive
// cannot.
const isWriteEntry = (item: object): item is WriteEntry =>
  typeof (item as WriteEntry).encode === 'function'

/** A directory above a path, when a pack follows symbolic links. */
export type Ancestor = { key: string; up?: Ancestor }

/** What `Pack` reads for a path before it writes the entry. */
export type PackLoad = {
  stat: CreateStats
  type: EntryTypeName
  /** The target of a symbolic link. */
  linkpath?: string
  /** The names in a directory. */
  names?: string[]
  /** A file of `maxReadSize` bytes or less, after 512 bytes of zeros. */
  buf?: Uint8Array
  /** A larger file. */
  handle?: CreateFileHandle
  /** The path is a different object now. The pack skips it. */
  changed?: boolean
}

/** A path in the queue of a pack. */
export class PackJob {
  path: string
  absolute: string
  /** The directories above it, when the pack follows symbolic links. */
  up?: Ancestor
  /** The target, when the pack writes the file as a hard link. */
  linkpath?: string
  /** Set when `Pack` starts to read the path. */
  ready?: Promise<PackLoad | undefined>

  constructor(path: string, absolute: string) {
    this.path = path
    this.absolute = absolute
  }
}

/** One item of the queue of a pack, and the item after it. */
export type QueueNode<T> = { item: T; next?: QueueNode<T> }

/**
 * The parts of `Pack` and `PackSync` that are the same: the options,
 * the queue, and the rules that make an entry from a path or from an
 * entry of another archive.
 */
export abstract class PackBase<
  FS,
  E extends ReadEntry | ReadEntrySync,
  S extends object,
> {
  opt: PackOptionsBase<E>
  fs?: FS
  /** The normalized form of `opt.cwd`. */
  cwd?: string
  win32: boolean
  maxReadSize: number
  /** The options of `WriteEntry.encode`. */
  header: EncodeOptions
  /** The compression of the output. */
  codec?: Codec
  codecOptions?: Record<string, unknown>
  /** True after `end()`. */
  ended: boolean = false
  protected head?: QueueNode<PackJob | WriteEntry | E | S>
  protected tail?: QueueNode<PackJob | WriteEntry | E | S>
  protected wake?: () => void
  // The first path of each file that has more than one link.
  #links = new Map<string, string>()

  constructor(
    opt: PackOptionsBase<E> & { fs?: FS },
    compress: 'compress' | 'compressSync',
  ) {
    opt = this.opt = ownOptions(opt)
    this.fs = opt.fs
    this.win32 = opt.platform === 'win32'
    this.maxReadSize = countOption(
      'maxReadSize',
      opt.maxReadSize,
      MAX_READ,
    )
    const { prefix, noPax } = opt
    this.header = {
      prefix: prefix && this.win32 ? slashes(prefix) : prefix,
      noPax,
    }
    const cwd = opt.cwd && (this.win32 ? slashes(opt.cwd) : opt.cwd)
    // This code has no working directory to make a path absolute.
    if (cwd && !(this.win32 ? win32IsAbsolute : isAbsolute)(cwd)) {
      throw new TypeError('cwd must be an absolute path')
    }
    this.cwd = cwd && this.#resolve(cwd, '')

    const set = opt as Record<string, unknown>
    const names = ['gzip', 'brotli', 'zstd', 'compress'].filter(
      name => set[name],
    )
    if (names.length > 1) {
      throw new TypeError(`${names.join(', ')} are mutually exclusive`)
    }
    const [name] = names
    if (name) {
      const custom = opt.compress
      // The named options use a codec of `codecs`, or the gzip of
      // the runtime. The `compress` option has its own codec.
      const [codec, value] =
        !custom ?
          [
            [...(opt.codecs ?? []), gzip].find(c => c.name === name),
            set[name],
          ]
        : Array.isArray(custom) ? custom
        : [custom]
      if (!codec?.[compress]) {
        throw new TypeError(
          `no codec named ${codec?.name ?? name} has a ${compress} function`,
        )
      }
      this.codec = codec
      this.codecOptions = {
        ...(typeof value === 'object' ? value : undefined),
        ...(codec.name === 'gzip' && opt.portable ?
          { portable: true }
        : undefined),
      }
    }
  }

  #resolve(cwd: string, path: string) {
    return this.win32 ? win32Resolve(cwd, path) : resolve(cwd, path)
  }

  /** The absolute form of a path that is relative to `cwd`. */
  resolve(path: string): string {
    if (!this.cwd || !this.fs) {
      throw new TypeError('a path needs the cwd and fs options')
    }
    return this.#resolve(this.cwd, this.win32 ? slashes(path) : path)
  }

  /**
   * Put a path, an entry, or a source of entries at the end of the
   * queue. A directory is added with all that is in it.
   */
  add(item: string | WriteEntry | E | S): this {
    if (this.ended) throw new Error('write after end')
    if (typeof item !== 'string') this.push(item)
    else {
      const path = this.win32 ? slashes(item) : item
      this.push(new PackJob(path || './', this.resolve(path)))
    }
    return this
  }

  /** Add no more. The archive ends after the last item of the queue. */
  end(): this {
    this.ended = true
    this.wake?.()
    return this
  }

  protected push(item: PackJob | WriteEntry | E | S): void {
    const node = { item }
    if (this.tail) this.tail.next = node
    else this.head = node
    this.tail = node
    this.wake?.()
  }

  protected shift(): void {
    this.head = this.head?.next
    if (!this.head) this.tail = undefined
  }

  /**
   * The type of the entry to write for a path, or `undefined` to
   * write no entry. The pack calls it one time for each path, in the
   * order of the queue.
   */
  protected plan(
    job: PackJob,
    stat: CreateStats,
  ): EntryTypeName | undefined {
    const { filter } = this.opt
    if (filter && !filter(job.path, stat)) return
    if (stat.isDirectory()) {
      for (let a = job.up; a; a = a.up) {
        if (a.key !== idOf(stat)) continue
        warn(
          this.opt,
          'TAR_ENTRY_ERROR',
          'directory is its own ancestor',
          {
            path: job.path,
            absolute: job.absolute,
          },
        )
        return
      }
      return 'Directory'
    }
    if (stat.isSymbolicLink()) return 'SymbolicLink'
    if (!stat.isFile()) {
      // A socket, a FIFO, or a device.
      warn(this.opt, 'TAR_ENTRY_UNSUPPORTED', 'unsupported file type', {
        path: job.path,
        absolute: job.absolute,
      })
      return
    }
    if (stat.nlink > 1) {
      const key = idOf(stat)
      const target = this.#links.get(key)
      const cwd = this.cwd as string
      // A link is only made to a path in the cwd. A directory beside
      // the cwd can have a name that starts with the name of the cwd.
      // A path that is added two times is a file each time: a link to
      // itself cannot be extracted.
      if (
        target !== job.absolute &&
        target?.startsWith(cwd.endsWith('/') ? cwd : cwd + '/')
      ) {
        job.linkpath = relative(cwd, target)
        return 'Link'
      }
      this.#links.set(key, job.absolute)
    }
    return 'File'
  }

  /** The jobs for the names in the directory of `job`. */
  protected children(
    job: PackJob,
    names: string[],
    stat: CreateStats,
  ): PackJob[] {
    const base = job.path === './' ? '' : job.path.replace(/\/*$/, '/')
    const dir =
      job.absolute.endsWith('/') ? job.absolute : job.absolute + '/'
    // Only a pack that follows symbolic links can find a directory
    // in itself.
    const up =
      this.opt.follow ? { key: idOf(stat), up: job.up } : undefined
    // Node.js sorts the names of a directory. Bun does not. Sort
    // them, so that each runtime makes the same archive.
    return [...names].sort().map(name => {
      const child = new PackJob(base + name, dir + name)
      child.up = up
      return child
    })
  }

  /** Report a path that is a different object after its `lstat`. */
  protected changed(job: PackJob, type: EntryTypeName): void {
    warn(
      this.opt,
      'TAR_ENTRY_ERROR',
      type === 'Directory' ?
        'directory changed between lstat and readdir'
      : 'file changed between lstat and open',
      { path: job.path, absolute: job.absolute },
    )
  }

  /** Make the entry for a path. */
  protected pathEntry(
    job: PackJob,
    stat: CreateStats,
    type: EntryTypeName,
    linkpath: string | undefined,
    body: WriteEntry['body'],
  ): WriteEntry {
    const { processUid, processUname = '' } = this.opt
    const entry = new WriteEntry(
      {
        path: job.path,
        type,
        mode: stat.mode,
        uid: stat.uid,
        gid: stat.gid,
        uname: stat.uid === processUid ? processUname : '',
        size: type === 'File' ? stat.size : 0,
        mtime: stat.mtime,
        atime: stat.atime,
        ctime: stat.ctime,
        linkpath: linkpath && this.win32 ? slashes(linkpath) : linkpath,
        dev: stat.dev,
        ino: stat.ino,
        nlink: stat.nlink,
      },
      body,
    )
    entry.absolute = job.absolute
    return this.#finish(entry, true)
  }

  /**
   * Make the entry to write for an entry that the caller added.
   * `undefined` if the filter refuses an entry of another archive.
   */
  protected addedEntry(item: WriteEntry | E): WriteEntry | undefined {
    if (isWriteEntry(item)) return this.#finish(item, false)
    const { filter } = this.opt
    if (filter && !filter(item.path, item)) return
    return this.#finish(new WriteEntry(item, item.body), false)
  }

  // Apply the options to the fields of the entry.
  #finish(entry: WriteEntry, fromPath: boolean): WriteEntry {
    const { opt, win32 } = this
    const dir = entry.type === 'Directory'
    if (win32 && !fromPath) {
      entry.path = slashes(entry.path)
      if (entry.linkpath) entry.linkpath = slashes(entry.linkpath)
    }
    const [root, stripped] =
      opt.preservePaths ? ['', entry.path] : stripAbsolutePath(entry.path)
    entry.path = stripped
    if (fromPath) {
      if (win32) entry.path = winchars.decode(entry.path)
      if (entry.path === '') entry.path = './'
    }
    if (root) {
      warn(opt, 'TAR_ENTRY_INFO', `stripping ${root} from absolute path`, {
        entry,
        path: root + entry.path,
      })
    }
    if (fromPath && dir && !entry.path.endsWith('/')) entry.path += '/'

    if (opt.portable) {
      entry.uid =
        entry.gid =
        entry.dev =
        entry.ino =
        entry.nlink =
          undefined
      entry.uname = entry.gname = undefined
      entry.atime = entry.ctime = undefined
    }
    if (entry.mode !== undefined) {
      entry.mode = modeFix(entry.mode, dir, !!opt.portable)
    }
    entry.mtime =
      opt.noMtime || (opt.portable && dir) ?
        undefined
      : opt.mtime || entry.mtime
    return entry
  }
}

// Read from the handle into `buf` at `off`, until the buffer is full
// or the file has no more bytes. `pos` is the place in the file.
// Returns the new place.
const fill = async (
  handle: CreateFileHandle,
  buf: Uint8Array,
  off: number,
  pos: number,
  size: number,
  path: string,
): Promise<number> => {
  while (off < buf.length && pos < size) {
    const { bytesRead } = await handle.read(
      buf,
      off,
      buf.length - off,
      pos,
    )
    if (bytesRead <= 0) throw fewer(path, size)
    if (bytesRead > size - pos) throw more(path, size)
    off += bytesRead
    pos += bytesRead
  }
  return pos
}

const fillSync = (
  fs: CreateFSSync,
  fd: number,
  buf: Uint8Array,
  off: number,
  pos: number,
  size: number,
  path: string,
): number => {
  while (off < buf.length && pos < size) {
    const bytesRead = fs.readSync(fd, buf, off, buf.length - off, pos)
    if (bytesRead <= 0) throw fewer(path, size)
    if (bytesRead > size - pos) throw more(path, size)
    off += bytesRead
    pos += bytesRead
  }
  return pos
}

// The chunks of a body, from each kind of content.
async function* chunks(
  body: WriteEntry['body'],
): AsyncGenerator<Uint8Array, void, void> {
  if (isUint8Array(body)) yield body
  else if (isBlob(body) || isReadableStream(body)) {
    const reader = (isBlob(body) ? body.stream() : body).getReader()
    try {
      for (;;) {
        const res = await reader.read()
        if (res.done) break
        yield res.value
      }
    } finally {
      await reader.cancel().catch(noop)
    }
  } else if (body) yield* body
}

function* chunksSync(
  body: WriteEntry['body'],
): Generator<Uint8Array, void, void> {
  if (isUint8Array(body)) yield body
  else if (body && Symbol.iterator in body) yield* body
  else if (body) {
    throw new TypeError(
      'PackSync needs a body that is a string, a Uint8Array, or an iterable',
    )
  }
}

// Count the bytes of a body part. Returns the bytes that are left.
const count = (entry: WriteEntry, remain: number, chunk: Uint8Array) => {
  if (chunk.length > remain) throw tooLong(entry)
  return remain - chunk.length
}

// The zeros after a body, or an error if the body was too short.
const padding = (entry: WriteEntry, remain: number) => {
  if (remain) throw eof('encountered unexpected EOF', pathOf(entry))
  return new Uint8Array(blockLength(entry.size) - entry.size)
}

// The body of the entry, with the zeros that fill its last block.
async function* bodyBlocks(
  entry: WriteEntry,
): AsyncGenerator<Uint8Array, void, void> {
  if (!entry.size) return
  let remain = entry.size
  for await (const chunk of chunks(entry.body)) {
    remain = count(entry, remain, chunk)
    yield chunk
  }
  const pad = padding(entry, remain)
  if (pad.length) yield pad
}

function* bodyBlocksSync(
  entry: WriteEntry,
): Generator<Uint8Array, void, void> {
  if (!entry.size) return
  let remain = entry.size
  for (const chunk of chunksSync(entry.body)) {
    remain = count(entry, remain, chunk)
    yield chunk
  }
  const pad = padding(entry, remain)
  if (pad.length) yield pad
}

/** What `Pack.add()` takes. */
export type PackInput =
  | string
  | WriteEntry
  | ReadEntry
  | AsyncIterable<WriteEntry | ReadEntry>
  | Iterable<WriteEntry | ReadEntry>

/** What `PackSync.add()` takes. */
export type PackInputSync =
  | string
  | WriteEntry
  | ReadEntrySync
  | Iterable<WriteEntry | ReadEntrySync>

/**
 * Makes an archive. `add()` paths and entries, then `end()`. The
 * pack is the async iterator of the bytes of the archive, compressed
 * if an option selects a codec.
 *
 * It reads the file system only when the consumer asks for bytes.
 * Then it reads the first `jobs` paths of the queue at the same
 * time, and writes them in the order of the queue. The entries of a
 * directory go to the end of the queue.
 *
 * `return()` closes each file that is open.
 */
export class Pack
  extends PackBase<
    CreateFS,
    ReadEntry,
    | AsyncIterable<WriteEntry | ReadEntry>
    | Iterable<WriteEntry | ReadEntry>
  >
  implements AsyncIterableIterator<Uint8Array, undefined>
{
  jobs: number
  #out?: AsyncGenerator<Uint8Array, void, void>
  // Settles when the pack called `plan()` for each path that it
  // started to read. It keeps the calls in the order of the queue.
  #planned: Promise<unknown> = Promise.resolve()

  constructor(opt: PackOptions = {}) {
    super(opt, 'compress')
    this.jobs = countOption('jobs', (this.opt as PackOptions).jobs, 4)
  }

  async next(): Promise<IteratorResult<Uint8Array, undefined>> {
    const res = await (this.#out ??= this.#output()).next()
    return res.done ? { value: undefined, done: true } : res
  }

  /** Stop, and close each file that is open. */
  async return(): Promise<IteratorResult<Uint8Array, undefined>> {
    this.end()
    await this.#out?.return()
    return { value: undefined, done: true }
  }

  [Symbol.asyncIterator](): this {
    return this
  }

  #output(): AsyncGenerator<Uint8Array, void, void> {
    const { codec } = this
    return codec?.compress ?
        this.#compress(codec.compress(this.codecOptions))
      : this.#run()
  }

  async *#compress(
    stream: CodecStream,
  ): AsyncGenerator<Uint8Array, void, void> {
    const run = this.#run()
    // An error of the pack goes to the consumer, also when the codec
    // does not pass it on: then the cancel ends the read.
    let failure: { er: unknown } | undefined
    const reader = toStream({
      next: () =>
        run.next().catch(er => {
          failure = { er }
          void reader.cancel().catch(noop)
          throw er
        }),
    })
      .pipeThrough(stream)
      .getReader()
    try {
      for (;;) {
        const res = await reader.read()
        if (failure) throw failure.er
        if (res.done) break
        yield res.value
      }
    } finally {
      await reader.cancel().catch(noop)
      await run.return()
    }
  }

  async *#run(): AsyncGenerator<Uint8Array, void, void> {
    try {
      for (;;) {
        const node = this.head
        if (!node) {
          if (this.ended) break
          await new Promise<void>(res => (this.wake = res))
          continue
        }
        this.#start()
        const { item } = node
        if (item instanceof PackJob) yield* this.#path(item)
        else if (!isSource(item)) yield* this.#entry(item)
        else for await (const entry of item) yield* this.#entry(entry)
        this.shift()
      }
      yield new Uint8Array(1024)
    } finally {
      // Close the files of the paths that the pack did not write.
      for (let node = this.head; node; node = node.next) {
        const { item } = node
        if (!(item instanceof PackJob) || !item.ready) break
        const load = await item.ready.catch(noop)
        await load?.handle?.close().catch(noop)
      }
    }
  }

  // Start to read the paths at the start of the queue.
  #start() {
    const fs = this.fs as CreateFS
    let node = this.head
    for (let n = 0; node && n < this.jobs; n++, node = node.next) {
      const job = node.item
      // An entry can change what the filter does with a later path.
      if (!(job instanceof PackJob)) break
      if (job.ready) continue
      const stat =
        this.opt.follow ? fs.stat(job.absolute) : fs.lstat(job.absolute)
      stat.catch(noop)
      const planned = this.#planned
        .then(() => stat)
        .then(st => {
          const type = this.plan(job, st)
          return type && { load: this.#load(fs, job, st, type) }
        })
      this.#planned = planned.catch(noop)
      job.ready = planned.then(p => p?.load)
      job.ready.catch(noop)
    }
  }

  async #load(
    fs: CreateFS,
    job: PackJob,
    stat: CreateStats,
    type: EntryTypeName,
  ): Promise<PackLoad> {
    const { absolute } = job
    const { follow, noDirRecurse } = this.opt
    const load: PackLoad = { stat, type }
    if (type === 'SymbolicLink') {
      load.linkpath = await fs.readlink(absolute)
    } else if (type === 'Directory' && !noDirRecurse) {
      load.names = await fs.readdir(absolute)
      load.changed = !follow && !same(stat, await fs.lstat(absolute))
    } else if (type === 'File' && stat.size) {
      const handle = await fs.open(absolute, 'r')
      try {
        const { size } = stat
        const length = blockLength(size)
        if (!follow && !same(stat, await handle.stat())) {
          load.changed = true
        } else if (length > this.maxReadSize) load.handle = handle
        else {
          load.buf = new Uint8Array(512 + length)
          await fill(handle, load.buf, 512, 0, size, absolute)
        }
      } catch (er) {
        await handle.close().catch(noop)
        throw er
      }
      if (!load.handle) await handle.close()
    }
    return load
  }

  async *#path(job: PackJob): AsyncGenerator<Uint8Array, void, void> {
    const load = await job.ready
    if (!load) return
    const { stat, type, names, buf, handle } = load
    if (load.changed) return this.changed(job, type)
    let ok = false
    try {
      const body =
        buf ?
          buf.subarray(512, 512 + stat.size)
        : handle && this.#read(handle, stat.size, job.absolute)
      const entry = this.pathEntry(
        job,
        stat,
        type,
        load.linkpath ?? job.linkpath,
        body,
      )
      if (names) {
        for (const child of this.children(job, names, stat)) {
          this.push(child)
        }
      }
      await this.opt.onWriteEntry?.(entry)
      // The header goes in the space before a body that is in `buf`.
      const whole = buf && entry.body === body && entry.size === stat.size
      yield* entry.encode(this.header, whole ? buf : undefined)
      if (!whole) yield* bodyBlocks(entry)
      ok = true
    } finally {
      if (handle) {
        load.handle = undefined
        const closed = handle.close()
        await (ok ? closed : closed.catch(noop))
      }
    }
  }

  // The chunks of a file that is larger than `maxReadSize`.
  async *#read(
    handle: CreateFileHandle,
    size: number,
    path: string,
  ): AsyncGenerator<Uint8Array, void, void> {
    const length = blockLength(size)
    for (let pos = 0; pos < size; ) {
      // Ask for the bytes of the last block also, to find a file that
      // is larger now.
      const buf = new Uint8Array(Math.min(length - pos, this.maxReadSize))
      const end = await fill(handle, buf, 0, pos, size, path)
      yield buf.subarray(0, end - pos)
      pos = end
    }
  }

  async *#entry(
    item: WriteEntry | ReadEntry,
  ): AsyncGenerator<Uint8Array, void, void> {
    const entry = this.addedEntry(item)
    if (!entry) return
    await this.opt.onWriteEntry?.(entry)
    yield* entry.encode(this.header)
    yield* bodyBlocks(entry)
  }
}

/**
 * Makes an archive with no promise. `add()` paths and entries. The
 * pack is the iterator of the bytes of the archive. It reads the
 * file system only when the consumer asks for bytes, one path at a
 * time. The entries of a directory come before the next item that
 * the caller added.
 *
 * The pack ends when the iterator comes to the end of the queue.
 * With compression, the iterator gives all the archive in one chunk.
 */
export class PackSync
  extends PackBase<
    CreateFSSync,
    ReadEntrySync,
    Iterable<WriteEntry | ReadEntrySync>
  >
  implements IterableIterator<Uint8Array, undefined>
{
  #out?: Generator<Uint8Array, void, void>

  constructor(opt: PackOptionsSync = {}) {
    super(opt, 'compressSync')
  }

  next(): IteratorResult<Uint8Array, undefined> {
    const res = (this.#out ??= this.#output()).next()
    return res.done ? { value: undefined, done: true } : res
  }

  /** Stop, and close the file that is open. */
  return(): IteratorResult<Uint8Array, undefined> {
    this.ended = true
    this.#out?.return()
    return { value: undefined, done: true }
  }

  [Symbol.iterator](): this {
    return this
  }

  *#output(): Generator<Uint8Array, void, void> {
    const { codec } = this
    if (!codec?.compressSync) return yield* this.#run()
    yield codec.compressSync(concat([...this.#run()]), this.codecOptions)
  }

  *#run(): Generator<Uint8Array, void, void> {
    for (let node; (node = this.head); this.shift()) {
      const { item } = node
      if (item instanceof PackJob) {
        const jobs = [item]
        for (const job of jobs) yield* this.#path(job, jobs)
      } else if (!isSource(item)) yield* this.#entry(item)
      else for (const entry of item) yield* this.#entry(entry)
    }
    this.ended = true
    yield new Uint8Array(1024)
  }

  *#path(
    job: PackJob,
    jobs: PackJob[],
  ): Generator<Uint8Array, void, void> {
    const fs = this.fs as CreateFSSync
    const { absolute } = job
    const { follow, noDirRecurse } = this.opt
    const stat = follow ? fs.statSync(absolute) : fs.lstatSync(absolute)
    const type = this.plan(job, stat)
    if (!type) return
    let { linkpath } = job
    let buf: Uint8Array | undefined
    let body: WriteEntry['body']
    let fd: number | undefined
    let ok = false
    try {
      if (type === 'SymbolicLink') linkpath = fs.readlinkSync(absolute)
      else if (type === 'Directory' && !noDirRecurse) {
        const names = fs.readdirSync(absolute)
        if (!follow && !same(stat, fs.lstatSync(absolute))) {
          return this.changed(job, type)
        }
        jobs.push(...this.children(job, names, stat))
      } else if (type === 'File' && stat.size) {
        const { size } = stat
        const length = blockLength(size)
        fd = fs.openSync(absolute, 'r')
        if (!follow && !same(stat, fs.fstatSync(fd))) {
          return this.changed(job, type)
        }
        if (length > this.maxReadSize) {
          body = this.#read(fs, fd, size, absolute)
        } else {
          buf = new Uint8Array(512 + length)
          fillSync(fs, fd, buf, 512, 0, size, absolute)
          body = buf.subarray(512, 512 + size)
        }
      }
      const entry = this.pathEntry(job, stat, type, linkpath, body)
      this.opt.onWriteEntry?.(entry)
      // The header goes in the space before a body that is in `buf`.
      const whole = buf && entry.body === body && entry.size === stat.size
      yield* entry.encode(this.header, whole ? buf : undefined)
      if (!whole) yield* bodyBlocksSync(entry)
      ok = true
    } finally {
      // An error of close must not hide the first error.
      if (fd !== undefined && !ok) {
        try {
          fs.closeSync(fd)
        } catch {}
      }
    }
    if (fd !== undefined) fs.closeSync(fd)
  }

  // The chunks of a file that is larger than `maxReadSize`.
  *#read(
    fs: CreateFSSync,
    fd: number,
    size: number,
    path: string,
  ): Generator<Uint8Array, void, void> {
    const length = blockLength(size)
    for (let pos = 0; pos < size; ) {
      const buf = new Uint8Array(Math.min(length - pos, this.maxReadSize))
      const end = fillSync(fs, fd, buf, 0, pos, size, path)
      yield buf.subarray(0, end - pos)
      pos = end
    }
  }

  *#entry(
    item: WriteEntry | ReadEntrySync,
  ): Generator<Uint8Array, void, void> {
    const entry = this.addedEntry(item)
    if (!entry) return
    this.opt.onWriteEntry?.(entry)
    yield* entry.encode(this.header)
    yield* bodyBlocksSync(entry)
  }
}
