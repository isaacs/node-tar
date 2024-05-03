import fs, { type Stats } from 'fs'
import { Minipass } from 'minipass'
import path from 'path'
import { Header } from './header.js'
import { modeFix } from './mode-fix.js'
import { normalizeWindowsPath } from './normalize-windows-path.js'
import {
  dealias,
  LinkCacheKey,
  TarOptions,
  TarOptionsWithAliases,
} from './options.js'
import { Pax } from './pax.js'
import { ReadEntry } from './read-entry.js'
import { stripAbsolutePath } from './strip-absolute-path.js'
import { stripTrailingSlashes } from './strip-trailing-slashes.js'
import { EntryTypeName } from './types.js'
import {
  WarnData,
  Warner,
  WarnEvent,
  warnMethod,
} from './warn-method.js'
import * as winchars from './winchars.js'

const prefixPath = (path: string, prefix?: string) => {
  if (!prefix) {
    return normalizeWindowsPath(path)
  }
  path = normalizeWindowsPath(path).replace(/^\.(\/|$)/, '')
  return stripTrailingSlashes(prefix) + '/' + path
}

const maxReadSize = 16 * 1024 * 1024

const PROCESS = Symbol('process')
const FILE = Symbol('file')
const DIRECTORY = Symbol('directory')
const SYMLINK = Symbol('symlink')
const HARDLINK = Symbol('hardlink')
const HEADER = Symbol('header')
const READ = Symbol('read')
const LSTAT = Symbol('lstat')
const ONLSTAT = Symbol('onlstat')
const ONREAD = Symbol('onread')
const ONREADLINK = Symbol('onreadlink')
const OPENFILE = Symbol('openfile')
const ONOPENFILE = Symbol('onopenfile')
const CLOSE = Symbol('close')
const MODE = Symbol('mode')
const AWAITDRAIN = Symbol('awaitDrain')
const ONDRAIN = Symbol('ondrain')
const PREFIX = Symbol('prefix')

export class WriteEntry
  extends Minipass<
    Minipass.ContiguousData,
    Buffer,
    WarnEvent
  >
  implements Warner
{
  path: string
  portable: boolean
  myuid: number = (process.getuid && process.getuid()) || 0
  // until node has builtin pwnam functions, this'll have to do
  myuser: string = process.env.USER || ''
  maxReadSize: number
  linkCache: Exclude<TarOptions['linkCache'], undefined>
  statCache: Exclude<TarOptions['statCache'], undefined>
  preservePaths: boolean
  cwd: string
  strict: boolean
  mtime?: Date
  noPax: boolean
  noMtime: boolean
  prefix?: string
  fd?: number

  blockLen: number = 0
  blockRemain: number = 0
  buf?: Buffer
  pos: number = 0
  remain: number = 0
  length: number = 0
  offset: number = 0

  win32: boolean
  absolute: string

  header?: Header
  type?: EntryTypeName | 'Unsupported'
  linkpath?: string
  stat?: Stats
  /* c8 ignore start */

  #hadError: boolean = false

  constructor(p: string, opt_: TarOptionsWithAliases = {}) {
    const opt = dealias(opt_)
    super()
    this.path = normalizeWindowsPath(p)
    // suppress atime, ctime, uid, gid, uname, gname
    this.portable = !!opt.portable
    this.maxReadSize = opt.maxReadSize || maxReadSize
    this.linkCache = opt.linkCache || new Map()
    this.statCache = opt.statCache || new Map()
    this.preservePaths = !!opt.preservePaths
    this.cwd = normalizeWindowsPath(opt.cwd || process.cwd())
    this.strict = !!opt.strict
    this.noPax = !!opt.noPax
    this.noMtime = !!opt.noMtime
    this.mtime = opt.mtime
    this.prefix =
      opt.prefix ? normalizeWindowsPath(opt.prefix) : undefined

    if (typeof opt.onwarn === 'function') {
      this.on('warn', opt.onwarn)
    }

    let pathWarn: string | boolean = false
    if (!this.preservePaths) {
      const [root, stripped] = stripAbsolutePath(this.path)
      if (root && typeof stripped === 'string') {
        this.path = stripped
        pathWarn = root
      }
    }

    this.win32 = !!opt.win32 || process.platform === 'win32'
    if (this.win32) {
      // force the \ to / normalization, since we might not *actually*
      // be on windows, but want \ to be considered a path separator.
      this.path = winchars.decode(this.path.replace(/\\/g, '/'))
      p = p.replace(/\\/g, '/')
    }

    this.absolute = normalizeWindowsPath(
      opt.absolute || path.resolve(this.cwd, p),
    )

    if (this.path === '') {
      this.path = './'
    }

    if (pathWarn) {
      this.warn(
        'TAR_ENTRY_INFO',
        `stripping ${pathWarn} from absolute path`,
        {
          entry: this,
          path: pathWarn + this.path,
        },
      )
    }

    const cs = this.statCache.get(this.absolute)
    if (cs) {
      this[ONLSTAT](cs)
    } else {
      this[LSTAT]()
    }
  }

  warn(code: string, message: string | Error, data: WarnData = {}) {
    return warnMethod(this, code, message, data)
  }

  emit(ev: keyof WarnEvent, ...data: any[]) {
    if (ev === 'error') {
      this.#hadError = true
    }
    return super.emit(ev, ...data)
  }

  [LSTAT]() {
    fs.lstat(this.absolute, (er, stat) => {
      if (er) {
        return this.emit('error', er)
      }
      this[ONLSTAT](stat)
    })
  }

  [ONLSTAT](stat: Stats) {
    this.statCache.set(this.absolute, stat)
    this.stat = stat
    if (!stat.isFile()) {
      stat.size = 0
    }
    this.type = getType(stat)
    this.emit('stat', stat)
    this[PROCESS]()
  }

  [PROCESS]() {
    switch (this.type) {
      case 'File':
        return this[FILE]()
      case 'Directory':
        return this[DIRECTORY]()
      case 'SymbolicLink':
        return this[SYMLINK]()
      // unsupported types are ignored.
      default:
        return this.end()
    }
  }

  [MODE](mode: number) {
    return modeFix(mode, this.type === 'Directory', this.portable)
  }

  [PREFIX](path: string) {
    return prefixPath(path, this.prefix)
  }

  [HEADER]() {
    /* c8 ignore start */
    if (!this.stat) {
      throw new Error('cannot write header before stat')
    }
    /* c8 ignore stop */

    if (this.type === 'Directory' && this.portable) {
      this.noMtime = true
    }

    this.header = new Header({
      path: this[PREFIX](this.path),
      // only apply the prefix to hard links.
      linkpath:
        this.type === 'Link' && this.linkpath !== undefined ?
          this[PREFIX](this.linkpath)
        : this.linkpath,
      // only the permissions and setuid/setgid/sticky bitflags
      // not the higher-order bits that specify file type
      mode: this[MODE](this.stat.mode),
      uid: this.portable ? undefined : this.stat.uid,
      gid: this.portable ? undefined : this.stat.gid,
      size: this.stat.size,
      mtime: this.noMtime ? undefined : this.mtime || this.stat.mtime,
      /* c8 ignore next */
      type: this.type === 'Unsupported' ? undefined : this.type,
      uname:
        this.portable ? undefined
        : this.stat.uid === this.myuid ? this.myuser
        : '',
      atime: this.portable ? undefined : this.stat.atime,
      ctime: this.portable ? undefined : this.stat.ctime,
    })

    if (this.header.encode() && !this.noPax) {
      super.write(
        new Pax({
          atime: this.portable ? undefined : this.header.atime,
          ctime: this.portable ? undefined : this.header.ctime,
          gid: this.portable ? undefined : this.header.gid,
          mtime:
            this.noMtime ? undefined : (
              this.mtime || this.header.mtime
            ),
          path: this[PREFIX](this.path),
          linkpath:
            this.type === 'Link' && this.linkpath !== undefined ?
              this[PREFIX](this.linkpath)
            : this.linkpath,
          size: this.header.size,
          uid: this.portable ? undefined : this.header.uid,
          uname: this.portable ? undefined : this.header.uname,
          dev: this.portable ? undefined : this.stat.dev,
          ino: this.portable ? undefined : this.stat.ino,
          nlink: this.portable ? undefined : this.stat.nlink,
        }).encode(),
      )
    }
    const block = this.header?.block
    /* c8 ignore start */
    if (!block) {
      throw new Error('failed to encode header')
    }
    /* c8 ignore stop */
    super.write(block)
  }

  [DIRECTORY]() {
    /* c8 ignore start */
    if (!this.stat) {
      throw new Error('cannot create directory entry without stat')
    }
    /* c8 ignore stop */
    if (this.path.slice(-1) !== '/') {
      this.path += '/'
    }
    this.stat.size = 0
    this[HEADER]()
    this.end()
  }

  [SYMLINK]() {
    fs.readlink(this.absolute, (er, linkpath) => {
      if (er) {
        return this.emit('error', er)
      }
      this[ONREADLINK](linkpath)
    })
  }

  [ONREADLINK](linkpath: string) {
    this.linkpath = normalizeWindowsPath(linkpath)
    this[HEADER]()
    this.end()
  }

  [HARDLINK](linkpath: string) {
    /* c8 ignore start */
    if (!this.stat) {
      throw new Error('cannot create link entry without stat')
    }
    /* c8 ignore stop */
    this.type = 'Link'
    this.linkpath = normalizeWindowsPath(
      path.relative(this.cwd, linkpath),
    )
    this.stat.size = 0
    this[HEADER]()
    this.end()
  }

  [FILE]() {
    /* c8 ignore start */
    if (!this.stat) {
      throw new Error('cannot create file entry without stat')
    }
    /* c8 ignore stop */
    if (this.stat.nlink > 1) {
      const linkKey =
        `${this.stat.dev}:${this.stat.ino}` as LinkCacheKey
      const linkpath = this.linkCache.get(linkKey)
      if (linkpath?.indexOf(this.cwd) === 0) {
        return this[HARDLINK](linkpath)
      }
      this.linkCache.set(linkKey, this.absolute)
    }

    this[HEADER]()
    if (this.stat.size === 0) {
      return this.end()
    }

    this[OPENFILE]()
  }

  [OPENFILE]() {
    fs.open(this.absolute, 'r', (er, fd) => {
      if (er) {
        return this.emit('error', er)
      }
      this[ONOPENFILE](fd)
    })
  }

  [ONOPENFILE](fd: number) {
    this.fd = fd
    if (this.#hadError) {
      return this[CLOSE]()
    }
    /* c8 ignore start */
    if (!this.stat) {
      throw new Error('should stat before calling onopenfile')
    }
    /* c8 ignore start */

    this.blockLen = 512 * Math.ceil(this.stat.size / 512)
    this.blockRemain = this.blockLen
    const bufLen = Math.min(this.blockLen, this.maxReadSize)
    this.buf = Buffer.allocUnsafe(bufLen)
    this.offset = 0
    this.pos = 0
    this.remain = this.stat.size
    this.length = this.buf.length
    this[READ]()
  }

  [READ]() {
    const { fd, buf, offset, length, pos } = this
    if (fd === undefined || buf === undefined) {
      throw new Error('cannot read file without first opening')
    }
    fs.read(fd, buf, offset, length, pos, (er, bytesRead) => {
      if (er) {
        // ignoring the error from close(2) is a bad practice, but at
        // this point we already have an error, don't need another one
        return this[CLOSE](() => this.emit('error', er))
      }
      this[ONREAD](bytesRead)
    })
  }

  /* c8 ignore start */
  [CLOSE](
    cb: (er?: null | Error | NodeJS.ErrnoException) => any = () => {},
  ) {
    /* c8 ignore stop */
    if (this.fd !== undefined) fs.close(this.fd, cb)
  }

  [ONREAD](bytesRead: number) {
    if (bytesRead <= 0 && this.remain > 0) {
      const er = Object.assign(
        new Error('encountered unexpected EOF'),
        {
          path: this.absolute,
          syscall: 'read',
          code: 'EOF',
        },
      )
      return this[CLOSE](() => this.emit('error', er))
    }

    if (bytesRead > this.remain) {
      const er = Object.assign(
        new Error('did not encounter expected EOF'),
        {
          path: this.absolute,
          syscall: 'read',
          code: 'EOF',
        },
      )
      return this[CLOSE](() => this.emit('error', er))
    }

    /* c8 ignore start */
    if (!this.buf) {
      throw new Error('should have created buffer prior to reading')
    }
    /* c8 ignore stop */

    // null out the rest of the buffer, if we could fit the block padding
    // at the end of this loop, we've incremented bytesRead and this.remain
    // to be incremented up to the blockRemain level, as if we had expected
    // to get a null-padded file, and read it until the end.  then we will
    // decrement both remain and blockRemain by bytesRead, and know that we
    // reached the expected EOF, without any null buffer to append.
    if (bytesRead === this.remain) {
      for (
        let i = bytesRead;
        i < this.length && bytesRead < this.blockRemain;
        i++
      ) {
        this.buf[i + this.offset] = 0
        bytesRead++
        this.remain++
      }
    }

    const writeBuf =
      this.offset === 0 && bytesRead === this.buf.length ?
        this.buf
      : this.buf.subarray(this.offset, this.offset + bytesRead)

    const flushed = this.write(writeBuf)
    if (!flushed) {
      this[AWAITDRAIN](() => this[ONDRAIN]())
    } else {
      this[ONDRAIN]()
    }
  }

  [AWAITDRAIN](cb: () => any) {
    this.once('drain', cb)
  }

  write(writeBuf: Buffer) {
    if (this.blockRemain < writeBuf.length) {
      const er = Object.assign(
        new Error('writing more data than expected'),
        {
          path: this.absolute,
        },
      )
      return this.emit('error', er)
    }
    this.remain -= writeBuf.length
    this.blockRemain -= writeBuf.length
    this.pos += writeBuf.length
    this.offset += writeBuf.length
    return super.write(writeBuf)
  }

  [ONDRAIN]() {
    if (!this.remain) {
      if (this.blockRemain) {
        super.write(Buffer.alloc(this.blockRemain))
      }
      return this[CLOSE](er =>
        er ? this.emit('error', er) : this.end(),
      )
    }

    /* c8 ignore start */
    if (!this.buf) {
      throw new Error('buffer lost somehow in ONDRAIN')
    }
    /* c8 ignore stop */

    if (this.offset >= this.length) {
      // if we only have a smaller bit left to read, alloc a smaller buffer
      // otherwise, keep it the same length it was before.
      this.buf = Buffer.allocUnsafe(
        Math.min(this.blockRemain, this.buf.length),
      )
      this.offset = 0
    }
    this.length = this.buf.length - this.offset
    this[READ]()
  }
}

export class WriteEntrySync extends WriteEntry implements Warner {
  [LSTAT]() {
    this[ONLSTAT](fs.lstatSync(this.absolute))
  }

  [SYMLINK]() {
    this[ONREADLINK](fs.readlinkSync(this.absolute))
  }

  [OPENFILE]() {
    this[ONOPENFILE](fs.openSync(this.absolute, 'r'))
  }

  [READ]() {
    let threw = true
    try {
      const { fd, buf, offset, length, pos } = this
      /* c8 ignore start */
      if (fd === undefined || buf === undefined) {
        throw new Error('fd and buf must be set in READ method')
      }
      /* c8 ignore stop */
      const bytesRead = fs.readSync(fd, buf, offset, length, pos)
      this[ONREAD](bytesRead)
      threw = false
    } finally {
      // ignoring the error from close(2) is a bad practice, but at
      // this point we already have an error, don't need another one
      if (threw) {
        try {
          this[CLOSE](() => {})
        } catch (er) {}
      }
    }
  }

  [AWAITDRAIN](cb: () => any) {
    cb()
  }

  /* c8 ignore start */
  [CLOSE](
    cb: (er?: null | Error | NodeJS.ErrnoException) => any = () => {},
  ) {
    /* c8 ignore stop */
    if (this.fd !== undefined) fs.closeSync(this.fd)
    cb()
  }
}

export class WriteEntryTar
  extends Minipass<Buffer, Buffer, WarnEvent>
  implements Warner
{
  blockLen: number = 0
  blockRemain: number = 0
  buf: number = 0
  pos: number = 0
  remain: number = 0
  length: number = 0
  preservePaths: boolean
  portable: boolean
  strict: boolean
  noPax: boolean
  noMtime: boolean
  readEntry: ReadEntry
  type: EntryTypeName
  prefix?: string
  path: string
  mode?: number
  uid?: number
  gid?: number
  uname?: string
  gname?: string
  header?: Header
  mtime?: Date
  atime?: Date
  ctime?: Date
  linkpath?: string
  size: number

  warn(code: string, message: string | Error, data: WarnData = {}) {
    return warnMethod(this, code, message, data)
  }

  constructor(
    readEntry: ReadEntry,
    opt_: TarOptionsWithAliases = {},
  ) {
    const opt = dealias(opt_)
    super()
    this.preservePaths = !!opt.preservePaths
    this.portable = !!opt.portable
    this.strict = !!opt.strict
    this.noPax = !!opt.noPax
    this.noMtime = !!opt.noMtime

    this.readEntry = readEntry
    const { type } = readEntry
    /* c8 ignore start */
    if (type === 'Unsupported') {
      throw new Error('writing entry that should be ignored')
    }
    /* c8 ignore stop */
    this.type = type
    if (this.type === 'Directory' && this.portable) {
      this.noMtime = true
    }

    this.prefix = opt.prefix

    this.path = normalizeWindowsPath(readEntry.path)
    this.mode =
      readEntry.mode !== undefined ?
        this[MODE](readEntry.mode)
      : undefined
    this.uid = this.portable ? undefined : readEntry.uid
    this.gid = this.portable ? undefined : readEntry.gid
    this.uname = this.portable ? undefined : readEntry.uname
    this.gname = this.portable ? undefined : readEntry.gname
    this.size = readEntry.size
    this.mtime =
      this.noMtime ? undefined : opt.mtime || readEntry.mtime
    this.atime = this.portable ? undefined : readEntry.atime
    this.ctime = this.portable ? undefined : readEntry.ctime
    this.linkpath =
      readEntry.linkpath !== undefined ?
        normalizeWindowsPath(readEntry.linkpath)
      : undefined

    if (typeof opt.onwarn === 'function') {
      this.on('warn', opt.onwarn)
    }

    let pathWarn: false | string = false
    if (!this.preservePaths) {
      const [root, stripped] = stripAbsolutePath(this.path)
      if (root && typeof stripped === 'string') {
        this.path = stripped
        pathWarn = root
      }
    }

    this.remain = readEntry.size
    this.blockRemain = readEntry.startBlockSize

    this.header = new Header({
      path: this[PREFIX](this.path),
      linkpath:
        this.type === 'Link' && this.linkpath !== undefined ?
          this[PREFIX](this.linkpath)
        : this.linkpath,
      // only the permissions and setuid/setgid/sticky bitflags
      // not the higher-order bits that specify file type
      mode: this.mode,
      uid: this.portable ? undefined : this.uid,
      gid: this.portable ? undefined : this.gid,
      size: this.size,
      mtime: this.noMtime ? undefined : this.mtime,
      type: this.type,
      uname: this.portable ? undefined : this.uname,
      atime: this.portable ? undefined : this.atime,
      ctime: this.portable ? undefined : this.ctime,
    })

    if (pathWarn) {
      this.warn(
        'TAR_ENTRY_INFO',
        `stripping ${pathWarn} from absolute path`,
        {
          entry: this,
          path: pathWarn + this.path,
        },
      )
    }

    if (this.header.encode() && !this.noPax) {
      super.write(
        new Pax({
          atime: this.portable ? undefined : this.atime,
          ctime: this.portable ? undefined : this.ctime,
          gid: this.portable ? undefined : this.gid,
          mtime: this.noMtime ? undefined : this.mtime,
          path: this[PREFIX](this.path),
          linkpath:
            this.type === 'Link' && this.linkpath !== undefined ?
              this[PREFIX](this.linkpath)
            : this.linkpath,
          size: this.size,
          uid: this.portable ? undefined : this.uid,
          uname: this.portable ? undefined : this.uname,
          dev: this.portable ? undefined : this.readEntry.dev,
          ino: this.portable ? undefined : this.readEntry.ino,
          nlink: this.portable ? undefined : this.readEntry.nlink,
        }).encode(),
      )
    }

    const b = this.header?.block
    /* c8 ignore start */
    if (!b) throw new Error('failed to encode header')
    /* c8 ignore stop */
    super.write(b)
    readEntry.pipe(this)
  }

  [PREFIX](path: string) {
    return prefixPath(path, this.prefix)
  }

  [MODE](mode: number) {
    return modeFix(mode, this.type === 'Directory', this.portable)
  }

  write(data: Buffer) {
    const writeLen = data.length
    if (writeLen > this.blockRemain) {
      throw new Error('writing more to entry than is appropriate')
    }
    this.blockRemain -= writeLen
    return super.write(data)
  }

  end() {
    if (this.blockRemain) {
      super.write(Buffer.alloc(this.blockRemain))
    }
    return super.end()
  }
}

const getType = (stat: Stats): EntryTypeName | 'Unsupported' =>
  stat.isFile() ? 'File'
  : stat.isDirectory() ? 'Directory'
  : stat.isSymbolicLink() ? 'SymbolicLink'
  : 'Unsupported'
