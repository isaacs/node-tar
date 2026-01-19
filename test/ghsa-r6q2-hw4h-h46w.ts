import t from 'tap'
import { normalizeUnicode } from '../src/normalize-unicode.js'
import { Header } from '../src/header.js'
import { extract } from '../src/extract.js'
import { resolve } from 'node:path'
import { lstatSync, readFileSync, statSync } from 'node:fs'

// these characters are problems on macOS's APFS
const chars = {
  ['ﬀ'.normalize('NFC')]: 'FF',
  ['ﬁ'.normalize('NFC')]: 'FI',
  ['ﬂ'.normalize('NFC')]: 'FL',
  ['ﬃ'.normalize('NFC')]: 'FFI',
  ['ﬄ'.normalize('NFC')]: 'FFL',
  ['ﬅ'.normalize('NFC')]: 'ST',
  ['ﬆ'.normalize('NFC')]: 'ST',
  ['ẛ'.normalize('NFC')]: 'Ṡ',
  ['ß'.normalize('NFC')]: 'SS',
  ['ẞ'.normalize('NFC')]: 'SS',
  ['ſ'.normalize('NFC')]: 'S',
}

for (const [c, n] of Object.entries(chars)) {
  t.test(`${c} => ${n}`, async t => {
    t.equal(normalizeUnicode(c), n)

    t.test('link then file', async t => {
      const tarball = Buffer.alloc(2048)
      new Header({
        path: c,
        type: 'SymbolicLink',
        linkpath: './target',
      }).encode(tarball, 0)
      new Header({
        path: n,
        type: 'File',
        size: 1,
      }).encode(tarball, 512)
      tarball[1024] = 'x'.charCodeAt(0)

      const cwd = t.testdir({ tarball })

      await extract({ cwd, file: resolve(cwd, 'tarball') })

      t.throws(() => statSync(resolve(cwd, 'target')))
      t.equal(readFileSync(resolve(cwd, n), 'utf8'), 'x')
    })

    t.test('file then link', { saveFixture: true }, async t => {
      const tarball = Buffer.alloc(2048)
      new Header({
        path: n,
        type: 'File',
        size: 1,
      }).encode(tarball, 0)
      tarball[512] = 'x'.charCodeAt(0)
      new Header({
        path: c,
        type: 'SymbolicLink',
        linkpath: './target',
      }).encode(tarball, 1024)

      const cwd = t.testdir({ tarball })

      await extract({ cwd, file: resolve(cwd, 'tarball') })

      t.throws(() => statSync(resolve(cwd, 'target')))
      t.equal(lstatSync(resolve(cwd, c)).isSymbolicLink(), true)
    })
  })
}
