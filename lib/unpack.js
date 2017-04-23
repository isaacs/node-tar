'use strict'
// TODO:
// - file/dir ownership setting based on what's in the file.
// - Refuse to extract through a symlink without preservePaths
// - unlink should *always* unlink links and files before writing

const assert = require('assert')
const EE = require('events').EventEmitter
const Parser = require('./parse.js')
const fs = require('fs')
const path = require('path')
const mkdir = require('./mkdir.js')
const mkdirSync = mkdir.sync

const ONENTRY = Symbol('onEntry')
const FILE = Symbol('file')
const DIRECTORY = Symbol('directory')
const LINK = Symbol('link')
const SYMLINK = Symbol('symlink')
const HARDLINK = Symbol('hardlink')
const UNSUPPORTED = Symbol('unsupported')
const UNKNOWN = Symbol('unknown')
const CHECKPATH = Symbol('checkPath')
const MKDIR = Symbol('mkdir')
const ONERROR = Symbol('onError')

class Unpack extends Parser {
  constructor (opt) {
    super(opt)
    if (!opt)
      opt = {}

    this.dirCache = opt.dirCache || new Map()

    // allow .., absolute path entries, and unpacking through symlinks
    // without this, warn and skip .., relativize absolutes, and error
    // on symlinks in extraction path
    this.preservePaths = !!opt.preservePaths

    this.cwd = path.resolve(opt.cwd || process.cwd())
    this.strip = +opt.strip || 0
    this.umask = typeof opt.umask === 'number' ? opt.umask : process.umask()
    // default mode for dirs created as parents
    this.dmode = opt.dmode || (0o0777 & (~this.umask))
    this.on('entry', entry => this[ONENTRY](entry))
    if (typeof opt.onwarn === 'function')
      this.on('warn', opt.onwarn)
  }

  [CHECKPATH] (entry) {
    if (this.strip) {
      const parts = entry.path.split(/\/|\\/)
      if (parts.length < this.strip)
        return false
      entry.path = parts.slice(this.strip).join('/')
    }

    if (!this.preservePaths) {
      const p = entry.path
      if (p.match(/(^|\/|\\)\.\.(\\|\/|$)/)) {
        this.warn('path contains \'..\'', p)
        return false
      }
      if (path.isAbsolute(p)) {
        const parsed = path.parse(p)
        this.warn('stripping ' + parsed.root + ' from absolute path', p)
        entry.path = p.substr(parsed.root.length)
      }
    }

    if (path.isAbsolute(entry.path))
      entry.absolute = entry.path
    else
      entry.absolute = path.resolve(this.cwd, entry.path)

    return true
  }

  [ONENTRY] (entry) {
    if (!this[CHECKPATH](entry))
      return entry.resume()

    assert.equal(typeof entry.absolute, 'string')

    switch (entry.type) {
      case 'File':
      case 'OldFile':
      case 'ContiguousFile':
        return this[FILE](entry)

      case 'Link':
        return this[HARDLINK](entry)

      case 'SymbolicLink':
        return this[SYMLINK](entry)

      case 'Directory':
      case 'GNUDumpDir':
        return this[DIRECTORY](entry)

      case 'CharacterDevice':
      case 'BlockDevice':
      case 'FIFO':
        return this[UNSUPPORTED](entry)

      default:
        return this[UNKNOWN](entry)
    }
  }

  [ONERROR] (er, entry) {
    this.warn(er.message, er)
    entry.resume()
  }

  [MKDIR] (dir, mode, cb) {
    mkdir(dir, {
      preserve: this.preservePaths,
      unlink: this.unlink,
      cache: this.dirCache,
      cwd: this.cwd,
      mode: mode
    }, cb)
  }

  [FILE] (entry) {
    const makeFile = er => {
      if (er && er.code !== 'ENOENT')
        return this[ONERROR](er, entry)
      const mode = entry.mode & 0o7777
      const stream = fs.createWriteStream(entry.absolute, { mode: mode })
      if (entry.atime && entry.mtime) {
        stream.on('close', _ =>
          fs.utimes(entry.absolute, entry.atime, entry.mtime, _ => _))
      }
      entry.pipe(stream)
    }

    this[MKDIR](path.dirname(entry.absolute), this.dmode, er => {
      if (er)
        return this[ONERROR](er, entry)
      if (this.unlink)
        fs.unlink(entry.absolute, makeFile)
      else
        makeFile()
    })
  }

  [DIRECTORY] (entry) {
    const makeDirectory = er => {
      if (er)
        return this[ONERROR](er, entry)
      this[MKDIR](entry.absolute, mode, er => {
        if (er)
          return this[ONERROR](er, entry)
        if (entry.atime && entry.mtime)
          fs.utimes(entry.absolute, entry.atime, entry.mtime, _ => _)
        entry.resume()
      })
    }

    const mode = entry.mode & 0o7777
    if (this.dmode !== mode)
      this[MKDIR](path.dirname(entry.absolute), this.dmode, makeDirectory)
    else
      makeDirectory()
  }

  [UNSUPPORTED] (entry) {
    this.warn('unsupported entry type: ' + entry.type, entry)
    entry.resume()
  }

  [UNKNOWN] (entry) {
    this.warn('unknown entry type: ' + entry.type, entry)
    entry.resume()
  }

  [SYMLINK] (entry) {
    this[LINK](entry, entry.linkpath, SYMLINK, 'symlink')
  }

  [HARDLINK] (entry) {
    this[LINK](entry, entry.linkpath, HARDLINK, 'link')
  }

  [LINK] (entry, linkpath, retry, link) {
    // should probably be allowed by default, locked down with an option.
    // XXX: get the type ('file' or 'dir') for windows
    this[MKDIR](path.dirname(entry.absolute), this.dmode, er => {
      if (er)
        return this[ONERROR](er, entry)
      if (this.unlink)
        fs.unlink(entry.absolute, makeLink)
      else
        makeLink
    })

    const makeLink = er => {
      if (er && er.code !== 'ENOENT')
        return this[ONERROR](er, entry)
      fs[link](linkpath, entry.absolute, er => {
        // if it's an EEXIST, then clobber
        if (er && er.code === 'EEXIST' && !this.unlink)
          return fs.unlink(entry.absolute, er => {
            if (er && er.code !== 'ENOENT')
              this[ONERROR](er, entry)
            else
              this[retry](entry)
          })
        if (er)
          return this[ONERROR](er, entry)
        entry.resume()
      })
    }
  }
}

class UnpackSync extends Unpack {
  constructor (opt) {
    super(opt)
  }

  [FILE] (entry) {
    const er = this[MKDIR](path.dirname(entry.absolute), this.dmode)
    if (er)
      return this[ONERROR](er, entry)
    const mode = entry.mode & 0o7777
    if (this.unlink) {
      try {
        fs.unlinkSync(entry.absolute)
      } catch (er) {
        if (er.code !== 'ENOENT')
          return this[ONERROR](er, entry)
      }
    }
    const fd = fs.openSync(entry.absolute, 'w', mode)
    entry.on('data', buf => fs.writeSync(fd, buf))
    entry.on('end', _ => {
      if (entry.atime && entry.mtime) {
        try {
          fs.futimesSync(fd, entry.atime, entry.mtime)
        } catch (er) {}
      }
      fs.closeSync(fd)
    })
  }

  [DIRECTORY] (entry) {
    const mode = entry.mode & 0o7777
    let er
    if (mode !== this.dmode)
      er = this[MKDIR](path.dirname(entry.absolute), this.dmode)
    if (er)
      return this[ONERROR](er, entry)
    er = this[MKDIR](entry.absolute, mode)
    if (er)
      return this[ONERROR](er, entry)
    if (entry.atime && entry.mtime) {
      try {
        fs.utimesSync(entry.absolute, entry.atime, entry.mtime)
      } catch (er) {}
    }
    entry.resume()
  }

  [MKDIR] (dir, mode, cb) {
    return mkdir.sync(dir, {
      preserve: this.preservePaths,
      unlink: this.unlink,
      cache: this.dirCache,
      cwd: this.cwd,
      mode: mode
    })
  }

  [LINK] (entry, linkpath, retry, link) {
    // should probably be allowed by default, locked down with an option.
    // XXX: get the type ('file' or 'dir') for windows
    const er = this[MKDIR](path.dirname(entry.absolute), this.dmode)
    if (er)
      return this[ONERROR](er, entry)

    if (this.unlink) {
      try {
        fs.unlinkSync(entry.absolute)
      } catch (er) {
        if (er.code !== 'ENOENT')
          return this[ONERROR](er, entry)
      }
    }

    try {
      fs[link + 'Sync'](linkpath, entry.absolute)
    } catch (er) {
      // if it's an EEXIST, then clobber
      if (er.code === 'EEXIST') {
        fs.unlinkSync(entry.absolute)
        return this[retry](entry)
      }
      throw er
    }
    entry.resume()
  }
}

Unpack.Sync = UnpackSync
module.exports = Unpack
