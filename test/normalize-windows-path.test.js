import { assert, env, mockImport, test } from 'ubqtest'

const realPlatform = process.platform
const fakePlatform = realPlatform === 'win32' ? 'posix' : 'win32'

test('posix', async () => {
  env({
    TESTING_TAR_FAKE_PLATFORM:
      realPlatform === 'win32' ? fakePlatform : undefined,
  })
  const { normalizeWindowsPath } = await mockImport(
    () => import('../src/normalize-windows-path.js'),
    [],
  )
  assert.equal(
    normalizeWindowsPath('/some/path/back\\slashes'),
    '/some/path/back\\slashes',
  )
  assert.equal(normalizeWindowsPath('c:\\foo\\bar'), 'c:\\foo\\bar')
})

test('win32', async () => {
  env({
    TESTING_TAR_FAKE_PLATFORM:
      realPlatform !== 'win32' ? fakePlatform : undefined,
  })
  const { normalizeWindowsPath } = await mockImport(
    () => import('../src/normalize-windows-path.js'),
    [],
  )
  assert.equal(
    normalizeWindowsPath('/some/path/back\\slashes'),
    '/some/path/back/slashes',
  )
  assert.equal(normalizeWindowsPath('c:\\foo\\bar'), 'c:/foo/bar')
})
