import { decodeUtf8 } from '../bytes.js'
import { Header } from '../header.js'
import { Pax } from '../pax.js'
import type { EntryTypeName } from '../types.js'
import type { ParserOptions } from './options.js'
import { EntryData } from './read-entry.js'
import { warn, type WarnData, type WarnOptions } from './warn.js'

/** What `Parser.next()` returns. */
export type ParseEvent<E extends EntryData = EntryData> =
  /**
   * An entry that is not a PAX or GNU meta entry. If `entry.ignore`
   * is set, the parser skips the body, and no other event follows
   * for this entry.
   */
  | { type: 'entry'; entry: E }
  /** A part of the body of the entry. A view into the input. */
  | { type: 'body'; data: Uint8Array }
  /** The end of the body of the entry. */
  | { type: 'entryEnd' }
  /** The end of the archive. No event follows. */
  | { type: 'end' }

/** Makes the entry object for a header. */
export type CreateEntry<E extends EntryData> = (
  header: Header,
  ex: Pax | undefined,
  gex: Pax | undefined,
) => E

const BEGIN = 0
const HEADER = 1
const BODY = 2
const IGNORE = 3
const META = 4

const ENTRY_END = { type: 'entryEnd' } as const
const END = { type: 'end' } as const

const metaTypes = new Set<EntryTypeName>([
  'ExtendedHeader',
  'OldExtendedHeader',
  'GlobalExtendedHeader',
  'NextFileHasLongPath',
  'OldGnuLongPath',
  'NextFileHasLongLinkpath',
])

// The text up to the first NUL.
const cstring = (buf: Uint8Array) => {
  const nul = buf.indexOf(0)
  return decodeUtf8(buf, 0, nul === -1 ? buf.length : nul)
}

/**
 * A tar parser that the caller pulls. Give it input with `push()`,
 * and call `next()` for each event until it returns `undefined`.
 * Then give it more input, or call `end()` and call `next()` again.
 *
 * It does not decompress. It calls no code of the caller but
 * `filter`, `onwarn`, and the function that makes the entry objects.
 *
 * With `strict`, `next()` throws at each problem. The parser stays
 * usable: the next call continues after the block with the problem.
 */
export class Parser<E extends EntryData = EntryData> {
  maxMetaEntrySize: number
  /**
   * The number of input bytes up to the end of the last complete
   * entry that is not a meta entry.
   */
  position: number = 0

  #opt: WarnOptions
  #filter?: (path: string, entry: E) => boolean
  #create: CreateEntry<E>
  #queue: Uint8Array[] = []
  #chunk?: Uint8Array
  #pos: number = 0
  // a header block that is in more than one chunk
  #block?: Uint8Array
  #blockLen: number = 0
  // the number of input bytes that are parsed
  #offset: number = 0
  #state: number = BEGIN
  // the entry of the body that is read or skipped now
  #entry?: E
  #header?: Header
  #meta?: Uint8Array
  #metaLen: number = 0
  // body bytes to come, without and with the padding
  #remain: number = 0
  #blockRemain: number = 0
  // body bytes at the end of the input that are less than a block
  #held: number = 0
  #ex?: Pax
  #gex?: Pax
  #ended: boolean = false
  #sawNull: boolean = false
  #sawValid?: boolean
  #entryEnd: boolean = false
  // 0: reading, 1: the end is found, 2: the end event is returned
  #done: number = 0

  /**
   * @param createEntry makes the object for each entry event. It is
   * required if `E` is not `EntryData`.
   */
  constructor(opt: ParserOptions<E> = {}, createEntry?: CreateEntry<E>) {
    this.#opt = opt
    this.maxMetaEntrySize = opt.maxMetaEntrySize || 1024 * 1024
    this.#filter = opt.filter
    const win32 = opt.platform === 'win32'
    this.#create =
      createEntry ??
      ((header, ex, gex) => new EntryData(header, ex, gex, win32) as E)
  }

  /**
   * Report a problem to `onwarn`. Throws if `strict` is set, or if
   * `data.recoverable` is false.
   */
  warn(code: string, message: string | Error, data?: WarnData): void {
    warn(this.#opt, code, message, data)
  }

  /**
   * Add input. The parser keeps the chunk until `next()` returns
   * `undefined`, and each body event is a view into it. Input after
   * `end()`, or after the end of the archive, is dropped.
   */
  push(chunk: Uint8Array): void {
    if (!this.#ended) this.#queue.push(chunk)
  }

  /** Tell the parser that the input is complete. */
  end(): void {
    this.#ended = true
  }

  /**
   * The next event. `undefined` means that the parser needs more
   * input, or after the `end` event, that it is done.
   */
  next(): ParseEvent<E> | undefined {
    if (this.#entryEnd) {
      this.#entryEnd = false
      return ENTRY_END
    }
    for (;;) {
      let chunk = this.#chunk
      let pos = this.#pos
      if (!chunk || pos === chunk.length) {
        chunk = this.#chunk = this.#queue.shift()
        pos = this.#pos = 0
        if (!chunk) {
          if (!this.#ended || this.#done === 2) return undefined
          const ev = this.#finish()
          if (ev) return ev
        }
        continue
      }
      const avail = chunk.length - pos
      const state = this.#state

      if (state <= HEADER) {
        let ev: ParseEvent<E> | undefined
        if (this.#blockLen === 0 && avail >= 512) {
          this.#pos = pos + 512
          ev = this.#consumeHeader(chunk, pos)
        } else {
          const block = (this.#block ??= new Uint8Array(512))
          const n = Math.min(512 - this.#blockLen, avail)
          block.set(chunk.subarray(pos, pos + n), this.#blockLen)
          this.#pos = pos + n
          this.#blockLen += n
          if (this.#blockLen < 512) continue
          this.#blockLen = 0
          ev = this.#consumeHeader(block, 0)
        }
        if (ev) return ev
        continue
      }

      const blockRemain = this.#blockRemain
      const n = avail < blockRemain ? avail : blockRemain
      const remain = this.#remain
      const len = n < remain ? n : remain
      this.#pos = pos + n
      this.#offset += n
      this.#blockRemain = blockRemain - n
      this.#remain = remain - len
      const last = n === blockRemain
      // The message of a truncated archive has this number.
      this.#held = last || this.#held + n >= 512 ? 0 : this.#held + n

      if (state === META) {
        const meta = this.#meta as Uint8Array
        meta.set(chunk.subarray(pos, pos + len), this.#metaLen)
        this.#metaLen += len
        if (last) {
          this.#endBody()
          this.#applyMeta(meta)
        }
        continue
      }
      if (last) this.#endBody()
      if (state === IGNORE) continue
      if (len === 0) {
        if (last) return ENTRY_END
        continue
      }
      this.#entryEnd = last
      return {
        type: 'body',
        data:
          len === chunk.length ? chunk : chunk.subarray(pos, pos + len),
      }
    }
  }

  #endBody() {
    const entry = this.#entry
    if (entry) {
      this.position = this.#offset
      this.#entry = undefined
    }
    if (!entry?.invalid) this.#sawValid = true
    this.#state = HEADER
  }

  // The input is complete, and all of it is read.
  #finish(): ParseEvent<E> | undefined {
    const state = this.#state
    if (state > HEADER) {
      // The body of the last entry is not complete.
      const entry = this.#entry
      const held = this.#held
      const need = this.#blockRemain + held
      this.#entry = undefined
      this.#meta = undefined
      this.#state = HEADER
      if (!entry?.invalid) this.#sawValid = true
      this.#entryEnd = state === BODY
      this.warn(
        'TAR_BAD_ARCHIVE',
        `Truncated input (needed ${need} more bytes, only ${held} available)`,
        { entry, header: this.#header },
      )
      return undefined
    }
    if (this.#entryEnd) {
      this.#entryEnd = false
      return ENTRY_END
    }
    if (this.#done === 0) {
      this.#done = 1
      if (state === BEGIN || this.#sawValid === false) {
        // Less than one block of data, or no valid entry.
        this.warn('TAR_BAD_ARCHIVE', 'Unrecognized archive format')
      }
    }
    this.#done = 2
    return END
  }

  #consumeHeader(buf: Uint8Array, off: number): ParseEvent<E> | undefined {
    this.#offset += 512
    if (this.#sawValid === undefined) this.#sawValid = false
    let header: Header
    try {
      header = new Header(buf, off, this.#ex, this.#gex)
    } catch (er) {
      this.warn('TAR_ENTRY_INVALID', er as Error)
      return
    }

    if (header.nullBlock) {
      if (this.#sawNull) {
        // The end of the archive. Drop all the data after it.
        this.#ended = true
        this.#chunk = undefined
        this.#queue.length = 0
        this.#blockLen = 0
        // An archive with no entries is valid.
        this.#state = HEADER
      }
      this.#sawNull = true
      return
    }

    const lone = this.#sawNull && header.cksumValid
    this.#sawNull = false
    if (lone) {
      // Other tar programs stop reading at a lone null block.
      this.warn('TAR_BAD_ARCHIVE', 'entry after a lone null block', {
        header,
      })
    }
    if (!header.cksumValid) {
      this.warn('TAR_ENTRY_INVALID', 'checksum failure', { header })
      return
    }
    if (!header.path) {
      this.warn('TAR_ENTRY_INVALID', 'path is required', { header })
      return
    }
    const type = header.type
    const link = type === 'Link' || type === 'SymbolicLink'
    if (link && !header.linkpath) {
      this.warn('TAR_ENTRY_INVALID', 'linkpath required', { header })
      return
    }
    if (
      !link &&
      header.linkpath &&
      type !== 'ExtendedHeader' &&
      type !== 'GlobalExtendedHeader'
    ) {
      this.warn('TAR_ENTRY_INVALID', 'linkpath forbidden', { header })
      return
    }

    const size = header.size ?? 0
    this.#header = header
    this.#remain = size
    this.#blockRemain = 512 * Math.ceil(size / 512)
    this.#held = 0
    // A meta entry or an ignored entry is valid tar also.
    if (!size) this.#sawValid = true

    if (metaTypes.has(type)) {
      if (size > this.maxMetaEntrySize) {
        this.#state = IGNORE
      } else if (size > 0) {
        this.#meta = new Uint8Array(size)
        this.#metaLen = 0
        this.#state = META
      }
      return
    }

    const ex = this.#ex
    this.#ex = undefined
    const entry = this.#create(header, ex, this.#gex)
    if (
      !entry.ignore &&
      this.#filter &&
      !this.#filter(entry.path, entry)
    ) {
      entry.ignore = true
    }
    if (size) {
      this.#entry = entry
      this.#state = entry.ignore ? IGNORE : BODY
    } else {
      this.#state = HEADER
      this.position = this.#offset
      this.#entryEnd = !entry.ignore
    }
    return { type: 'entry', entry }
  }

  #applyMeta(meta: Uint8Array) {
    switch ((this.#header as Header).type) {
      case 'ExtendedHeader':
      case 'OldExtendedHeader':
        this.#ex = Pax.parseBytes(meta, this.#ex, false)
        break
      case 'GlobalExtendedHeader':
        this.#gex = Pax.parseBytes(meta, this.#gex, true)
        break
      case 'NextFileHasLongPath':
      case 'OldGnuLongPath': {
        const ex = (this.#ex ??= Object.create(null) as Pax)
        ex.path ??= cstring(meta)
        break
      }
      // NextFileHasLongLinkpath
      default: {
        const ex = (this.#ex ??= Object.create(null) as Pax)
        ex.linkpath ??= cstring(meta)
      }
    }
  }
}
