import type { Header } from '../header.js'
import type { Pax } from '../pax.js'
import type { EntryTypeName } from '../types.js'
import { concat } from './concat.js'

// The types that are an object of the file system.
const fsTypes = new Set<EntryTypeName>([
  'File',
  'OldFile',
  'Link',
  'SymbolicLink',
  'CharacterDevice',
  'BlockDevice',
  'Directory',
  'FIFO',
  'ContiguousFile',
  'GNUDumpDir',
])

const winPath = (path: string) => path.replaceAll('\\', '/')

/**
 * The metadata of one archive entry: the header fields, with the
 * values of the PAX and GNU extended headers applied.
 */
export class EntryData {
  /** The header block of the entry. */
  header: Header
  /** The PAX header that applies to this entry only. */
  extended?: Pax
  /** The global PAX header in effect. */
  globalExtended?: Pax
  type: EntryTypeName
  path: string
  /** The permission bits only. */
  mode?: number
  uid?: number
  gid?: number
  uname?: string
  gname?: string
  /** The number of bytes in the body. */
  size: number
  mtime?: Date
  atime?: Date
  ctime?: Date
  linkpath?: string
  devmaj: number
  devmin: number
  dev?: number
  ino?: number
  nlink?: number
  /** The absolute path of the entry, when a consumer resolves it. */
  absolute?: string
  /**
   * The body is skipped. Set for a type that is not an object of the
   * file system, and for an entry that the filter refuses.
   */
  ignore: boolean
  /** A consumer sets this when it refuses the entry. */
  invalid: boolean = false
  /** A consumer sets this when it does not support the type. */
  unsupported: boolean = false

  /**
   * @param win32 change each `\` in `path` and `linkpath` to `/`
   */
  constructor(
    header: Header,
    ex?: Pax,
    gex?: Pax,
    win32: boolean = false,
  ) {
    if (!header.path) {
      throw new Error('no path provided for tar.ReadEntry')
    }
    this.header = header
    this.extended = ex
    this.globalExtended = gex
    this.type = header.type
    this.ignore = !fsTypes.has(this.type)
    this.path = win32 ? winPath(header.path) : header.path
    this.mode = header.mode && header.mode & 0o7777
    this.uid = header.uid
    this.gid = header.gid
    this.uname = header.uname
    this.gname = header.gname
    this.size = header.size ?? 0
    this.mtime = header.mtime
    this.atime = header.atime
    this.ctime = header.ctime
    this.linkpath =
      header.linkpath ?
        win32 ? winPath(header.linkpath)
        : header.linkpath
      : undefined
    this.devmaj = header.devmaj
    this.devmin = header.devmin

    // Apply the global values first, so that the local values win.
    // The header already has the size.
    if (gex) this.#apply(gex)
    if (ex) {
      this.#apply(ex)
      // A global header does not set a path or a linkpath.
      if (ex.path != null) this.path = win32 ? winPath(ex.path) : ex.path
      if (ex.linkpath != null) {
        this.linkpath = win32 ? winPath(ex.linkpath) : ex.linkpath
      }
    }
  }

  #apply(ex: Pax) {
    if (ex.uid != null) this.uid = ex.uid
    if (ex.gid != null) this.gid = ex.gid
    if (ex.uname != null) this.uname = ex.uname
    if (ex.gname != null) this.gname = ex.gname
    if (ex.mtime != null) this.mtime = ex.mtime
    if (ex.atime != null) this.atime = ex.atime
    if (ex.ctime != null) this.ctime = ex.ctime
    if (ex.dev != null) this.dev = ex.dev
    if (ex.ino != null) this.ino = ex.ino
    if (ex.nlink != null) this.nlink = ex.nlink
  }
}

/** Where a `ReadEntry` gets its body. */
export type BodySource = {
  /**
   * The next part of the body of `entry`. `null` at the end of the
   * body. `undefined` if more input is needed: then await `fill()`
   * and call this again. Throws if the source moved to a later entry.
   */
  readBody(entry: ReadEntry): Uint8Array | null | undefined
  /** Read more input. */
  fill(): Promise<void>
}

/** Where a `ReadEntrySync` gets its body. */
export type BodySourceSync = {
  /**
   * The next part of the body of `entry`, or `null` at the end of the
   * body. Throws if the source moved to a later entry.
   */
  readBody(entry: ReadEntrySync): Uint8Array | null
}

const decoder = new TextDecoder()
const decode = (parts: Uint8Array[]) => {
  let text = ''
  for (const part of parts) text += decoder.decode(part, { stream: true })
  return text + decoder.decode()
}

const usedError = () => new TypeError('Body has already been consumed')

/**
 * An archive entry with its body, in the shape of a `Response`. The
 * body can be consumed one time, in one way. It must be consumed
 * before the next entry is read: after that, the rest of it is gone.
 */
export class ReadEntry extends EntryData {
  #source?: BodySource
  #used: boolean = false
  #stream?: ReadableStream<Uint8Array>

  constructor(
    header: Header,
    ex?: Pax,
    gex?: Pax,
    win32?: boolean,
    source?: BodySource,
  ) {
    super(header, ex, gex, win32)
    this.#source = source
  }

  /** True when the body started to be consumed. */
  get bodyUsed(): boolean {
    return this.#used
  }

  /**
   * The body as a stream. Each chunk is a view into the input, not a
   * copy. Input is read only when the stream is read.
   */
  get body(): ReadableStream<Uint8Array> {
    if (this.#stream) return this.#stream
    let started = false
    return (this.#stream = new ReadableStream<Uint8Array>(
      {
        pull: async controller => {
          if (!started) {
            this.#claim()
            started = true
          }
          const [part] = await this.#read(1)
          if (part) controller.enqueue(part)
          else controller.close()
        },
      },
      { highWaterMark: 0 },
    ))
  }

  #claim() {
    if (this.#used) throw usedError()
    this.#used = true
  }

  // Add the parts of the body that are in memory to `parts`, up to
  // `max` parts. False if the body has more parts that need input.
  #collect(parts: Uint8Array[], max: number = Infinity): boolean {
    const source = this.#source
    while (source && parts.length < max) {
      const part = source.readBody(this)
      if (part === null) break
      if (part === undefined) return false
      parts.push(part)
    }
    return true
  }

  // Read all the parts of the body that are left, or `max` of them.
  async #read(max?: number): Promise<Uint8Array[]> {
    const parts: Uint8Array[] = []
    while (!this.#collect(parts, max)) await this.#source?.fill()
    return parts
  }

  /** The body in a new `Uint8Array`. */
  async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    this.#claim()
    const parts: Uint8Array[] = []
    while (!this.#collect(parts)) await this.#source?.fill()
    return concat(parts)
  }

  /** The body in a new `ArrayBuffer`. */
  async arrayBuffer(): Promise<ArrayBuffer> {
    return (await this.bytes()).buffer
  }

  /** The body, decoded as UTF-8. */
  async text(): Promise<string> {
    this.#claim()
    return decode(await this.#read())
  }

  /** The body in a new `Blob`. */
  async blob(): Promise<Blob> {
    this.#claim()
    return new Blob((await this.#read()) as Uint8Array<ArrayBuffer>[])
  }
}

/**
 * An archive entry with its body, for sync code. The body can be
 * consumed one time, in one way. It must be consumed before the next
 * entry is read: after that, the rest of it is gone.
 */
export class ReadEntrySync extends EntryData {
  #source?: BodySourceSync
  #used: boolean = false
  #body?: IterableIterator<Uint8Array>

  constructor(
    header: Header,
    ex?: Pax,
    gex?: Pax,
    win32?: boolean,
    source?: BodySourceSync,
  ) {
    super(header, ex, gex, win32)
    this.#source = source
  }

  /** True when the body started to be consumed. */
  get bodyUsed(): boolean {
    return this.#used
  }

  /**
   * The parts of the body. Each one is a view into the input, not a
   * copy. Input is read only when the iterator is read.
   */
  get body(): IterableIterator<Uint8Array> {
    return (this.#body ??= this.#iterate())
  }

  *#iterate(): IterableIterator<Uint8Array> {
    this.#claim()
    for (let part; (part = this.#source?.readBody(this)); ) yield part
  }

  #claim() {
    if (this.#used) throw usedError()
    this.#used = true
  }

  #read(): Uint8Array[] {
    this.#claim()
    const parts: Uint8Array[] = []
    for (let part; (part = this.#source?.readBody(this)); )
      parts.push(part)
    return parts
  }

  /** The body in a new `Uint8Array`. */
  bytes(): Uint8Array<ArrayBuffer> {
    return concat(this.#read())
  }

  /** The body in a new `ArrayBuffer`. */
  arrayBuffer(): ArrayBuffer {
    return this.bytes().buffer
  }

  /** The body, decoded as UTF-8. */
  text(): string {
    return decode(this.#read())
  }
}
