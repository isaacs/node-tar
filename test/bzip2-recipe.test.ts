// The bzip2 recipe of the README, with the real node-bzip2 addon.
import * as nodeFs from 'node:fs'
import { resolve } from 'node:path'
import { assert, describe, test, testdir } from 'ubqtest'
import type { Codec } from '../src/codec.js'
import * as tar from '../src/server/index.js'

type Bzip2 = {
  compress(data: Uint8Array, options?: object): Uint8Array
  decompress(data: Uint8Array): Uint8Array
  compressAsync(data: Uint8Array, options?: object): Promise<Uint8Array>
  decompressAsync(data: Uint8Array): Promise<Uint8Array>
}

// The addon has no types, and it is not built when npm does not run
// its install scripts.
const name: string = 'node-bzip2'
const bzip2 = await import(name).then(
  (m: { default: Bzip2 }) => m.default,
  () => undefined,
)
// The addon uses the V8 addon API of Node.js (nan). Deno does not
// load it. Bun loads it, and the process ends with a segmentation
// fault at the first call.
const skip =
  'Bun' in globalThis ? 'the node-bzip2 addon makes Bun crash'
  : 'Deno' in globalThis ? 'Deno cannot load the node-bzip2 addon'
  : !bzip2 &&
    'the node-bzip2 addon is not built: npm install-scripts approve node-bzip2'

const whole = (fn: (data: Uint8Array) => Promise<Uint8Array>) => {
  const parts: Uint8Array[] = []
  return new TransformStream<Uint8Array, Uint8Array>({
    transform: chunk => {
      parts.push(chunk)
    },
    flush: async controller => {
      controller.enqueue(await fn(Buffer.concat(parts)))
    },
  })
}

const lib = bzip2 as Bzip2
const bz2: Codec = {
  name: 'bzip2',
  headLength: 3,
  detect: head => head[0] === 0x42 && head[1] === 0x5a && head[2] === 0x68,
  decompress: () => whole(data => lib.decompressAsync(data)),
  compress: options => whole(data => lib.compressAsync(data, options)),
  decompressSync: (data, { maxOutputLength }) => {
    const out = lib.decompress(data)
    if (out.length > maxOutputLength) {
      throw new Error('bzip2: the output is larger than the limit')
    }
    return out
  },
  compressSync: (data, options) => lib.compress(data, options),
}

const tree = () =>
  testdir({ src: { 'a.txt': 'alpha', sub: { 'b.txt': 'beta' } }, out: {} })
const paths = ['src/', 'src/a.txt', 'src/sub/', 'src/sub/b.txt']

describe('bzip2 through node-bzip2', { skip }, () => {
  test('async: create, list, extract', async () => {
    const cwd = tree()
    const file = resolve(cwd, 'src.tar.bz2')
    await tar.create({ file, cwd, compress: [bz2, { level: 9 }] }, ['src'])
    assert.equal(nodeFs.readFileSync(file).toString('latin1', 0, 3), 'BZh')
    const found: string[] = []
    await tar.list({
      file,
      codecs: [bz2],
      onEntry: entry => {
        found.push(entry.path)
      },
    })
    assert.deepEqual(found, paths)
    await tar.extract({ file, codecs: [bz2], cwd: resolve(cwd, 'out') })
    assert.equal(
      nodeFs.readFileSync(resolve(cwd, 'out/src/sub/b.txt'), 'utf8'),
      'beta',
    )
  })

  test('sync: create, list, extract', () => {
    const cwd = tree()
    const file = resolve(cwd, 'src.tar.bz2')
    tar.createSync({ file, cwd, compress: bz2 }, ['src'])
    assert.equal(nodeFs.readFileSync(file).toString('latin1', 0, 3), 'BZh')
    const found: string[] = []
    tar.listSync({
      file,
      codecs: [bz2],
      onEntry: entry => {
        found.push(entry.path)
      },
    })
    assert.deepEqual(found, paths)
    tar.extractSync({ file, codecs: [bz2], cwd: resolve(cwd, 'out') })
    assert.equal(
      nodeFs.readFileSync(resolve(cwd, 'out/src/a.txt'), 'utf8'),
      'alpha',
    )
  })

  test('the async and sync forms read the output of each other', async () => {
    const cwd = tree()
    const a = resolve(cwd, 'async.tar.bz2')
    const s = resolve(cwd, 'sync.tar.bz2')
    await tar.create({ file: a, cwd, compress: bz2 }, ['src'])
    tar.createSync({ file: s, cwd, compress: bz2 }, ['src'])
    const sync = [
      ...tar.entriesSync(nodeFs.readFileSync(a), { codecs: [bz2] }),
    ]
    assert.deepEqual(
      sync.map(e => e.path),
      paths,
    )
    const found: string[] = []
    await tar.list({
      file: s,
      codecs: [bz2],
      onEntry: entry => {
        found.push(entry.path)
      },
    })
    assert.deepEqual(found, paths)
  })

  test('the ratio limit is an error, after the data is inflated', async () => {
    const cwd = testdir({ 'zero.bin': Buffer.alloc(4 * 1024 * 1024) })
    const file = resolve(cwd, 'zero.tar.bz2')
    tar.createSync({ file, cwd, compress: bz2 }, ['zero.bin'])
    const expect = { tarCode: 'TAR_ABORT' }
    await assert.rejects(tar.list({ file, codecs: [bz2] }), expect)
    assert.throws(() => tar.listSync({ file, codecs: [bz2] }), expect)
  })
})
