import t from 'tap'
import { fileURLToPath } from 'url'
import { normalizeUnicode } from '../dist/esm/normalize-unicode.js'
import { stripTrailingSlashes } from '../dist/esm/strip-trailing-slashes.js'
import { normalizeWindowsPath } from '../dist/esm/normalize-windows-path.js'

const __filename = fileURLToPath(import.meta.url)
const fakePlatform = process.env.TESTING_TAR_FAKE_PLATFORM

// café
const cafe1 = Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9]).toString()

// cafe with a `
const cafe2 = Buffer.from([
  0x63, 0x61, 0x66, 0x65, 0xcc, 0x81,
]).toString()

t.equal(
  normalizeUnicode(cafe1),
  normalizeUnicode(cafe2),
  'matching unicodes',
)
t.equal(normalizeUnicode(cafe1), normalizeUnicode(cafe2), 'cached')
t.equal(normalizeUnicode('foo'), 'foo', 'non-unicode string')

if (fakePlatform === 'win32') {
  t.test('normalize with strip slashes', t => {
    const paths = [
      '\\a\\b\\c\\d\\',
      '﹨aaaa﹨dddd﹨',
      '＼bbb＼eee＼',
      '＼＼＼＼＼eee＼＼＼＼＼＼',
      '¼foo.txt',
      '1/4foo.txt',
    ]

    t.plan(paths.length)

    for (const path of paths) {
      t.test(JSON.stringify(path), t => {
        const a = normalizeUnicode(
          stripTrailingSlashes(normalizeWindowsPath(path)),
        )
        const b = stripTrailingSlashes(
          normalizeWindowsPath(normalizeUnicode(path)),
        )
        t.matchSnapshot(a, 'normalized')
        t.equal(a, b, 'order should not matter')
        t.end()
      })
    }
    t.end()
  })
}

if (fakePlatform !== 'win32') {
  t.spawn(process.execPath, [__filename, 'win32'], {
    env: {
      ...process.env,
      TESTING_TAR_FAKE_PLATFORM: 'win32',
    }
  })
}
