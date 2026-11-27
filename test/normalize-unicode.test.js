import { assert, describe, test } from 'ubqtest'
import { normalizeUnicode } from '../src/normalize-unicode.js'
import { stripTrailingSlashes } from '../src/strip-trailing-slashes.js'

// café
const cafe1 = Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9]).toString()

// cafe with a `
const cafe2 = Buffer.from([0x63, 0x61, 0x66, 0x65, 0xcc, 0x81]).toString()

test('matching unicodes', () => {
  assert.equal(
    normalizeUnicode(cafe1),
    normalizeUnicode(cafe2),
    'matching unicodes',
  )
  assert.equal(normalizeUnicode(cafe1), normalizeUnicode(cafe2), 'cached')
  assert.equal(normalizeUnicode('foo'), 'FOO', 'non-unicode string')
})

describe('normalize with strip slashes', () => {
  const paths = [
    '\\a\\b\\c\\d\\',
    '﹨aaaa﹨dddd﹨',
    '＼bbb＼eee＼',
    '＼＼＼＼＼eee＼＼＼＼＼＼',
    '¼foo.txt',
    '1/4foo.txt',
  ]

  for (const path of paths) {
    test(JSON.stringify(path), () => {
      // The path rule of Windows: each backslash is a separator.
      const normalizeWindowsPath = p => p.replace(/\\/g, '/')
      const a = normalizeUnicode(
        stripTrailingSlashes(normalizeWindowsPath(path)),
      )
      const b = stripTrailingSlashes(
        normalizeWindowsPath(normalizeUnicode(path)),
      )
      assert.snapshot(a, 'normalized')
      assert.equal(a, b, 'order should not matter')
    })
  }
})

test('more strings than the cache holds', () => {
  // The cache drops its oldest strings at 11,000. Each string here
  // is short, and has an accent in one of two forms.
  for (let i = 0; i < 11_001; i++) {
    const n1 = normalizeUnicode(`cafe\u0301 ${i}`)
    const n2 = normalizeUnicode(`caf\u00e9 ${i}`)
    // One check in 500 is enough.
    if (!(i % 500)) {
      assert.equal(n1, n2)
    }
  }
  // A string that the cache dropped still gets the same result.
  assert.equal(normalizeUnicode('cafe\u0301 0'), 'CAFE\u0301 0')
})
