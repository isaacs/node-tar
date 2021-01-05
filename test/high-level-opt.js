'use strict'

const t = require('tap')
const hlo = require('../lib/high-level-opt.js')

t.same(hlo(), {})

t.same(hlo({
  C: 'dir',
  f: 'file',
  z: 'zip',
  P: 'preserve',
  U: 'unlink',
  'strip-components': 99,
  foo: 'bar',
}), {
  cwd: 'dir',
  file: 'file',
  gzip: 'zip',
  preservePaths: 'preserve',
  unlink: 'unlink',
  strip: 99,
  foo: 'bar',
})

t.same(hlo({
  C: 'dir',
  f: 'file',
  z: 'zip',
  P: 'preserve',
  U: 'unlink',
  stripComponents: 99,
  foo: 'bar',
}), {
  cwd: 'dir',
  file: 'file',
  gzip: 'zip',
  preservePaths: 'preserve',
  unlink: 'unlink',
  strip: 99,
  foo: 'bar',
})
