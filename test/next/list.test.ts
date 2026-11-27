import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { resolve } from 'node:path'
import zlib from 'node:zlib'
import { assert, describe, test, testdir } from 'ubqtest'
import type { TarFileHandle, TarFS, TarFSSync } from '../../src/next/fs.js'
import { filesFilter, list, listSync } from '../../src/next/list.js'
import { readFile, readFileSync } from '../../src/next/read-file.js'
import { cat, EOA, file, xorCodec, xorCompress } from './helpers.js'

// The modules of Node fit the adapter types as they are.
const fs: TarFS = nodeFsPromises
const fsSync: TarFSSync = nodeFs

const fixtures = resolve(import.meta.dirname, '../fixtures')
const longPaths = resolve(fixtures, 'tars/long-paths.tar')
const expectLong = (
  JSON.parse(
    nodeFs.readFileSync(
      resolve(fixtures, 'parse/long-paths.json'),
      'utf8',
    ),
  ) as [string, { path: string }][]
)
  .filter(e => e[0] === 'entry')
  .map(e => e[1].path)

const poop = new Error('poop')

// An fs that records its calls, with some functions replaced.
const mockFs = (over: Partial<TarFileHandle> = {}) => {
  const calls: string[] = []
  const mock: TarFS = {
    open: async (path, flags) => {
      calls.push(`open ${flags}`)
      const handle: TarFileHandle = await nodeFsPromises.open(path, flags)
      return {
        stat: () => {
          calls.push('stat')
          return over.stat ? over.stat() : handle.stat()
        },
        read: (buf, off, len, pos) => {
          calls.push(`read ${len} ${pos}`)
          return over.read ?
              over.read(buf, off, len, pos)
            : handle.read(buf, off, len, pos)
        },
        close: async () => {
          calls.push('close')
          await handle.close()
          await over.close?.()
        },
      }
    },
  }
  return { calls, mock }
}
const mockFsSync = (over: Partial<TarFSSync> = {}) => {
  const calls: string[] = []
  const mock: TarFSSync = {
    openSync: (path, flags) => (
      calls.push(`open ${flags}`),
      (over.openSync ?? nodeFs.openSync)(path, flags)
    ),
    fstatSync: fd => (
      calls.push('stat'),
      (over.fstatSync ?? nodeFs.fstatSync)(fd)
    ),
    readSync: (fd, buf, off, len, pos) => (
      calls.push(`read ${len} ${pos}`),
      (over.readSync ?? nodeFs.readSync)(fd, buf, off, len, pos)
    ),
    closeSync: fd => {
      calls.push('close')
      nodeFs.closeSync(fd)
      over.closeSync?.(fd)
    },
  }
  return { calls, mock }
}

describe('file', () => {
  for (const maxReadSize of [1000, undefined]) {
    test(`async, maxReadSize=${maxReadSize}`, async () => {
      const actual: string[] = []
      const res = await list({
        file: longPaths,
        fs,
        maxReadSize,
        onEntry: entry => actual.push(entry.path),
      })
      assert.equal(res, undefined)
      assert.deepEqual(actual, expectLong)
    })

    test(`sync, maxReadSize=${maxReadSize}`, () => {
      const actual: string[] = []
      const res = listSync({
        file: longPaths,
        fs: fsSync,
        maxReadSize,
        onEntry: entry => actual.push(entry.path),
      })
      assert.equal(res, undefined)
      assert.deepEqual(actual, expectLong)
    })
  }

  test('the file is read in chunks of maxReadSize, then closed', async () => {
    const { size } = nodeFs.statSync(longPaths)
    const reads = [
      `read 10000 0`,
      `read 10000 10000`,
      `read ${size - 20000} 20000`,
    ]
    const expect = ['open r', 'stat', ...reads, 'close']
    const { calls, mock } = mockFs()
    await list({ file: longPaths, fs: mock, maxReadSize: 10000 })
    assert.deepEqual(calls, expect)
    const sync = mockFsSync()
    listSync({ file: longPaths, fs: sync.mock, maxReadSize: 10000 })
    assert.deepEqual(sync.calls, expect)
  })

  test('a small file is read in one read of its size', async () => {
    const dir = testdir({
      'a.tar': Buffer.from(cat(file('a', 'abc'), EOA)),
    })
    const { calls, mock } = mockFs()
    await list({ file: resolve(dir, 'a.tar'), fs: mock })
    assert.deepEqual(calls, ['open r', 'stat', 'read 2048 0', 'close'])
    const sync = mockFsSync()
    listSync({ file: resolve(dir, 'a.tar'), fs: sync.mock })
    assert.deepEqual(sync.calls, [
      'open r',
      'stat',
      'read 2048 0',
      'close',
    ])
  })

  test('a gzip file, and warnings with the file name', async () => {
    const dir = testdir({
      'a.tgz': zlib.gzipSync(
        cat(file('a', 'abc'), file('b').fill(1, 0, 1)),
      ),
    })
    const path = resolve(dir, 'a.tgz')
    const paths: string[] = []
    const warnings: unknown[] = []
    await list({
      file: path,
      fs,
      onEntry: entry => paths.push(entry.path),
      onwarn: (...args) => warnings.push(args),
    })
    assert.deepEqual(paths, ['a'])
    assert.match(warnings, [
      ['TAR_ENTRY_INVALID', 'checksum failure', { file: path }],
    ])
  })

  test('a codec that is found by the file name', async () => {
    const codec = {
      ...xorCodec,
      detect: () => false,
      extensions: ['.txr'],
    }
    const dir = testdir({
      'a.txr': Buffer.from(xorCompress(cat(file('a', 'abc'), EOA))),
    })
    const opt = { file: resolve(dir, 'a.txr'), codecs: [codec] }
    const paths: string[] = []
    await list({ ...opt, fs, onEntry: entry => paths.push(entry.path) })
    listSync({
      ...opt,
      fs: fsSync,
      onEntry: entry => paths.push(entry.path),
    })
    assert.deepEqual(paths, ['a', 'a'])
  })

  test('the reading stops at the end of the archive', async () => {
    const data = cat(file('a'), EOA, new Uint8Array(4096))
    const dir = testdir({ 'a.tar': Buffer.from(data) })
    const { calls, mock } = mockFs()
    await list({
      file: resolve(dir, 'a.tar'),
      fs: mock,
      maxReadSize: 1024,
    })
    assert.deepEqual(calls, [
      'open r',
      'stat',
      'read 1024 0',
      'read 1024 1024',
      'close',
    ])
    const sync = mockFsSync()
    listSync({
      file: resolve(dir, 'a.tar'),
      fs: sync.mock,
      maxReadSize: 1024,
    })
    assert.deepEqual(sync.calls, calls)
  })
})

describe('input', () => {
  const data = cat(file('a', 'abc'), file('b', 'def'), EOA)

  test('async', async () => {
    const found: string[] = []
    await list({
      input: new Blob([data]),
      onEntry: async entry => {
        found.push(entry.path + '=' + (await entry.text()))
      },
    })
    assert.deepEqual(found, ['a=abc', 'b=def'])
  })

  test('sync', () => {
    const found: string[] = []
    listSync({
      input: [data],
      onEntry: entry => found.push(entry.path + '=' + entry.text()),
    })
    assert.deepEqual(found, ['a=abc', 'b=def'])
  })

  test('no onEntry function', async () => {
    assert.equal(await list({ input: data }), undefined)
    assert.equal(listSync({ input: data }), undefined)
  })

  test('no input', async () => {
    const expect = {
      name: 'TypeError',
      message: 'list needs input, or file and fs',
    }
    await assert.rejects(list({}), expect)
    await assert.rejects(list({ file: longPaths }), expect)
    await assert.rejects(list({ fs }), expect)
    assert.throws(() => listSync({}), expect)
    assert.throws(() => listSync({ file: longPaths }), expect)
    assert.throws(() => listSync({ fs: fsSync }), expect)
  })
})

describe('onEntry', () => {
  const data = cat(file('a', 'abc'), file('b', 'def'), file('c'), EOA)

  test('a promise is awaited before the next entry', async () => {
    const order: string[] = []
    await list({
      input: data,
      onEntry: async entry => {
        order.push('start ' + entry.path)
        await new Promise(res => setTimeout(res, 5))
        order.push('end ' + entry.path)
      },
    })
    assert.deepEqual(order, [
      'start a',
      'end a',
      'start b',
      'end b',
      'start c',
      'end c',
    ])
  })

  test('an error stops the list, and the file is closed', async () => {
    const { calls, mock } = mockFs()
    const seen: string[] = []
    const er = await assert.rejects(
      list({
        file: longPaths,
        fs: mock,
        onEntry: async entry => {
          seen.push(entry.path)
          throw poop
        },
      }),
      Error,
    )
    assert.equal(er, poop)
    assert.equal(seen.length, 1)
    assert.equal(calls.pop(), 'close')
  })

  test('sync: an error stops the list, and the file is closed', () => {
    const { calls, mock } = mockFsSync()
    const seen: string[] = []
    const er = assert.throws(
      () =>
        listSync({
          file: longPaths,
          fs: mock,
          onEntry: entry => {
            seen.push(entry.path)
            throw poop
          },
        }),
      Error,
    )
    assert.equal(er, poop)
    assert.equal(seen.length, 1)
    assert.equal(calls.pop(), 'close')
  })
})

describe('limit to specific files', () => {
  const fileList = [
    'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t',
    '170-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc///',
  ]
  const fileListCopy = [...fileList]
  const expect = expectLong.filter(
    p => p.startsWith(fileList[0] + '/') || p.startsWith('170-byte'),
  )

  test('gutcheck', () => {
    assert.equal(expect.length, 8)
    assert.lessThan(expect.length, expectLong.length)
  })

  test('no filter function', async () => {
    const actual: string[] = []
    await list(
      { file: longPaths, fs, onEntry: entry => actual.push(entry.path) },
      fileList,
    )
    assert.deepEqual(actual, expect)
    actual.length = 0
    listSync(
      {
        file: longPaths,
        fs: fsSync,
        onEntry: entry => actual.push(entry.path),
      },
      fileList,
    )
    assert.deepEqual(actual, expect)
  })

  test('filter function', async () => {
    const actual: string[] = []
    const seen: string[] = []
    const opt = {
      file: longPaths,
      filter: (path: string) => !!seen.push(path) && path === expect[0],
    }
    await list(
      { ...opt, fs, onEntry: entry => actual.push(entry.path) },
      fileList,
    )
    assert.deepEqual(actual, expect.slice(0, 1))
    // The filter of the caller gets each entry.
    assert.deepEqual(seen, expectLong)
    listSync(
      { ...opt, fs: fsSync, onEntry: entry => actual.push(entry.path) },
      fileList,
    )
    assert.deepEqual(actual, expect.slice(0, 1).concat(expect.slice(0, 1)))
  })

  test('an empty list is no limit', async () => {
    const actual: string[] = []
    await list(
      { file: longPaths, fs, onEntry: entry => actual.push(entry.path) },
      [],
    )
    assert.deepEqual(actual, expectLong)
  })

  // This runs after the tests that pass fileList to list().
  test('list is unmunged', () => {
    assert.deepEqual(fileList, fileListCopy)
  })

  test('filesFilter', () => {
    const filter = filesFilter(['x', 'd/e/', '/abs/dir', '.'])
    const pass = (path: string) => filter(path, undefined)
    assert.deepEqual(
      ['x', 'x/', 'x/y', 'x/y/z/', 'd/e', 'd/e/f', '/abs/dir/f'].filter(
        p => !pass(p),
      ),
      [],
    )
    assert.deepEqual(
      [
        'xy',
        'y/x',
        'd',
        'd/f',
        '/abs',
        '/x',
        'abs/dir',
        '.',
        '/',
        '',
      ].filter(pass),
      [],
    )
  })

  test('files filter looks at 100 parent directories at most', () => {
    const filter = filesFilter(['x'])
    assert.equal(filter('x/y', undefined), true)
    assert.equal(filter('x/' + 'a/'.repeat(98) + 'b', undefined), true)
    assert.equal(filter('x/' + 'a/'.repeat(99) + 'b', undefined), false)
    assert.equal(filter('x/' + 'a/'.repeat(101) + 'b', undefined), false)
  })
})

describe('file system errors', () => {
  test('open fails', async () => {
    const mock: TarFS = { open: () => Promise.reject(poop) }
    const er = await assert.rejects(list({ file: 'x', fs: mock }), Error)
    assert.equal(er, poop)
    const { calls, mock: sync } = mockFsSync({
      openSync: () => {
        throw poop
      },
    })
    assert.equal(
      assert.throws(() => listSync({ file: 'x', fs: sync }), Error),
      poop,
    )
    assert.deepEqual(calls, ['open r'])
  })

  test('a missing file', async () => {
    await assert.rejects(list({ file: resolve(fixtures, 'nope'), fs }), {
      code: 'ENOENT',
    })
    assert.throws(
      () => listSync({ file: resolve(fixtures, 'nope'), fs: fsSync }),
      { code: 'ENOENT' },
    )
  })

  test('stat fails, and the file is closed', async () => {
    const { calls, mock } = mockFs({ stat: () => Promise.reject(poop) })
    const er = await assert.rejects(
      list({ file: longPaths, fs: mock }),
      Error,
    )
    assert.equal(er, poop)
    assert.deepEqual(calls, ['open r', 'stat', 'close'])
    const sync = mockFsSync({
      fstatSync: () => {
        throw poop
      },
    })
    assert.equal(
      assert.throws(
        () => listSync({ file: longPaths, fs: sync.mock }),
        Error,
      ),
      poop,
    )
    assert.deepEqual(sync.calls, ['open r', 'stat', 'close'])
  })

  test('read fails, and the file is closed', async () => {
    const { calls, mock } = mockFs({ read: () => Promise.reject(poop) })
    const er = await assert.rejects(
      list({ file: longPaths, fs: mock }),
      Error,
    )
    assert.equal(er, poop)
    assert.equal(calls.pop(), 'close')
    const sync = mockFsSync({
      readSync: () => {
        throw poop
      },
    })
    assert.equal(
      assert.throws(
        () => listSync({ file: longPaths, fs: sync.mock }),
        Error,
      ),
      poop,
    )
    assert.equal(sync.calls.pop(), 'close')
  })

  test('an error of close is ignored', async () => {
    const paths: string[] = []
    const { calls, mock } = mockFs({ close: () => Promise.reject(poop) })
    await list({
      file: longPaths,
      fs: mock,
      onEntry: entry => paths.push(entry.path),
    })
    assert.equal(calls.pop(), 'close')
    const sync = mockFsSync({
      closeSync: () => {
        throw poop
      },
    })
    listSync({
      file: longPaths,
      fs: sync.mock,
      onEntry: entry => paths.push(entry.path),
    })
    assert.equal(sync.calls.pop(), 'close')
    assert.deepEqual(paths, [...expectLong, ...expectLong])
  })
})

// GHSA-29xp-372q-xqph
describe('the file gets smaller while it is read', () => {
  const data = cat(file('a', 'a'), file('b', 'b'), EOA)
  const truncLen = 512 * 2

  for (const [name, maxReadSize] of [
    ['read in one go', data.length + 1],
    ['read in parts', data.length / 4],
  ] as const) {
    test(`async, ${name}`, async () => {
      const dir = testdir({ 'file.tar': Buffer.from(data) })
      const path = resolve(dir, 'file.tar')
      const { mock } = mockFs({
        stat: async () => {
          const st = nodeFs.statSync(path)
          nodeFs.truncateSync(path, truncLen)
          return st
        },
      })
      const found: string[] = []
      await list({
        file: path,
        fs: mock,
        maxReadSize,
        onEntry: async entry => {
          found.push(entry.path + '=' + (await entry.text()))
        },
      })
      assert.deepEqual(found, ['a=a'])
    })

    test(`sync, ${name}`, () => {
      const dir = testdir({ 'file.tar': Buffer.from(data) })
      const path = resolve(dir, 'file.tar')
      const { mock } = mockFsSync({
        fstatSync: fd => {
          const st = nodeFs.fstatSync(fd)
          nodeFs.truncateSync(path, truncLen)
          return st
        },
      })
      const found: string[] = []
      listSync({
        file: path,
        fs: mock,
        maxReadSize,
        onEntry: entry => found.push(entry.path + '=' + entry.text()),
      })
      assert.deepEqual(found, ['a=a'])
    })
  }
})

describe('readFile', () => {
  test('each chunk is a new array', async () => {
    const chunks: Uint8Array[] = []
    for await (const chunk of readFile(fs, longPaths, 4096))
      chunks.push(chunk)
    const syncChunks = [...readFileSync(fsSync, longPaths, 4096)]
    const data = nodeFs.readFileSync(longPaths)
    assert.equal(Buffer.concat(chunks).equals(data), true)
    assert.equal(Buffer.concat(syncChunks).equals(data), true)
    assert.equal(new Set(chunks.map(c => c.buffer)).size, chunks.length)
    assert.equal(
      new Set(syncChunks.map(c => c.buffer)).size,
      chunks.length,
    )
    assert.equal(chunks.length, Math.ceil(data.length / 4096))
  })

  test('an empty file', async () => {
    const dir = testdir({ empty: '' })
    const chunks: Uint8Array[] = []
    for await (const c of readFile(fs, resolve(dir, 'empty')))
      chunks.push(c)
    assert.deepEqual(chunks, [])
    assert.deepEqual([...readFileSync(fsSync, resolve(dir, 'empty'))], [])
  })
})
