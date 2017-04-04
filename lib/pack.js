'use strict'
// The Pack class is a readable stream that creates a tar stream
// by adding WriteEntry objects into it.

const MiniPass = require('minipass')
const WriteEntry = require('./write-entry.js')
const WriteEntrySync = WriteEntry.Sync
const Yallist = require('yallist')
const EOF = Buffer.alloc(1024)
const ONSTAT = Symbol('onStat')
const ENDED = Symbol('ended')
const QUEUE = Symbol('queue')
const CURRENT = Symbol('current')
const MAYBESTAT = Symbol('maybeStat')
const PROCESS = Symbol('process')
const PROCESSPATH = Symbol('processPath')
const ADDENTRY = Symbol('addEntry')
const fs = require('fs')

class Pack extends MiniPass {
  constructor (opt) {
    super(opt)
    opt = opt || Object.create(null)
    this.opt = opt
    this.sync = !!opt.sync || false
    this.linkCache = opt.linkCache || new Map()
    this.statCache = opt.statCache || new Map()
    this.didReaddir = new Set()
    this.awaitReaddir = new Set()
    this.filter = opt.filter || (_ => true)
    this.filter = typeof opt.filter === 'function' ? opt.filter : _=>true
    this[QUEUE] = new Yallist
    this[CURRENT] = null
  }

  add (path) {
    this.write(path)
    return this
  }

  write (path) {
    if (this[ENDED])
      throw new Error('write after end')

    this[ADDENTRY](path)
  }

  [ADDENTRY] (path) {
    if (!this.filter(path)) {
      return true
    }

    this[PROCESS](path)

    return this[QUEUE].length === 0 && this.flowing
  }

  [ONSTAT] (path, stat) {
    if (!stat.isDirectory() || this.didReaddir.has(path))
      return

    this.awaitReaddir.add(path)
    this.didReaddir.add(path)

    fs.readdir(path, (er, entries) => {
      this.awaitReaddir.delete(path)
      if (er)
        return this.emit('error', er)
      entries.forEach(entry => this[ADDENTRY](path + '/' + entry))
    })
  }

  [MAYBESTAT] (path) {
    const has = this.statCache.has(path)
    if (has)
      this[ONSTAT](path, this.statCache.get(path))
    return has
  }

  end (path) {
    if (path)
      this.write(path)
    this[ENDED] = true
    if (!this[CURRENT] && !this[QUEUE].length) {
      super.write(EOF)
      super.end()
    }
    return this
  }

  [PROCESS] (path) {
    if (this[CURRENT])
      return this[QUEUE].push(path)

    if (this[QUEUE].length) {
      if (typeof path === 'string')
        this[QUEUE].push(path)
      path = this[QUEUE].shift()
    }

    this[PROCESSPATH](path)
  }

  [PROCESSPATH] (path) {
    if (typeof path !== 'string')
      return

    const entry = new WriteEntry(path, this.linkCache, this.statCache)
    this[CURRENT] = entry
    if (!this[MAYBESTAT](path))
      entry.on('stat', stat => this[ONSTAT](path, stat))
    entry.on('data', chunk => {
      if (!super.write(chunk))
        entry.pause()
    })
    const ondrain = _ => entry.resume()
    this.on('drain', ondrain)
    entry.on('end', _ => {
      this.removeListener('drain', ondrain)
      this[CURRENT] = null
      if (this[QUEUE].length)
        this[PROCESS]()
      else if (this[ENDED] && this.awaitReaddir.size === 0) {
        super.write(EOF)
        super.end()
      }
    })
  }
}

module.exports = Pack
