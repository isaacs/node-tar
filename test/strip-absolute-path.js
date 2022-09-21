const t = require('tap')
const stripAbsolutePath = require('../lib/strip-absolute-path.js')
const cwd = process.cwd()

t.test('basic', t => {
  const cases = {
    '/': ['/', ''],
    '////': ['////', ''],
    'c:///a/b/c': ['c:///', 'a/b/c'],
    '\\\\foo\\bar\\baz': ['\\\\foo\\bar\\', 'baz'],
    '//foo//bar//baz': ['//', 'foo//bar//baz'],
    'c:\\c:\\c:\\c:\\\\d:\\e/f/g': ['c:\\c:\\c:\\c:\\\\d:\\', 'e/f/g'],
  }

  for (const [input, [root, stripped]] of Object.entries(cases)) {
    t.strictSame(stripAbsolutePath(input, cwd), [root, stripped], input)
  }
  t.end()
})

t.test('drive-local paths', t => {
  const env = process.env
  t.teardown(() => process.env = env)
  const cwd = 'D:\\safety\\land'
  const realPath = require('path')
  // be windowsy
  const path = {
    ...realPath.win32,
    win32: realPath.win32,
    posix: realPath.posix,
  }
  const stripAbsolutePath = t.mock('../lib/strip-absolute-path.js', { path })
  const cases = {
    '/': ['/', ''],
    '////': ['////', ''],
    'c:///a/b/c': ['c:///', 'a/b/c'],
    '\\\\foo\\bar\\baz': ['\\\\foo\\bar\\', 'baz'],
    '//foo//bar//baz': ['//', 'foo//bar//baz'],
    'c:\\c:\\c:\\c:\\\\d:\\e/f/g': ['c:\\c:\\c:\\c:\\\\d:\\', 'e/f/g'],
    'c:..\\system\\explorer.exe': ['c:', '..\\system\\explorer.exe'],
    'd:..\\..\\unsafe\\land': ['d:', '..\\..\\unsafe\\land'],
    'c:foo': ['c:', 'foo'],
    'D:mark': ['D:', 'mark'],
    '//?/X:/y/z': ['//?/X:/', 'y/z'],
    '\\\\?\\X:\\y\\z': ['\\\\?\\X:\\', 'y\\z'],
  }
  for (const [input, [root, stripped]] of Object.entries(cases)) {
    if (!t.strictSame(stripAbsolutePath(input, cwd), [root, stripped], input)) {
      break
    }
  }
  t.end()
})
