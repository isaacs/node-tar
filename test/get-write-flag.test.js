import fs from 'fs'
import { assert, env, mockImport, test } from 'ubqtest'

// The module reads the platform and the fmap flag when it loads, so
// each test loads a new instance with a fake environment.
const UV_FS_O_FILEMAP = 0x20000000
const { O_CREAT, O_NOFOLLOW, O_TRUNC, O_WRONLY } = fs.constants
const load = async vars => {
  env(vars)
  const { getWriteFlag } = await mockImport(
    () => import('../src/get-write-flag.js'),
    [],
  )
  return getWriteFlag
}

test('win32 with fmap uses fmap for small files only', async () => {
  const getWriteFlag = await load({
    __FAKE_FS_O_FILENAME__: String(UV_FS_O_FILEMAP),
    __FAKE_PLATFORM__: 'win32',
  })
  assert.equal(
    getWriteFlag(1),
    UV_FS_O_FILEMAP | O_TRUNC | O_CREAT | O_WRONLY,
  )
  assert.equal(getWriteFlag(512 * 1024 + 1), 'w')
})

test(
  'win32 without fmap uses w',
  {
    skip:
      !!fs.constants.UV_FS_O_FILEMAP &&
      'this platform always has UV_FS_O_FILEMAP',
  },
  async () => {
    const getWriteFlag = await load({
      __FAKE_FS_O_FILENAME__: '0',
      __FAKE_PLATFORM__: 'win32',
    })
    assert.equal(getWriteFlag(1), 'w')
    assert.equal(getWriteFlag(512 * 1024 + 1), 'w')
  },
)

test('unix uses O_NOFOLLOW', async () => {
  const getWriteFlag = await load({ __FAKE_PLATFORM__: 'linux' })
  const unixFlag =
    typeof O_NOFOLLOW === 'number' ?
      O_NOFOLLOW | O_TRUNC | O_CREAT | O_WRONLY
    : 'w'
  assert.equal(getWriteFlag(1), unixFlag)
  assert.equal(getWriteFlag(512 * 1024 + 1), unixFlag)
})
