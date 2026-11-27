import { Minipass } from 'minipass'
import type { Header } from './header.js'
import { normalizeWindowsPath } from './normalize-windows-path.js'
import type { Pax } from './pax.js'
import type { EntryTypeName } from './types.js'

export class ReadEntry extends Minipass<Buffer, Buffer> {
  extended?: Pax
  globalExtended?: Pax
  header: Header
  startBlockSize: number
  blockRemain: number
  remain: number
  type: EntryTypeName
  meta: boolean = false
  ignore: boolean = false
  path: string
  mode?: number
  uid?: number
  gid?: number
  uname?: string
  gname?: string
  size: number = 0
  mtime?: Date
  atime?: Date
  ctime?: Date
  linkpath?: string

  dev?: number
  ino?: number
  nlink?: number
  invalid: boolean = false
  absolute?: string
  unsupported: boolean = false

  constructor(header: Header, ex?: Pax, gex?: Pax) {
    super({})
    // read entries always start life paused.  this is to avoid the
    // situation where Minipass's auto-ending empty streams results
    // in an entry ending before we're ready for it.
    this.pause()
    this.extended = ex
    this.globalExtended = gex
    this.header = header
    this.remain = header.size ?? 0
    this.startBlockSize = 512 * Math.ceil(this.remain / 512)
    this.blockRemain = this.startBlockSize
    this.type = header.type
    switch (this.type) {
      case 'File':
      case 'OldFile':
      case 'Link':
      case 'SymbolicLink':
      case 'CharacterDevice':
      case 'BlockDevice':
      case 'Directory':
      case 'FIFO':
      case 'ContiguousFile':
      case 'GNUDumpDir':
        break

      case 'NextFileHasLongLinkpath':
      case 'NextFileHasLongPath':
      case 'OldGnuLongPath':
      case 'GlobalExtendedHeader':
      case 'ExtendedHeader':
      case 'OldExtendedHeader':
        this.meta = true
        break

      // NOTE: gnutar and bsdtar treat unrecognized types as 'File'
      // it may be worth doing the same, but with a warning.
      default:
        this.ignore = true
    }

    if (!header.path) {
      throw new Error('no path provided for tar.ReadEntry')
    }

    this.path = normalizeWindowsPath(header.path) as string
    this.mode = header.mode
    if (this.mode) {
      this.mode = this.mode & 0o7777
    }
    this.uid = header.uid
    this.gid = header.gid
    this.uname = header.uname
    this.gname = header.gname
    this.size = this.remain
    this.mtime = header.mtime
    this.atime = header.atime
    this.ctime = header.ctime
    this.linkpath =
      header.linkpath ? normalizeWindowsPath(header.linkpath) : undefined
    this.uname = header.uname
    this.gname = header.gname

    // Pending extended headers describe the next file entry, not a
    // meta entry. Apply global first, so that local values win.
    if (!this.meta) {
      if (gex) {
        this.#slurp(gex, true)
      }
      if (ex) {
        this.#slurp(ex)
      }
    }
  }

  write(data: Buffer) {
    const writeLen = data.length
    if (writeLen > this.blockRemain) {
      throw new Error('writing more to entry than is appropriate')
    }

    const r = this.remain
    const br = this.blockRemain
    this.remain = Math.max(0, r - writeLen)
    this.blockRemain = Math.max(0, br - writeLen)
    if (this.ignore) {
      return true
    }

    if (r >= writeLen) {
      return super.write(data)
    }

    // r < writeLen
    return super.write(data.subarray(0, r))
  }

  #slurp(ex: Pax, gex: boolean = false) {
    if (ex.path) ex.path = normalizeWindowsPath(ex.path)
    if (ex.linkpath) ex.linkpath = normalizeWindowsPath(ex.linkpath)
    Object.assign(
      this,
      Object.fromEntries(
        Object.entries(ex).filter(([k, v]) => {
          // we slurp in everything except for the path attribute in
          // a global extended header, because that's weird. Also, any
          // null/undefined values are ignored.
          // The Header already resolved size. It sets the body length.
          return !(
            v === null ||
            v === undefined ||
            k === 'size' ||
            k === 'global' ||
            (k === 'path' && gex) ||
            (k === 'linkpath' && gex)
          )
        }),
      ),
    )
  }
}
