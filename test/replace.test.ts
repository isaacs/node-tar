import { spawn } from 'child_process'
import fs from 'fs'
//@ts-ignore
import mutateFS from 'mutate-fs'
import path, { resolve } from 'path'
import { assert, cleanup, describe, test, testdir } from 'ubqtest'
import zlib from 'zlib'
import { list } from '../src/list.js'
import type { TarOptionsWithAliasesFile } from '../src/options.js'
import { replace as r } from '../src/replace.js'
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
type Fixture = keyof typeof fixtureDef

// Make a test folder that has one fixture. Return the path of the file.
const fixture = (name: Fixture) =>
  resolve(testdir({ [name]: fixtureDef[name] }), name)

const bodyByteCounts = [
  '1024-bytes.txt',
  '512-bytes.txt',
  'one-byte.txt',
  'zero-byte.txt',
]

// The three ways to call replace() with a file. Each one resolves when
// the archive is complete, and rejects on an error.
const modes: [
  name: string,
  run: (opt: TarOptionsWithAliasesFile, files: string[]) => Promise<void>,
][] = [
  ['sync', async (opt, files) => r({ ...opt, sync: true }, files)],
  [
    'async cb',
    (opt, files) =>
      new Promise<void>((res, rej) =>
        r(opt, files, er => (er ? rej(er) : res())),
      ),
  ],
  ['async', async (opt, files) => r(opt, files)],
]

// Call replace() with a callback, and resolve to the error it gets.
const cbError = (opt: TarOptionsWithAliasesFile, files: string[]) =>
  new Promise<Error | undefined>(res => r(opt, files, res))

// List the entries of an archive with the system tar command.
const systemTarList = async (file: string) => {
  const c = spawn('tar', ['tf', file])
  const out: Buffer[] = []
  c.stdout.on('data', (chunk: Buffer) => out.push(chunk))
  const [code, signal] = await new Promise<
    [number | null, NodeJS.Signals | null]
  >(res => c.on('close', (code, signal) => res([code, signal])))
  assert.equal(code, 0)
  assert.equal(signal, null)
  return Buffer.concat(out).toString().trim().split(/\r?\n/)
}

describe('basic file add to archive (good or truncated)', () => {
  const files: Fixture[] = [
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
  const files: (Fixture | undefined)[] = [
    'empty.tar',
    'zero.tar',
    undefined,
  ]
  for (const [mode, run] of modes) {
    for (const name of files) {
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

  assert.throws(() => r({ file, cwd: __dirname, gzip: true }, [self]), {
    ...compressedError,
    name: 'TypeError',
  })

  assert.throws(() => r({ file, cwd: __dirname, sync: true }, [self]), {
    ...compressedError,
    name: 'Error',
  })

  assert.match(await cbError({ file, cwd: __dirname }, [self]), {
    ...compressedError,
    name: 'Error',
  })
})

test('cannot append to brotli compressed archives', () => {
  const file = fixture('compressed.tbr')

  assert.throws(() => r({ file, cwd: __dirname, brotli: true }, [self]), {
    ...compressedError,
    name: 'TypeError',
  })

  // The file name ends in .tbr, so this fails before it reads the file.
  assert.throws(() => r({ file, cwd: __dirname, sync: true }, [self]), {
    ...compressedError,
    name: 'TypeError',
  })
})

test('cannot append to zstd compressed archives', () => {
  const file = fixture('compressed.tzst')

  assert.throws(() => r({ file, cwd: __dirname, zstd: true }, [self]), {
    ...compressedError,
    name: 'TypeError',
  })
})

test('other throws', () => {
  assert.throws(() => r({}, ['asdf']), { message: 'file is required' })
  assert.throws(() => r({ file: 'asdf' }, []), {
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
        () => r({ sync: true, file }, ['README.md']),
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

describe('mtime cache', () => {
  for (const [mode, run] of modes) {
    test(mode, async () => {
      const file = fixture('body-byte-counts.tar')
      const mtimeCache = new Map<string, Date>()
      await run({ file, cwd: __dirname, mtimeCache }, [self])
      assert.deepEqual(await systemTarList(file), [
        ...bodyByteCounts,
        self,
      ])
      assert.deepEqual(
        Object.fromEntries(
          [...mtimeCache].map(([k, v]) => [k, v.toISOString()]),
        ),
        {
          '1024-bytes.txt': '2017-04-10T16:57:47.000Z',
          '512-bytes.txt': '2017-04-10T17:08:55.000Z',
          'one-byte.txt': '2017-04-10T16:58:20.000Z',
          'zero-byte.txt': '2017-04-10T17:08:01.000Z',
        },
      )
    })
  }
})

describe('create tarball out of another tarball', () => {
  for (const [mode, run] of modes) {
    test(mode, async () => {
      const dir = testdir({
        'out.tar': fs.readFileSync(path.resolve(tars, 'dir.tar')),
      })
      const out = resolve(dir, 'out.tar')
      await run({ f: out, cwd: tars }, ['@utf8.tar'])
      const actual: string[] = []
      list({
        f: out,
        sync: true,
        onReadEntry: entry => actual.push(entry.path),
      })
      assert.deepEqual(actual, [
        'dir/',
        'Ω.txt',
        '🌟.txt',
        'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
      ])
    })
  }
})

describe('archive with a header that has no size', () => {
  for (const [mode, run] of modes) {
    test(mode, async () => {
      const dir = testdir({
        'no-size.tar': makeTar([{ path: 'x', type: 'File' }, '', '']),
      })
      const file = resolve(dir, 'no-size.tar')
      await run({ file, cwd: __dirname }, [self])
      const actual: string[] = []
      list({
        file,
        sync: true,
        onReadEntry: entry => actual.push(entry.path),
      })
      assert.deepEqual(actual, ['x', self])
    })
  }
})

test('no file option', () => {
  assert.throws(() => r.syncNoFile({ sync: true }, []), {
    name: 'TypeError',
    message: 'file is required',
  })
  assert.throws(() => r.asyncNoFile({}, []), {
    name: 'TypeError',
    message: 'file is required',
  })
})
