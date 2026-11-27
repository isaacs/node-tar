import nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { assert, test } from 'ubqtest'
import { writeFlags } from '../../src/next/write-flag.js'

const UV_FS_O_FILEMAP = 0x20000000
const { O_CREAT, O_TRUNC, O_WRONLY } = nodeFs.constants
// Not each platform has the flag, so the tests use a made-up value.
const O_NOFOLLOW = 0x100
const write = O_TRUNC | O_CREAT | O_WRONLY
const big = 512 * 1024

test('win32 with fmap uses fmap for small files only', () => {
  const flag = writeFlags(
    { O_CREAT, O_TRUNC, O_WRONLY, O_NOFOLLOW, UV_FS_O_FILEMAP },
    true,
  )
  assert.equal(flag(1), UV_FS_O_FILEMAP | write)
  assert.equal(flag(big - 1), UV_FS_O_FILEMAP | write)
  assert.equal(flag(big), 'w')
})

test('win32 without fmap uses w', () => {
  for (const UV_FS_O_FILEMAP of [0, undefined]) {
    const flag = writeFlags(
      { O_CREAT, O_TRUNC, O_WRONLY, O_NOFOLLOW, UV_FS_O_FILEMAP },
      true,
    )
    assert.equal(flag(1), 'w')
    assert.equal(flag(big), 'w')
  }
})

test('unix uses O_NOFOLLOW', () => {
  const flag = writeFlags(
    { O_CREAT, O_TRUNC, O_WRONLY, O_NOFOLLOW, UV_FS_O_FILEMAP },
    false,
  )
  assert.equal(flag(1), O_NOFOLLOW | write)
  assert.equal(flag(big), O_NOFOLLOW | write)
})

test('unix without O_NOFOLLOW uses w', () => {
  const flag = writeFlags({ O_CREAT, O_TRUNC, O_WRONLY }, false)
  assert.equal(flag(1), 'w')
})

test('no constants gives w', () => {
  assert.equal(writeFlags(undefined, false)(1), 'w')
  assert.equal(writeFlags(undefined, true)(1), 'w')
})

test('the constants of Node fit', () => {
  for (const { constants } of [nodeFs, nodeFsPromises]) {
    const expect =
      typeof constants.O_NOFOLLOW === 'number' ?
        constants.O_NOFOLLOW | write
      : 'w'
    assert.equal(writeFlags(constants, false)(1), expect)
  }
})
