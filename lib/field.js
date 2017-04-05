'use strict'
const large = require('./large-numbers.js')

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

const parseNumeric = f => {
  if (f[0] & 0x80)
    return large.parse(f)

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
  const maxNum = MAXNUM[writeLen]

  if (num instanceof Date ||
      Object.prototype.toString.call(num) === '[object Date]') {
    num = num.getTime() / 1000
  }

  if (num > maxNum || num < 0) {
    large.encode(num, block.slice(off, end))
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
  if (numStr.length < writeLen - 1) {
    numStr = (new Array(writeLen - numStr.length).join('0')) + numStr
  }

  block.write(numStr, off, writeLen, 'utf8')
  block[end - 1] = 0
}
