'use strict'
// a little utility to create virtual tar data
if (module === require.main)
  return require('tap').pass('this is fine')

const Header = require('../lib/header.js')
module.exports = chunks =>
  Buffer.concat(chunks.map(chunk => {
    const buf = Buffer.alloc(512)
    if (typeof chunk === 'string')
      buf.write(chunk)
    else
      new Header(chunk).encode(buf, 0)
    return buf
  }), chunks.length * 512)
