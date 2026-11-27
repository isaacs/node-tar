import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import zlib from 'node:zlib'
import { assert, describe, test } from 'ubqtest'
import { gzip, type Codec } from '../src/codec.js'
import type {
  ExtractFS,
  ExtractFSSync,
  TarFS,
  TarFSSync,
} from '../src/fs.js'
import { Pax } from '../src/pax.js'
import { makeTar } from './fixtures/make-tar.js'
import {
  extract,
  extractSync,
  hookFs,
  resolve,
  testdir,
} from './helpers.js'

// The modules of Node fit the adapter types as they are.
const fs: ExtractFS & TarFS = nodeFsPromises
const fsSync: ExtractFSSync & TarFSSync = nodeFs

const fixtures = resolve(import.meta.dirname, './fixtures')
const tars = resolve(fixtures, 'tars')

// Gzip for the sync reader, which has no codec of its own.
const gunzip: Codec = {
  ...gzip,
  decompressSync: (data, limit) =>
    zlib.gunzipSync(data, isFinite(limit.maxOutputLength) ? limit : {}),
}

const makeCompressedBomb = () => {
  const payload = Buffer.alloc(8 * 1024 * 1024)
  return zlib.gzipSync(
    makeTar([
      { path: 'bomb', size: payload.length, type: 'File' },
      payload,
      '',
      '',
    ]),
  )
}

const longPath =
  '/long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt'

// The names in the x folder of the example archives.
const oneToTen = ['1', '10', '2', '3', '4', '5', '6', '7', '8', '9']

describe('basic extracting', () => {
  const file = resolve(tars, 'utf8.tar')

  const check = (dir: string) => {
    assert(nodeFs.lstatSync(dir + '/Ω.txt').isFile())
    assert(nodeFs.lstatSync(dir + '/🌟.txt').isFile())
    assert.throws(() => nodeFs.lstatSync(dir + longPath), Error)
  }

  const files = ['🌟.txt', 'Ω.txt']
  test('sync file', () => {
    const cwd = testdir({})
    const res = extractSync({ file, cwd, fs: fsSync }, files)
    assert.equal(res, undefined)
    check(cwd)
  })

  test('async file', async () => {
    const cwd = testdir({})
    const res = await extract({ file, cwd, fs }, files)
    assert.equal(res, undefined)
    check(cwd)
  })

  test('sync input', () => {
    const cwd = testdir({})
    const input = nodeFs.readFileSync(file)
    extractSync({ input, cwd, fs: fsSync }, files)
    check(cwd)
  })

  test('async input', async () => {
    const cwd = testdir({})
    const input = new Blob([nodeFs.readFileSync(file)])
    await extract({ input, cwd, fs }, files)
    check(cwd)
  })

  test('a listed directory', async () => {
    const dir = testdir({ a: {}, s: {} })
    const list = ['long-path/r/e/a/', 'Ω.txt']
    await extract({ file, cwd: dir + '/a', fs }, list)
    extractSync({ file, cwd: dir + '/s', fs: fsSync }, list)
    for (const cwd of [dir + '/a', dir + '/s']) {
      assert(nodeFs.lstatSync(cwd + '/Ω.txt').isFile())
      assert(nodeFs.lstatSync(cwd + longPath).isFile())
      assert.throws(() => nodeFs.lstatSync(cwd + '/🌟.txt'), Error)
    }
  })
})

describe('an input that arrives slowly is read to its end', () => {
  const data = nodeFs.readFileSync(resolve(tars, 'long-paths.tar'))

  test('a stream of small chunks', async () => {
    const cwd = testdir({})
    let pos = 0
    const input = new ReadableStream<Uint8Array>({
      pull: controller => {
        if (pos >= data.length) return controller.close()
        controller.enqueue(data.subarray(pos, (pos += 97)))
      },
    })
    await extract({ input, cwd, fs })
    assert(nodeFs.lstatSync(cwd + longPath).isFile())
  })

  test('an async iterable with a delay', async () => {
    const cwd = testdir({})
    const input = (async function* () {
      for (let pos = 0; pos < data.length; pos += 5000) {
        await new Promise(res => setTimeout(res, 2))
        yield data.subarray(pos, pos + 5000)
      }
    })()
    await extract({ input, cwd, fs })
    assert(nodeFs.lstatSync(cwd + longPath).isFile())
  })
})

describe('file list and filter', () => {
  const file = resolve(tars, 'utf8.tar')

  const check = (dir: string) => {
    assert(nodeFs.lstatSync(dir + '/Ω.txt').isFile())
    assert.throws(() => nodeFs.lstatSync(dir + '/🌟.txt'), Error)
    assert.throws(() => nodeFs.lstatSync(dir + longPath), Error)
  }

  const filter = (path: string) => path === 'Ω.txt'
  const files = ['🌟.txt', 'Ω.txt']

  test('sync file', () => {
    const cwd = testdir({})
    extractSync({ filter, file, cwd, fs: fsSync }, files)
    check(cwd)
  })

  test('async file', async () => {
    const cwd = testdir({})
    await extract({ filter, file, cwd, fs }, files)
    check(cwd)
  })

  test('filter with no file list', async () => {
    const dir = testdir({ a: {}, s: {} })
    await extract({ filter, file, cwd: dir + '/a', fs }, [])
    extractSync({ filter, file, cwd: dir + '/s', fs: fsSync })
    check(dir + '/a')
    check(dir + '/s')
  })
})

describe('the body of an entry that is not extracted is not read', () => {
  const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251)
  const data = makeTar([
    { path: 'keep', type: 'File', size: 3 },
    'abc',
    { path: 'big', type: 'File', size: big.length },
    big,
    { path: 'last', type: 'File', size: 3 },
    'end',
  ])
  const afterBig = 1536 + big.length

  // Extract with a fs that records the reads of the archive file.
  const run = async (
    mode: 'async' | 'sync',
    filter?: (path: string) => boolean,
    files?: string[],
  ) => {
    const dir = testdir({ 'a.tar': Buffer.from(data), out: {} })
    const file = dir + '/a.tar'
    const cwd = dir + '/out'
    const hooked = hookFs()
    if (mode === 'sync') {
      extractSync({ file, cwd, filter, fs: hooked.fsSync }, files)
    } else await extract({ file, cwd, filter, fs: hooked.fs }, files)
    const reads = hooked.calls
      .filter(c => c[0] === 'read' && c[1] === file)
      .map(c => [c[4], c[5]])
    return { cwd, reads }
  }

  for (const mode of ['async', 'sync'] as const) {
    test(`${mode}: an entry that the filter refuses`, async () => {
      const { cwd, reads } = await run(mode, path => path !== 'big')
      assert.deepEqual(nodeFs.readdirSync(cwd).sort(), ['keep', 'last'])
      assert.equal(nodeFs.readFileSync(cwd + '/last', 'utf8'), 'end')
      assert.deepEqual(reads, [
        [65536, 0],
        [1024, afterBig],
      ])
    })

    test(`${mode}: an entry that the files list does not have`, async () => {
      const { cwd, reads } = await run(mode, undefined, ['keep', 'last'])
      assert.deepEqual(nodeFs.readdirSync(cwd).sort(), ['keep', 'last'])
      assert.deepEqual(reads, [
        [65536, 0],
        [1024, afterBig],
      ])
    })

    test(`${mode}: an entry that is extracted is read`, async () => {
      const { cwd, reads } = await run(mode)
      assert.deepEqual(nodeFs.readdirSync(cwd).sort(), [
        'big',
        'keep',
        'last',
      ])
      assert.equal(nodeFs.readFileSync(cwd + '/big').equals(big), true)
      let pos = 0
      for (const [len, at] of reads) {
        assert.equal(at, pos)
        pos += len as number
      }
      assert.equal(pos, data.length)
    })
  }
})

describe('no file list', () => {
  const file = resolve(tars, 'body-byte-counts.tar')
  const check = (dir: string) => {
    for (const [name, size] of [
      ['1024-bytes.txt', 1024],
      ['512-bytes.txt', 512],
      ['one-byte.txt', 1],
      ['zero-byte.txt', 0],
    ] as const) {
      assert.equal(nodeFs.lstatSync(resolve(dir, name)).size, size, name)
    }
  }

  const { size } = nodeFs.statSync(file)
  for (const [name, maxReadSize, reads] of [
    ['one read', undefined, 1],
    ['read in itty bits', 1000, Math.ceil(size / 1000)],
  ] as const) {
    test(`sync file, ${name}`, () => {
      const cwd = testdir({})
      const { fsSync, calls } = hookFs()
      extractSync({ file, cwd, maxReadSize, fs: fsSync })
      check(cwd)
      assert.equal(calls.filter(c => c[0] === 'read').length, reads)
      assert.deepEqual(calls[0]?.slice(0, 3), ['open', file, 'r'])
    })

    test(`async file, ${name}`, async () => {
      const cwd = testdir({})
      const { fs, calls } = hookFs()
      await extract({ file, cwd, maxReadSize, fs })
      check(cwd)
      assert.equal(calls.filter(c => c[0] === 'read').length, reads)
      assert.deepEqual(calls[0]?.slice(0, 3), ['open', file, 'r'])
    })
  }
})

test('bad calls', async () => {
  const expect = {
    name: 'TypeError',
    message: 'extract needs input or file',
  }
  type Opt = Parameters<typeof extract>[0]
  type OptSync = Parameters<typeof extractSync>[0]
  await assert.rejects(extract({ cwd: '/x', fs } as Opt), expect)
  assert.throws(
    () => extractSync({ cwd: '/x', fs: fsSync } as OptSync),
    expect,
  )
})

test('nonexistent', async () => {
  const cwd = testdir({})
  const file = cwd + '/does not exist'
  assert.throws(() => extractSync({ file, cwd, fs: fsSync }), {
    code: 'ENOENT',
  })
  await assert.rejects(extract({ file, cwd, fs }), { code: 'ENOENT' })
})

test('read fail', async () => {
  const poop = new Error('poop')
  const { fs, fsSync, calls } = hookFs({
    read: () => {
      throw poop
    },
  })
  const opt = {
    maxReadSize: 10,
    file: import.meta.filename,
    cwd: testdir({}),
  }
  const er = assert.throws(() => extractSync({ ...opt, fs: fsSync }), {
    message: 'poop',
  })
  assert.equal(er, poop)
  assert.equal(
    await assert.rejects(extract({ ...opt, fs }), { message: 'poop' }),
    poop,
  )
  // Each file is closed.
  assert.deepEqual(
    calls.map(c => c[0]),
    ['open', 'read', 'close', 'open', 'read', 'close'],
  )
})

test('sync gzip error edge case test', () => {
  const file = resolve(fixtures, 'sync-gzip-fail.tgz')
  const cwd = testdir({ x: {} })
  extractSync({
    file,
    cwd,
    fs: fsSync,
    codecs: [gunzip],
    onwarn: (_c, _m, er) => {
      throw er
    },
  })
  assert.deepEqual(nodeFs.readdirSync(cwd + '/x').sort(), oneToTen)
})

test('an error that onwarn throws stops the extraction', async () => {
  const data = makeTar([
    { path: 'a/../b', type: 'File' },
    { path: 'c', type: 'File' },
    { path: 'l', type: 'Link', linkpath: 'missing' },
    { path: 'd', type: 'File' },
    '',
    '',
  ])
  const dir = testdir({ a: {}, s: {} })
  const poop = new Error('poop')
  const onwarn = (_: string, message: string) => {
    if (/ENOENT/.test(message)) throw poop
  }
  const opt = { input: data, onwarn, jobs: 1 }
  assert.equal(
    await assert.rejects(extract({ ...opt, cwd: dir + '/a', fs }), {
      message: 'poop',
    }),
    poop,
  )
  assert.equal(
    assert.throws(
      () => extractSync({ ...opt, cwd: dir + '/s', fs: fsSync }),
      { message: 'poop' },
    ),
    poop,
  )
  assert.deepEqual(nodeFs.readdirSync(dir + '/a'), ['c'])
  assert.deepEqual(nodeFs.readdirSync(dir + '/s'), ['c'])
})

describe('max decompression ratio', () => {
  const bombFile = () =>
    resolve(testdir({ 'bomb.tgz': makeCompressedBomb() }), 'bomb.tgz')
  const expect = {
    tarCode: 'TAR_ABORT',
    recoverable: false,
    message: /max decompression ratio exceeded/,
  }

  test('file extraction aborts by default', async () => {
    const file = bombFile()
    const cwd = testdir({})
    await assert.rejects(extract({ file, cwd, fs }), { ...expect, file })
    assert.throws(
      () => extractSync({ file, cwd, fs: fsSync, codecs: [gunzip] }),
      { tarCode: 'TAR_ABORT', recoverable: false, file, cwd },
    )
  })

  test('file extraction can disable the limit explicitly', async () => {
    const file = bombFile()
    const cwd = testdir({})
    await extract({ file, cwd, fs, maxDecompressionRatio: Infinity })
    assert.equal(
      nodeFs.statSync(resolve(cwd, 'bomb')).size,
      8 * 1024 * 1024,
    )
  })
})

test('a file that is not an archive', async () => {
  const cwd = testdir({ 'example.unknown': '' })
  const file = resolve(cwd, 'example.unknown')
  const expect = {
    message: 'TAR_BAD_ARCHIVE: Unrecognized archive format',
    file,
    cwd,
  }
  assert.throws(() => extractSync({ file, cwd, fs: fsSync }), expect)
  await assert.rejects(extract({ file, cwd, fs }), expect)
})

describe('a codec for the file name ending', () => {
  // The first bytes of this format do not identify it.
  const flip: Codec = {
    name: 'flip',
    headLength: 0,
    detect: () => false,
    extensions: ['.tar.flip'],
    decompress: () =>
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) =>
          controller.enqueue(chunk.map(b => b ^ 0xff)),
      }),
    decompressSync: data => data.map(b => b ^ 0xff),
  }
  const tar = makeTar([{ path: 'f', type: 'File', size: 2 }, 'hi', '', ''])

  test('sync and async', async () => {
    const cwd = testdir({
      'a.tar.flip': tar.map(b => b ^ 0xff),
      a: {},
      s: {},
    })
    const file = cwd + '/a.tar.flip'
    await extract({ file, cwd: cwd + '/a', fs, codecs: [flip] })
    extractSync({ file, cwd: cwd + '/s', fs: fsSync, codecs: [flip] })
    assert.equal(nodeFs.readFileSync(cwd + '/a/f', 'utf8'), 'hi')
    assert.equal(nodeFs.readFileSync(cwd + '/s/f', 'utf8'), 'hi')
  })
})

describe('verify long linkname is not a problem', () => {
  // See: https://github.com/isaacs/node-tar/issues/312
  const file = resolve(fixtures, 'long-linkname.tar')
  test('sync', () => {
    const cwd = testdir({})
    extractSync({ strict: true, file, cwd, fs: fsSync })
    assert(nodeFs.lstatSync(cwd + '/test').isSymbolicLink())
  })
  test('async', async () => {
    const cwd = testdir({})
    await extract({ file, cwd, strict: true, fs })
    assert(nodeFs.lstatSync(cwd + '/test').isSymbolicLink())
  })
})

describe('numeric pax/entry name discernment', () => {
  const numericName = '12345'
  const alphaName = 'abcde'
  for (const strict of [true, false]) {
    for (const paxName of [numericName, alphaName]) {
      for (const entryName of [numericName, alphaName]) {
        const data = makeTar([
          new Pax(
            { path: paxName, size: '12345\n'.length },
            false,
          ).encode(),
          {
            type: 'File',
            path: entryName,
            mode: 0o755,
            ctime: new Date('2000-01-01T00:00:00.000Z'),
            mtime: new Date('2000-01-01T00:00:00.000Z'),
            size: '12345\n'.length,
          },
          '12345\n',
          '',
          '',
        ])
        const name = `strict=${strict} paxName=${paxName} entryName=${entryName}`

        test(`${name} sync`, () => {
          const cwd = testdir({ tarFile: data })
          extractSync({ strict, cwd, file: cwd + '/tarFile', fs: fsSync })
          assert.equal(
            nodeFs.readFileSync(cwd + '/' + paxName, 'utf8'),
            '12345\n',
          )
        })

        test(`${name} async`, async () => {
          const cwd = testdir({ tarFile: data })
          await extract({ strict, cwd, file: cwd + '/tarFile', fs })
          assert.equal(
            nodeFs.readFileSync(cwd + '/' + paxName, 'utf8'),
            '12345\n',
          )
        })
      }
    }
  }
})

for (const mode of ['async', 'sync'] as const) {
  test(`${mode}: an entry that onEntry reads is not extracted`, async () => {
    const cwd = testdir({})
    const data = makeTar([
      { path: 'taken.txt', type: 'File', size: 5 },
      'taken',
      { path: 'kept.txt', type: 'File', size: 4 },
      'kept',
      '',
      '',
    ])
    const texts: string[] = []
    const opt = { cwd, input: data }
    if (mode === 'sync') {
      extractSync({
        ...opt,
        fs: nodeFs,
        onEntry: entry => {
          if (entry.path === 'taken.txt') texts.push(entry.text())
        },
      })
    } else {
      await extract({
        ...opt,
        fs: nodeFsPromises,
        onEntry: async entry => {
          if (entry.path === 'taken.txt') texts.push(await entry.text())
        },
      })
    }
    assert.deepEqual(texts, ['taken'])
    assert.deepEqual(nodeFs.readdirSync(cwd), ['kept.txt'])
    assert.equal(nodeFs.readFileSync(cwd + '/kept.txt', 'utf8'), 'kept')
  })

  test(`${mode}: an entry after a lone null block is extracted`, async () => {
    const cwd = testdir({})
    const data = makeTar([
      { path: 'a.txt', type: 'File', size: 1 },
      'a',
      new Uint8Array(512),
      { path: 'b.txt', type: 'File', size: 1 },
      'b',
      new Uint8Array(1024),
    ])
    const run = async (strict: boolean) => {
      const warnings: [string, string][] = []
      const opt = {
        cwd,
        input: data,
        strict,
        onwarn: (code: string, message: string) => {
          warnings.push([code, message])
        },
      }
      if (mode === 'sync') extractSync({ ...opt, fs: nodeFs })
      else await extract({ ...opt, fs: nodeFsPromises })
      return warnings
    }
    assert.deepEqual(await run(false), [
      ['TAR_BAD_ARCHIVE', 'entry after a lone null block'],
    ])
    assert.deepEqual(nodeFs.readdirSync(cwd).sort(), ['a.txt', 'b.txt'])
    await assert.rejects(run(true), {
      message: 'TAR_BAD_ARCHIVE: entry after a lone null block',
    })
  })
}
