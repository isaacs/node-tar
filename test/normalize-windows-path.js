const t = require('tap')

const realPlatform = process.platform
const fakePlatform = realPlatform === 'win32' ? 'posix' : 'win32'

t.test('posix', t => {
  if (realPlatform === 'win32')
    process.env.TESTING_TAR_FAKE_PLATFORM = fakePlatform
  else
    delete process.env.TESTING_TAR_FAKE_PLATFORM
  const normPath = t.mock('../lib/normalize-windows-path.js')
  t.equal(normPath('/some/path/back\\slashes'), '/some/path/back\\slashes')
  t.equal(normPath('c:\\foo\\bar'), 'c:\\foo\\bar')
  t.end()
})

t.test('win32', t => {
  if (realPlatform !== 'win32')
    process.env.TESTING_TAR_FAKE_PLATFORM = fakePlatform
  else
    delete process.env.TESTING_TAR_FAKE_PLATFORM
  const normPath = t.mock('../lib/normalize-windows-path.js')
  t.equal(normPath('/some/path/back\\slashes'), '/some/path/back/slashes')
  t.equal(normPath('c:\\foo\\bar'), 'c:/foo/bar')
  t.end()
})
