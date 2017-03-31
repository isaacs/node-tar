// parse a 512-byte header block to a data object, or vice-versa
// encode returns `true` if an extended header is needed, because
// the data could not be faithfully encoded in a simple header.

const types = require('./types.js')
const Field = require('./field.js')

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
const afterCksum = new Field(156, 512, false)

const basicFields = Object.create(null)
basicFields.path = path
basicFields.mode = mode
basicFields.uid = uid
basicFields.gid = gid
basicFields.size = size
basicFields.mtime = mtime
basicFields.cksum = cksum
basicFields.typeKey = typeKey
basicFields.linkpath = linkpath

const ustarFields = Object.create(null)
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

const xstarFields = Object.create(null)
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

const detectFieldset = buffer => {
  if (ustar.readRaw(buffer).toString('utf8') !== 'ustar\0')
    return basicFields
  const sz = prefixTerminator.readRaw(buffer)
  if (sz[0] !== 0)
    return ustarFields
  return xstarFields
}

class Header {
  constructor (block, buffer) {
    this.fieldset = null
    this.block = null
    this.cksumValid = false

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
      this.decode(block)
    else if (block)
      this.encode(block, buffer)
  }

  decode (block, buffer) {
    this.block = block
    this.fieldset = detectFieldset(block)
    for (let i in this.fieldset) {
      this[i] = this.fieldset[i].read(block)
    }
    this.cksumValid = validateSum(block)
    const prefix = this.xstarPrefix || this.ustarPrefix
    if (prefix) {
      this.path = prefix + '/' + this.path
      this.xstarPrefix = ''
      this.ustarPrefix = ''
    }
    this.type = types.name.get(this.typeKey)
  }

  encode (data, buffer) {
    if (data) for (let i in data) {
      this[i] = data[i]
    }

    if (this.type && !this.typeKey)
      this.typeKey = types.code.get(this.type) || '0'

    this.fieldset = xstarFields
    this.block = Buffer.isBuffer(buffer) ? buffer : Buffer.alloc(512)

    let extend = false
    let path = this.path
    let prefix = ''
    const pathLen = this.path.length
    if (pathLen > 100 && pathLen < 230) {
      // need to split it somewhere between len-100 through 130,
      // so that both fit in their respective spots.
      // shorter than 100? don't bother, fits in path field.
      // longer than 130? no point, truncate and use PAX for it.
      const s = this.path.indexOf('/', pathLen - 1 - 100)
      if (s !== -1) {
        prefix = this.path.substr(0, s)
        path = this.path.substr(s + 1)
      } else {
        const b = this.path.indexOf('\\', pathLen - 1 - 100)
        prefix = this.path.substr(0, b)
        path = this.path.substr(b + 1)
      }
    }

    for (let i in this.fieldset) {
      let field = this.fieldset[i]
      switch (i) {
        case 'path':
          extend = field.write(path, this.block) || extend
          continue
        case 'xstarPrefix':
          extend = field.write(prefix, this.block) || extend
          continue
        case 'cksum':
          continue
        default:
          extend = field.write(this[i], this.block) || extend
          continue
      }
    }

    writeSum(this.block)
    return extend
  }
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

const writeSum = block => {
  cksum.write(calcSum(block), block)
}

const validateSum = block => {
  return calcSum(block) === cksum.read(block)
}

module.exports = Header
