'use strict'
// A readable tar stream creator
// Technically, this is a transform stream that you write paths into,
// and tar format comes out of.
// The `add()` method is like `write()` but returns this,u
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
const WRITE = Symbol('write')
const fs = require('fs')

class Pack extends MiniPass {
  constructor (opt) {
    super(opt)
    opt = opt || Object.create(null)
    this[PENDING] = new Set()
    this.opt = opt
    this.sync = !!opt.sync || false
    this.linkCache = opt.linkCache || new Map()
    this.statCache = opt.statCache || new Map()
    this.readdirCache = opt.readdirCache || new Map()

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
    this[NEXT]()
    return this
  }

  write (path) {
    if (this[ENDED])
      throw new Error('write after end')

    this[ADDENTRY](path)
  }

  [ADDENTRY] (path) {
    if (this.statCache.has(path))
      return this[ONSTAT](path, this.statCache.get(path))

    this[STAT](path)
  }

  [STAT] (path) {
    this[PENDING].add('stat\0' + path)
    fs.lstat(path, (er, stat) => {
      if (er)
        return this.emit('error', er)
      this[ONSTAT](path, stat)
      this[PENDING].delete('stat\0' + path)
    })
  }

  [ONSTAT] (path, stat) {
    this.statCache.set(path, stat)

    // now we have the stat, we can filter it.
    if (!this.filter(path, stat))
      return this[NEXT]()

    if (!stat.isDirectory())
      return this[PROCESS](path, stat)

    if (this.readdirCache.has(path))
      return this[ONREADDIR](path, stat, this.readdirCache.has(path))

    this[READDIR](path, stat)
  }

  [READDIR] (path, stat) {
    this[PENDING].add('readdir\0' + path)
    fs.readdir(path, (er, entries) => {
      if (er)
        return this.emit('error', entries)
      this[ONREADDIR](path, stat, entries)
      this[PENDING].delete('readdir\0' + path)
    })
  }

  [ONREADDIR] (path, stat, entries) {
    this.readdirCache.set(path, entries)
    this[PROCESS](path, stat)
    entries.forEach(entry => this[ADDENTRY](path + '/' + entry))
  }

  [PROCESS] (path) {
    if (this[CURRENT])
      return this[QUEUE].push(path)

    const entry = this[ENTRY](path)
    this[CURRENT] = entry
    this[PIPE](entry)
  }

  [ENTRY] (path) {
    return new WriteEntry(path, this.linkCache, this.statCache)
  }

  // like .pipe() but using super, because our write() is special
  [PIPE] (source) {
    const ondrain = _ => source.resume()
    const zip = this.zip
    source.on('end', _ => {
      ;(zip || this).removeListener('drain', ondrain)
      this[CURRENT] = null
      this[NEXT]()
    })

    if (zip)
      source.on('data', chunk => zip.write(chunk) || source.pause())
    else
      source.on('data', chunk => super.write(chunk) || source.pause())
  }

  [NEXT] () {
    if (this[CURRENT])
      return

    if (this[QUEUE].length)
      this[PROCESS](this[QUEUE].shift())
    else if (this[ENDED] && !this[QUEUE].length &&
             this[PENDING].size === 0) {
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
  }

  pause () {
    throw new Error('no')
  }

  [ENTRY] (path) {
    return new WriteEntrySync(path, this.linkCache, this.statCache)
  }

  [STAT] (path) {
    this[ONSTAT](path, fs.lstatSync(path))
  }

  [READDIR] (path, stat) {
    const entries = fs.readdirSync(path)
    this[ONREADDIR](path, stat, entries)
  }

  // gotta get it all in this tick
  [PIPE] (source) {
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
