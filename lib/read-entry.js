const types = require('./types.js')
const MiniPass = require('minipass')

const SLURP = Symbol('slurp')
module.exports = class ReadEntry extends MiniPass {
  constructor (header, ex, gex) {
    super()
    this.extended = ex
    this.globalExtended = gex
    this.header = header
    this.blockRemain = 512 * Math.ceil(header.size / 512)
    this.remain = header.size
    this.type = header.type
    this.meta = false
    this.ignore = false
    switch (this.type) {
      case 'File':
      case 'OldFile':
      case 'Link':
      case 'SymbolicLink':
      case 'CharacterDevice':
      case 'BlockDevice':
      case 'Directory':
      case 'FIFO':
      case 'ContiguousFile':
      case 'GNUDumpDir':
        break

      case 'NextFileHasLongLinkpath':
      case 'NextFileHasLongPath':
      case 'OldGnuLongPath':
      case 'GlobalExtendedHeader':
      case 'ExtendedHeader':
      case 'OldExtendedHeader':
        this.meta = true
        break

      // NOTE: gnutar and bsdtar treat unrecognized types as 'File'
      // it may be worth doing the same, but with a warning.
      default:
        this.ignore = true
    }

    this.path = header.path
    this.mode = header.mode
    this.uid = header.uid
    this.gid = header.gid
    this.uname = header.uname
    this.gname = header.gname
    this.size = header.size
    this.mtime = new Date(header.mtime * 1000)
    this.atime = header.atime ? new Date(header.atime * 1000) : null
    this.ctime = header.ctime ? new Date(header.ctime * 1000) : null
    this.linkpath = header.linkpath
    this.uname = header.uname
    this.gname = header.gname

    if (ex) this[SLURP](ex)
    if (gex) this[SLURP](gex)
  }

  [SLURP] (ex) {
    for (let k in ex) {
      this[k] = /^[amc]time$/.test(k) ? new Date(ex[k] * 1000) : ex[k]
    }
  }
}
