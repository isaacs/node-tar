'use strict'
const zlib = require('zlib')
const minizlib = require('minizlib')
const szlib = require('../lib/zlib.js')
const select = szlib._SELECT_ZLIB
const test = require('tap').test

test('select the right zlib', t => {
  t.is(select('v8.5.0'), minizlib, 'older nodes get faster zlib')
  t.is(select('v9.0.0-pre'), zlib, 'newer nodes get compat zlib')
  t.is(select('v9.1.0'), zlib, 'non-pre newer nodes get compat zlib')
  t.is(select('v10.0.0-pre'), zlib, 'even newer pre-release nodes get compat zlib')
  t.is(select('v10.0.0'), zlib, 'even newer nodes get compat zlib')
  t.end()
})
