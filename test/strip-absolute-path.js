const t = require('tap')
const stripAbsolutePath = require('../lib/strip-absolute-path.js')

const cases = {
  '/': ['/', ''],
  '////': ['////', ''],
  'c:///a/b/c': ['c:///', 'a/b/c'],
  '\\\\foo\\bar\\baz': ['\\\\foo\\bar\\', 'baz'],
  '//foo//bar//baz': ['//', 'foo//bar//baz'],
  'c:\\c:\\c:\\c:\\\\d:\\e/f/g': ['c:\\c:\\c:\\c:\\\\d:\\', 'e/f/g'],
}

for (const [input, [root, stripped]] of Object.entries(cases))
  t.strictSame(stripAbsolutePath(input), [root, stripped], input)
