import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { resolve } from 'node:path'
import zlib from 'node:zlib'
import { assert, describe, test, testdir } from 'ubqtest'
import type { TarFileHandle, TarFS, TarFSSync } from '../src/fs.js'
import type { ListOptions } from '../src/options.js'
import { filesFilter, list, listSync } from '../src/list.js'
import { readFile, readFileSync } from '../src/read-file.js'
import {
  cat,
  EOA,
  file,
  longPath,
  pax,
  rec,
  xorCodec,
  xorCompress,
} from './helpers.js'

// The modules of Node fit the adapter types as they are.
const fs: TarFS = nodeFsPromises
const fsSync: TarFSSync = nodeFs

const fixtures = resolve(import.meta.dirname, './fixtures')
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

describe('a body that no consumer reads is not read from the file', () => {
  const K = 1024
  const M = K * K
  const FIRST = 64 * K
  const body = (size: number, seed: number) => {
    const b = new Uint8Array(size)
    for (let i = 0; i < size; i++) b[i] = (i * 7 + seed) % 251
    return b
  }
  const big = body(3 * M, 1)
  const y = body(2 * M, 2)
  // The place of each part: 'small' 0, 'big' 1024 (body 1536), the
  // PAX header and 'pax-name' 3147264, the GNU header and 'y' 3149312
  // (body 3150848), 'last' 5248000, the end 5249024.
  const afterBig = 1536 + 3 * M
  const afterY = afterBig + 3584 + 2 * M
  const archive = cat(
    file('small', 'abc'),
    file('big', big),
    pax([['path', 'pax-name']]),
    file('x', 'xyz'),
    longPath('long-name'),
    file('y', y),
    file('last', 'end'),
    EOA,
  )
  const allPaths = ['small', 'big', 'pax-name', 'long-name', 'last']
  const skipped = [
    `read ${FIRST} 0`,
    `read ${FIRST} ${afterBig}`,
    `read 2048 ${afterY}`,
  ]

  type Shared = Pick<
    ListOptions,
    'strict' | 'maxReadSize' | 'maxMetaEntrySize' | 'codecs'
  > & { filter?: (path: string) => boolean }
  type Result = {
    found: [path: string, body?: Uint8Array][]
    warnings: [code: string, message: string][]
    error?: string
  }
  // What a consumer takes of a body: all of it, or the first part.
  type Take = (path: string) => 'all' | 'part' | undefined

  const run = async (
    result: Result,
    reads: string[] | undefined,
    work: () => unknown,
  ) => {
    try {
      await work()
    } catch (er) {
      result.error = (er as Error).message
    }
    return { ...result, reads }
  }

  const listAsync = (
    source: { file: string; fs: TarFS } | { input: Uint8Array },
    opt: Shared,
    take: Take,
    files?: string[],
  ) => {
    const result: Result = { found: [], warnings: [] }
    return run(result, undefined, () =>
      list(
        {
          ...opt,
          ...source,
          onwarn: (code, message) => result.warnings.push([code, message]),
          onEntry: async entry => {
            const t = take(entry.path)
            const part =
              t === 'all' ? await entry.bytes()
              : t === 'part' ? (await entry.body.getReader().read()).value
              : undefined
            result.found.push(part ? [entry.path, part] : [entry.path])
          },
        },
        files,
      ),
    )
  }

  const listFileSync = (
    path: string,
    fs: TarFSSync,
    opt: Shared,
    take: Take,
    files?: string[],
  ) => {
    const result: Result = { found: [], warnings: [] }
    return run(result, undefined, () =>
      listSync(
        {
          ...opt,
          file: path,
          fs,
          onwarn: (code, message) => result.warnings.push([code, message]),
          onEntry: entry => {
            const t = take(entry.path)
            const part =
              t === 'all' ? entry.bytes()
              : t === 'part' ? entry.body.next().value
              : undefined
            result.found.push(part ? [entry.path, part] : [entry.path])
          },
        },
        files,
      ),
    )
  }

  // List the data from a file, async and sync. Each must give the
  // entries, the warnings, and the error that the data gives when it
  // is all in memory. Returns them, and the reads of the file.
  const both = async (
    data: Uint8Array,
    opt: Shared = {},
    take: Take = () => undefined,
    files?: string[],
  ) => {
    const name = opt.codecs ? 'a.tar.xor' : 'a.tar'
    const path = resolve(testdir({ [name]: Buffer.from(data) }), name)
    const expect = await listAsync({ input: data }, opt, take, files)
    const a = mockFs()
    const async = await listAsync(
      { file: path, fs: a.mock },
      opt,
      take,
      files,
    )
    const s = mockFsSync()
    const sync = await listFileSync(path, s.mock, opt, take, files)
    const reads = a.calls.filter(c => c.startsWith('read'))
    assert.deepEqual(
      s.calls.filter(c => c.startsWith('read')),
      reads,
    )
    for (const actual of [async, sync]) {
      assert.deepEqual(
        actual.found.map(f => f[0]),
        expect.found.map(f => f[0]),
      )
      assert.deepEqual(actual.warnings, expect.warnings)
      assert.equal(actual.error, expect.error)
    }
    // The parts of the bodies have other sizes if all the data is in
    // memory, so the two file results are compared with each other.
    assert.equal(async.found.length, sync.found.length)
    for (const [i, [, part]] of async.found.entries()) {
      const other = sync.found[i]?.[1]
      assert.equal(!part, !other)
      if (part && other) {
        assert.equal(Buffer.from(part).equals(other), true)
      }
    }
    return { ...async, reads, paths: async.found.map(f => f[0]) }
  }

  // True if the reads are in sequence and get all the bytes from
  // `from` to `to`.
  const sequential = (reads: string[], to: number, from: number = 0) => {
    let pos = from
    for (const read of reads) {
      const [, len, at] = read.split(' ').map(Number)
      if (at !== pos) return false
      pos += len as number
    }
    return pos === to
  }

  const same = (a: Uint8Array | undefined, b: Uint8Array) =>
    !!a && Buffer.from(a).equals(b)

  test('no body is read', async () => {
    const { reads, paths, warnings } = await both(archive)
    assert.deepEqual(paths, allPaths)
    assert.deepEqual(warnings, [])
    assert.deepEqual(reads, skipped)
  })

  test('a body that onEntry reads is complete', async () => {
    const { reads, found } = await both(archive, {}, path =>
      path === 'big' || path === 'pax-name' ? 'all' : undefined,
    )
    assert.deepEqual(
      found.map(f => f[0]),
      allPaths,
    )
    assert.equal(same(found[1]?.[1], big), true)
    assert.equal(same(found[2]?.[1], Buffer.from('xyz')), true)
    // Each read is two times the size of the read before it. The
    // last of them has the first part of 'y'. The rest is skipped.
    assert.deepEqual(reads, [
      `read ${FIRST} 0`,
      `read ${2 * FIRST} ${FIRST}`,
      `read ${4 * FIRST} ${3 * FIRST}`,
      `read ${8 * FIRST} ${7 * FIRST}`,
      `read ${16 * FIRST} ${15 * FIRST}`,
      `read ${32 * FIRST} ${31 * FIRST}`,
      `read 2048 ${afterY}`,
    ])
  })

  test('the last body that onEntry reads is complete', async () => {
    const { reads, found } = await both(archive, {}, path =>
      path === 'long-name' ? 'all' : undefined,
    )
    assert.equal(same(found[3]?.[1], y), true)
    assert.deepEqual(reads.slice(0, 1), skipped.slice(0, 1))
    assert.equal(
      sequential(reads.slice(1), archive.length, afterBig),
      true,
    )
  })

  test('the rest of a body that onEntry reads in part is skipped', async () => {
    const { reads, found } = await both(archive, {}, path =>
      path === 'big' ? 'part' : undefined,
    )
    assert.equal(same(found[1]?.[1], big.subarray(0, FIRST - 1536)), true)
    assert.deepEqual(reads, skipped)
  })

  test('the body of an entry that the filter refuses', async () => {
    const { reads, paths } = await both(archive, {
      filter: path => path !== 'big' && path !== 'long-name',
    })
    assert.deepEqual(paths, ['small', 'pax-name', 'last'])
    assert.deepEqual(reads, skipped)
  })

  test('the body of an entry that the files list does not have', async () => {
    const { reads, paths } = await both(archive, {}, undefined, [
      'pax-name',
      'last',
    ])
    assert.deepEqual(paths, ['pax-name', 'last'])
    assert.deepEqual(reads, skipped)
  })

  test('a compressed file is read in full', async () => {
    const data = xorCompress(archive)
    const { reads, paths } = await both(data, { codecs: [xorCodec] })
    assert.deepEqual(paths, allPaths)
    assert.equal(sequential(reads, data.length), true)
  })

  test('small bodies are read in sequence', async () => {
    const parts: Uint8Array[] = []
    for (let i = 0; i < 400; i++) parts.push(file(`f${i}`, body(1000, i)))
    const data = cat(...parts, EOA)
    const { reads, found } = await both(data, {}, path =>
      path === 'f399' ? 'all' : undefined,
    )
    assert.equal(found.length, 400)
    assert.equal(same(found[399]?.[1], body(1000, 399)), true)
    assert.deepEqual(reads, [
      `read ${FIRST} 0`,
      `read ${2 * FIRST} ${FIRST}`,
      `read ${4 * FIRST} ${3 * FIRST}`,
      `read ${data.length - 7 * FIRST} ${7 * FIRST}`,
    ])
  })

  test('a skip is 1 MiB at least', async () => {
    // The first read has the header and 65024 bytes of the body.
    const less = cat(file('a', body(M + 65024 - 512, 3)), file('b'), EOA)
    const { reads, paths } = await both(less)
    assert.deepEqual(paths, ['a', 'b'])
    assert.equal(sequential(reads, less.length), true)
    const enough = cat(file('a', body(M + 65024, 3)), file('b'), EOA)
    assert.deepEqual((await both(enough)).reads, [
      `read ${FIRST} 0`,
      `read 1536 ${FIRST + M}`,
    ])
  })

  test('maxReadSize is the most bytes of one read', async () => {
    const { reads, paths } = await both(archive, { maxReadSize: 2048 })
    assert.deepEqual(paths, allPaths)
    assert.deepEqual(reads, [
      'read 2048 0',
      `read 2048 ${afterBig}`,
      `read 2048 ${afterBig + 2048}`,
      `read 2048 ${afterY}`,
    ])
  })

  describe('a truncated file', () => {
    for (const [name, size] of [
      ['in the first read', 1536 + 1000],
      ['after the first read', 1536 + 2 * M + 100],
      ['in the padding', afterBig - 100],
      ['in the second body', afterY - 512],
    ] as const) {
      test(`${name}: the same warning, and no skip to the end`, async () => {
        const data = archive.subarray(0, size)
        const { reads, warnings } = await both(data)
        assert.equal(warnings.length, 1)
        assert.match(warnings[0], [
          'TAR_BAD_ARCHIVE',
          /^Truncated input \(needed \d+ more bytes/,
        ])
        // All the bytes of the body that are in the file are read.
        if (size < afterBig) assert.equal(sequential(reads, size), true)
        else {
          assert.deepEqual(reads.slice(0, 1), skipped.slice(0, 1))
          assert.equal(sequential(reads.slice(1), size, afterBig), true)
        }
        const strict = await both(data, { strict: true })
        assert.match(strict.error ?? '', /Truncated input/)
      })
    }

    test('a body that ends at the end of the file is skipped', async () => {
      const { reads, paths, warnings } = await both(
        archive.subarray(0, afterBig),
      )
      assert.deepEqual(paths, ['small', 'big'])
      assert.deepEqual(warnings, [])
      assert.deepEqual(reads, skipped.slice(0, 1))
    })
  })

  test('data after the end of the archive is not read', async () => {
    const data = cat(archive, body(M, 4))
    const { reads, paths, warnings } = await both(data)
    assert.deepEqual(paths, allPaths)
    assert.deepEqual(warnings, [])
    assert.deepEqual(reads, [
      ...skipped.slice(0, 2),
      `read ${FIRST} ${afterY}`,
    ])
  })

  test('strict, and a warning after a skip', async () => {
    const bad = file('bad')
    bad[0] = 0x7a
    const data = cat(file('big', big), bad, file('ok'), EOA)
    const { reads, paths, warnings } = await both(data)
    assert.deepEqual(paths, ['big', 'ok'])
    assert.deepEqual(warnings, [['TAR_ENTRY_INVALID', 'checksum failure']])
    assert.deepEqual(reads, [
      `read ${FIRST} 0`,
      `read 2048 ${512 + 3 * M}`,
    ])
    const strict = await both(data, { strict: true })
    assert.equal(strict.error, 'TAR_ENTRY_INVALID: checksum failure')
    assert.deepEqual(strict.paths, ['big'])
    assert.deepEqual(
      (await both(archive, { strict: true })).paths,
      allPaths,
    )
  })

  test('a PAX header is read, if it is not too large', async () => {
    const header = pax([
      ['comment', body(M + M / 2, 5).map(b => 0x61 + (b % 26))],
      ['path', 'renamed'],
    ])
    const data = cat(header, file('f', 'body'), EOA)
    const size = 512 + rec('path', 'renamed').length
    assert.equal(header.length > size + M + M / 2, true)
    const read = await both(data, { maxMetaEntrySize: 2 * M })
    assert.deepEqual(read.paths, ['renamed'])
    assert.equal(sequential(read.reads, data.length), true)
    // The parser ignores a header that is too large.
    const ignored = await both(data)
    assert.deepEqual(ignored.paths, ['f'])
    assert.deepEqual(ignored.reads, [
      `read ${FIRST} 0`,
      `read 2048 ${header.length}`,
    ])
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

  test('files filter looks at each parent directory', async () => {
    const filter = filesFilter(['x', '/abs/dir', 'p//q'])
    assert.equal(filter('x/y', undefined), true)
    const deep = 'a/'.repeat(150) + 'b'
    assert.equal(filter('x/' + deep, undefined), true)
    assert.equal(filter('/abs/dir/' + deep, undefined), true)
    assert.equal(filter('y/' + deep, undefined), false)
    assert.equal(filter('/abs/' + deep, undefined), false)
    assert.equal(filter('p//q/r', undefined), true)
    assert.equal(filter('p/q/r', undefined), false)

    const input = cat(
      pax([['path', 'x/' + deep]]),
      file('f', 'deep'),
      pax([['path', 'y/' + deep]]),
      file('g'),
      EOA,
    )
    const found: string[] = []
    const onEntry = (entry: { path: string }) => found.push(entry.path)
    await list({ input, onEntry }, ['x'])
    listSync({ input, onEntry }, ['x'])
    assert.deepEqual(found, ['x/' + deep, 'x/' + deep])
  })

  test('files filter of a very long path is fast', () => {
    const filter = filesFilter(['x'])
    const long = 'a/'.repeat(500_000)
    assert.equal(filter('x/' + long + 'b', undefined), true)
    assert.equal(filter('y/' + long + 'b', undefined), false)
    assert.equal(filter('/x/' + long + 'b', undefined), false)
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

  test('maxReadSize 0 is the default', async () => {
    const data = nodeFs.readFileSync(longPaths)
    const chunks: Uint8Array[] = []
    for await (const chunk of readFile(fs, longPaths, 0))
      chunks.push(chunk)
    assert.equal(Buffer.concat(chunks).equals(data), true)
    assert.equal(
      Buffer.concat([...readFileSync(fsSync, longPaths, 0)]).equals(data),
      true,
    )

    const found: string[] = []
    const onEntry = (entry: { path: string }) => found.push(entry.path)
    await list({ file: longPaths, fs, maxReadSize: 0, onEntry })
    listSync({ file: longPaths, fs: fsSync, maxReadSize: 0, onEntry })
    assert.deepEqual(found, [...expectLong, ...expectLong])
  })

  test('a maxReadSize that is not a positive integer', async () => {
    const expect = {
      name: 'TypeError',
      message: 'maxReadSize must be a positive integer',
    }
    for (const maxReadSize of [-1, 1.5, NaN, '10' as unknown as number]) {
      assert.throws(() => readFile(fs, longPaths, maxReadSize), expect)
      assert.throws(
        () => readFileSync(fsSync, longPaths, maxReadSize),
        expect,
      )
      await assert.rejects(
        list({ file: longPaths, fs, maxReadSize }),
        expect,
      )
      assert.throws(
        () => listSync({ file: longPaths, fs: fsSync, maxReadSize }),
        expect,
      )
    }
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
