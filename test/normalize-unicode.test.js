import { assert, describe, env, mockImport, test } from 'ubqtest'
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
    test(JSON.stringify(path), async () => {
      // Use the path rules of Windows on each platform.
      env({ TESTING_TAR_FAKE_PLATFORM: 'win32' })
      const { normalizeWindowsPath } = await mockImport(
        () => import('../src/normalize-windows-path.js'),
        [],
      )
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

test('blow out the cache', () => {
  const cafBuf = Buffer.from([0x63, 0x61, 0x66])
  const e1 = Buffer.from([0x65, 0xcc, 0x81])
  const e2 = Buffer.from([0xc3, 0xa9])
  let cafe1 = cafBuf
  let cafe2 = cafBuf
  for (let i = 0; i < 11_001; i++) {
    cafe1 = Buffer.concat([cafe1, e1])
    cafe2 = Buffer.concat([cafe2, e2])

    const n1 = normalizeUnicode(cafe1.toString())
    const n2 = normalizeUnicode(cafe2.toString())
    // don't test all of these, too noisy
    if (!(i % 500)) {
      assert.equal(n1, n2)
    }
  }
})
