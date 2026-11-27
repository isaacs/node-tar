import { isBlob, isUint8Array } from './bytes.js'
import { Header } from './header.js'
import { Pax } from './pax.js'
import { stripTrailingSlashes } from './strip-trailing-slashes.js'
import type { EntryTypeName } from './types.js'

/**
 * The content of a `WriteEntry`. `PackSync` takes only a string, a
 * `Uint8Array`, or a sync iterable.
 */
export type WriteBody =
  | string
  | Uint8Array
  | Blob
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>
  | Iterable<Uint8Array>

/** The metadata of a `WriteEntry`. A `ReadEntry` fits this type. */
export type WriteEntryData = {
  path: string
  /** Default `'File'`. */
  type?: EntryTypeName
  mode?: number
  uid?: number
  gid?: number
  uname?: string
  gname?: string
  /**
   * The number of bytes in the body. Default: the length of a body
   * that is a string, a `Uint8Array`, or a `Blob`.
   */
  size?: number
  mtime?: Date
  atime?: Date
  ctime?: Date
  linkpath?: string
  dev?: number
  ino?: number
  nlink?: number
}

/** The options of `WriteEntry.encode`. */
export type EncodeOptions = {
  /** A directory to put before the path, and before a hard link target. */
  prefix?: string
  /** Write no PAX header for a field that does not fit the header. */
  noPax?: boolean
}

const encoder = new TextEncoder()

const prefixPath = (path: string, prefix?: string) =>
  prefix ?
    stripTrailingSlashes(prefix) + '/' + path.replace(/^\.(\/|$)/, '')
  : path

/**
 * An entry to write to an archive, in the shape of a `Request`: the
 * metadata is in the fields, and the content is `body`.
 *
 * A pack makes one for each path that it reads from the file system
 * and for each entry that it copies from another archive. Make one
 * with content from memory, and give it to `Pack.add()`.
 *
 * `onWriteEntry` gets the entry before its header is written, and can
 * change each field.
 */
export class WriteEntry {
  path: string
  type: EntryTypeName
  /** The permission bits only. */
  mode?: number
  uid?: number
  gid?: number
  uname?: string
  gname?: string
  /** The number of bytes in the body. The body must have this many. */
  size: number
  mtime?: Date
  atime?: Date
  ctime?: Date
  linkpath?: string
  dev?: number
  ino?: number
  nlink?: number
  /** The content. A string is kept as its UTF-8 bytes. */
  body?: Exclude<WriteBody, string>
  /** The path of the file, for an entry that a pack read from a path. */
  absolute?: string
  /** The header block, after `encode()`. */
  header?: Header

  constructor(data: WriteEntryData, body?: WriteBody) {
    if ((data.type as string) === 'Unsupported') {
      throw new Error('writing entry that should be ignored')
    }
    if (typeof body === 'string') body = encoder.encode(body)
    this.path = data.path
    this.type = data.type ?? 'File'
    this.mode = data.mode
    this.uid = data.uid
    this.gid = data.gid
    this.uname = data.uname
    this.gname = data.gname
    if (
      data.size === undefined &&
      body !== undefined &&
      !isUint8Array(body) &&
      !isBlob(body)
    ) {
      // The header comes before the content, and it has the size.
      throw new TypeError('a stream body needs the size option')
    }
    this.size =
      data.size ??
      (isUint8Array(body) ? body.length
      : isBlob(body) ? body.size
      : 0)
    this.mtime = data.mtime
    this.atime = data.atime
    this.ctime = data.ctime
    this.linkpath = data.linkpath
    this.dev = data.dev
    this.ino = data.ino
    this.nlink = data.nlink
    this.body = body
  }

  /**
   * Make the header from the fields, and write it to the first 512
   * bytes of `block`, which must be zeros. Returns the blocks to
   * write before the body: `block`, and before it a PAX header entry
   * if a field does not fit the header.
   */
  encode(
    opt: EncodeOptions = {},
    block: Uint8Array = new Uint8Array(512),
  ): Uint8Array[] {
    const path = prefixPath(this.path, opt.prefix)
    // The target of a symbolic link is not a path in the archive.
    const linkpath =
      this.type === 'Link' && this.linkpath !== undefined ?
        prefixPath(this.linkpath, opt.prefix)
      : this.linkpath
    const { uid, gid, uname, gname, size, mtime, atime, ctime } = this
    this.header = new Header({
      path,
      linkpath,
      mode: this.mode,
      uid,
      gid,
      size,
      mtime,
      type: this.type,
      uname,
      gname,
      atime,
      ctime,
    })
    if (!this.header.encode(block) || opt.noPax) return [block]
    const { dev, ino, nlink } = this
    return [
      new Pax({
        atime,
        ctime,
        gid,
        gname,
        mtime,
        path,
        linkpath,
        size,
        uid,
        uname,
        dev,
        ino,
        nlink,
      }).encode(),
      block,
    ]
  }
}
