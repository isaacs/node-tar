import { assert, test } from 'ubqtest'
import {
  dealias,
  isSync,
  isSyncFile,
  isFile,
  isAsyncFile,
  isAsyncNoFile,
  isSyncNoFile,
  isAsync,
  isNoFile,
} from '../src/options.js'

test('dealias and the option type guards', () => {
  assert.deepEqual(dealias(), {})
  assert.deepEqual(dealias(false), {})

  assert.deepEqual(
    dealias({
      C: 'dir',
      f: 'file',
      z: 'zip',
      P: 'preserve',
      U: 'unlink',
      'strip-components': 99,
      foo: 'bar',
    }),
    {
      cwd: 'dir',
      file: 'file',
      gzip: 'zip',
      preservePaths: 'preserve',
      unlink: 'unlink',
      strip: 99,
      foo: 'bar',
    },
  )

  assert.deepEqual(
    dealias({
      C: 'dir',
      f: 'file',
      z: 'zip',
      P: 'preserve',
      U: 'unlink',
      stripComponents: 99,
      foo: 'bar',
    }),
    {
      cwd: 'dir',
      file: 'file',
      gzip: 'zip',
      preservePaths: 'preserve',
      unlink: 'unlink',
      strip: 99,
      foo: 'bar',
    },
  )

  assert.deepEqual(dealias({ noChmod: false }), { chmod: true })
  assert.deepEqual(dealias({ noChmod: true }), {})

  assert.equal(isSyncFile(dealias({ sync: true, f: 'x' })), true)
  assert.equal(isSyncFile(dealias({ file: 'x' })), false)
  assert.equal(isSyncFile(dealias({ sync: true })), false)
  assert.equal(isSyncFile(dealias({})), false)
  assert.equal(isSync(dealias({ sync: true, f: 'x' })), true)
  assert.equal(isSync(dealias({ file: 'x' })), false)
  assert.equal(isSync(dealias({ sync: true })), true)
  assert.equal(isSync(dealias({})), false)
  assert.equal(isAsync(dealias({})), true)
  assert.equal(isFile(dealias({ sync: true, f: 'x' })), true)
  assert.equal(isNoFile(dealias({ sync: true, f: 'x' })), false)
  assert.equal(isFile(dealias({ file: 'x' })), true)
  assert.equal(isFile(dealias({ sync: true })), false)
  assert.equal(isFile(dealias({})), false)
  assert.equal(isSyncFile(dealias({})), false)
  assert.equal(isSyncNoFile(dealias({ sync: true })), true)
  assert.equal(isAsyncFile(dealias({})), false)
  assert.equal(isAsyncNoFile(dealias({})), true)
})
