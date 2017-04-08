'use strict'
// parse a 512-byte header block to a data object, or vice-versa
// encode returns `true` if a pax extended header is needed, because
// the data could not be faithfully encoded in a simple header.
// (Also, check header.needPax to see if it needs a pax header.)

const types = require('./types.js')
const Field = require('./field.js')

const pathModule = require('path')
const path = new Field(0, 100, false)
const mode = new Field(100, 8, true)
const uid = new Field(108, 8, true)
const gid = new Field(116, 8, true)
const size = new Field(124, 12, true)
const mtime = new Field(136, 12, true)
const cksum = new Field(148, 8, true)
const typeKey = new Field(156, 1, false)
const linkpath = new Field(157, 100, false)

const ustar = new Field(257, 6, false)
const ustarver = new Field(263, 2, false)
const uname = new Field(265, 32, false)
const gname = new Field(297, 32, false)
const devmaj = new Field(329, 8, true)
const devmin = new Field(337, 8, true)
const ustarPrefix = new Field(345, 155, false)

const xstarPrefix = new Field(345, 130, false)
const prefixTerminator = new Field(475, 1, false)
const atime = new Field(476, 12, true)
const ctime = new Field(488, 12, true)

const beforeCksum = new Field(0, 148, false)
const afterCksum = new Field(156, 356, false)

const basicFields = new class BasicFieldset {}
basicFields.path = path
basicFields.mode = mode
basicFields.uid = uid
basicFields.gid = gid
basicFields.size = size
basicFields.mtime = mtime
basicFields.cksum = cksum
basicFields.typeKey = typeKey
basicFields.linkpath = linkpath

const ustarFields = new class UstarFieldset {}
ustarFields.path = path
ustarFields.mode = mode
ustarFields.uid = uid
ustarFields.gid = gid
ustarFields.size = size
ustarFields.mtime = mtime
ustarFields.cksum = cksum
ustarFields.typeKey = typeKey
ustarFields.linkpath = linkpath
ustarFields.ustar = ustar
ustarFields.ustarver = ustarver
ustarFields.uname = uname
ustarFields.gname = gname
ustarFields.devmaj = devmaj
ustarFields.devmin = devmin
ustarFields.ustarPrefix = ustarPrefix

const xstarFields = new class XstarFieldset {}
xstarFields.path = path
xstarFields.mode = mode
xstarFields.uid = uid
xstarFields.gid = gid
xstarFields.size = size
xstarFields.mtime = mtime
xstarFields.cksum = cksum
xstarFields.typeKey = typeKey
xstarFields.linkpath = linkpath
xstarFields.ustar = ustar
xstarFields.ustarver = ustarver
xstarFields.uname = uname
xstarFields.gname = gname
xstarFields.devmaj = devmaj
xstarFields.devmin = devmin
xstarFields.xstarPrefix = xstarPrefix
xstarFields.prefixTerminator = prefixTerminator
xstarFields.atime = atime
xstarFields.ctime = ctime

const detectFieldset = block => {
  if (ustar.readRaw(block).toString('utf8') !== 'ustar\0')
    return basicFields
  const sz = prefixTerminator.readRaw(block)
  if (sz[0] !== 0)
    return ustarFields
  const a = atime.read(block)
  const c = ctime.read(block)
  return (a !== null || c !== null) ? xstarFields : ustarFields
}

class Header {
  constructor (block, buffer) {
    this.fieldset = null
    this.block = null
    this.cksumValid = false
    this.needPax = false

    this.preservePaths = false
    this.path = null
    this.mode = null
    this.uid = null
    this.gid = null
    this.size = null
    this.mtime = null
    this.cksum = null
    this.typeKey = null
    this.type = null
    this.linkpath = null
    this.ustar = null
    this.ustarver = null
    this.uname = null
    this.gname = null
    this.devmaj = null
    this.devmin = null
    this.ustarPrefix = null
    this.xstarPrefix = null
    this.prefixTerminator = null
    this.atime = null
    this.ctime = null

    if (Buffer.isBuffer(block))
      this.decode(block, buffer)
    else if (block)
      this.encode(block, buffer)
  }

  decode (block, options) {
    if (options && options.preservePaths)
      this.preservePaths = !!options.preservePaths

    if (block.length < 512)
      throw new Error('need 512 bytes for header, got ' + block.length)
    this.block = block.length === 512 ? block : block.slice(0, 512)
    this.fieldset = detectFieldset(block)
    for (let i in this.fieldset) {
      this[i] = this.fieldset[i].read(block)
      if (/^[acm]time$/.test(i) && this[i] !== null)
        this[i] = new Date(this[i] * 1000)
    }
    this.cksumValid = validateSum(block)
    const prefix = this.xstarPrefix || this.ustarPrefix
    if (prefix) {
      this.path = prefix + '/' + this.path
      this.xstarPrefix = ''
      this.ustarPrefix = ''
    }
    this.type = types.name.get(this.typeKey)

    checkPaths(this)
  }

  encode (data, block) {
    this.type = 'File'
    this.typeKey = '0'

    if (data) for (let i in data) {
      if (i === 'fieldset') {
        switch (data[i]) {
          case 'xstar':
            this.fieldset = xstarFields
            continue
          case 'ustar':
            this.fieldset = ustarFields
            continue
          case 'basic':
            this.fieldset = basicFields
            continue
          default:
            throw new Error('unknown fieldset: ' + data[i])
        }
      } else if (i === 'preservePaths') {
        this.preservePaths = !!data[i]
      } else if (i === 'type') {
        if (types.name.has(data[i])) {
          this.typeKey = data[i]
          this.type = types.name.get(data[i])
        } else if (types.code.has(data[i])) {
          this.type = data[i]
          this.typeKey = types.code.get(data[i])
        } else
          throw new Error('unknown type: ' + data[i])
      } else if (data[i] !== null && data[i] !== undefined)
        this[i] = data[i]
    }

    if (!this.fieldset) {
      if (this.atime || this.ctime)
        this.fieldset = xstarFields
      else
        this.fieldset = ustarFields
    }

    // linkpath is required for Links, not allowed for other types.
    if (this.type !== 'Link' && this.type !== 'SymbolicLink' &&
        this.linkpath)
      throw new Error('linkpath not allowed for type ' + this.type)
    else if ((this.type === 'Link' || this.type === 'SymbolicLink') &&
             !this.linkpath)
      throw new Error('linkpath required for type ' + this.type)

    if (Buffer.isBuffer(block)) {
      if (block.length < 512)
        throw new Error('need 512 bytes for header, got ' + block.length)
      this.block = block.length === 512 ? block : block.slice(0, 512)
    } else
      this.block = Buffer.alloc(512)

    checkPaths(this)

    const prefixSize =
      this.fieldset === xstarFields ? xstarPrefix.size
      : this.fieldset === ustarFields ? ustarPrefix.size
      : 0
    const split = splitPrefix(this.path, 100, prefixSize)
    const path = split[0]
    const prefix = split[1]
    this.needPax = split[2]

    for (let i in this.fieldset) {
      let field = this.fieldset[i]
      switch (i) {
        case 'path':
          this.needPax = field.write(path, this.block) || this.needPax
          continue
        case 'ustarPrefix':
        case 'xstarPrefix':
          this.needPax = field.write(prefix, this.block) || this.needPax
          continue
        case 'devmaj': case 'devmin':
          field.write(0, this.block)
          continue
        case 'cksum':
          continue
        case 'ustar':
          field.write('ustar\0', this.block)
          continue
        case 'ustarver':
          field.write('00', this.block)
          continue
        default:
          if (this[i] !== null && this[i] !== undefined)
            this.needPax = field.write(this[i], this.block) || this.needPax
          continue
      }
    }

    writeSum(this)
    this.cksumValid = true
    return this.needPax
  }
}

const splitPrefix = (p, pathSize, prefixSize) => {
  let pp = p
  let prefix = ''

  if (Buffer.byteLength(pp) < pathSize)
    return [pp, prefix, false]

  // basic fields don't have a prefix field, must truncate
  if (prefixSize === 0)
    return [p.substr(0, pathSize - 1), '', true]

  // first set prefix to the dir, and path to the base
  prefix = pathModule.dirname(pp)
  pp = pathModule.basename(pp)

  do {
    // both fit!
    if (Buffer.byteLength(pp) <= pathSize &&
        Buffer.byteLength(prefix) <= prefixSize)
      return [pp, prefix, false]

    // prefix fits in prefix, but path doesn't fit in path
    if (Buffer.byteLength(pp) > pathSize &&
        Buffer.byteLength(prefix) <= prefixSize)
      return [pp.substr(0, pathSize - 1), prefix, true]

    // make path take a bit from prefix
    pp = pathModule.join(pathModule.basename(prefix), pp)
    prefix = pathModule.dirname(prefix)
  } while (prefix !== '.')

  // at this point, found no resolution, just truncate
  return [p.substr(0, pathSize - 1), '', true]
}

const calcSum = block => {
  const before = beforeCksum.readRaw(block)
  const after = afterCksum.readRaw(block)

  // calculate sum by treating the cksum bytes as ' '
  let sum = 8 * 0x20
  for (let i = 0; i < before.length; i ++) {
    sum += before[i]
  }
  for (let i = 0; i < after.length; i ++) {
    sum += after[i]
  }
  return sum
}

const writeSum = Header.writeSum = header => {
  header.cksum = calcSum(header.block)
  cksum.write(header.cksum, header.block)
}

const validateSum = block => {
  return calcSum(block) === cksum.read(block)
}

const checkPaths = h => {
  if (!h.preservePaths) {
    h.path = checkPath(h.path)
    if (h.linkpath)
      h.linkpath = checkPath(h.linkpath)
  }
  if (!h.path)
    throw new Error('path is required')
}

const checkPath = p => {
  if (typeof p !== 'string')
    return p

  if (pathModule.isAbsolute(p))
    throw new Error('absolute path not allowed: ' + p)
  if (new Set(p.split(/[\/\\]/)).has('..'))
    throw new Error('".." not allowed in paths: ' + p)
  return pathModule.normalize(p).replace(/^\.(\/|$)/, '')
}

module.exports = Header
