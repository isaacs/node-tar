process.env.TESTING_TAR_FAKE_PLATFORM = 'win32'
const t = require('tap')
const normalize = require('../lib/normalize-unicode.js')
const stripSlash = require('../lib/strip-trailing-slashes.js')
const normPath = require('../lib/normalize-windows-path.js')

// café
const cafe1 = Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9]).toString()

// cafe with a `
const cafe2 = Buffer.from([0x63, 0x61, 0x66, 0x65, 0xcc, 0x81]).toString()

t.equal(normalize(cafe1), normalize(cafe2), 'matching unicodes')
t.equal(normalize(cafe1), normalize(cafe2), 'cached')
t.equal(normalize('foo'), 'foo', 'non-unicode string')

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
      const a = normalize(stripSlash(normPath(path)))
      const b = stripSlash(normPath(normalize(path)))
      t.matchSnapshot(a, 'normalized')
      t.equal(a, b, 'order should not matter')
      t.end()
    })
  }
  t.end()
})
