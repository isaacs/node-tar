import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import zlib from 'node:zlib'
import { assert, describe, test } from 'ubqtest'
import type { Codec, CodecStream } from '../src/codec.js'
import type {
  CreateFileHandle,
  CreateFS,
  CreateFSSync,
} from '../src/fs.js'
import type { CreateOptions, CreateOptionsSync } from '../src/options.js'
import { PackSync } from '../src/pack.js'
import type { WarnData } from '../src/warn.js'
import { WriteEntry } from '../src/write-entry.js'
import {
  collect,
  create,
  createSync,
  files,
  fixtures,
  fs,
  fsSync,
  paths,
  read,
  tars,
  tracked,
  uid,
  type Filter,
  type Options,
  type Over,
} from './create-helpers.js'
import {
  cat,
  EOA,
  file,
  fsPath,
  resolve,
  testdir,
  xorCodec,
  xorCompress,
} from './helpers.js'

const defaults = { processUid: uid, processUname: 'isaacs' }

type Opt = Options & { mode?: number; fs?: undefined }
type Input = string | WriteEntry

/** One way to call create: async or sync, to a file or not. */
type Way = {
  name: string
  sync: boolean
  toFile: boolean
  /** Make the archive, and give all its bytes. */
  run(opt: Opt, items: Input[], over?: Over): Promise<Buffer>
}

const asyncOpt = (opt: Opt, over?: Over): CreateOptions => ({
  ...defaults,
  fs: { ...fs, ...over?.async },
  ...opt,
})
const syncOpt = (opt: Opt, over?: Over): CreateOptionsSync => ({
  ...defaults,
  fs: { ...fsSync, ...over?.sync },
  ...opt,
})

const ways: Way[] = [
  {
    name: 'async, stream',
    sync: false,
    toFile: false,
    run: (opt, items, over) =>
      collect(create({ ...asyncOpt(opt, over), file: undefined }, items)),
  },
  {
    name: 'async, file',
    sync: false,
    toFile: true,
    run: async (opt, items, over) => {
      const out = resolve(testdir(), 'out.tar')
      const res = await create(
        { ...asyncOpt(opt, over), file: out },
        items,
      )
      assert.equal(res, undefined)
      return nodeFs.readFileSync(out)
    },
  },
  {
    name: 'sync, iterator',
    sync: true,
    toFile: false,
    run: async (opt, items, over) =>
      collect(
        createSync({ ...syncOpt(opt, over), file: undefined }, items),
      ),
  },
  {
    name: 'sync, file',
    sync: true,
    toFile: true,
    run: async (opt, items, over) => {
      const out = resolve(testdir(), 'out.tar')
      const res = createSync({ ...syncOpt(opt, over), file: out }, items)
      assert.equal(res, undefined)
      return nodeFs.readFileSync(out)
    },
  },
]

/** Define the test one time for each way. */
const each = (name: string, fn: (way: Way) => Promise<void>) => {
  for (const way of ways) test(`${name}: ${way.name}`, () => fn(way))
}

test('the modules of Node fit the types of fs', async () => {
  const nodeAsync: CreateFS = nodeFsPromises
  const nodeSync: CreateFSSync = nodeFs
  const out = resolve(testdir(), 'out.tar')
  await create({ file: out, cwd: files, fs: nodeAsync }, ['dir'])
  assert.deepEqual(paths(nodeFs.readFileSync(out)), ['dir/', 'dir/x'])
  createSync({ file: out, cwd: files, fs: nodeSync }, ['one-byte.txt'])
  assert.deepEqual(paths(nodeFs.readFileSync(out)), ['one-byte.txt'])
})

describe('arguments', () => {
  test('files are required', () => {
    const expect = {
      name: 'TypeError',
      message: 'no paths specified to add to archive',
    }
    assert.throws(() => create({ cwd: files, fs }, []), expect)
    assert.throws(() => createSync({ cwd: files, fs: fsSync }, []), expect)
    assert.throws(
      () => create({ cwd: files, fs }, undefined as unknown as []),
      expect,
    )
    assert.throws(
      () =>
        createSync({ file: 'x', fs: fsSync }, undefined as unknown as []),
      expect,
    )
  })

  test('a file needs fs', async () => {
    const expect = {
      name: 'TypeError',
      message: 'the file option needs the fs option',
    }
    const entry = new WriteEntry({ path: 'a' })
    // The file form of create returns a promise, so it rejects.
    await assert.rejects(create({ file: 'x.tar' }, [entry]), expect)
    assert.throws(() => createSync({ file: 'x.tar' }, [entry]), expect)
  })

  test('a path needs cwd and fs', () => {
    const expect = {
      name: 'TypeError',
      message: 'a path needs the cwd and fs options',
    }
    assert.throws(() => create({ fs }, ['a']), expect)
    assert.throws(() => create({ cwd: files }, ['@a.tar']), expect)
    assert.throws(() => createSync({ cwd: files }, ['a']), expect)
    assert.throws(() => createSync({ fs: fsSync }, ['@a.tar']), expect)
  })

  test('two kinds of compression', () => {
    const expect = { message: 'gzip, brotli are mutually exclusive' }
    assert.throws(
      () => create({ gzip: true, brotli: true }, ['a']),
      expect,
    )
    assert.throws(
      () => createSync({ gzip: true, brotli: true }, ['a']),
      expect,
    )
  })

  test('the types of the results', () => {
    const entry = new WriteEntry({ path: 'a' })
    const stream = create({}, [entry])
    assert.type<typeof stream, ReadableStream<Uint8Array>>()
    assert(stream instanceof ReadableStream)
    const iterator = createSync({}, [entry])
    assert.type<typeof iterator, IterableIterator<Uint8Array, undefined>>()
    assert(iterator instanceof PackSync)
    const promise = (f: string) => create({ file: f, fs }, [entry])
    assert.type<ReturnType<typeof promise>, Promise<void>>()
    const nothing = (f: string) =>
      createSync({ file: f, fs: fsSync }, [entry])
    assert.type<ReturnType<typeof nothing>, void>()
    const either = (opt: CreateOptions) => create(opt, [entry])
    assert.type<
      ReturnType<typeof either>,
      Promise<void> | ReadableStream<Uint8Array>
    >()
    const eitherSync = (opt: CreateOptionsSync) => createSync(opt, [entry])
    assert.type<
      ReturnType<typeof eitherSync>,
      void | IterableIterator<Uint8Array, undefined>
    >()
  })
})

describe('paths', () => {
  each('a file', async way => {
    const data = await way.run({ cwd: files }, ['one-byte.txt'])
    assert.equal(data.length, 2048)
    assert.match(read(data), [
      {
        entry: { path: 'one-byte.txt', size: 1, uname: 'isaacs' },
        body: 'a',
      },
    ])
  })

  each('a tree with large and small files', async way => {
    // Chunks of 64 KiB or more are written alone. The others are
    // written in groups of 256 KiB at most.
    const big = (n: number, char: string) => char.repeat(n)
    const tree = {
      'a-small': 'small',
      'b-big': big(70_000, 'b'),
      'c-small': 'c',
      'd-mid': big(60_000, 'd'),
      'e-mid': big(60_000, 'e'),
      'f-mid': big(60_000, 'f'),
      'g-mid': big(60_000, 'g'),
      'h-mid': big(60_000, 'h'),
      'i-edge': big(65_536 - 512, 'i'),
      'j-edge': big(65_536 - 1024, 'j'),
      'k-huge': big(300_000, 'k'),
    }
    const cwd = testdir({ tree })
    const sorted: Over = {
      async: { readdir: async p => (await fs.readdir(p)).sort() },
      sync: { readdirSync: p => fsSync.readdirSync(p).sort() },
    }
    for (const maxReadSize of [undefined, 100_000]) {
      const data = await way.run({ cwd, maxReadSize }, ['tree'], sorted)
      assert.deepEqual(
        read(data).map(f => [f.entry.path, f.body]),
        [
          ['tree/', ''],
          ...Object.entries(tree).map(([k, v]) => [`tree/${k}`, v]),
        ],
      )
    }
  })

  each('onWriteEntry changes a name', async way => {
    const cwd = testdir({ 'README.md': 'hello, world' })
    const data = await way.run(
      {
        cwd,
        onWriteEntry: entry => {
          entry.path = 'bloorg.md'
        },
      },
      ['README.md'],
    )
    assert.equal(
      data.subarray(0, 'bloorg.md'.length).toString(),
      'bloorg.md',
    )
  })

  each('entries of the caller, with no fs for them', async way => {
    const opt: Opt = way.toFile ? {} : { fs: undefined }
    const data = await way.run(opt, [
      new WriteEntry({ path: 'a.txt', mode: 0o644 }, 'hello'),
      new WriteEntry({ path: 'd', type: 'Directory', mode: 0o755 }),
    ])
    assert.match(read(data), [
      { entry: { path: 'a.txt', type: 'File' }, body: 'hello' },
      { entry: { path: 'd', type: 'Directory' } },
    ])
  })
})

describe('the archive file', () => {
  const mode = process.platform === 'win32' ? 0o666 : 0o740
  for (const way of ways.filter(w => w.toFile)) {
    test(`mode: ${way.name}`, async () => {
      const seen: unknown[] = []
      const over: Over = {
        async: {
          open: (path, flags, m) => {
            if (flags === 'w') seen.push(m)
            return nodeFsPromises.open(path, flags, m)
          },
        },
        sync: {
          openSync: (path, flags, m) => {
            if (flags === 'w') seen.push(m)
            return nodeFs.openSync(path, flags, m)
          },
        },
      }
      await way.run({ cwd: files }, ['one-byte.txt'], over)
      await way.run({ cwd: files, mode }, ['one-byte.txt'], over)
      assert.deepEqual(seen, [0o666, mode])
    })
  }

  test('the file has the mode', async () => {
    const dir = testdir()
    const a = resolve(dir, 'a.tar')
    const s = resolve(dir, 's.tar')
    await create({ file: a, cwd: files, fs, mode }, ['one-byte.txt'])
    createSync({ file: s, cwd: files, fs: fsSync, mode }, ['one-byte.txt'])
    assert.equal(nodeFs.lstatSync(a).mode & 0o7777, mode)
    assert.equal(nodeFs.lstatSync(s).mode & 0o7777, mode)
  })

  test('small chunks are written together', async () => {
    // A chunk is the header and the body of a file. Chunks of 64 KiB
    // or more are written alone. The others are written in groups
    // of 256 KiB at most.
    const cwd = testdir({
      tree: {
        'a-small': 'small',
        'b-big': 'b'.repeat(70_000),
        'c-small': 'c',
        'd-mid': 'd'.repeat(60_000),
        'e-mid': 'e'.repeat(60_000),
        'f-mid': 'f'.repeat(60_000),
        'g-mid': 'g'.repeat(60_000),
        'h-fill': 'h'.repeat(16_896),
        'i-edge': 'i'.repeat(65_536 - 512),
        'j-edge': 'j'.repeat(65_536 - 1024),
        'k-huge': 'k'.repeat(300_000),
      },
    })
    const expect = [1536, 70656, 262144, 65536, 65024, 300544, 1024]
    const out = resolve(cwd, 'out.tar')
    const lengths: number[] = []
    await create(
      {
        file: out,
        cwd,
        fs: {
          ...fs,
          readdir: async p => (await fs.readdir(p)).sort(),
          open: async (path, flags, m) => {
            const handle = await nodeFsPromises.open(path, flags, m)
            const res: CreateFileHandle = {
              read: (...a) => handle.read(...a),
              stat: () => handle.stat(),
              close: () => handle.close(),
              write: (buf, off, length) => {
                lengths.push(length)
                return handle.write(buf, off, length)
              },
            }
            return res
          },
        },
      },
      ['tree'],
    )
    assert.deepEqual(lengths, expect)
    const data = nodeFs.readFileSync(out)

    lengths.length = 0
    createSync(
      {
        file: out,
        cwd,
        fs: {
          ...fsSync,
          readdirSync: p => fsSync.readdirSync(p).sort(),
          writeSync: (fd, buf, off, length) => {
            lengths.push(length)
            return nodeFs.writeSync(fd, buf, off, length)
          },
        },
      },
      ['tree'],
    )
    assert.deepEqual(lengths, expect)
    assert.deepEqual(nodeFs.readFileSync(out), data)
    assert.equal(paths(data).length, 12)
  })

  const poop = new Error('poop')

  test('open fails', async () => {
    const out = resolve(testdir(), 'out.tar')
    const { calls, open, over } = tracked({
      async: { open: () => Promise.reject(poop) },
      sync: {
        openSync: () => {
          throw poop
        },
      },
    })
    const opt = { file: out, cwd: files }
    const er = await assert.rejects(
      create({ ...opt, fs: over.async }, ['one-byte.txt']),
      { message: 'poop' },
    )
    assert.equal(er, poop)
    assert.equal(
      assert.throws(
        () => createSync({ ...opt, fs: over.sync }, ['one-byte.txt']),
        { message: 'poop' },
      ),
      poop,
    )
    assert.throws(() => nodeFs.lstatSync(out), { code: 'ENOENT' })
    // No path is read.
    assert.deepEqual(calls, [`open ${out}`, `open ${out}`])
    assert.equal(open.size, 0)
  })

  // A file system where the archive file has its own write and close.
  const outOver = (
    out: string,
    write?: (real: () => number, length: number) => number,
    close?: () => void,
  ): Over => {
    let outFd: number | undefined
    return {
      async: {
        open: async (path, flags, m) => {
          const handle: CreateFileHandle = await nodeFsPromises.open(
            path,
            flags,
            m,
          )
          if (path !== out) return handle
          return {
            read: (...a) => handle.read(...a),
            stat: () => handle.stat(),
            write: async (buf, off, length, pos) => {
              const bytesWritten =
                write ?
                  write(
                    () =>
                      nodeFs.writeSync(
                        (handle as nodeFsPromises.FileHandle).fd,
                        buf,
                        off,
                        Math.ceil(length / 3),
                      ),
                    length,
                  )
                : (await handle.write(buf, off, length, pos)).bytesWritten
              return { bytesWritten }
            },
            close: async () => {
              await handle.close()
              close?.()
            },
          }
        },
      },
      sync: {
        openSync: (path, flags, m) => {
          const fd = nodeFs.openSync(path, flags, m)
          if (path === out) outFd = fd
          return fd
        },
        writeSync: (fd, buf, off, length) =>
          write ?
            write(
              () => nodeFs.writeSync(fd, buf, off, Math.ceil(length / 3)),
              length,
            )
          : nodeFs.writeSync(fd, buf, off, length),
        closeSync: fd => {
          nodeFs.closeSync(fd)
          if (fd === outFd) close?.()
        },
      },
    }
  }
  const fileWays = [
    {
      name: 'async',
      run: async (out: string, over: Over, opt: Opt = {}) =>
        create(
          { ...opt, file: out, cwd: files, fs: over.async as CreateFS },
          ['dir', '1024-bytes.txt', 'long-path'],
        ),
    },
    {
      name: 'sync',
      run: async (out: string, over: Over, opt: Opt = {}) =>
        createSync(
          { ...opt, file: out, cwd: files, fs: over.sync as CreateFSSync },
          ['dir', '1024-bytes.txt', 'long-path'],
        ),
    },
  ]

  for (const { name, run } of fileWays) {
    test(`a write that writes a part of the data: ${name}`, async () => {
      const out = resolve(testdir(), 'out.tar')
      let writes = 0
      const { open, over } = tracked(
        outOver(out, real => {
          writes++
          return real()
        }),
      )
      await run(out, over)
      assert.greaterThan(writes, 5)
      assert.equal(open.size, 0)
      const data = nodeFs.readFileSync(out)
      assert.equal(paths(data).length, 32)
      assert.equal(data.length, 512 * 5 + 21504)
    })

    test(`write fails: ${name}`, async () => {
      const out = resolve(testdir(), 'out.tar')
      for (const maxReadSize of [undefined, 512]) {
        const { open, over } = tracked(
          outOver(out, () => {
            throw poop
          }),
        )
        const er = await assert.rejects(run(out, over, { maxReadSize }), {
          message: 'poop',
        })
        assert.equal(er, poop)
        assert.equal(open.size, 0)
      }
    })

    test(`close fails: ${name}`, async () => {
      const out = resolve(testdir(), 'out.tar')
      const { open, over } = tracked(
        outOver(out, undefined, () => {
          throw poop
        }),
      )
      const er = await assert.rejects(run(out, over), { message: 'poop' })
      assert.equal(er, poop)
      assert.equal(open.size, 0)
    })

    test(`write fails, then close fails: ${name}`, async () => {
      const out = resolve(testdir(), 'out.tar')
      const first = new Error('first')
      const { open, over } = tracked(
        outOver(
          out,
          () => {
            throw first
          },
          () => {
            throw poop
          },
        ),
      )
      const er = await assert.rejects(run(out, over), { message: 'first' })
      assert.equal(er, first)
      assert.equal(open.size, 0)
    })

    test(`a path that fails closes the archive file: ${name}`, async () => {
      const out = resolve(testdir(), 'out.tar')
      const { open, over } = tracked()
      await assert.rejects(run(resolve(out, 'not/a/dir.tar'), over), {
        code: 'ENOENT',
      })
      const fail = name === 'async' ? create : createSync
      await assert.rejects(
        (async () =>
          (fail as typeof createSync)(
            {
              file: out,
              cwd: files,
              fs: (name === 'async' ?
                over.async
              : over.sync) as CreateFSSync,
            },
            ['dir', 'missing'],
          ))(),
        { code: 'ENOENT', syscall: 'lstat' },
      )
      assert.equal(open.size, 0)
    })
  }
})

describe('an @archive operand', () => {
  const operands = ['@dir.tar', '@utf8.tar', '@links.tar']
  const expect = [
    ['dir/', 'Directory'],
    ['Ω.txt', 'File'],
    ['🌟.txt', 'File'],
    [
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
      'File',
    ],
    ['hardlink-1', 'File'],
    ['hardlink-2', 'Link'],
    ['symlink', 'SymbolicLink'],
  ]
  const list = (data: Uint8Array) =>
    read(data).map(f => [f.entry.path, f.entry.type])

  each('the entries of each archive are added', async way => {
    const { open, over } = tracked()
    const data = await way.run({ cwd: tars }, operands, over)
    assert.deepEqual(list(data), expect)
    assert.equal(open.size, 0)
  })

  each('the filter and the options apply to the entries', async way => {
    const seen: string[] = []
    const filter: Filter = (path, entry) => {
      seen.push(`${entry.constructor.name} ${path}`)
      return !path.startsWith('hardlink')
    }
    const data = await way.run(
      {
        cwd: fixtures,
        filter,
        prefix: 'pre',
        portable: true,
        maxReadSize: 1000,
      },
      ['@tars/links.tar', 'files/dir', '@tars/dir.tar'],
    )
    const kind = way.sync ? 'ReadEntrySync' : 'ReadEntry'
    assert.deepEqual(seen, [
      `${kind} hardlink-1`,
      `${kind} hardlink-2`,
      `${kind} symlink`,
      'Stats files/dir',
      ...(way.sync ? ['Stats files/dir/x'] : []),
      `${kind} dir/`,
      ...(way.sync ? [] : ['Stats files/dir/x']),
    ])
    assert.match(
      read(data).map(f => [f.entry.path, f.entry.linkpath, f.entry.uid]),
      way.sync ?
        [
          ['pre/symlink', 'hardlink-2', undefined],
          ['pre/files/dir/', undefined, undefined],
          ['pre/files/dir/x', undefined, undefined],
          ['pre/dir/', undefined, undefined],
        ]
      : [
          ['pre/symlink', 'hardlink-2', undefined],
          ['pre/files/dir/', undefined, undefined],
          ['pre/dir/', undefined, undefined],
          ['pre/files/dir/x', undefined, undefined],
        ],
    )
  })

  each('an archive that does not exist', async way => {
    const { open, over } = tracked()
    const er = await assert.rejects(
      way.run({ cwd: files }, ['dir', '@nonexistent.tar', 'dir'], over),
      { code: 'ENOENT' },
    )
    assert.match<unknown>(er, {
      path: fsPath(resolve(files, 'nonexistent.tar')),
    })
    assert.equal(open.size, 0)
  })

  each('a compressed archive', async way => {
    const tar = cat(file('a.txt', 'alpha'), file('b.txt', 'beta'), EOA)
    const cwd = testdir({
      'x.tgz': zlib.gzipSync(tar),
      'x.xor': Buffer.from(xorCompress(tar)),
    })
    const unzip: Codec = {
      name: 'gunzip',
      headLength: 2,
      detect: head => head[0] === 0x1f && head[1] === 0x8b,
      decompress: () => new DecompressionStream('gzip') as CodecStream,
      decompressSync: data => zlib.gunzipSync(data),
    }
    const data = await way.run({ cwd, codecs: [xorCodec, unzip] }, [
      '@x.tgz',
      '@x.xor',
    ])
    assert.deepEqual(paths(data), ['a.txt', 'b.txt', 'a.txt', 'b.txt'])
  })

  each('a warning of the archive goes to onwarn', async way => {
    const cwd = testdir({
      'bad.tar': Buffer.from(
        cat(file('a.txt', 'alpha'), new Uint8Array(512).fill(120), EOA),
      ),
    })
    const warnings: [string, string, WarnData][] = []
    const data = await way.run(
      { cwd, onwarn: (c, m, d) => warnings.push([c, m, d]) },
      ['@bad.tar'],
    )
    assert.deepEqual(paths(data), ['a.txt'])
    assert.match<unknown>(warnings, [
      [
        'TAR_ENTRY_INVALID',
        'checksum failure',
        { file: resolve(cwd, 'bad.tar') },
      ],
    ])
    await assert.rejects(way.run({ cwd, strict: true }, ['@bad.tar']), {
      tarCode: 'TAR_ENTRY_INVALID',
    })
  })

  each('an archive that ends in the body of an entry', async way => {
    const cwd = testdir({
      'cut.tar': Buffer.from(
        cat(file('a.txt', 'a'.repeat(2000))).subarray(0, 1024),
      ),
    })
    const { open, over } = tracked()
    await assert.rejects(way.run({ cwd }, ['@cut.tar'], over), {
      message: 'encountered unexpected EOF',
      path: 'a.txt',
    })
    assert.equal(open.size, 0)
  })

  each('win32: a \\ in the name of the archive', async way => {
    const data = await way.run({ cwd: fixtures, platform: 'win32' }, [
      '@tars\\dir.tar',
    ])
    assert.deepEqual(paths(data), ['dir/'])
  })
})

describe('compression', () => {
  test('gzip to a stream and to a file', async () => {
    const out = resolve(testdir(), 'out.tgz')
    const opt = { cwd: files, fs, gzip: true, portable: true }
    const stream = await collect(create(opt, ['dir', 'long-path']))
    await create({ ...opt, file: out }, ['dir', 'long-path'])
    const fromFile = nodeFs.readFileSync(out)
    for (const zipped of [stream, fromFile]) {
      assert.equal(zipped[9], 255)
      assert.equal(zlib.gunzipSync(zipped).length, 512 * 2 + 21504)
    }
    assert.deepEqual(zlib.gunzipSync(stream), zlib.gunzipSync(fromFile))
  })

  test('the name of the file selects no compression', async () => {
    const out = resolve(testdir(), 'out.tgz')
    await create({ cwd: files, fs, file: out }, ['dir'])
    createSync(
      { cwd: files, fs: fsSync, file: out + '.xor', codecs: [xorCodec] },
      ['dir'],
    )
    assert.deepEqual(paths(nodeFs.readFileSync(out)), ['dir/', 'dir/x'])
    assert.deepEqual(paths(nodeFs.readFileSync(out + '.xor')), [
      'dir/',
      'dir/x',
    ])
  })

  test('a large tree, with gzip, to a slow consumer', async () => {
    const cwd = resolve(fixtures, '..')
    const plain = await collect(create({ cwd, fs }, ['fixtures']))
    const reader = create({ cwd, fs, gzip: true }, [
      'fixtures',
    ]).getReader()
    const parts: Uint8Array[] = []
    for (let n = 0; ; n++) {
      if (n % 20 === 0) await new Promise(res => setTimeout(res, 1))
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }
    const data = zlib.gunzipSync(Buffer.concat(parts))
    assert.greaterThan(data.length, 1_000_000)
    assert(data.equals(plain))
  })

  each('a codec of the caller', async way => {
    const opt = { cwd: files, compress: xorCodec }
    const plain = await way.run({ cwd: files }, ['dir'])
    const zipped = await way.run(opt, ['dir'])
    assert.deepEqual(zipped, Buffer.from(xorCompress(plain)))
  })
})

describe('the stream reads files on demand', () => {
  test('async', async () => {
    const { calls, open, over } = tracked()
    const cwd = testdir({ a: 'a'.repeat(3000), b: 'b'.repeat(3000) })
    const stream = create(
      { cwd, fs: over.async, maxReadSize: 1024, jobs: 1 },
      ['a', 'b'],
    )
    await new Promise(res => setTimeout(res, 50))
    assert.deepEqual(calls, [])
    const reader = stream.getReader()
    assert.equal((await reader.read()).value?.length, 512)
    await new Promise(res => setTimeout(res, 50))
    assert.deepEqual(calls, [
      `lstat ${resolve(cwd, 'a')}`,
      `open ${resolve(cwd, 'a')}`,
    ])
    assert.equal(open.size, 1)
    await reader.cancel()
    assert.equal(open.size, 0)
    assert.equal(calls.length, 2)
  })

  test('an error of a path is the error of the stream', async () => {
    const stream = create({ cwd: files, fs }, ['@nonexistent.tar'])
    const reader = stream.getReader()
    await assert.rejects(reader.read(), { code: 'ENOENT' })
    await assert.rejects(reader.read(), { code: 'ENOENT' })
  })

  test('sync', () => {
    const { calls, open, over } = tracked()
    const cwd = testdir({ a: 'a'.repeat(3000), b: 'b'.repeat(3000) })
    const iterator = createSync(
      { cwd, fs: over.sync, maxReadSize: 1024 },
      ['a', 'b'],
    )
    assert.deepEqual(calls, [])
    assert.equal(iterator.next().value?.length, 512)
    assert.equal(open.size, 1)
    assert.equal(calls.length, 2)
    iterator.return?.()
    assert.equal(open.size, 0)
    assert.equal(calls.length, 2)
  })
})
