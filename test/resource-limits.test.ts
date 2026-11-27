// A small archive must not use memory or CPU without limit, stop
// the extraction, or crash the process. GHSA-343g-5v7x-x325,
// GHSA-7c32-79xj-j3jp, GHSA-98v3-7xjr-fg83, GHSA-25mm-r35j-6hgm,
// GHSA-72fp-85cc-g945, GHSA-9239-v992-p74f.
import fs from 'node:fs'
import { resolve } from 'node:path'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { assert, describe, mockImport, test, testdir } from 'ubqtest'
import { Header, type HeaderData } from '../src/header.js'
import { Parser } from '../src/parse.js'
import { PathReservations } from '../src/path-reservations.js'
import { Unpack, UnpackSync } from '../src/unpack.js'

const ent = (h: HeaderData, body = '') => {
  const data = Buffer.from(body)
  const block = Buffer.alloc(512)
  new Header({ mode: 0o644, ...h, size: data.length }).encode(block)
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512)
  return Buffer.concat([block, data, pad])
}
const longLink = (name: string) =>
  ent(
    { path: '././@LongLink', type: 'NextFileHasLongLinkpath' },
    name + '\0',
  )
const longPath = (name: string) =>
  ent({ path: '././@LongLink', type: 'NextFileHasLongPath' }, name + '\0')
const EOA = Buffer.alloc(1024)

type Warning = [code: string, message: string]
const unpack = (chunks: Buffer[], sync: boolean, opt = {}) =>
  new Promise<{ cwd: string; warnings: Warning[] }>((res, rej) => {
    const cwd = testdir()
    const warnings: Warning[] = []
    const u = new (sync ? UnpackSync : Unpack)({
      cwd,
      ...opt,
      onwarn: (code, message) => {
        warnings.push([code, String(message)])
      },
    })
    u.on('error', rej)
    u.on('end', () => res({ cwd, warnings }))
    u.end(Buffer.concat([...chunks, EOA]))
  })

for (const sync of [false, true]) {
  describe(sync ? 'sync' : 'async', () => {
    test('reject a linkpath that is too deep', async () => {
      const { cwd, warnings } = await unpack(
        [
          longLink('a/'.repeat(1024) + 'x'),
          ent({ path: 'ln', type: 'SymbolicLink', linkpath: 'p' }),
        ],
        sync,
      )
      assert.deepEqual(warnings, [
        ['TAR_ENTRY_ERROR', 'linkpath excessively deep'],
      ])
      assert.deepEqual(fs.readdirSync(cwd), [])
    })

    test('reject a linkpath that is too long', async () => {
      const { cwd, warnings } = await unpack(
        [
          longLink('a'.repeat(32769)),
          ent({ path: 'ln', type: 'SymbolicLink', linkpath: 'p' }),
        ],
        sync,
      )
      assert.deepEqual(warnings, [
        ['TAR_ENTRY_ERROR', 'linkpath excessively long'],
      ])
      assert.deepEqual(fs.readdirSync(cwd), [])
    })

    test('reject a path that is too long', async () => {
      const { cwd, warnings } = await unpack(
        [
          longPath(('a'.repeat(99) + '/').repeat(400) + 'x'),
          ent({ path: 'f', type: 'File' }),
        ],
        sync,
      )
      assert.deepEqual(warnings, [
        ['TAR_ENTRY_ERROR', 'path excessively long'],
      ])
      assert.deepEqual(fs.readdirSync(cwd), [])
    })

    const related: Record<string, HeaderData> = {
      'a link to its parent directory': {
        path: 'a/b',
        type: 'Link',
        linkpath: 'a',
      },
      'a symlink to its child': {
        path: 'a',
        type: 'SymbolicLink',
        linkpath: 'a/b',
      },
      'a symlink to its parent directory': {
        path: 'a/b',
        type: 'SymbolicLink',
        linkpath: 'a',
      },
      'a symlink to its own path': {
        path: 'a',
        type: 'SymbolicLink',
        linkpath: './a',
      },
    }
    for (const [name, header] of Object.entries(related)) {
      test(`extraction continues after ${name}`, async () => {
        const { cwd } = await unpack(
          [ent(header), ent({ path: 'after.txt', type: 'File' }, 'ok')],
          sync,
        )
        assert.equal(
          fs.readFileSync(resolve(cwd, 'after.txt'), 'utf8'),
          'ok',
        )
      })
    }

    test('the stream ends after an entry that fails', async () => {
      const { cwd, warnings } = await unpack(
        [
          ent({ path: 'l', type: 'Link', linkpath: 'missing' }),
          ent({ path: 'after.txt', type: 'File' }, 'ok'),
        ],
        sync,
      )
      assert.equal(warnings.length, 1)
      assert.equal(warnings[0]?.[0], 'TAR_ENTRY_ERROR')
      assert.match(warnings[0]?.[1], /^ENOENT/)
      assert.equal(
        fs.readFileSync(resolve(cwd, 'after.txt'), 'utf8'),
        'ok',
      )
    })

    test('the stream ends after an entry that is skipped', async () => {
      const cwd = testdir({ f: 'old' })
      const { warnings } = await unpack(
        [ent({ path: 'f', type: 'File' }, 'new')],
        sync,
        { cwd, keep: true },
      )
      assert.deepEqual(warnings, [])
      assert.equal(fs.readFileSync(resolve(cwd, 'f'), 'utf8'), 'old')
    })
  })
}

test('a reservation is released when its work is done', async () => {
  setFlagsFromString('--expose-gc')
  const gc = runInNewContext('gc') as () => void
  const reservations = new PathReservations()
  let ref: WeakRef<object> | undefined
  await new Promise<void>(res => {
    const held = { big: new Array(1000).fill('x') }
    ref = new WeakRef(held)
    reservations.reserve(['a/b', 'a/c'], done => {
      assert.equal(held.big.length, 1000)
      done()
      res()
    })
  })
  // Let the promise callbacks drop their references.
  await new Promise(res => setTimeout(res, 10))
  gc()
  assert(ref)
  assert.equal(ref.deref(), undefined)
  // The reservation system still works.
  const order: number[] = []
  reservations.reserve(['a/b'], done => {
    order.push(1)
    done()
  })
  assert.deepEqual(order, [1])
})

test('the parser keeps no data after the end of the archive', () => {
  const p = new Parser()
  const entries: string[] = []
  p.on('entry', e => {
    entries.push(e.path)
    e.resume()
  })
  p.write(Buffer.concat([ent({ path: 'f', type: 'File' }), EOA]))
  const filler = Buffer.alloc(64 * 1024, 1)
  for (let i = 0; i < 16; i++) p.write(filler)
  const kept = Object.getOwnPropertySymbols(p)
    .map(s => (p as unknown as Record<symbol, unknown>)[s])
    .filter(v => Buffer.isBuffer(v))
  assert.deepEqual(kept, [])
  p.end()
  assert.deepEqual(entries, ['f'])
})

test('zstd data on a runtime with no zstd support is an error', async () => {
  const minizlib = await import('minizlib')
  class NoZstd {
    constructor() {
      throw new TypeError('Compression method not supported')
    }
  }
  const ZstdDecompress =
    NoZstd as unknown as typeof minizlib.ZstdDecompress
  const { Parser } = await mockImport(
    () => import('../src/parse.js'),
    [[() => import('minizlib'), { ZstdDecompress }]],
  )
  const p = new Parser()
  const errors: unknown[] = []
  p.on('error', er => errors.push(er))
  // The zstd magic number, then enough bytes to choose a format.
  const data = Buffer.alloc(512)
  data.set([0x28, 0xb5, 0x2f, 0xfd])
  p.end(data)
  assert.match(errors, [{ message: 'Compression method not supported' }])
})
