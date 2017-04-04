'use strict'
module.exports = class Field {
  constructor (offset, size, numeric) {
    this.size = size
    this.offset = offset
    this.end = size + offset
    this.numeric = numeric
  }

  readRaw (buffer) {
    return buffer.slice(this.offset, this.end)
  }

  read (buffer) {
    const slice = this.readRaw(buffer)
    return this.numeric ? parseNumeric(slice)
      : slice.toString('utf8').replace(/\0+$/, '')
  }

  write (value, buffer) {
    return this.numeric
      ? writeNumeric(buffer, this.offset, this.end, value)
      : writeText(buffer, this.offset, this.end, value)
  }
}

// parse a 2's complement base-256 signed integer
const parse256 = buf => {
  // first byte MUST be either 80 or FF
  // 80 for positive, FF for 2's comp
  const positive = buf[0] === 0x80

  // build up a base-256 tuple from the least sig to the highest
  let zero = false
  const tuple = []
  for (let i = buf.length - 1; i > 0; i --) {
    let byte = buf[i]
    if (positive)
      tuple.push(byte)
    else if (zero && byte === 0)
      tuple.push(0)
    else if (zero) {
      zero = false
      tuple.push(0x100 - byte)
    } else
      tuple.push(0xFF - byte)
  }

  let sum, i, l
  for (sum = 0, i = 0, l = tuple.length; i < l; i ++) {
    sum += tuple[i] * Math.pow(256, i)
  }

  return positive ? sum : -1 * sum
}

const parseNumeric = f => {
  if (f[0] & 0x80)
    return parse256(f)

  const str = f.toString('utf8').replace(/\0.*$/, '').trim()
  const res = parseInt(str, 8)

  return isNaN(res) ? null : res
}

const writeText = (block, off, end, str) => {
  // strings are written as utf8, then padded with \0
  const strLen = Buffer.byteLength(str)
  const writeLen = Math.min(strLen, end - off)
  // non-ascii fields need extended headers
  // long fields get truncated
  const needExtended = strLen !== str.length || strLen > writeLen

  // write the string, and null-pad
  if (writeLen > 0)
    block.write(str, off, writeLen, 'utf8')

  for (let i = off + writeLen; i < end; i ++) {
    block[i] = 0
  }

  return needExtended
}

// if it's a negative number, or greater than will fit,
// then use write256.
const MAXNUM = {
  12: 0o77777777777,
  11: 0o7777777777,
  8 : 0o7777777,
  7 : 0o777777
}
const writeNumeric = (block, off, end, num) => {
  const writeLen = end - off
  const maxNum = MAXNUM[writeLen] || 0

  num = num || 0

  if (num instanceof Date ||
      Object.prototype.toString.call(num) === '[object Date]') {
    num = num.getTime() / 1000
  }

  if (num > maxNum || num < 0) {
    write256(block, off, end, num)
    // need an extended header if negative or too big.
    return true
  }

  // god, tar is so annoying
  // if the string is small enough, you should put a space
  // between the octal string and the \0, but if it doesn't
  // fit, then don't.
  var numStr = Math.floor(num).toString(8)
  if (num < MAXNUM[writeLen - 1]) numStr += ' '

  // pad with '0' chars
  if (numStr.length < writeLen) {
    numStr = (new Array(writeLen - numStr.length).join('0')) + numStr
  }

  block.write(numStr, off, writeLen, 'utf8')
  block[end - 1] = 0
}

function write256 (block, off, end, num) {
  var buf = block.slice(off, end)
  var positive = num >= 0
  buf[0] = positive ? 0x80 : 0xFF

  // get the number as a base-256 tuple
  if (!positive) num *= -1
  var tuple = []
  do {
    var n = num % 256
    tuple.push(n)
    num = (num - n) / 256
  } while (num)

  var bytes = tuple.length

  var fill = buf.length - bytes
  for (var i = 1; i < fill; i ++) {
    buf[i] = positive ? 0 : 0xFF
  }

  // tuple is a base256 number, with [0] as the *least* significant byte
  // if it's negative, then we need to flip all the bits once we hit the
  // first non-zero bit.  The 2's-complement is (0x100 - n), and the 1's-
  // complement is (0xFF - n).
  var zero = true
  for (i = bytes; i > 0; i --) {
    var byte = tuple[bytes - i]
    if (positive) buf[fill + i] = byte
    else if (zero && byte === 0) buf[fill + i] = 0
    else if (zero) {
      zero = false
      buf[fill + i] = 0x100 - byte
    } else buf[fill + i] = 0xFF - byte
  }
}
