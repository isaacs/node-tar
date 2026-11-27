import { assert, test } from 'ubqtest'
import { stripAbsolutePath } from '../src/strip-absolute-path.js'

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

for (const [input, expect] of Object.entries(cases)) {
  test(`strip root from ${JSON.stringify(input)}`, () => {
    assert.deepEqual(stripAbsolutePath(input), expect)
  })
}
