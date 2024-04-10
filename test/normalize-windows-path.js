import t from 'tap'

const realPlatform = process.platform
const fakePlatform = realPlatform === 'win32' ? 'posix' : 'win32'

t.test('posix', async t => {
  if (realPlatform === 'win32') {
    process.env.TESTING_TAR_FAKE_PLATFORM = fakePlatform
  } else {
    delete process.env.TESTING_TAR_FAKE_PLATFORM
  }
  const { normalizeWindowsPath } = await t.mockImport(
    '../dist/esm/normalize-windows-path.js',
  )
  t.equal(
    normalizeWindowsPath('/some/path/back\\slashes'),
    '/some/path/back\\slashes',
  )
  t.equal(normalizeWindowsPath('c:\\foo\\bar'), 'c:\\foo\\bar')
  t.end()
})

t.test('win32', async t => {
  if (realPlatform !== 'win32') {
    process.env.TESTING_TAR_FAKE_PLATFORM = fakePlatform
  } else {
    delete process.env.TESTING_TAR_FAKE_PLATFORM
  }
  const { normalizeWindowsPath } = await t.mockImport(
    '../dist/esm/normalize-windows-path.js',
  )
  t.equal(
    normalizeWindowsPath('/some/path/back\\slashes'),
    '/some/path/back/slashes',
  )
  t.equal(normalizeWindowsPath('c:\\foo\\bar'), 'c:/foo/bar')
  t.end()
})
