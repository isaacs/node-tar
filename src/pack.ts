// A readable tar stream creator
// Technically, this is a transform stream that you write paths into,
// and tar format comes out of.
// The `add()` method is like `write()` but returns this,
// and end() return `this` as well, so you can
// do `new Pack(opt).add('files').add('dir').end().pipe(output)
// You could also do something like:
// streamOfPaths().pipe(new Pack()).pipe(new fs.WriteStream('out.tar'))

import fs, { type Stats } from 'fs'
import {
  WriteEntry,
  WriteEntrySync,
  WriteEntryTar,
} from './write-entry.js'

export class PackJob {
  path: string
  absolute: string
  entry?: WriteEntry | WriteEntryTar
  stat?: Stats
  readdir?: string[]
  pending: boolean = false
  ignore: boolean = false
  piped: boolean = false
  constructor(path: string, absolute: string) {
    this.path = path || './'
    this.absolute = absolute
  }
}

import { Minipass } from 'minipass'
import * as zlib from 'minizlib'
import { Yallist } from 'yallist'
import { ReadEntry } from './read-entry.js'
import {
  WarnEvent,
  warnMethod,
  type WarnData,
  type Warner,
} from './warn-method.js'

const EOF = Buffer.alloc(1024)
const ONSTAT = Symbol('onStat')
const ENDED = Symbol('ended')
const QUEUE = Symbol('queue')
const CURRENT = Symbol('current')
const PROCESS = Symbol('process')
const PROCESSING = Symbol('processing')
const PROCESSJOB = Symbol('processJob')
const JOBS = Symbol('jobs')
const JOBDONE = Symbol('jobDone')
const ADDFSENTRY = Symbol('addFSEntry')
const ADDTARENTRY = Symbol('addTarEntry')
const STAT = Symbol('stat')
const READDIR = Symbol('readdir')
const ONREADDIR = Symbol('onreaddir')
const PIPE = Symbol('pipe')
const ENTRY = Symbol('entry')
const ENTRYOPT = Symbol('entryOpt')
const WRITEENTRYCLASS = Symbol('writeEntryClass')
const WRITE = Symbol('write')
const ONDRAIN = Symbol('ondrain')

import path from 'path'
import { normalizeWindowsPath } from './normalize-windows-path.js'
import { TarOptions } from './options.js'

export class Pack
  extends Minipass<Buffer, ReadEntry | string, WarnEvent<Buffer>>
  implements Warner
{
  sync: boolean = false
  opt: TarOptions
  cwd: string
  maxReadSize?: number
  preservePaths: boolean
  strict: boolean
  noPax: boolean
  prefix: string
  linkCache: Exclude<TarOptions['linkCache'], undefined>
  statCache: Exclude<TarOptions['statCache'], undefined>
  file: string
  portable: boolean
  zip?: zlib.BrotliCompress | zlib.Gzip | zlib.ZstdCompress
  readdirCache: Exclude<TarOptions['readdirCache'], undefined>
  noDirRecurse: boolean
  follow: boolean
  noMtime: boolean
  mtime?: Date
  filter: Exclude<TarOptions['filter'], undefined>
  jobs: number;

  [WRITEENTRYCLASS]: typeof WriteEntry | typeof WriteEntrySync
  onWriteEntry?: (entry: WriteEntry) => void;
  // Note: we actually DO need a linked list here, because we
  // shift() to update the head of the list where we start, but still
  // while that happens, need to know what the next item in the queue
  // will be. Since we do multiple jobs in parallel, it's not as simple
  // as just an Array.shift(), since that would lose the information about
  // the next job in the list. We could add a .next field on the PackJob
  // class, but then we'd have to be tracking the tail of the queue the
  // whole time, and Yallist just does that for us anyway.
  [QUEUE]: Yallist<PackJob>;
  [JOBS]: number = 0;
  [PROCESSING]: boolean = false;
  [ENDED]: boolean = false

  constructor(opt: TarOptions = {}) {
    //@ts-ignore
    super()
    this.opt = opt
    this.file = opt.file || ''
    this.cwd = opt.cwd || process.cwd()
    this.maxReadSize = opt.maxReadSize
    this.preservePaths = !!opt.preservePaths
    this.strict = !!opt.strict
    this.noPax = !!opt.noPax
    this.prefix = normalizeWindowsPath(opt.prefix || '')
    this.linkCache = opt.linkCache || new Map()
    this.statCache = opt.statCache || new Map()
    this.readdirCache = opt.readdirCache || new Map()
    this.onWriteEntry = opt.onWriteEntry

    this[WRITEENTRYCLASS] = WriteEntry
    if (typeof opt.onwarn === 'function') {
      this.on('warn', opt.onwarn)
    }

    this.portable = !!opt.portable

    if (opt.gzip || opt.brotli || opt.zstd) {
      if (
        (opt.gzip ? 1 : 0) +
          (opt.brotli ? 1 : 0) +
          (opt.zstd ? 1 : 0) >
        1
      ) {
        throw new TypeError(
          'gzip, brotli, zstd are mutually exclusive',
        )
      }
      if (opt.gzip) {
        if (typeof opt.gzip !== 'object') {
          opt.gzip = {}
        }
        if (this.portable) {
          opt.gzip.portable = true
        }
        this.zip = new zlib.Gzip(opt.gzip)
      }
      if (opt.brotli) {
        if (typeof opt.brotli !== 'object') {
          opt.brotli = {}
        }
        this.zip = new zlib.BrotliCompress(opt.brotli)
      }
      if (opt.zstd) {
        if (typeof opt.zstd !== 'object') {
          opt.zstd = {}
        }
        this.zip = new zlib.ZstdCompress(opt.zstd)
      }
      /* c8 ignore next */
      if (!this.zip) throw new Error('impossible')
      const zip = this.zip
      zip.on('data', chunk => super.write(chunk as unknown as string))
      zip.on('end', () => super.end())
      zip.on('drain', () => this[ONDRAIN]())
      this.on('resume', () => zip.resume())
    } else {
      this.on('drain', this[ONDRAIN])
    }

    this.noDirRecurse = !!opt.noDirRecurse
    this.follow = !!opt.follow
    this.noMtime = !!opt.noMtime
    if (opt.mtime) this.mtime = opt.mtime

    this.filter =
      typeof opt.filter === 'function' ? opt.filter : () => true

    this[QUEUE] = new Yallist<PackJob>()
    this[JOBS] = 0
    this.jobs = Number(opt.jobs) || 4
    this[PROCESSING] = false
    this[ENDED] = false
  }

  [WRITE](chunk: Buffer) {
    return super.write(chunk as unknown as string)
  }

  add(path: string | ReadEntry) {
    this.write(path)
    return this
  }

  end(cb?: () => void): this
  end(path: string | ReadEntry, cb?: () => void): this
  end(
    path: string | ReadEntry,
    encoding?: Minipass.Encoding,
    cb?: () => void,
  ): this
  end(
    path?: string | ReadEntry | (() => void),
    encoding?: Minipass.Encoding | (() => void),
    cb?: () => void,
  ) {
    /* c8 ignore start */
    if (typeof path === 'function') {
      cb = path
      path = undefined
    }
    if (typeof encoding === 'function') {
      cb = encoding
      encoding = undefined
    }
    /* c8 ignore stop */
    if (path) {
      this.add(path)
    }
    this[ENDED] = true
    this[PROCESS]()
    /* c8 ignore next */
    if (cb) cb()
    return this
  }

  write(path: string | ReadEntry) {
    if (this[ENDED]) {
      throw new Error('write after end')
    }

    if (path instanceof ReadEntry) {
      this[ADDTARENTRY](path)
    } else {
      this[ADDFSENTRY](path)
    }
    return this.flowing
  }

  [ADDTARENTRY](p: ReadEntry) {
    const absolute = normalizeWindowsPath(
      path.resolve(this.cwd, p.path),
    )
    // in this case, we don't have to wait for the stat
    if (!this.filter(p.path, p)) {
      p.resume()
    } else {
      const job = new PackJob(p.path, absolute)
      job.entry = new WriteEntryTar(p, this[ENTRYOPT](job))
      job.entry.on('end', () => this[JOBDONE](job))
      this[JOBS] += 1
      this[QUEUE].push(job)
    }

    this[PROCESS]()
  }

  [ADDFSENTRY](p: string) {
    const absolute = normalizeWindowsPath(path.resolve(this.cwd, p))
    this[QUEUE].push(new PackJob(p, absolute))
    this[PROCESS]()
  }

  [STAT](job: PackJob) {
    job.pending = true
    this[JOBS] += 1
    const stat = this.follow ? 'stat' : 'lstat'
    fs[stat](job.absolute, (er, stat) => {
      job.pending = false
      this[JOBS] -= 1
      if (er) {
        this.emit('error', er)
      } else {
        this[ONSTAT](job, stat)
      }
    })
  }

  [ONSTAT](job: PackJob, stat: Stats) {
    this.statCache.set(job.absolute, stat)
    job.stat = stat

    // now we have the stat, we can filter it.
    if (!this.filter(job.path, stat)) {
      job.ignore = true
    } else if (
      stat.isFile() &&
      stat.nlink > 1 &&
      job === this[CURRENT] &&
      !this.linkCache.get(`${stat.dev}:${stat.ino}`) &&
      !this.sync
    ) {
      // if it's not filtered, and it's a new File entry,
      // jump the queue in case any pending Link entries are about
      // to try to link to it. This prevents a hardlink from coming ahead
      // of its target in the archive.
      this[PROCESSJOB](job)
    }

    this[PROCESS]()
  }

  [READDIR](job: PackJob) {
    job.pending = true
    this[JOBS] += 1
    fs.readdir(job.absolute, (er, entries) => {
      job.pending = false
      this[JOBS] -= 1
      if (er) {
        return this.emit('error', er)
      }
      this[ONREADDIR](job, entries)
    })
  }

  [ONREADDIR](job: PackJob, entries: string[]) {
    this.readdirCache.set(job.absolute, entries)
    job.readdir = entries
    this[PROCESS]()
  }

  [PROCESS]() {
    if (this[PROCESSING]) {
      return
    }

    this[PROCESSING] = true
    for (
      let w = this[QUEUE].head;
      !!w && this[JOBS] < this.jobs;
      w = w.next
    ) {
      this[PROCESSJOB](w.value)
      if (w.value.ignore) {
        const p = w.next
        this[QUEUE].removeNode(w)
        w.next = p
      }
    }

    this[PROCESSING] = false

    if (this[ENDED] && !this[QUEUE].length && this[JOBS] === 0) {
      if (this.zip) {
        this.zip.end(EOF)
      } else {
        super.write(EOF as unknown as string)
        super.end()
      }
    }
  }

  get [CURRENT]() {
    return this[QUEUE] && this[QUEUE].head && this[QUEUE].head.value
  }

  [JOBDONE](_job: PackJob) {
    this[QUEUE].shift()
    this[JOBS] -= 1
    this[PROCESS]()
  }

  [PROCESSJOB](job: PackJob) {
    if (job.pending) {
      return
    }

    if (job.entry) {
      if (job === this[CURRENT] && !job.piped) {
        this[PIPE](job)
      }
      return
    }

    if (!job.stat) {
      const sc = this.statCache.get(job.absolute)
      if (sc) {
        this[ONSTAT](job, sc)
      } else {
        this[STAT](job)
      }
    }
    if (!job.stat) {
      return
    }

    // filtered out!
    if (job.ignore) {
      return
    }

    if (
      !this.noDirRecurse &&
      job.stat.isDirectory() &&
      !job.readdir
    ) {
      const rc = this.readdirCache.get(job.absolute)
      if (rc) {
        this[ONREADDIR](job, rc)
      } else {
        this[READDIR](job)
      }
      if (!job.readdir) {
        return
      }
    }

    // we know it doesn't have an entry, because that got checked above
    job.entry = this[ENTRY](job)
    if (!job.entry) {
      job.ignore = true
      return
    }

    if (job === this[CURRENT] && !job.piped) {
      this[PIPE](job)
    }
  }

  [ENTRYOPT](job: PackJob): TarOptions {
    return {
      onwarn: (code, msg, data) => this.warn(code, msg, data),
      noPax: this.noPax,
      cwd: this.cwd,
      absolute: job.absolute,
      preservePaths: this.preservePaths,
      maxReadSize: this.maxReadSize,
      strict: this.strict,
      portable: this.portable,
      linkCache: this.linkCache,
      statCache: this.statCache,
      noMtime: this.noMtime,
      mtime: this.mtime,
      prefix: this.prefix,
      onWriteEntry: this.onWriteEntry,
    }
  }

  [ENTRY](job: PackJob) {
    this[JOBS] += 1
    try {
      const e = new this[WRITEENTRYCLASS](
        job.path,
        this[ENTRYOPT](job),
      )
      return e
        .on('end', () => this[JOBDONE](job))
        .on('error', er => this.emit('error', er))
    } catch (er) {
      this.emit('error', er)
    }
  }

  [ONDRAIN]() {
    if (this[CURRENT] && this[CURRENT].entry) {
      this[CURRENT].entry.resume()
    }
  }

  // like .pipe() but using super, because our write() is special
  [PIPE](job: PackJob) {
    job.piped = true

    if (job.readdir) {
      job.readdir.forEach(entry => {
        const p = job.path
        const base = p === './' ? '' : p.replace(/\/*$/, '/')
        this[ADDFSENTRY](base + entry)
      })
    }

    const source = job.entry
    const zip = this.zip
    /* c8 ignore start */
    if (!source) throw new Error('cannot pipe without source')
    /* c8 ignore stop */

    if (zip) {
      source.on('data', chunk => {
        if (!zip.write(chunk)) {
          source.pause()
        }
      })
    } else {
      source.on('data', chunk => {
        if (!super.write(chunk as unknown as string)) {
          source.pause()
        }
      })
    }
  }

  pause() {
    if (this.zip) {
      this.zip.pause()
    }
    return super.pause()
  }
  warn(
    code: string,
    message: string | Error,
    data: WarnData = {},
  ): void {
    warnMethod(this, code, message, data)
  }
}

export class PackSync extends Pack {
  sync: true = true
  constructor(opt: TarOptions) {
    super(opt)
    this[WRITEENTRYCLASS] = WriteEntrySync
  }

  // pause/resume are no-ops in sync streams.
  pause() {}
  resume() {}

  [STAT](job: PackJob) {
    const stat = this.follow ? 'statSync' : 'lstatSync'
    this[ONSTAT](job, fs[stat](job.absolute))
  }

  [READDIR](job: PackJob) {
    this[ONREADDIR](job, fs.readdirSync(job.absolute))
  }

  // gotta get it all in this tick
  [PIPE](job: PackJob) {
    const source = job.entry
    const zip = this.zip

    if (job.readdir) {
      job.readdir.forEach(entry => {
        const p = job.path
        const base = p === './' ? '' : p.replace(/\/*$/, '/')
        this[ADDFSENTRY](base + entry)
      })
    }

    /* c8 ignore start */
    if (!source) throw new Error('Cannot pipe without source')
    /* c8 ignore stop */

    if (zip) {
      source.on('data', chunk => {
        zip.write(chunk)
      })
    } else {
      source.on('data', chunk => {
        super[WRITE](chunk)
      })
    }
  }
}
