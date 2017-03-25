const tar = require('./field-info.js')
const MiniPass = require('minipass')
const SLURP = Symbol('slurp')
module.exports = class Entry extends MiniPass {
  constructor (header, ex, gex) {
    super()
    this.extended = ex
    this.globalExtended = gex
    this.header = header
    this.blockRemain = 512 * Math.ceil(header.size / 512)
    this.remain = header.size
    this.type = tar.types[header.type] || 'invalid'
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

      // NOTE: bsdtar treats unrecognized types as 'File'
      default:
        this.ignore = true
    }

    this.path = header.path
    this.mode = header.mode
    this.uid = header.uid
    this.gid = header.gid
    this.size = header.size
    this.mtime = new Date(header.mtime * 1000)
    this.linkpath = header.linkpath
    this.uname = header.uname
    this.gname = header.gname

    if (ex) this[SLURP](ex)
    if (gex) this[SLURP](gex)
  }

  [SLURP] (ex) {
    for (let k in ex) {
      this[k] = ex[k]
    }
  }
}
