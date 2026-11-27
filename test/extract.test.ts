import fs, { readFileSync } from 'fs'
import http from 'http'
import nock from 'nock'
import path from 'path'
import { pipeline } from 'stream/promises'
import {
  assert,
  cleanup,
  describe,
  mockImport,
  spy,
  test,
  testdir,
} from 'ubqtest'
import zlib from 'zlib'
import { extract as x } from '../src/extract.js'
import { Unpack, UnpackSync } from '../src/unpack.js'
import { makeTar } from './fixtures/make-tar.js'
import { Pax } from '../src/pax.js'

const fixtures = path.resolve(import.meta.dirname, 'fixtures')
const tars = path.resolve(fixtures, 'tars')

const makeCompressedBomb = () => {
  const payload = Buffer.alloc(8 * 1024 * 1024)
  return zlib.gzipSync(
    makeTar([
      {
        path: 'bomb',
        size: payload.length,
        type: 'File',
      },
      payload,
      '',
      '',
    ]),
  )
}

const tnock = (host: string, opts?: nock.Options) => {
  nock.disableNetConnect()
  const server = nock(host, opts)
  cleanup(function () {
    nock.enableNetConnect()
    server.done()
  })
  return server
}

// A callback for an async command. It throws the error that it gets.
const makeCb = () =>
  spy((er?: Error) => {
    if (er) {
      throw er
    }
  })

const longPath =
  '/long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt'

// The names in the x folder of the example archives.
const oneToTen = ['1', '10', '2', '3', '4', '5', '6', '7', '8', '9']

describe('basic extracting', () => {
  const file = path.resolve(tars, 'utf8.tar')

  const check = (dir: string) => {
    assert(fs.lstatSync(dir + '/Ω.txt').isFile())
    assert(fs.lstatSync(dir + '/🌟.txt').isFile())
    assert.throws(() => fs.lstatSync(dir + longPath), Error)
  }

  const files = ['🌟.txt', 'Ω.txt']
  test('sync', () => {
    const dir = testdir({})
    x({ file, sync: true, C: dir }, files)
    check(dir)
  })

  test('async promisey', async () => {
    const dir = testdir({})
    const p = x({ file, cwd: dir }, files)
    //@ts-expect-error
    p.sync
    //@ts-expect-error
    p.write
    await p
    check(dir)
  })

  test('async cb', async () => {
    const dir = testdir({})
    const cb = makeCb()
    const p = x({ file, cwd: dir }, files, cb)
    //@ts-expect-error
    p.sync
    //@ts-expect-error
    p.write
    await p
    assert.deepEqual(
      cb.calls.map(c => c.args),
      [[]],
    )
    check(dir)
  })

  test('stream sync', () => {
    const dir = testdir({})
    const ups = x({ cwd: dir, sync: true }, files)
    ups.end(fs.readFileSync(file))
    //@ts-expect-error
    ups.then
    assert.equal(ups.sync, true)
    check(dir)
  })

  test('stream async', async () => {
    const dir = testdir({})
    const up = x({ cwd: dir }, files)
    //@ts-expect-error
    up.then
    //@ts-expect-error
    up.sync
    await new Promise<void>(r =>
      up.end(fs.readFileSync(file)).on('end', r),
    )
    check(dir)
  })
})

describe('ensure an open stream is not prematurely closed', () => {
  const file = path.resolve(tars, 'long-paths.tar')

  test('async promisey', async () => {
    const dir = testdir({})
    const stream = fs.createReadStream(file, {
      highWaterMark: 1,
    })
    await pipeline(stream, x({ cwd: dir }))
    assert(fs.lstatSync(dir + '/long-path'))
  })
})

describe('ensure an open stream is not prematuraly closed http', () => {
  const file = path.resolve(tars, 'long-paths.tar')

  test('async promisey', async () => {
    const dir = testdir({})
    tnock('http://codeload.github.com/')
      .get('/npm/node-tar/tar.gz/main')
      .delay(250)
      .reply(200, () => fs.createReadStream(file))

    const stream = await new Promise<http.IncomingMessage>(
      (resolve, reject) =>
        http
          .get(
            'http://codeload.github.com/npm/node-tar/tar.gz/main',
            resolve,
          )
          .on('error', reject),
    )
    await pipeline(stream, x({ cwd: dir }))
    assert(fs.lstatSync(dir + '/long-path'))
  })
})

describe('file list and filter', () => {
  const file = path.resolve(tars, 'utf8.tar')

  const check = (dir: string) => {
    assert(fs.lstatSync(dir + '/Ω.txt').isFile())
    assert.throws(() => fs.lstatSync(dir + '/🌟.txt'), Error)
    assert.throws(() => fs.lstatSync(dir + longPath), Error)
  }

  const filter = (path: string) => path === 'Ω.txt'
  const files = ['🌟.txt', 'Ω.txt']

  test('sync file', () => {
    const dir = testdir({})
    x({ filter, file, sync: true, C: dir }, files)
    check(dir)
  })

  test('async file', async () => {
    const dir = testdir({})
    await x({ filter, file, cwd: dir }, files)
    check(dir)
  })

  test('async cb', async () => {
    const dir = testdir({})
    const cb = makeCb()
    await x({ filter, file, cwd: dir }, files, cb)
    assert.deepEqual(
      cb.calls.map(c => c.args),
      [[]],
    )
    check(dir)
  })
})

const byteCountsFile = path.resolve(tars, 'body-byte-counts.tar')
const checkByteCounts = (dir: string) => {
  for (const [name, size] of [
    ['1024-bytes.txt', 1024],
    ['512-bytes.txt', 512],
    ['one-byte.txt', 1],
    ['zero-byte.txt', 0],
  ] as const) {
    assert.equal(fs.lstatSync(path.resolve(dir, name)).size, size, name)
  }
}

for (const [name, maxReadSize] of [
  ['no file list', undefined],
  ['read in itty bits', 1000],
] as const) {
  describe(name, () => {
    const file = byteCountsFile

    test('sync file', () => {
      const dir = testdir({})
      x({ file, sync: true, C: dir, maxReadSize })
      checkByteCounts(dir)
    })

    test('async promisey file', async () => {
      const dir = testdir({})
      await x({ file, cwd: dir, maxReadSize })
      checkByteCounts(dir)
    })

    test('async cb', async () => {
      const dir = testdir({})
      const cb = makeCb()
      await x({ file, cwd: dir, maxReadSize }, cb)
      assert.deepEqual(
        cb.calls.map(c => c.args),
        [[]],
      )
      checkByteCounts(dir)
    })
  })
}

describe('no file list, stream', () => {
  const file = byteCountsFile

  test('sync stream', () => {
    const dir = testdir({})
    const up = x({ sync: true, C: dir })
    assert.equal(up.sync, true)
    assert(up instanceof UnpackSync)
    //@ts-expect-error
    up.then
    up.end(fs.readFileSync(file))
    checkByteCounts(dir)
  })

  test('async stream', async () => {
    const dir = testdir({})
    const up = x({ C: dir })
    assert(up instanceof Unpack)
    //@ts-expect-error
    up.sync
    //@ts-expect-error
    up.then
    up.end(fs.readFileSync(file))
    await new Promise<void>(r => up.on('close', () => r()))
    checkByteCounts(dir)
  })
})

test('bad calls', () => {
  assert.throws(() => x({}, () => {}), Error)
  assert.throws(() => x({}, [], () => {}), Error)
  //@ts-expect-error
  assert.throws(() => x({ sync: true }, () => {}), Error)
  //@ts-expect-error
  assert.throws(() => x({ sync: true }, [], () => {}), Error)
})

test('no file', () => {
  const up = x()
  assert(up instanceof Unpack)
  //@ts-expect-error
  up.then
  //@ts-expect-error
  up.sync
  const upf = x(['asdf'])
  //@ts-expect-error
  upf.then
  //@ts-expect-error
  upf.sync
  assert(upf instanceof Unpack)
  const ups = x({ sync: true })
  //@ts-expect-error
  ups.then
  assert.equal(ups.sync, true)
  assert(ups instanceof UnpackSync)
})

test('nonexistent', async () => {
  assert.throws(() => x({ sync: true, file: 'does not exist' }), Error)
  await assert.rejects(x({ file: 'does not exist' }), Error)
})

test('read fail', async () => {
  const poop = new Error('poop')
  const readSync = () => {
    throw poop
  }
  // The read is in @isaacs/fs-minipass, so that package gets the mock.
  const fsm = await mockImport(
    () => import('@isaacs/fs-minipass'),
    [
      [
        () => import('node:fs'),
        { ...fs, readSync, default: { ...fs, readSync } },
      ],
    ],
  )
  const { extract } = await mockImport(
    () => import('../src/extract.js'),
    [[() => import('@isaacs/fs-minipass'), fsm]],
  )

  const er = assert.throws(
    () =>
      extract({
        maxReadSize: 10,
        sync: true,
        file: import.meta.filename,
      }),
    { message: poop.message },
  )
  assert.equal(er, poop)
})

test('sync gzip error edge case test', () => {
  const file = path.resolve(fixtures, 'sync-gzip-fail.tgz')
  const dir = testdir({ x: {} })
  const cwd = process.cwd()
  process.chdir(dir)
  cleanup(() => process.chdir(cwd))

  x({
    sync: true,
    file: file,
    onwarn: (_c: any, _m: any, er) => {
      throw er
    },
  })

  assert.deepEqual(fs.readdirSync(dir + '/x').sort(), oneToTen)
})

describe('max decompression ratio', () => {
  const bombFile = () =>
    path.resolve(testdir({ 'bomb.tgz': makeCompressedBomb() }), 'bomb.tgz')

  test('file extraction aborts by default', async () => {
    const file = bombFile()
    const cwd = testdir({})
    assert.throws(
      () => x({ sync: true, file, cwd }),
      {
        tarCode: 'TAR_ABORT',
        recoverable: false,
        message: /max decompression ratio exceeded/,
      },
      'sync throws',
    )
    await assert.rejects(x({ file, cwd }), {
      tarCode: 'TAR_ABORT',
      recoverable: false,
      message: /max decompression ratio exceeded/,
    })
  })

  test('file extraction can disable the limit explicitly', async () => {
    const file = bombFile()
    const cwd = testdir({})
    await x({
      file,
      cwd,
      maxDecompressionRatio: Infinity,
    })
    assert.equal(
      fs.statSync(path.resolve(cwd, 'bomb')).size,
      8 * 1024 * 1024,
    )
  })
})

describe('brotli', () => {
  const file = path.resolve(fixtures, 'example.tbr')

  test('fails if unknown file extension', () => {
    const dir = testdir({ 'example.unknown': '' })
    const filename = path.resolve(dir, 'example.unknown')

    assert.throws(() => x({ sync: true, file: filename }), {
      message: 'TAR_BAD_ARCHIVE: Unrecognized archive format',
    })
  })

  test('succeeds based on file extension', () => {
    const dir = testdir({})
    x({ sync: true, file: file, C: dir })

    assert.deepEqual(fs.readdirSync(dir + '/x').sort(), oneToTen)
  })

  test('succeeds when passed explicit option', () => {
    const dir = testdir({})
    x({ sync: true, file: file, C: dir, brotli: true })

    assert.deepEqual(fs.readdirSync(dir + '/x').sort(), oneToTen)
  })
})

describe('zstd', () => {
  const file = path.resolve(fixtures, 'example.tzst')

  test('succeeds based on magic bytes', () => {
    const dir = testdir({})
    // copy the file to a new location with a different extension
    const unknownExtension = path.resolve(dir, 'example.unknown')
    fs.copyFileSync(file, unknownExtension)

    x({ sync: true, file: unknownExtension, C: dir })

    assert.deepEqual(fs.readdirSync(dir + '/x').sort(), oneToTen)
  })

  test('succeeds based on file extension', () => {
    const dir = testdir({})
    x({ sync: true, file: file, C: dir })

    assert.deepEqual(fs.readdirSync(dir + '/x').sort(), oneToTen)
  })

  test('succeeds when passed explicit option', () => {
    const dir = testdir({})
    x({ sync: true, file: file, C: dir, brotli: true })

    assert.deepEqual(fs.readdirSync(dir + '/x').sort(), oneToTen)
  })
})

describe('verify long linkname is not a problem', () => {
  // See: https://github.com/isaacs/node-tar/issues/312
  const file = path.resolve(fixtures, 'long-linkname.tar')
  test('sync', () => {
    const cwd = testdir({})
    const result = x({ sync: true, strict: true, file, cwd })
    assert.equal(result, undefined)
    assert(fs.lstatSync(cwd + '/test').isSymbolicLink())
  })
  test('async', async () => {
    const cwd = testdir({})
    await x({ file, C: cwd, strict: true })
    assert(fs.lstatSync(cwd + '/test').isSymbolicLink())
  })
})

describe('numeric pax/entry name discernment', () => {
  const numericName = '12345'
  const alphaName = 'abcde'
  for (const strict of [true, false]) {
    describe('strict=' + strict, () => {
      for (const paxName of [numericName, alphaName]) {
        describe('paxName=' + paxName, () => {
          for (const entryName of [numericName, alphaName]) {
            describe('entryName=' + entryName, () => {
              const paxHeader = new Pax(
                {
                  path: paxName,
                  size: '12345\n'.length,
                },
                false,
              )
              const paxData = paxHeader.encode()
              const data = makeTar([
                paxData,
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

              test('sync', () => {
                const dir = testdir({ tarFile: data })
                x({ strict, sync: true, cwd: dir, file: dir + '/tarFile' })
                assert.equal(
                  readFileSync(dir + '/' + paxName, 'utf8'),
                  '12345\n',
                )
              })

              test('async', async () => {
                const dir = testdir({ tarFile: data })
                await x({ strict, cwd: dir, file: dir + '/tarFile' })
                assert.equal(
                  readFileSync(dir + '/' + paxName, 'utf8'),
                  '12345\n',
                )
              })
            })
          }
        })
      }
    })
  }
})
