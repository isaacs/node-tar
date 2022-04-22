'use strict'
// a little utility to create virtual tar data
if (module === require.main) {
  return require('tap').pass('this is fine')
}

const Header = require('../lib/header.js')
module.exports = chunks => {
  let dataLen = 0
  return Buffer.concat(chunks.map(chunk => {
    if (Buffer.isBuffer(chunk)) {
      dataLen += chunk.length
      return chunk
    }
    const size = Math.max(typeof chunk === 'string'
      ? 512 * Math.ceil(chunk.length / 512)
      : 512)
    dataLen += size
    const buf = Buffer.alloc(size)
    if (typeof chunk === 'string') {
      buf.write(chunk)
    } else {
      new Header(chunk).encode(buf, 0)
    }
    return buf
  }), dataLen)
}
