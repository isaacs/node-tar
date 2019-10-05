// read a .git/index file for entries, and pull out stat.mode values from it
// We only care about the mode -- everything else will be pulled from the
// file as it is on disk.  Also, this ignores any errors reading from the
// git index, since we fall back to the fs anyway.

const fs = require('fs')
const {dirname, resolve, relative} = require('path')
class GitStat {
  constructor (opt) {
    this.entryCache = new Map()
    this.indexCache = new Map()
    this.cwd = opt.cwd
  }

  updateStat (path, stat, cb) {
    this.stat(path, (er, gitStat) => {
      if (er || !gitStat)
        return cb()
      stat.mode = gitStat.mode
      // XXX maybe track these two also?
      // stat.uid = gitStat.uid
      // entry.gid = gitStat.gid
    })
  }

  stat (path, cb) {
    if (this.entryCache.has(path))
      cb(this.entryCache.get(path))
    else
      this.find(path, dirname(path), cb)
  }

  find (path, dir, cb) {
    return this.getIndex(path, dir, (er, index) => {
      if (er)
        return cb(er)
      return index.entries.get(path)
    })
  }

  getIndex (path, dir, cb) {
    if (this.indexCache.has(dir))
      return cb(null, this.indexCache.get(dir))

    fs.readFile(resolve(dir, '.git/index'), (er, data) => {
      if (er)
        return dir === this.cwd ? cb(er)
          : this.getIndex(path, dirname(dir), then)
      return this.parseIndex(dir, data, then)
    })

    const then = (er, index) => {
      if (er)
        return cb(er)
      this.indexCache.set(dir, index)
      return cb(null, index)
    }
  }

  parseIndex (dir, data, cb) {
    try {
      cb(null, new GitIndex(dir, data))
    } catch (er) {
      cb(er)
    }
  }
}

class GitStatSync extends GitStat {}

class Reader {
  constructor (buffer) {
    this.buffer = buffer
    this.p = 0
  }
  advance (n) {
    this.p += n
  }
  UInt32BE () {
    try {
      return this.buffer.readUInt32BE(this.p)
    } finally {
      this.advance(4)
    }
  }
  ascii (n) {
    return this.slice(n).toString('ascii')
  }
  hex (n) {
    return this.slice(n).toString('hex')
  }
  utf8 (n) {
    return this.slice(n).toString('utf8')
  }
  slice (n) {
    try {
      return this.buffer.slice(this.p, this.p + n)
    } finally {
      this.advance(n)
    }
  }
  UInt16BE () {
    try {
      return this.buffer.readUInt16BE(this.p)
    } finally {
      this.advance(2)
    }
  }
  nullTerminated () {
    for (let w = 0; this.buffer[this.p + w++];);
    return this.slice(w)
  }
}

class GitIndex {
  constructor (dir, index) {
    this.entries = new Map()
    const r = new Reader(index)
    if (r.ascii(4) !== 'DIRC')
      throw new Error('not a git index directory cache')
    const version = r.UInt32BE()
    if (version !== 3 && version !== 2 && version !== 4) {
      throw new Error('unsupported version')
    }
    const entryCount = r.UInt32BE()
    for (let i = 0; i < entryCount; i++) {
      const entry = {}
      r.advance(24)
      // entry.ctimeSeconds = r.UInt32BE()
      // entry.ctimeNanoseconds = r.UInt32BE()
      // entry.mtimeSeconds = r.UInt32BE()
      // entry.mtimeNanoseconds = r.UInt32BE()
      // entry.dev = r.UInt32BE()
      // entry.ino = r.UInt32BE()
      entry.mode = r.UInt32BE()
      r.advance(32)
      // entry.uid = r.UInt32BE()
      // entry.gid = r.UInt32BE()
      // entry.size = r.UInt32BE()
      // entry.sha1 = r.slice(20)
      const flags = r.UInt16BE()
      // entry.assumeValid = flags & 0x8000
      const extended = flags & 0x4000
      // entry.stage =  [entry.flags & 0x2000, entry.flags & 0x1000]
      const nameLen = flags & 0xFFF
      let length = 62

      if (entry.extended && result.version === 3) {
        r.advance(2)
        // entry.extraFlags = r.UInt16BE()
        // entry.reserved = entry.extraFlags & 0x8000
        // entry.skipWorktree = entry.extraFlags & 0x4000
        // entry.intentToAdd = entry.extraFlags & 0x2000
        length += 2
      }

      if (nameLen < 0xFFF) {
        const name = r.utf8(entry.nameLen)
        length += nameLen
        this.entries.set(resolve(dir, name), entry)
      } else {
        const name = reader.nullTerminated()
        nameLen = name.length
        this.entries.set(resolve(dir, name.toString()), entry)
      }

      if (version !== 4) {
        const padLen = (8 - length % 8) || 8
        const pad = r.hex(padLen)
        if (!/^(?:00)+$/.test(pad))
          throw new Error('non-null chars in pad')
      }
    }
  }
}

module.exports = { GitStat, GitStatSync }
