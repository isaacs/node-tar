import type { Stats } from 'fs'
import fs, { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  assert,
  describe,
  mockImport,
  spyOn,
  test,
  testdir,
} from 'ubqtest'
import { filesFilter, list } from '../src/list.js'
import type { TarOptions } from '../src/options.js'
import { Parser } from '../src/parse.js'
import type { ReadEntry } from '../src/read-entry.js'
import { makeTar } from './fixtures/make-tar.js'

const __filename = import.meta.filename
const __dirname = import.meta.dirname

const poop = new Error('poop')
const cbFail = (...args: any[]) =>
  (args[args.length - 1] as Function)(poop)
const syncFail = () => {
  throw poop
}

// A copy of the fs module with some methods replaced.
const mockFs = (overrides: Record<string, unknown>) => {
  const mocked = { ...fs, ...overrides }
  return { ...mocked, default: mocked } as unknown as typeof fs
}

// Load a new instance of list() that uses the mocked fs methods. The
// file streams of @isaacs/fs-minipass use the same mocked fs.
const mockedList = async (overrides: Record<string, unknown>) => {
  const mocked = mockFs(overrides)
  const fsm = await mockImport(
    () => import('@isaacs/fs-minipass'),
    [[() => import('node:fs'), mocked]],
  )
  const { list } = await mockImport(
    () => import('../src/list.js'),
    [
      [() => import('node:fs'), mocked],
      [() => import('@isaacs/fs-minipass'), fsm],
    ],
  )
  return list
}

const lp = JSON.parse(
  readFileSync(__dirname + '/fixtures/parse/long-paths.json', 'utf8'),
) as (
  | ['meta', string]
  | ['entry', Record<string, any>]
  | ['nullBlock' | 'eof' | 'end']
)[]

describe('basic', () => {
  const file = resolve(__dirname, 'fixtures/tars/long-paths.tar')
  const expect = lp
    .filter(e => e[0] === 'entry')
    .map(e => e[1].path as string)

  for (const maxReadSize of [1000, undefined]) {
    describe('file maxReadSize=' + maxReadSize, () => {
      test('sync', () => {
        const actual: string[] = []
        const onReadEntry = (entry: ReadEntry) => actual.push(entry.path)
        list({ file, sync: true, onReadEntry, maxReadSize })
        assert.deepEqual(actual, expect)
      })

      test('async promise', async () => {
        const actual: string[] = []
        const onReadEntry = (entry: ReadEntry) => actual.push(entry.path)
        await list({ file, onReadEntry, maxReadSize })
        assert.deepEqual(actual, expect)
      })

      test('async cb', async () => {
        const actual: string[] = []
        const onReadEntry = (entry: ReadEntry) => actual.push(entry.path)
        const er = await new Promise<Error | undefined>(cb =>
          list({ file, onReadEntry, maxReadSize }, cb),
        )
        assert.equal(er, undefined)
        assert.deepEqual(actual, expect)
      })
    })
  }

  describe('stream', () => {
    test('sync', () => {
      const actual: string[] = []
      const onReadEntry = (entry: ReadEntry) => actual.push(entry.path)
      const l = list({ sync: true, onReadEntry })
      l.end(fs.readFileSync(file))
      assert.deepEqual(actual, expect)
    })

    test('async', async () => {
      const actual: string[] = []
      const onReadEntry = (entry: ReadEntry) => actual.push(entry.path)
      const l = list()
      l.on('entry', onReadEntry)
      const end = new Promise<void>(res => l.on('end', res))
      fs.createReadStream(file).pipe(l)
      await end
      assert.deepEqual(actual, expect)
    })
  })

  test('no onReadEntry function', async () => {
    assert.equal(await list({ file }), undefined)
  })

  describe('limit to specific files', () => {
    const fileList = [
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t',
      '170-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc///',
    ]
    const fileListCopy = [...fileList]

    const expect = [
      '170-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
    ]

    test('no filter function', async () => {
      const actual: string[] = []
      await list(
        { file, onReadEntry: entry => actual.push(entry.path) },
        fileList,
      )
      assert.deepEqual(actual, expect)
    })

    test('no filter function, stream', async () => {
      const actual: string[] = []
      const onReadEntry = (entry: ReadEntry) => actual.push(entry.path)
      const l = list(fileList).on('entry', onReadEntry)
      const end = new Promise<void>(res => l.on('end', res))
      fs.createReadStream(file).pipe(l)
      await end
      assert.deepEqual(actual, expect)
    })

    test('filter function', async () => {
      const actual: string[] = []
      await list(
        {
          file,
          filter: path => path === expect[0],
          onReadEntry: entry => actual.push(entry.path),
        },
        fileList,
      )
      assert.deepEqual(actual, expect.slice(0, 1))
    })

    // This runs after the tests that pass fileList to list().
    test('list is unmunged', () => {
      assert.deepEqual(fileList, fileListCopy)
    })
  })
})

test('bad args', () => {
  assert.throws(() => list({ file: __filename, sync: true }, () => {}), {
    message: 'callback not supported for sync tar functions',
  })
  assert.throws(() => list({}, () => {}), {
    message: 'callback only supported with file option',
  })
})

describe('stat fails', () => {
  const setup = () =>
    mockedList({
      open: cbFail,
      stat: cbFail,
      lstat: cbFail,
      fstat: cbFail,
      openSync: syncFail,
      statSync: syncFail,
      lstatSync: syncFail,
      fstatSync: syncFail,
    })

  test('sync', async () => {
    const list = await setup()
    const er = assert.throws(
      () => list({ file: __filename, sync: true }),
      Error,
    )
    assert.equal(er, poop)
  })

  test('cb', async () => {
    const list = await setup()
    const er = await new Promise<Error | undefined>(cb =>
      list({ file: __filename }, cb),
    )
    assert.equal(er, poop)
  })

  test('promise', async () => {
    const list = await setup()
    const er = await assert.rejects(list({ file: __filename }), Error)
    assert.equal(er, poop)
  })
})

describe('read fail', () => {
  const setup = () => mockedList({ read: cbFail, readSync: syncFail })

  test('sync', async () => {
    const list = await setup()
    const er = assert.throws(
      () => list({ file: __filename, sync: true, maxReadSize: 10 }),
      Error,
    )
    assert.equal(er, poop)
  })

  test('cb', async () => {
    const list = await setup()
    const er = await new Promise<Error | undefined>(cb =>
      list({ file: __filename }, cb),
    )
    assert.equal(er, poop)
  })

  test('promise', async () => {
    const list = await setup()
    const er = await assert.rejects(list({ file: __filename }), Error)
    assert.equal(er, poop)
  })
})

describe('noResume option', () => {
  const file = resolve(__dirname, 'fixtures/tars/file.tar')
  test('sync', async () => {
    let e!: ReadEntry
    list({
      file,
      onReadEntry: entry => {
        e = entry
        process.nextTick(() => {
          assert(!entry.flowing)
          entry.resume()
        })
      },
      sync: true,
      noResume: true,
    })
    assert(e)
    assert(!e.flowing)
    await new Promise<void>(res => e.on('end', res))
  })

  test('async', () =>
    list({
      file,
      onReadEntry: entry => {
        process.nextTick(() => {
          assert(!entry.flowing)
          entry.resume()
        })
      },
      noResume: true,
    }))
})

test('typechecks', () => {
  const p = list()
  //@ts-expect-error
  p.then
  assert(p instanceof Parser)
})

// GHSA-29xp-372q-xqph
describe('reduce file size while synchronously reading', () => {
  const data = makeTar([
    {
      type: 'File',
      path: 'a',
      size: 1,
    },
    'a',
    {
      type: 'File',
      path: 'b',
      size: 1,
    },
    'b',
    '',
    '',
  ])
  const dataLen = data.byteLength
  const truncLen = 512 * 2
  const truncData = data.subarray(0, truncLen)

  const setup = async () => {
    const dir = testdir({ 'file.tar': data })
    const file = resolve(dir, 'file.tar')
    const { list } = await mockImport(
      () => import('../src/list.js'),
      [
        [
          () => import('node:fs'),
          mockFs({
            fstatSync: (fd: number): Stats => {
              const st = fs.fstatSync(fd)
              // truncate the file before we have a chance to read
              fs.writeFileSync(file, truncData)
              return st
            },
          }),
        ],
      ],
    )

    return { file, list }
  }

  test('gutcheck, reading normally reads the whole file', () => {
    const dir = testdir({ 'file.tar': data })
    const file = resolve(dir, 'file.tar')
    for (const maxReadSize of [dataLen + 1, dataLen - 1]) {
      const entries: string[] = []
      list({
        file,
        sync: true,
        maxReadSize,
        onReadEntry: e => entries.push(e.path),
      })
      assert.deepEqual(entries, ['a', 'b'])
    }
  })

  for (const [name, maxReadSize] of [
    ['read in one go', dataLen + 1],
    ['read in parts', dataLen / 4],
  ] as const) {
    test(name, async () => {
      const { file, list } = await setup()
      const entries: string[] = []
      list({
        file,
        sync: true,
        maxReadSize,
        onReadEntry: e => entries.push(e.path),
      })
      assert.deepEqual(entries, ['a'])
    })
  }
})

test('files filter looks at 100 parent directories at most', () => {
  const opt: TarOptions = {}
  filesFilter(opt, ['x'])
  const filter = opt.filter
  assert(filter)
  const entry = {} as ReadEntry
  assert.equal(filter('x/y', entry), true)
  assert.equal(filter('x/' + 'a/'.repeat(101) + 'b', entry), false)
})

test('sync list ignores an error of close', () => {
  const dir = testdir({
    'file.tar': makeTar([{ path: 'a', type: 'File', size: 0 }, '', '']),
  })
  const { closeSync } = fs
  const close = spyOn(fs, 'closeSync', (fd: number) => {
    closeSync(fd)
    throw poop
  })
  const entries: string[] = []
  list({
    file: resolve(dir, 'file.tar'),
    sync: true,
    onReadEntry: e => entries.push(e.path),
  })
  assert.deepEqual(entries, ['a'])
  assert.equal(close.calls.length, 1)
})
