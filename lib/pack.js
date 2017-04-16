'use strict'
// A readable tar stream creator
// Technically, this is a transform stream that you write paths into,
// and tar format comes out of.
// The `add()` method is like `write()` but returns this,
// and end() return `this` as well, so you can
// do `new Pack(opt).add('files').add('dir').end().pipe(output)
// You could also do something like:
// streamOfPaths().pipe(new Pack()).pipe(new fs.WriteStream('out.tar'))

const MiniPass = require('minipass')
const zlib = require('minizlib')
const WriteEntry = require('./write-entry.js')
const WriteEntrySync = WriteEntry.Sync
const Yallist = require('yallist')
const EOF = Buffer.alloc(1024)
const ONSTAT = Symbol('onStat')
const ENDING = Symbol('ending')
const ENDED = Symbol('ended')
const QUEUE = Symbol('queue')
const CURRENT = Symbol('current')
const PENDING = Symbol('pending')
const PROCESS = Symbol('process')
const NEXT = Symbol('next')
const ADDENTRY = Symbol('addEntry')
const STAT = Symbol('stat')
const READDIR = Symbol('readdir')
const ONREADDIR = Symbol('onreaddir')
const PIPE = Symbol('pipe')
const ENTRY = Symbol('entry')
const WRITEENTRYCLASS = Symbol('writeEntryClass')
const WRITE = Symbol('write')
const ABORTED = Symbol('aborted')
const fs = require('fs')
const path = require('path')

class Pack extends MiniPass {
  constructor (opt) {
    super(opt)
    opt = opt || Object.create(null)
    this[PENDING] = new Set()
    this.opt = opt
    this.cwd = opt.cwd || process.cwd()
    this.maxReadSize = opt.maxReadSize
    this.preservePaths = !!opt.preservePaths
    this.strict = !!opt.strict
    this.linkCache = opt.linkCache || new Map()
    this.statCache = opt.statCache || new Map()
    this.readdirCache = opt.readdirCache || new Map()
    this[ABORTED] = false
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
    this[CURRENT] = null
    this[ENDING] = false
    this[ENDED] = false
  }

  [WRITE] (chunk) {
    return super.write(chunk)
  }

  abort () {
    this[ABORTED] = true
  }

  add (path) {
    if (this[ABORTED])
      return this

    this.write(path)
    return this
  }

  end (path) {
    if (this[ABORTED])
      return this

    if (path)
      this.write(path)
    this[ENDING] = true
    this[NEXT]()
    return this
  }

  write (path) {
    if (this[ABORTED])
      return true

    if (this[ENDING])
      throw new Error('write after end')

    this[ADDENTRY](path)
    return this.flowing
  }

  [ADDENTRY] (p) {
    if (this[ABORTED])
      return
    const absolute = path.resolve(this.cwd, p)
    if (this.statCache.has(absolute))
      return this[ONSTAT](p, absolute, this.statCache.get(absolute))

    this[STAT](p, absolute)
  }

  [STAT] (path, absolute) {
    if (this[ABORTED])
      return

    this[PENDING].add('stat\0' + path + '\0' + absolute)
    fs.lstat(absolute, (er, stat) => {
      this[PENDING].delete('stat\0' + path + '\0' + absolute)
      if (er)
        return this.emit('error', er)
      this[ONSTAT](path, absolute, stat)
    })
  }

  [ONSTAT] (path, absolute, stat) {
    if (this[ABORTED])
      return

    this.statCache.set(absolute, stat)

    // now we have the stat, we can filter it.
    if (!this.filter(path, stat))
      return this[NEXT]()

    if (!stat.isDirectory())
      return this[PROCESS](path, stat)

    if (this.readdirCache.has(absolute))
      return this[ONREADDIR](path, absolute, stat, this.readdirCache.get(absolute))

    this[READDIR](path, absolute, stat)
  }

  [READDIR] (path, absolute, stat) {
    if (this[ABORTED])
      return

    this[PENDING].add('readdir\0' + path + '\0' + absolute)
    fs.readdir(absolute, (er, entries) => {
      if (er)
        return this.emit('error', entries)
      this[ONREADDIR](path, absolute, stat, entries)
      this.readdirCache.set(absolute, entries)
    })
  }

  [ONREADDIR] (path, absolute, stat, entries) {
    if (this[ABORTED])
      return

    this[PROCESS](path)
    this[PENDING].delete('readdir\0' + path + '\0' + absolute)
    entries.forEach(entry => this[ADDENTRY](path + '/' + entry))
  }

  [PROCESS] (path) {
    if (this[ABORTED])
      return

    if (this[CURRENT])
      return this[QUEUE].push(path)

    const entry = this[ENTRY](path)
    this[CURRENT] = entry
    this[PIPE](entry)
  }

  warn (msg, data) {
    if (!this.strict)
      return this.emit('warn', msg, data)

    const er = new Error(msg)
    er.data = data
    this.emit('error', er)
  }

  [ENTRY] (path) {
    return new this[WRITEENTRYCLASS](path, {
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
  [PIPE] (source) {
    if (this[ABORTED])
      return

    const ondrain = _ => source.resume()
    const zip = this.zip
    source.on('end', _ => {
      ;(zip || this).removeListener('drain', ondrain)
      this[CURRENT] = null
      this[NEXT]()
    })

    ;(zip || this).on('drain', ondrain)

    if (zip)
      source.on('data', chunk => zip.write(chunk) || source.pause())
    else
      source.on('data', chunk => super.write(chunk) || source.pause())
  }

  [NEXT] () {
    if (this[ABORTED] || this[CURRENT])
      return

    if (this[QUEUE].length)
      this[PROCESS](this[QUEUE].shift())
    else if (this[ENDING] && this[PENDING].size === 0 && !this[ENDED]) {
      this[ENDED] = true
      if (this.zip)
        this.zip.end(EOF)
      else {
        super.write(EOF)
        super.end()
      }
    }
  }
}

class PackSync extends Pack {
  constructor (opt) {
    super(opt)
    this[WRITEENTRYCLASS] = WriteEntrySync
  }

  pause () {
    throw new Error('cannot pause sync packer!')
  }

  [STAT] (path, absolute) {
    if (this[ABORTED])
      return

    this[ONSTAT](path, absolute, fs.lstatSync(absolute))
  }

  [READDIR] (path, absolute, stat) {
    if (this[ABORTED])
      return

    this[ONREADDIR](path, absolute, stat, fs.readdirSync(absolute))
  }

  // gotta get it all in this tick
  [PIPE] (source) {
    if (this[ABORTED])
      return

    const zip = this.zip
    source.on('end', _ => {
      this[CURRENT] = null
      this[NEXT]()
    })

    if (zip)
      source.on('data', chunk => zip.write(chunk))
    else
      source.on('data', chunk => super[WRITE](chunk))
  }
}

Pack.Sync = PackSync

module.exports = Pack
