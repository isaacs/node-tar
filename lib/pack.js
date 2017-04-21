'use strict'

// A readable tar stream creator
// Technically, this is a transform stream that you write paths into,
// and tar format comes out of.
// The `add()` method is like `write()` but returns this,
// and end() return `this` as well, so you can
// do `new Pack(opt).add('files').add('dir').end().pipe(output)
// You could also do something like:
// streamOfPaths().pipe(new Pack()).pipe(new fs.WriteStream('out.tar'))

class PackJob {
  constructor (path, absolute) {
    this.path = path
    this.absolute = absolute
    this.stat = null
    this.readdir = null
    this.pending = false
    this.ignore = false
    this.piped = false
  }
}

const MiniPass = require('minipass')
const zlib = require('minizlib')
const WriteEntry = require('./write-entry.js')
const WriteEntrySync = WriteEntry.Sync
const Yallist = require('yallist')
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
const ADDENTRY = Symbol('addEntry')
const STAT = Symbol('stat')
const READDIR = Symbol('readdir')
const ONREADDIR = Symbol('onreaddir')
const PIPE = Symbol('pipe')
const ENTRY = Symbol('entry')
const WRITEENTRYCLASS = Symbol('writeEntryClass')
const WRITE = Symbol('write')

const fs = require('fs')
const path = require('path')
const assert = require('assert')

class Pack extends MiniPass {
  constructor (opt) {
    super(opt)
    opt = opt || Object.create(null)
    this.opt = opt
    this.cwd = opt.cwd || process.cwd()
    this.maxReadSize = opt.maxReadSize
    this.preservePaths = !!opt.preservePaths
    this.strict = !!opt.strict
    this.linkCache = opt.linkCache || new Map()
    this.statCache = opt.statCache || new Map()
    this.readdirCache = opt.readdirCache || new Map()
    this[WRITEENTRYCLASS] = WriteEntry

    if (opt.gzip) {
      if (typeof opt.gzip !== 'object')
        opt.gzip = {}
      this.zip = new zlib.Gzip(opt.gzip)
      this.zip.on('data', chunk => super.write(chunk))
      this.zip.on('end', _ => super.end())
    } else
      this.zip = null

    this.filter = typeof opt.filter === 'function' ? opt.filter : _ => true
    this[QUEUE] = new Yallist
    this[JOBS] = 0
    this.jobs = +opt.jobs || 4
    this[PROCESSING] = false
    this[ENDED] = false
  }

  [WRITE] (chunk) {
    return super.write(chunk)
  }

  add (path) {
    this.write(path)
    return this
  }

  end (path) {
    if (path)
      this.write(path)
    this[ENDED] = true
    this[PROCESS]()
    return this
  }

  write (path) {
    if (this[ENDED])
      throw new Error('write after end')

    this[ADDENTRY](path)
    return this.flowing
  }

  [ADDENTRY] (p) {
    const absolute = path.resolve(this.cwd, p)
    this[QUEUE].push(new PackJob(p, absolute))
    this[PROCESS]()
  }

  [STAT] (job) {
    job.pending = true
    this[JOBS] += 1
    fs.lstat(job.absolute, (er, stat) => {
      job.pending = false
      this[JOBS] -= 1
      if (er)
        return this.emit('error', er)
      this[ONSTAT](job, stat)
    })
  }

  [ONSTAT] (job, stat) {
    this.statCache.set(job.absolute, stat)
    job.stat = stat

    // now we have the stat, we can filter it.
    if (!this.filter(job.path, stat))
      job.ignore = true

    this[PROCESS]()
  }

  [READDIR] (job) {
    job.pending = true
    this[JOBS] += 1
    fs.readdir(job.absolute, (er, entries) => {
      job.pending = false
      this[JOBS] -= 1
      if (er)
        return this.emit('error', entries)
      this[ONREADDIR](job, entries)
    })
  }

  [ONREADDIR] (job, entries) {
    this.readdirCache.set(job.absolute, entries)
    job.readdir = entries
    this[PROCESS]()
  }

  [PROCESS] () {
    if (this[PROCESSING])
      return

    this[PROCESSING] = true
    for (let w = this[QUEUE].head;
         w !== null && this[JOBS] < this.jobs;
         w = w.next) {
      this[PROCESSJOB](w.value)
    }
    this[PROCESSING] = false

    if (this[ENDED] && !this[QUEUE].length && this[JOBS] === 0) {
      if (this.zip)
        this.zip.end(EOF)
      else {
        super.write(EOF)
        super.end()
      }
    }
  }

  get [CURRENT] () {
    return this[QUEUE].head.value
  }

  [JOBDONE] (job) {
    assert.equal(job, this[CURRENT])
    this[QUEUE].shift()
    this[JOBS] -= 1
    this[PROCESS]()
  }

  [PROCESSJOB] (job) {
    if (job.pending)
      return

    if (!job.stat) {
      if (this.statCache.has(job.absolute))
        this[ONSTAT](job, this.statCache.get(job.absolute))
      else
        this[STAT](job)
    }
    if (!job.stat)
      return

    // filtered out!
    if (job.ignore) {
      if (job === this[CURRENT])
        this[QUEUE].shift()
      return
    }

    if (job.stat.isDirectory() && !job.readdir) {
      if (this.readdirCache.has(job.absolute))
        this[ONREADDIR](job, this.readdirCache.get(job.absolute))
      else
        this[READDIR](job)
      if (!job.readdir)
        return
    }

    if (!job.entry) {
      job.entry = this[ENTRY](job)
      job.entry.on('end', _ => this[JOBDONE](job))
    }

    if (job === this[CURRENT] && !job.piped)
      this[PIPE](job)
  }

  warn (msg, data) {
    if (!this.strict)
      return this.emit('warn', msg, data)

    const er = new Error(msg)
    er.data = data
    this.emit('error', er)
  }

  [ENTRY] (job) {
    this[JOBS] += 1
    return new this[WRITEENTRYCLASS](job.path, {
      onwarn: (msg, data) => this.warn(msg, data),
      cwd: this.cwd,
      preservePaths: this.preservePaths,
      maxReadSize: this.maxReadSize,
      strict: this.strict,
      linkCache: this.linkCache,
      statCache: this.statCache
    })
  }

  // like .pipe() but using super, because our write() is special
  [PIPE] (job) {
    assert.equal(job, this[CURRENT])
    assert(this[PROCESSING])

    if (job.readdir)
      job.readdir.forEach(entry => this[ADDENTRY](job.path + '/' + entry))

    const source = job.entry
    const ondrain = _ => source.resume()
    const zip = this.zip
    source.on('end', _ => {
      ;(zip || this).removeListener('drain', ondrain)
    })

    ;(zip || this).on('drain', ondrain)

    if (zip)
      source.on('data', chunk => zip.write(chunk) || source.pause())
    else
      source.on('data', chunk => super.write(chunk) || source.pause())
  }
}

class PackSync extends Pack {
  constructor (opt) {
    super(opt)
    this[WRITEENTRYCLASS] = WriteEntrySync
  }

  [STAT] (job) {
    this[ONSTAT](job, fs.lstatSync(job.absolute))
  }

  [READDIR] (job, stat) {
    this[ONREADDIR](job, fs.readdirSync(job.absolute))
  }

  // gotta get it all in this tick
  [PIPE] (job) {
    const source = job.entry
    const zip = this.zip

    if (job.readdir)
      job.readdir.forEach(entry => this[ADDENTRY](job.path + '/' + entry))

    if (zip)
      source.on('data', chunk => zip.write(chunk))
    else
      source.on('data', chunk => super[WRITE](chunk))
  }
}

Pack.Sync = PackSync

module.exports = Pack
