import { spawn } from 'child_process'
import fs from 'fs'
import mutateFS from 'mutate-fs'
import path, { resolve } from 'path'
import { assert, cleanup, describe, test, testdir } from 'ubqtest'
import zlib from 'zlib'
import { update as u } from '../src/update.js'
import { makeTar } from './fixtures/make-tar.js'

const __filename = import.meta.filename
const __dirname = import.meta.dirname
const tars = path.resolve(__dirname, 'fixtures/tars')
const self = path.basename(__filename)

const data = fs.readFileSync(tars + '/body-byte-counts.tar')
const dataNoNulls = data.subarray(0, data.length - 1024)
const fixtureDef = {
  'body-byte-counts.tar': data,
  'no-null-eof.tar': dataNoNulls,
  'truncated-head.tar': Buffer.concat([
    dataNoNulls,
    data.subarray(0, 500),
  ]),
  'truncated-body.tar': Buffer.concat([
    dataNoNulls,
    data.subarray(0, 700),
  ]),
  'zero.tar': Buffer.from(''),
  'empty.tar': Buffer.alloc(512),
  'compressed.tgz': zlib.gzipSync(data),
  'compressed.tbr': zlib.brotliCompressSync(data),
  'compressed.tzst': zlib.zstdCompressSync(data),
}

// Make a test folder that has one fixture. Return the path of the file.
const fixture = name =>
  resolve(testdir({ [name]: fixtureDef[name] }), name)

const bodyByteCounts = [
  '1024-bytes.txt',
  '512-bytes.txt',
  'one-byte.txt',
  'zero-byte.txt',
]

// The three ways to call update() with a file. Each one resolves when
// the archive is complete, and rejects on an error.
const modes = [
  ['sync', async (opt, files) => u({ ...opt, sync: true }, files)],
  [
    'async cb',
    (opt, files) =>
      new Promise((res, rej) =>
        u(opt, files, er => (er ? rej(er) : res())),
      ),
  ],
  ['async', async (opt, files) => u(opt, files)],
]

// Call update() with a callback, and resolve to the error it gets.
const cbError = (opt, files) => new Promise(res => u(opt, files, res))

// List the entries of an archive with the system tar command.
const systemTarList = async file => {
  const c = spawn('tar', ['tf', file])
  const out = []
  c.stdout.on('data', chunk => out.push(chunk))
  const [code, signal] = await new Promise(res =>
    c.on('close', (code, signal) => res([code, signal])),
  )
  assert.equal(code, 0)
  assert.equal(signal, null)
  return Buffer.concat(out).toString().trim().split(/\r?\n/)
}

describe('basic file add to archive (good or truncated)', () => {
  const files = [
    'body-byte-counts.tar',
    'no-null-eof.tar',
    'truncated-head.tar',
    'truncated-body.tar',
  ]
  for (const [mode, run] of modes) {
    for (const name of files) {
      test(`${mode} ${name}`, async () => {
        const file = fixture(name)
        await run({ file, cwd: __dirname }, [self])
        assert.deepEqual(await systemTarList(file), [
          ...bodyByteCounts,
          self,
        ])
      })
    }
  }
})

describe('add to empty archive', () => {
  for (const [mode, run] of modes) {
    for (const name of ['empty.tar', 'zero.tar', undefined]) {
      test(`${mode} ${name ?? 'not-existing.tar'}`, async () => {
        const file =
          name ? fixture(name) : resolve(testdir(), 'not-existing.tar')
        await run({ file, cwd: __dirname }, [self])
        assert.deepEqual(await systemTarList(file), [self])
      })
    }
  }
})

const compressedError = { message: 'cannot append to compressed archives' }

test('cannot append to gzipped archives', async () => {
  const file = fixture('compressed.tgz')

  assert.throws(() => u({ file, cwd: __dirname, gzip: true }, [self]), {
    ...compressedError,
    name: 'TypeError',
  })

  assert.throws(() => u({ file, cwd: __dirname, sync: true }, [self]), {
    ...compressedError,
    name: 'Error',
  })

  assert.match(await cbError({ file, cwd: __dirname }, [self]), {
    ...compressedError,
    name: 'Error',
  })
})

test('cannot append to brotli archives', () => {
  const file = fixture('compressed.tbr')

  assert.throws(() => u({ file, cwd: __dirname, brotli: true }, [self]), {
    ...compressedError,
    name: 'TypeError',
  })

  // The file name ends in .tbr, so this fails before it reads the file.
  assert.throws(() => u({ file, cwd: __dirname, sync: true }, [self]), {
    ...compressedError,
    name: 'TypeError',
  })
})

test('cannot append to zstd archives', () => {
  const file = fixture('compressed.tzst')

  assert.throws(() => u({ file, cwd: __dirname, zstd: true }, [self]), {
    ...compressedError,
    name: 'TypeError',
  })
})

test('other throws', () => {
  assert.throws(() => u({}, ['asdf']), { message: 'file is required' })
  assert.throws(() => u({ file: 'asdf' }, []), {
    message: 'no paths specified to add/replace',
  })
})

describe('broken fs method', () => {
  const poop = new Error('poop')
  for (const method of ['open', 'fstat', 'read']) {
    test(`${method} sync`, () => {
      const file = fixture('body-byte-counts.tar')
      cleanup(mutateFS.fail(method, poop))
      const er = assert.throws(
        () => u({ sync: true, file }, ['README.md']),
        Error,
      )
      assert.equal(er, poop)
    })

    test(`${method} async`, async () => {
      const file = fixture('body-byte-counts.tar')
      cleanup(mutateFS.fail(method, poop))
      assert.equal(await cbError({ file }, ['README.md']), poop)
    })
  }
})

// Make a test folder with an archive, and a file that the archive has
// with the given mtime. Return the folder and the path of the archive.
const mtimeFixture = mtime => {
  const dir = testdir({
    'body-byte-counts.tar': fixtureDef['body-byte-counts.tar'],
    '1024-bytes.txt': '.'.repeat(1024),
    foo: 'foo',
  })
  fs.utimesSync(resolve(dir, '1024-bytes.txt'), mtime, mtime)
  return { dir, file: resolve(dir, 'body-byte-counts.tar') }
}

// The sync case also has an mtime cache, and a filter that removes foo.
const mtimeArgs = mode =>
  mode === 'sync' ?
    [
      {
        mtimeCache: new Map(),
        filter: path => path === '1024-bytes.txt',
      },
      ['1024-bytes.txt', 'foo'],
    ]
  : [{}, ['1024-bytes.txt']]

describe('do not add older file', () => {
  for (const [mode, run] of modes) {
    test(mode, async () => {
      const { dir, file } = mtimeFixture(
        new Date('1997-04-10T16:57:47.000Z'),
      )
      const [opt, files] = mtimeArgs(mode)
      await run({ ...opt, file, cwd: dir }, files)
      // file size should not change
      assert.equal(
        fs.statSync(file).size,
        fixtureDef['body-byte-counts.tar'].length,
      )
    })
  }
})

describe('do add newer file', () => {
  for (const [mode, run] of modes) {
    test(mode, async () => {
      const { dir, file } = mtimeFixture(
        new Date(Date.now() + 24 * 60 * 60 * 1000),
      )
      const [opt, files] = mtimeArgs(mode)
      await run({ ...opt, file, cwd: dir }, files)
      // a chunk for the header, then 2 for the body
      assert.equal(
        fs.statSync(file).size,
        fixtureDef['body-byte-counts.tar'].length + 512 + 1024,
      )
    })
  }
})

describe('filter passes a file that the archive does not have', () => {
  for (const [mode, run] of modes) {
    test(mode, async () => {
      const { dir, file } = mtimeFixture(
        new Date('1997-04-10T16:57:47.000Z'),
      )
      await run({ file, cwd: dir, filter: path => path === 'foo' }, [
        '1024-bytes.txt',
        'foo',
      ])
      assert.deepEqual(await systemTarList(file), [
        ...bodyByteCounts,
        'foo',
      ])
    })
  }
})

describe('add an entry with no mtime from another archive', () => {
  for (const [mode, run] of modes) {
    for (const filter of [undefined, () => true]) {
      test(`${mode}${filter ? ' with filter' : ''}`, async () => {
        const dir = testdir({
          'body-byte-counts.tar': fixtureDef['body-byte-counts.tar'],
          'no-mtime.tar': makeTar([
            { path: 'no-mtime', type: 'File', size: 1 },
            'a',
            '',
            '',
          ]),
        })
        const file = resolve(dir, 'body-byte-counts.tar')
        await run({ file, cwd: dir, filter }, ['@no-mtime.tar'])
        assert.deepEqual(await systemTarList(file), [
          ...bodyByteCounts,
          'no-mtime',
        ])
      })
    }
  }
})
