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
const fs = require('fs')

class Pack extends MiniPass {
  constructor (opt) {
    super(opt)
    opt = opt || Object.create(null)
    this[PENDING] = 0
    this.opt = opt
    this.sync = !!opt.sync || false
    this.linkCache = opt.linkCache || new Map()
    this.statCache = opt.statCache || new Map()
    this.readdirCache = opt.readdirCache || new Map()

    this.filter = typeof opt.filter === 'function' ? opt.filter : _ => true
    this[QUEUE] = new Yallist
    this[CURRENT] = null
  }

  add (path) {
    this.write(path)
    return this
  }

  end (path) {
    if (path)
      this.write(path)
    this[ENDED] = true
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
    this[PENDING] ++
    fs.lstat(path, (er, stat) => {
      if (er)
        return this.emit('error', er)
      this[ONSTAT](path, stat)
      this[PENDING] --
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
    this[PENDING] ++
    fs.readdir(path, (er, entries) => {
      if (er)
        return this.emit('error', entries)
      this[ONREADDIR](path, stat, entries)
      this[PENDING] --
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

    const entry = new WriteEntry(path, this.linkCache, this.statCache)
    this[CURRENT] = entry
    const ondrain = _ => entry.resume()
    this.on('drain', ondrain)
    entry.on('end', _ => {
      this.removeListener('drain', ondrain)
      this[CURRENT] = null
      this[NEXT]()
    })
    entry.on('data', chunk => super.write(chunk) || entry.pause())
  }

  [NEXT] () {
    if (this[CURRENT])
      return

    if (this[QUEUE].length)
      this[PROCESS](this[QUEUE].shift())
    else if (this[ENDED] && !this[QUEUE].length && this[PENDING] === 0) {
      super.write(EOF)
      super.end()
    }
  }
}

module.exports = Pack
