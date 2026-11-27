import {
  isArrayBuffer,
  isBlob,
  isReadableStream,
  isUint8Array,
} from './bytes.js'
import { Header } from './header.js'
import { gzip, type Codec } from './codec.js'
import { concat } from './concat.js'
import {
  ownOptions,
  type ReadOptions,
  type ReadOptionsSync,
  type TarInput,
  type TarInputSync,
} from './options.js'
import { Parser } from './parser.js'
import {
  ReadEntry,
  ReadEntrySync,
  type BodySource,
  type BodySourceSync,
  type EntryData,
} from './read-entry.js'
import { SKIP, type Skip } from './read-file.js'
import { tarError } from './warn.js'

// A source of input chunks: an iterator, or the reader of a stream.
type Source = Partial<Skip> & {
  next():
    | IteratorResult<Uint8Array, unknown>
    | Promise<IteratorResult<Uint8Array, unknown>>
  return?(): unknown
}
type SourceSync = Iterator<Uint8Array, unknown> & Partial<Skip>

// The number of bytes to read before the choice of a codec.
const headLength = (codecs: Codec[]) =>
  Math.max(512, ...codecs.map(c => c.headLength))

const isTar = (head: Uint8Array) => {
  try {
    const header = new Header(head)
    return header.cksumValid || header.nullBlock
  } catch {
    return false
  }
}

const findCodec = (
  codecs: Codec[],
  head: Uint8Array,
  file: string = '',
): Codec | undefined =>
  codecs.find(c => c.detect(head)) ??
  (isTar(head) ? undefined : (
    codecs.find(c => c.extensions?.some(x => file.endsWith(x)))
  ))

const maxRatio = (opt: ReadOptions<never>) =>
  typeof opt.maxDecompressionRatio === 'number' ?
    opt.maxDecompressionRatio
  : 1000

const abort = (opt: ReadOptions<never>, er: Error) =>
  tarError(opt, 'TAR_ABORT', er, { recoverable: false })

const ratioError = (opt: ReadOptions<never>, ratio: number, max: number) =>
  abort(
    opt,
    new Error(
      `max decompression ratio exceeded: ${ratio.toFixed(2)} > ${max}`,
    ),
  )

const notCurrent = () =>
  new TypeError('The body of an entry cannot be read after a later entry')

/**
 * Gets entries and the parts of their bodies from a `Parser`. The
 * readers use it. It does not read input.
 */
export class EntryCursor<E extends EntryData> {
  parser: Parser<E>
  /** The entry that has a body to read now. */
  current?: E
  /** True after the end of the archive. */
  ended: boolean = false

  constructor(parser: Parser<E>) {
    this.parser = parser
  }

  /**
   * The next entry that is not ignored. `null` at the end of the
   * archive. `undefined` if the parser needs more input. The rest of
   * the body of the entry before it is skipped.
   */
  entry(): E | null | undefined {
    this.current = undefined
    if (this.ended) return null
    for (let ev; (ev = this.parser.next()); ) {
      if (ev.type === 'end') {
        this.ended = true
        return null
      }
      if (ev.type === 'entry' && !ev.entry.ignore) {
        return (this.current = ev.entry)
      }
    }
  }

  /**
   * The next part of the body of `entry`. `null` at the end of the
   * body. `undefined` if the parser needs more input.
   */
  body(entry: E): Uint8Array | null | undefined {
    if (entry !== this.current) throw notCurrent()
    const ev = this.parser.next()
    if (!ev) return undefined
    if (ev.type === 'body') return ev.data
    this.current = undefined
    return null
  }
}

// Skip the rest of a body that no consumer reads, if it is after the
// input that the parser has, and the source can skip it. The source
// must be the input of the reader: decompressed data has no place in
// the input.
const skipBody = <E extends EntryData>(
  cursor: EntryCursor<E>,
  source: Partial<Skip>,
) => {
  if (cursor.current) return
  const n = cursor.parser.bodyRemain
  if (n && source[SKIP]?.(n)) cursor.parser.skipBody()
}

const toSource = (input: TarInput): Source => {
  if (isUint8Array(input)) return [input].values()
  if (isArrayBuffer(input)) return [new Uint8Array(input)].values()
  if (isBlob(input)) input = input.stream()
  if (isReadableStream(input)) {
    const reader = input.getReader()
    return { next: () => reader.read(), return: () => reader.cancel() }
  }
  return Symbol.asyncIterator in input ?
      input[Symbol.asyncIterator]()
    : input[Symbol.iterator]()
}

/**
 * Reads the entries of an archive from async input. It is the
 * iterator that `entries()` returns.
 *
 * Input is read only when the consumer asks for the next entry or
 * for more of a body. `poll()` and `fill()` do the same work as
 * `next()`, with no promise for an entry that is in memory.
 */
export class TarReader
  implements AsyncIterableIterator<ReadEntry, undefined>, BodySource
{
  parser: Parser<ReadEntry>
  #cursor: EntryCursor<ReadEntry>
  #opt: ReadOptions
  #input: Source
  #source?: Source
  // the first bytes of input that is not compressed
  #head?: Uint8Array
  #filling?: Promise<void>
  #done: boolean = false

  constructor(input: TarInput, opt: ReadOptions = {}) {
    opt = ownOptions(opt)
    const win32 = opt.platform === 'win32'
    this.parser = new Parser<ReadEntry>(
      opt,
      (header, ex, gex) => new ReadEntry(header, ex, gex, win32, this),
    )
    this.#cursor = new EntryCursor(this.parser)
    this.#opt = opt
    this.#input = toSource(input)
  }

  /**
   * The next entry, if it is in memory. `null` at the end of the
   * archive. `undefined` if more input is needed: then await `fill()`
   * and call this again.
   */
  poll(): ReadEntry | null | undefined {
    return this.#done ? null : this.#cursor.entry()
  }

  readBody(entry: ReadEntry): Uint8Array | null | undefined {
    return this.#cursor.body(entry)
  }

  /** Read one chunk of input, and give it to the parser. */
  fill(): Promise<void> {
    return (this.#filling ??= this.#fill())
  }

  async #fill() {
    try {
      const source = (this.#source ??= await this.#open(this.#input))
      const head = this.#head
      this.#head = undefined
      if (source === this.#input) skipBody(this.#cursor, source)
      const res = head ? { value: head, done: false } : await source.next()
      if (res.done) this.parser.end()
      else this.parser.push(res.value)
    } finally {
      this.#filling = undefined
    }
  }

  // Read the first bytes, and add the decompression if they need it.
  async #open(input: Source): Promise<Source> {
    const opt = this.#opt
    const codecs = [...(opt.codecs ?? []), gzip]
    const need = headLength(codecs)
    let head: Uint8Array | undefined
    while (!head || head.length < need) {
      const res = await input.next()
      if (res.done) break
      head = head ? concat([head, res.value]) : res.value
    }
    const codec = head && findCodec(codecs, head, opt.file)
    if (!codec) {
      this.#head = head
      return input
    }
    let compressed = 0
    let decompressed = 0
    const reader = new ReadableStream<Uint8Array>({
      pull: async controller => {
        const res =
          head ? { value: head, done: false } : await input.next()
        head = undefined
        if (res.done) return controller.close()
        compressed += res.value.length
        controller.enqueue(res.value)
      },
      cancel: async () => {
        await input.return?.()
      },
    })
      .pipeThrough(codec.decompress())
      .getReader()
    const max = maxRatio(opt)
    return {
      next: async () => {
        const res = await reader.read().catch(er => {
          throw abort(opt, er as Error)
        })
        if (!res.done) {
          decompressed += res.value.length
          const ratio = decompressed / compressed
          if (ratio > max) throw ratioError(opt, ratio, max)
        }
        return res
      },
      return: () => reader.cancel(),
    }
  }

  async next(): Promise<IteratorResult<ReadEntry, undefined>> {
    try {
      for (;;) {
        const entry = this.poll()
        if (entry) return { value: entry, done: false }
        if (entry === null) break
        await this.fill()
      }
    } catch (er) {
      await this.return()
      throw er
    }
    return this.return()
  }

  /** Stop reading, and release the input. */
  async return(): Promise<IteratorResult<ReadEntry, undefined>> {
    if (!this.#done) {
      this.#done = true
      this.#cursor.current = undefined
      await (this.#source ?? this.#input).return?.()
    }
    return { value: undefined, done: true }
  }

  [Symbol.asyncIterator](): this {
    return this
  }
}

/**
 * Reads the entries of an archive from sync input. It is the
 * iterator that `entriesSync()` returns.
 */
export class TarReaderSync
  implements IterableIterator<ReadEntrySync, undefined>, BodySourceSync
{
  parser: Parser<ReadEntrySync>
  #cursor: EntryCursor<ReadEntrySync>
  #opt: ReadOptionsSync
  #input: SourceSync
  #source?: SourceSync
  // the first bytes of input that is not compressed
  #head?: Uint8Array
  #done: boolean = false

  constructor(input: TarInputSync, opt: ReadOptionsSync = {}) {
    opt = ownOptions(opt)
    const win32 = opt.platform === 'win32'
    this.parser = new Parser<ReadEntrySync>(
      opt,
      (header, ex, gex) => new ReadEntrySync(header, ex, gex, win32, this),
    )
    this.#cursor = new EntryCursor(this.parser)
    this.#opt = opt
    this.#input =
      isUint8Array(input) ? [input].values()
      : isArrayBuffer(input) ? [new Uint8Array(input)].values()
      : input[Symbol.iterator]()
  }

  readBody(entry: ReadEntrySync): Uint8Array | null {
    for (;;) {
      const part = this.#cursor.body(entry)
      if (part !== undefined) return part
      this.#fill()
    }
  }

  #fill() {
    const source = (this.#source ??= this.#open(this.#input))
    const head = this.#head
    this.#head = undefined
    if (source === this.#input) skipBody(this.#cursor, source)
    const res = head ? { value: head, done: false } : source.next()
    if (res.done) this.parser.end()
    else this.parser.push(res.value)
  }

  // Read the first bytes. If they are compressed, read and decompress
  // all the input.
  #open(input: SourceSync): SourceSync {
    const opt = this.#opt
    const codecs = [...(opt.codecs ?? []), gzip]
    const need = headLength(codecs)
    let head: Uint8Array | undefined
    let res: IteratorResult<Uint8Array, unknown>
    while ((!head || head.length < need) && !(res = input.next()).done) {
      head = head ? concat([head, res.value]) : res.value
    }
    const codec = head && findCodec(codecs, head, opt.file)
    if (!head || !codec) {
      this.#head = head
      return input
    }
    const { decompressSync } = codec
    if (!decompressSync) {
      throw abort(
        opt,
        new Error(
          `the ${codec.name} codec has no decompressSync function`,
        ),
      )
    }
    const parts = [head]
    while (!(res = input.next()).done) parts.push(res.value)
    const data = concat(parts)
    const max = maxRatio(opt)
    let out: Uint8Array
    try {
      out = decompressSync(data, { maxOutputLength: data.length * max })
    } catch (er) {
      throw abort(opt, er as Error)
    }
    const ratio = out.length / data.length
    if (ratio > max) throw ratioError(opt, ratio, max)
    return [out].values()
  }

  next(): IteratorResult<ReadEntrySync, undefined> {
    try {
      for (;;) {
        const entry = this.#done ? null : this.#cursor.entry()
        if (entry) return { value: entry, done: false }
        if (entry === null) break
        this.#fill()
      }
    } catch (er) {
      this.return()
      throw er
    }
    return this.return()
  }

  /** Stop reading, and release the input. */
  return(): IteratorResult<ReadEntrySync, undefined> {
    if (!this.#done) {
      this.#done = true
      this.#cursor.current = undefined
      ;(this.#source ?? this.#input).return?.()
    }
    return { value: undefined, done: true }
  }

  [Symbol.iterator](): this {
    return this
  }
}

/**
 * Read the entries of an archive. Gzip input is decompressed.
 *
 * Read the body of an entry before the next entry: when the iterator
 * moves on, the rest of the body is skipped.
 */
export const entries = (
  input: TarInput,
  opt?: ReadOptions,
): AsyncIterableIterator<ReadEntry, undefined> => new TarReader(input, opt)

/**
 * Read the entries of an archive with no promises. Compressed input
 * needs a codec with a `decompressSync` function in `opt.codecs`.
 */
export const entriesSync = (
  input: TarInputSync,
  opt?: ReadOptionsSync,
): IterableIterator<ReadEntrySync, undefined> =>
  new TarReaderSync(input, opt)
