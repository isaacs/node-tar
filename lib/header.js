'use strict'
// parse a 512-byte header block to a data object, or vice-versa
// encode returns `true` if a pax extended header is needed, because
// the data could not be faithfully encoded in a simple header.
// (Also, check header.needPax to see if it needs a pax header.)

const types = require('./types.js')
const Field = require('./field.js')

const pathModule = require('path')
const path = new Field(0, 100, 'string')
const mode = new Field(100, 8, 'number')
const uid = new Field(108, 8, 'number')
const gid = new Field(116, 8, 'number')
const size = new Field(124, 12, 'number')
const mtime = new Field(136, 12, 'date')
const cksum = new Field(148, 8, 'number')
const type = new Field(156, 1, 'string')
const linkpath = new Field(157, 100, 'string')

const ustar = new Field(257, 6, 'string')
const ustarver = new Field(263, 2, 'string')
const uname = new Field(265, 32, 'string')
const gname = new Field(297, 32, 'string')
const devmaj = new Field(329, 8, 'number')
const devmin = new Field(337, 8, 'number')
const ustarPrefix = new Field(345, 155, 'string')

const xstarPrefix = new Field(345, 130, 'string')
const prefixTerminator = new Field(475, 1, 'string')
const atime = new Field(476, 12, 'date')
const ctime = new Field(488, 12, 'date')

const beforeCksum = new Field(0, 148, 'string')
const afterCksum = new Field(156, 356, 'string')

const basicFields = new class BasicFieldset {}
basicFields.path = path
basicFields.mode = mode
basicFields.uid = uid
basicFields.gid = gid
basicFields.size = size
basicFields.mtime = mtime
basicFields.cksum = cksum
basicFields.type = type
basicFields.linkpath = linkpath

const ustarFields = new class UstarFieldset {}
ustarFields.path = path
ustarFields.mode = mode
ustarFields.uid = uid
ustarFields.gid = gid
ustarFields.size = size
ustarFields.mtime = mtime
ustarFields.cksum = cksum
ustarFields.type = type
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
xstarFields.type = type
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

const TYPE = Symbol('type')
const FIELDSET = Symbol('fieldset')
class Header {
  constructor (data) {
    this[FIELDSET] = null
    this.block = null
    this.cksumValid = false
    this.needPax = false
    this.nullBlock = false

    this.path = null
    this.mode = null
    this.uid = null
    this.gid = null
    this.size = null
    this.mtime = null
    this.cksum = null
    this[TYPE] = null
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

    if (Buffer.isBuffer(data))
      this.decode(data)
    else if (data)
      this.set(data)
  }

  get type () {
    return types.name.get(this[TYPE]) || this[TYPE]
  }
  get typeKey () {
    return this[TYPE]
  }

  set type (type) {
    if (types.code.has(type))
      this[TYPE] = types.code.get(type)
    else
      this[TYPE] = type
  }

  get fieldset () {
    return this[FIELDSET]
  }

  set fieldset (name) {
    switch (name) {
      case 'xstar':
        return this[FIELDSET] = xstarFields
      case 'ustar':
        return this[FIELDSET] = ustarFields
      case 'basic':
        return this[FIELDSET] = basicFields
      default:
        throw new Error('unknown fieldset: ' + name)
    }
  }

  decode (block) {
    if (block.length < 512)
      throw new Error('need 512 bytes for header, got ' + block.length)
    this.block = block.length === 512 ? block : block.slice(0, 512)
    const fieldset = this[FIELDSET] = detectFieldset(block)
    this.nullBlock = true
    for (let i in fieldset) {
      this[i] = fieldset[i].read(block)
      if (this[i])
        this.nullBlock = false
    }

    const actualSum = calcSum(block)
    const expectSum = fieldset.cksum.read(block)
    if (actualSum === 8 * 0x20 && expectSum === null)
      this.nullBlock = true
    this.cksumValid = actualSum === expectSum

    const prefix = this.xstarPrefix || this.ustarPrefix
    if (prefix) {
      this.path = prefix + '/' + this.path
      this.xstarPrefix = ''
      this.ustarPrefix = ''
    }
  }

  set (data) {
    if (data.type && !types.code.has(data.type) && !types.name.has(data.type))
      throw new TypeError('unknown type: ' + data.type)

    for (let i in data) {
      if (data[i] !== null && data[i] !== undefined)
        this[i] = data[i]
    }
  }

  encode (block) {
    if (!this[FIELDSET]) {
      if (this.atime || this.ctime)
        this[FIELDSET] = xstarFields
      else
        this[FIELDSET] = ustarFields
    }

    // default to File
    if (this[TYPE] === null)
      this[TYPE] = '0'

    if (Buffer.isBuffer(block)) {
      if (block.length < 512)
        throw new Error('need 512 bytes for header, got ' + block.length)
      this.block = block.length === 512 ? block : block.slice(0, 512)
    } else
      this.block = Buffer.alloc(512)

    const prefixSize =
      this[FIELDSET] === xstarFields ? xstarPrefix.size
      : this[FIELDSET] === ustarFields ? ustarPrefix.size
      : 0

    const split = splitPrefix(this.path, 100, prefixSize)
    const path = split[0]
    const prefix = split[1]
    this.needPax = split[2]

    for (let i in this[FIELDSET]) {
      let field = this[FIELDSET][i]
      switch (i) {
        case 'type':
          this.needPax = field.write(this[TYPE], this.block) || this.needPax
          continue
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

const writeSum = header => {
  header.cksum = calcSum(header.block)
  cksum.write(header.cksum, header.block)
}

module.exports = Header
