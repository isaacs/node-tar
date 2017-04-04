'use strict'
const MiniPass = require('minipass')
const Pax = require('./pax.js')
const Header = require('./header.js')
const fs = require('fs')

const types = require('./types.js')
const maxReadSize = 1024 * 1024
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

class WriteEntry extends MiniPass {
  constructor (path, linkCache) {
    super()
    this.path = path
    this.linkCache = linkCache
    this[LSTAT]()
  }

  [LSTAT] () {
    fs.lstat(this.path, (er, stat) => {
      if (er)
        return this.emit('error', er)
      this[ONLSTAT](stat)
    })
  }

  [ONLSTAT] (stat) {
    this.stat = stat
    this.type = getType(stat)
    this.typeKey = types.code.get(this.type)
    this[PROCESS]()
  }

  [PROCESS] () {
    switch (this.type) {
      case 'File': return this[FILE]()
      case 'Directory': return this[DIRECTORY]()
      case 'SymbolicLink': return this[SYMLINK]()
      // unsupported types are ignored.
      default: return this.end()
    }
  }

  [HEADER] () {
    this.header = new Header()
    this.needExtended = this.header.encode({
      path: this.path,
      linkpath: this.linkpath,
      mode: this.stat.mode,
      uid: this.stat.uid,
      gid: this.stat.gid,
      size: this.stat.size,
      mtime: this.stat.mtime.getTime() / 1000,
      typeKey: this.typeKey,
      uname: process.env.USER || '',
      atime: this.stat.atime.getTime() / 1000,
      ctime: this.stat.ctime.getTime() / 1000
    })
    if (this.needExtended)
      this.write(new Pax({
        atime: this.header.atime,
        ctime: this.header.ctime,
        gid: this.header.gid,
        mtime: this.header.mtime,
        path: this.path,
        linkpath: this.linkpath,
        size: this.size,
        uid: this.header.uid,
        uname: this.header.uname,
        dev: this.stat.dev,
        ino: this.stat.ino,
        nlink: this.stat.nlink
      }).encode())
    this.write(this.header.block)
  }

  [DIRECTORY] () {
    this[HEADER]()
    this.end()
  }

  [SYMLINK] () {
    fs.readlink(this.path, (er, linkpath) => {
      if (er)
        return this.emit('error', er)
      this[ONREADLINK](linkpath)
    })
  }

  [ONREADLINK] (linkpath) {
    this.linkpath = linkpath
    this[HEADER]()
    this.end()
  }

  [HARDLINK] (linkpath) {
    this.type = 'Link'
    this.typeKey = types.code.get(this.type)
    this.linkpath = linkpath
    this.stat.size = 0
    this[HEADER]()
    this.end()
  }

  [FILE] () {
    if (this.stat.nlink > 1) {
      const linkKey = this.stat.dev + ':' + this.stat.ino
      if (this.linkCache.has(linkKey))
        return this[HARDLINK](this.linkCache.get(linkKey))
      else
        this.linkCache.set(linkKey, this.path)
    }

    this[HEADER]()
    if (this.stat.size === 0)
      return this.end()

    this[OPENFILE]()
  }

  [OPENFILE] () {
    fs.open(this.path, 'r', (er, fd) => {
      if (er)
        return this.emit('error', er)
      this[ONOPENFILE](fd)
    })
  }

  [ONOPENFILE] (fd) {
    const blockLen = 512 * Math.floor(1 + this.stat.size / 512)
    const bufLen = Math.min(blockLen, maxReadSize)
    const buf = Buffer.allocUnsafe(bufLen)
    this[READ](fd, buf, 0, this.stat.size, blockLen)
  }

  [READ] (fd, buf, pos, remain, blockRemain) {
    fs.read(fd, buf, 0, buf.length, pos, (er, bytesRead) => {
      if (er)
        return this[CLOSE](fd, _ => this.emit('error', er))
      this[ONREAD](fd, buf, pos, remain, blockRemain, bytesRead)
    })
  }

  [CLOSE] (fd, cb) {
    fs.close(fd, cb)
  }

  [ONREAD] (fd, buf, pos, remain, blockRemain, bytesRead) {
    if (bytesRead === 0)
      throw ('wat')
    if (bytesRead === remain) {
      for (let i = bytesRead; i < buf.length && bytesRead < blockRemain; i++) {
        buf[i] = 0
        bytesRead ++
        remain ++
      }
    }
    this.write(bytesRead === buf.length ? buf : buf.slice(0, bytesRead))
    remain -= bytesRead
    blockRemain -= bytesRead
    pos += bytesRead
    if (!remain) {
      if (blockRemain)
        this.write(Buffer.alloc(blockRemain))
      this.end()
      this[CLOSE](fd, _ => _)
      return
    }
    this[READ](fd, buf, pos, remain, blockRemain)
  }
}

class WriteEntrySync extends WriteEntry {
  constructor (path, linkCache) {
    super(path, linkCache)
  }

  [LSTAT] () {
    this[ONLSTAT](fs.lstatSync(this.path))
  }

  [SYMLINK] () {
    this[ONREADLINK](fs.readlinkSync(this.path))
  }

  [OPENFILE] () {
    this[ONOPENFILE](fd.openSync(this.path, 'r'))
  }

  [READ] (fd, buf, pos, remain, blockRemain) {
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, pos)
    let threw = true
    try {
      this[ONREAD](fd, buf, pos, remain, blockRemain, bytesRead)
      threw = false
    } finally {
      if (threw)
        this[CLOSE](fd)
    }
  }

  [CLOSE] (fd) {
    fs.closeSync(fd)
    if (cb)
      cb()
  }
}

WriteEntry.Sync = WriteEntrySync

const getType = stat =>
  stat.isFile() ? 'File'
  : stat.isDirectory() ? 'Directory'
  : stat.isSymbolicLink() ? 'SymbolicLink'
  : stat.isBlockDevice() ? 'BlockDevice'
  : stat.isFIFO() ? 'FIFO'
  : stat.isCharacterDevice() ? 'CharacterDevice'
  : 'Unknown'

module.exports = WriteEntry
