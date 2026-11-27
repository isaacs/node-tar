import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import zlib from 'node:zlib'
import { assert, describe, test } from 'ubqtest'
import type { CreateFileHandle } from '../src/fs.js'
import { AppendScan } from '../src/replace.js'
import {
  fs,
  fsSync,
  mtime as pinned,
  pin,
  stats,
  read,
  replace,
  replaceSync,
  tars,
  tracked,
  update,
  updateSync,
  type Options,
  type Over,
} from './create-helpers.js'
import {
  cat,
  ent,
  EOA,
  file as fileEntry,
  hdr,
  longPath,
  pax,
  resolve,
  testdir,
  xorCodec,
  xorCompress,
} from './helpers.js'

type Opt = Options & {
  file: string
  mode?: number
  mtimeCache?: Map<string, Date>
}
type Run = (opt: Opt, files: string[], over?: Over) => Promise<void>
type Mode = { name: 'async' | 'sync'; replace: Run; update: Run }

const modes: Mode[] = [
  {
    name: 'async',
    replace: (opt, files, over) =>
      replace({ ...opt, fs: { ...fs, ...over?.async } }, files),
    update: (opt, files, over) =>
      update({ ...opt, fs: { ...fs, ...over?.async } }, files),
  },
  {
    name: 'sync',
    replace: async (opt, files, over) =>
      replaceSync({ ...opt, fs: { ...fsSync, ...over?.sync } }, files),
    update: async (opt, files, over) =>
      updateSync({ ...opt, fs: { ...fsSync, ...over?.sync } }, files),
  },
]

const each = (name: string, fn: (mode: Mode) => Promise<void>) => {
  for (const mode of modes) test(`${name}: ${mode.name}`, () => fn(mode))
}

const data = nodeFs.readFileSync(tars + '/body-byte-counts.tar')
const dataNoNulls = data.subarray(0, data.length - 1024)
const bodyByteCounts = [
  '1024-bytes.txt',
  '512-bytes.txt',
  'one-byte.txt',
  'zero-byte.txt',
]

// Make a folder with the archive `a.tar` and the file `new.txt`.
const fixture = (archive?: Uint8Array, name: string = 'a.tar') => {
  const cwd = testdir({
    'new.txt': 'new',
    ...(archive ? { [name]: Buffer.from(archive) } : undefined),
  })
  return { cwd, file: resolve(cwd, name) }
}

// The path and the body of each entry of the archive file.
const found = (file: string) =>
  read(nodeFs.readFileSync(file)).map(({ entry, body }) => [
    entry.path,
    body,
  ])
const pathsOf = (file: string) => found(file).map(([path]) => path)

// A file system that records the offset and the length of each read
// of the file with this path.
const readSpy = (path: string) => {
  const reads: [position: number, length: number][] = []
  let fd: number | undefined
  const over: Over = {
    async: {
      open: async (p, flags, mode) => {
        const handle: CreateFileHandle = await nodeFsPromises.open(
          p,
          flags,
          mode,
        )
        if (p !== path) return handle
        return {
          stat: () => handle.stat(),
          write: (...a) => handle.write(...a),
          close: () => handle.close(),
          read: (buf, off, length, position) => {
            reads.push([position, length])
            return handle.read(buf, off, length, position)
          },
        }
      },
    },
    sync: {
      openSync: (p, flags, mode) => {
        const opened = nodeFs.openSync(p, flags, mode)
        if (p === path) fd = opened
        return opened
      },
      readSync: (f, buf, off, length, position) => {
        if (f === fd) reads.push([position, length])
        return nodeFs.readSync(f, buf, off, length, position)
      },
    },
  }
  return { reads, over }
}

describe('add a file to an archive', () => {
  const archives: [string, Uint8Array][] = [
    ['complete', data],
    ['no null blocks at the end', dataNoNulls],
    ['truncated header', cat(dataNoNulls, data.subarray(0, 500))],
    ['truncated body', cat(dataNoNulls, data.subarray(0, 700))],
  ]
  for (const [name, archive] of archives) {
    each(name, async mode => {
      const { cwd, file } = fixture(archive)
      await mode.replace({ file, cwd }, ['new.txt'])
      assert.deepEqual(pathsOf(file), [...bodyByteCounts, 'new.txt'])
      // The new entry is after the last complete entry, and the
      // archive ends after it.
      assert.equal(
        nodeFs.statSync(file).size,
        dataNoNulls.length + 512 + 512 + 1024,
      )
    })
  }
})

describe('add a file to an empty archive', () => {
  const archives: [string, Uint8Array | undefined][] = [
    ['one null block', new Uint8Array(512)],
    ['no bytes', new Uint8Array(0)],
    ['two null blocks', EOA],
    ['no file', undefined],
  ]
  for (const [name, archive] of archives) {
    each(name, async mode => {
      const { cwd, file } = fixture(archive)
      await mode.replace({ file, cwd }, ['new.txt'])
      assert.deepEqual(found(file), [['new.txt', 'new']])
      assert.equal(nodeFs.statSync(file).size, 512 + 512 + 1024)
    })
  }

  const mode = process.platform === 'win32' ? 0o666 : 0o640
  each('a new archive file has the mode of the options', async m => {
    const { cwd, file } = fixture()
    await m.replace({ file, cwd, mode }, ['new.txt'])
    assert.equal(nodeFs.statSync(file).mode & 0o777, mode)
  })
})

describe('a compressed archive is refused', () => {
  const message = 'cannot append to compressed archives'

  each('a compression option', async mode => {
    const { cwd, file } = fixture(data)
    for (const opt of [{ gzip: true }, { brotli: true }, { zstd: true }]) {
      await assert.rejects(
        mode.replace({ file, cwd, ...opt }, ['new.txt']),
        { name: 'TypeError', message },
      )
      await assert.rejects(
        mode.update({ file, cwd, ...opt }, ['new.txt']),
        { name: 'TypeError', message },
      )
    }
    assert.deepEqual(nodeFs.readFileSync(file), data)
  })

  each('the compress option', async mode => {
    const { cwd, file } = fixture(data)
    const opt = { file, cwd, compress: xorCodec }
    await assert.rejects(mode.replace(opt, ['new.txt']), {
      name: 'TypeError',
      message,
    })
    assert.deepEqual(nodeFs.readFileSync(file), data)
  })

  each('a file name that ends in .tbr or .br', async mode => {
    for (const name of ['a.tbr', 'a.tar.br']) {
      const { cwd, file } = fixture(data, name)
      await assert.rejects(mode.replace({ file, cwd }, ['new.txt']), {
        name: 'TypeError',
        message,
      })
      assert.deepEqual(nodeFs.readFileSync(file), data)
    }
  })

  each('a gzip file', async mode => {
    const gz = zlib.gzipSync(data)
    const { cwd, file } = fixture(gz)
    const { open, over } = tracked()
    await assert.rejects(mode.replace({ file, cwd }, ['new.txt'], over), {
      name: 'Error',
      message,
    })
    assert.equal(open.size, 0)
    assert.deepEqual(nodeFs.readFileSync(file), gz)
  })

  each('a file in the format of a codec of the caller', async mode => {
    const x = xorCompress(data)
    const { cwd, file } = fixture(x)
    await assert.rejects(
      mode.replace({ file, cwd, codecs: [xorCodec] }, ['new.txt']),
      { name: 'Error', message },
    )
    assert.deepEqual(new Uint8Array(nodeFs.readFileSync(file)), x)
  })
})

describe('bad arguments', () => {
  each('no file', async mode => {
    await assert.rejects(mode.replace({ file: '' }, ['asdf']), {
      name: 'TypeError',
      message: 'file is required',
    })
  })

  each('no paths', async mode => {
    await assert.rejects(mode.replace({ file: 'asdf' }, []), {
      name: 'TypeError',
      message: 'no paths specified to add/replace',
    })
  })
})

describe('a failure goes to the caller, and no file stays open', () => {
  const poop = new Error('poop')

  each('open fails', async mode => {
    const { cwd, file } = fixture(data)
    const { open, over } = tracked({
      async: { open: () => Promise.reject(poop) },
      sync: {
        openSync: () => {
          throw poop
        },
      },
    })
    const er = await assert.rejects(
      mode.replace({ file, cwd }, ['new.txt'], over),
      Error,
    )
    assert.equal(er, poop)
    assert.equal(open.size, 0)
  })

  each('stat of the archive fails', async mode => {
    const { cwd, file } = fixture(data)
    const { open, over } = tracked({
      async: {
        open: async (...a) => {
          const handle = await fs.open(...a)
          return {
            read: (...r) => handle.read(...r),
            write: (...w) => handle.write(...w),
            close: () => handle.close(),
            stat: (): Promise<never> => Promise.reject(poop),
          }
        },
      },
      sync: {
        fstatSync: () => {
          throw poop
        },
      },
    })
    const er = await assert.rejects(
      mode.replace({ file, cwd }, ['new.txt'], over),
      Error,
    )
    assert.equal(er, poop)
    assert.equal(open.size, 0)
  })

  each('read of the archive fails', async mode => {
    const { cwd, file } = fixture(data)
    const { open, over } = tracked({
      async: {
        open: async (...a) => {
          const handle = await fs.open(...a)
          return {
            read: () => Promise.reject(poop),
            write: (...w) => handle.write(...w),
            close: () => handle.close(),
            stat: () => handle.stat(),
          }
        },
      },
      sync: {
        readSync: () => {
          throw poop
        },
      },
    })
    const er = await assert.rejects(
      mode.replace({ file, cwd }, ['new.txt'], over),
      Error,
    )
    assert.equal(er, poop)
    assert.equal(open.size, 0)
    assert.deepEqual(nodeFs.readFileSync(file), data)
  })

  each('close fails after a failure: the first error', async mode => {
    const { cwd, file } = fixture(zlib.gzipSync(data))
    const over: Over = {
      async: {
        open: async (...a) => {
          const handle = await fs.open(...a)
          return {
            read: (...r) => handle.read(...r),
            write: (...w) => handle.write(...w),
            stat: () => handle.stat(),
            close: async () => {
              await handle.close()
              throw poop
            },
          }
        },
      },
      sync: {
        closeSync: fd => {
          nodeFs.closeSync(fd)
          throw poop
        },
      },
    }
    await assert.rejects(mode.replace({ file, cwd }, ['new.txt'], over), {
      message: 'cannot append to compressed archives',
    })
  })

  each('a path to add that does not exist', async mode => {
    const { cwd, file } = fixture(data)
    const { open, over } = tracked()
    await assert.rejects(
      mode.replace({ file, cwd, strict: true }, ['missing'], over),
      { code: 'ENOENT', tarCode: 'TAR_ENTRY_ERROR' },
    )
    assert.equal(open.size, 0)
    // The archive is still complete.
    assert.deepEqual(pathsOf(file), bodyByteCounts)

    // Without strict, it is a warning, and the other paths are added.
    const warnings: string[][] = []
    await mode.replace(
      {
        file,
        cwd,
        onwarn: (code, message) => warnings.push([code, message]),
      },
      ['missing', 'new.txt'],
      over,
    )
    assert.equal(open.size, 0)
    assert.match(warnings, [['TAR_ENTRY_ERROR', /^ENOENT/]])
    assert.deepEqual(pathsOf(file).slice(bodyByteCounts.length), [
      'new.txt',
    ])
  })

  each('an @archive operand that does not exist', async mode => {
    const { cwd, file } = fixture(data)
    const { open, over } = tracked()
    await assert.rejects(
      mode.replace({ file, cwd }, ['@missing.tar'], over),
      { code: 'ENOENT' },
    )
    assert.equal(open.size, 0)
  })

  each('a header with a size that is not a safe integer', async mode => {
    const block = Buffer.from(hdr({ path: 'x', type: 'File', size: 0 }))
    // a base-256 size that is too large, with a correct checksum
    block[124] = 0x80
    block.fill(0x7f, 125, 136)
    block.fill(' ', 148, 156)
    const sum = block.reduce((a, b) => a + b, 0)
    block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    const archive = cat(block, EOA)
    const { cwd, file } = fixture(archive)
    const { open, over } = tracked()
    await assert.rejects(mode.replace({ file, cwd }, ['new.txt'], over), {
      message: 'parsed number outside of javascript safe integer range',
    })
    assert.equal(open.size, 0)
    assert.deepEqual(new Uint8Array(nodeFs.readFileSync(file)), archive)
  })
})

describe('mtime cache', () => {
  each('gets the mtime of each entry of the archive', async mode => {
    const { cwd, file } = fixture(data)
    const mtimeCache = new Map<string, Date>()
    await mode.replace({ file, cwd, mtimeCache }, ['new.txt'])
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

  each('not of an entry that is not complete', async mode => {
    const { cwd, file } = fixture(
      cat(fileEntry('a', 'aaa'), hdr({ path: 'b', size: 2000 })),
    )
    const mtimeCache = new Map<string, Date>()
    await mode.replace({ file, cwd, mtimeCache }, ['new.txt'])
    assert.deepEqual([...mtimeCache.keys()], [])
    assert.deepEqual(pathsOf(file), ['a', 'new.txt'])
  })
})

describe('the entries of another archive', () => {
  each('@archive', async mode => {
    const dir = testdir({
      'out.tar': nodeFs.readFileSync(resolve(tars, 'dir.tar')),
    })
    const file = resolve(dir, 'out.tar')
    await mode.replace({ file, cwd: tars }, ['@utf8.tar'])
    assert.deepEqual(pathsOf(file), [
      'dir/',
      'Ω.txt',
      '🌟.txt',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
    ])
  })
})

describe('where the new entries go', () => {
  each('an entry with no size field', async mode => {
    const block = hdr({ path: 'x', type: 'File' })
    block.fill(0, 124, 136)
    block.fill(0x20, 148, 156)
    const sum = block.reduce((a, b) => a + b, 0)
    block.set(Buffer.from(sum.toString(8).padStart(6, '0') + '\0 '), 148)
    const { cwd, file } = fixture(cat(block, EOA))
    await mode.replace({ file, cwd }, ['new.txt'])
    assert.deepEqual(pathsOf(file), ['x', 'new.txt'])
  })

  each('a PAX size that is not the size of the header', async mode => {
    const body = 'x'.repeat(1024)
    const archive = cat(
      pax([['size', '1024']]),
      hdr({ path: 'big', type: 'File', size: 0 }),
      Buffer.from(body),
      fileEntry('after', 'after'),
      EOA,
    )
    const { cwd, file } = fixture(archive)
    await mode.replace({ file, cwd }, ['new.txt'])
    assert.deepEqual(found(file), [
      ['big', body],
      ['after', 'after'],
      ['new.txt', 'new'],
    ])
    assert.equal(nodeFs.statSync(file).size, archive.length + 1024)
  })

  const last = fileEntry('a', 'aaa')
  const dangling: [string, Uint8Array][] = [
    ['a PAX header', pax([['path', 'hijack']])],
    ['a global PAX header', pax([['uname', 'hijack']], true)],
    ['a GNU long path', longPath('hijack')],
    [
      'a PAX header with no body',
      hdr({ path: 'p', type: 'ExtendedHeader' }),
    ],
  ]
  for (const [name, meta] of dangling) {
    each(`${name} with no entry after it`, async mode => {
      for (const end of [new Uint8Array(0), EOA]) {
        const { cwd, file } = fixture(cat(last, meta, end))
        await mode.replace({ file, cwd }, ['new.txt'])
        assert.match(read(nodeFs.readFileSync(file)), [
          { entry: { path: 'a' }, body: 'aaa' },
          { entry: { path: 'new.txt', uname: '' }, body: 'new' },
        ])
        // The new entry is in the place of the header.
        const bytes = nodeFs.readFileSync(file)
        assert.equal(
          bytes.subarray(last.length, last.length + 7).toString(),
          'new.txt',
        )
      }
    })
  }

  each('a block that is not a header', async mode => {
    const junk = new Uint8Array(512).fill(0x61)
    const { cwd, file } = fixture(
      cat(fileEntry('a', 'aaa'), junk, fileEntry('b', 'bbb'), EOA),
    )
    await mode.replace({ file, cwd }, ['new.txt'])
    assert.deepEqual(pathsOf(file).slice(0, 2), ['a', 'new.txt'])
    assert.equal(
      nodeFs.readFileSync(file).subarray(1024, 1031).toString(),
      'new.txt',
    )
  })

  each('one null block before an entry', async mode => {
    const { cwd, file } = fixture(
      cat(
        fileEntry('a', 'aaa'),
        new Uint8Array(512),
        fileEntry('b', 'bbb'),
        EOA,
      ),
    )
    await mode.replace({ file, cwd }, ['new.txt'])
    assert.deepEqual(pathsOf(file).slice(0, 2), ['a', 'new.txt'])
  })

  each('a header that is not valid, after a PAX header', async mode => {
    const { cwd, file } = fixture(
      cat(
        fileEntry('a', 'aaa'),
        pax([['path', 'p']]),
        // a symbolic link needs a linkpath
        hdr({ path: 'link', type: 'SymbolicLink' }),
        EOA,
      ),
    )
    await mode.replace({ file, cwd }, ['new.txt'])
    assert.deepEqual(pathsOf(file), ['a', 'new.txt'])
  })
})

describe('the archive is read in chunks, without the bodies', () => {
  const big = 200_000
  const small = 70_000
  const archive = cat(
    fileEntry('big', 'b'.repeat(big)),
    fileEntry('small', 's'.repeat(small)),
    pax([['path', 'a-long-name']]),
    fileEntry('x', 'xxx'),
    EOA,
  )

  each('reads', async mode => {
    const { cwd, file } = fixture(archive)
    const { reads, over } = readSpy(file)
    await mode.replace({ file, cwd }, ['new.txt'], over)
    assert.deepEqual(
      found(file).map(([path, body]) => [path, body?.length]),
      [
        ['big', big],
        ['small', small],
        ['a-long-name', 3],
        ['new.txt', 3],
      ],
    )
    const bigEnd = 512 + 512 * Math.ceil(big / 512)
    const smallEnd = bigEnd + 512 + 512 * Math.ceil(small / 512)
    assert.deepEqual(reads, [
      [0, 65536],
      [bigEnd, 65536],
      [smallEnd, archive.length - smallEnd],
    ])
  })

  each('a file that is shorter than its size', async mode => {
    const { cwd, file } = fixture(archive)
    const over: Over = {
      async: {
        open: async (...a) => {
          const handle = await fs.open(...a)
          return {
            read: async (buf, off, length, position) =>
              position === 0 ?
                handle.read(buf, off, length, position)
              : { bytesRead: 0 },
            write: (...w) => handle.write(...w),
            close: () => handle.close(),
            stat: () => handle.stat(),
          }
        },
      },
      sync: {
        readSync: (fd, buf, off, length, position) =>
          position === 0 ?
            nodeFs.readSync(fd, buf, off, length, position)
          : 0,
      },
    }
    await mode.replace({ file, cwd }, ['new.txt'], over)
    assert.deepEqual(pathsOf(file).slice(0, 2), ['big', 'new.txt'])
  })
})

describe('AppendScan', () => {
  test('the place after each push', () => {
    const archive = cat(
      ent({ path: 'a', type: 'File', mtime: pinned }, 'aaa'),
      ent({ path: 'b', type: 'File', mtime: pinned }, 'b'.repeat(2000)),
      EOA,
    )
    const mtimes = new Map<string, Date>()
    const scan = new AppendScan(archive.length, undefined, mtimes)
    assert.equal(scan.want, archive.length)
    assert.equal(scan.position, 0)
    // the entry "a", and the header of "b"
    scan.buf.set(archive.subarray(0, 1536))
    assert.equal(scan.push(1536), true)
    // The scan does not need the body of "b".
    assert.equal(scan.pos, 1536 + 2048)
    assert.equal(scan.position, 1536 + 2048)
    assert.equal(scan.want, 1024)
    scan.buf.set(archive.subarray(scan.pos))
    assert.equal(scan.push(1024), false)
    assert.equal(scan.position, 1536 + 2048)
    assert.deepEqual([...mtimes.keys()], ['a', 'b'])
  })
})

describe('update', () => {
  const old = new Date('1997-04-10T16:57:47.000Z')
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
  // The file systems of the helpers give each file the same mtime.
  // Give the files of this test the mtime of the map.
  const withMtimes = (mtimes: Record<string, Date>): Over => {
    return stats((stat, path) => {
      const name = Object.keys(mtimes).find(n => path.endsWith('/' + n))
      return Object.assign(pin(stat), name && { mtime: mtimes[name] })
    })
  }
  const updateFixture = () => {
    const cwd = testdir({
      'a.tar': data,
      '1024-bytes.txt': '.'.repeat(1024),
      foo: 'foo',
    })
    return { cwd, file: resolve(cwd, 'a.tar') }
  }

  each('a file that is older than its entry is not added', async mode => {
    const { cwd, file } = updateFixture()
    await mode.update(
      { file, cwd },
      ['1024-bytes.txt'],
      withMtimes({ '1024-bytes.txt': old }),
    )
    assert.deepEqual(nodeFs.readFileSync(file), data)
  })

  each('a file that is newer than its entry is added', async mode => {
    const { cwd, file } = updateFixture()
    const mtimeCache = new Map<string, Date>()
    await mode.update(
      { file, cwd, mtimeCache },
      ['1024-bytes.txt'],
      withMtimes({ '1024-bytes.txt': future }),
    )
    assert.equal(nodeFs.statSync(file).size, data.length + 512 + 1024)
    assert.deepEqual(pathsOf(file), [...bodyByteCounts, '1024-bytes.txt'])
    // The cache of the caller gets the entries.
    assert.equal(mtimeCache.size, 4)
  })

  // 2001-09-09T01:46:40Z
  const at = 1_000_000_000_000
  const entry = ent(
    { path: 'f.txt', type: 'File', mtime: new Date(at) },
    'x',
  )
  const ustar = cat(entry, EOA)
  const withPax = cat(pax([['mtime', '1000000000.25']]), entry, EOA)
  const times: [string, Uint8Array, number, boolean][] = [
    ['later in the second of a ustar time', ustar, at + 999, false],
    ['the second after a ustar time', ustar, at + 1000, true],
    ['the same PAX time', withPax, at + 250, false],
    ['one millisecond after a PAX time', withPax, at + 251, true],
  ]
  for (const [name, archive, time, added] of times) {
    each(`a file ${name} is ${added ? '' : 'not '}added`, async mode => {
      const cwd = testdir({
        'a.tar': Buffer.from(archive),
        'f.txt': 'new',
      })
      const file = resolve(cwd, 'a.tar')
      await mode.update(
        { file, cwd },
        ['f.txt'],
        withMtimes({ 'f.txt': new Date(time) }),
      )
      assert.deepEqual(
        pathsOf(file),
        added ? ['f.txt', 'f.txt'] : ['f.txt'],
      )
    })
  }

  for (const arg of ['dir', 'dir/']) {
    each(`a changed file in the directory ${arg}`, async mode => {
      const root = testdir({
        tree: { dir: { a: 'a', b: 'b', sub: { c: 'c' } } },
      })
      const cwd = resolve(root, 'tree')
      const file = resolve(root, 'a.tar')
      await mode.replace({ file, cwd }, [arg])
      const all = ['dir/', 'dir/a', 'dir/b', 'dir/sub/', 'dir/sub/c']
      assert.deepEqual(pathsOf(file), all)

      // No time changed: only the directories are added again.
      await mode.update({ file, cwd }, [arg])
      assert.deepEqual(pathsOf(file), [...all, 'dir/', 'dir/sub/'])

      // The times of the directories did not change.
      nodeFs.writeFileSync(file, '')
      await mode.replace({ file, cwd }, [arg])
      await mode.update(
        { file, cwd },
        [arg],
        withMtimes({ a: future, c: future }),
      )
      assert.deepEqual(pathsOf(file), [
        ...all,
        'dir/',
        'dir/a',
        'dir/sub/',
        'dir/sub/c',
      ])
    })
  }

  each('a file that the archive does not have is added', async mode => {
    const { cwd, file } = updateFixture()
    await mode.update(
      { file, cwd },
      ['1024-bytes.txt', 'foo'],
      withMtimes({ '1024-bytes.txt': old }),
    )
    assert.deepEqual(pathsOf(file), [...bodyByteCounts, 'foo'])
  })

  each('the filter of the caller applies also', async mode => {
    const { cwd, file } = updateFixture()
    const seen: string[] = []
    await mode.update(
      {
        file,
        cwd,
        filter: path => {
          seen.push(path)
          return path !== 'foo'
        },
      },
      ['1024-bytes.txt', 'foo'],
      withMtimes({ '1024-bytes.txt': future }),
    )
    assert.deepEqual(seen, ['1024-bytes.txt', 'foo'])
    assert.deepEqual(pathsOf(file), [...bodyByteCounts, '1024-bytes.txt'])
  })

  each('an entry with no mtime, from another archive', async mode => {
    const block = hdr({ path: 'no-mtime', type: 'File', size: 1 })
    assert.equal(read(cat(block, Buffer.from('a'), EOA)).length, 1)
    const cwd = testdir({
      'a.tar': data,
      'no-mtime.tar': Buffer.from(
        cat(block, Buffer.from('a'), new Uint8Array(511), EOA),
      ),
    })
    const file = resolve(cwd, 'a.tar')
    await mode.update({ file, cwd }, ['@no-mtime.tar'])
    assert.deepEqual(pathsOf(file), [...bodyByteCounts, 'no-mtime'])
  })

  // The archive has the mtime of the helpers for each file.
  const longName = 'long-' + 'n'.repeat(150) + '.txt'
  each('a path of more than 100 characters', async mode => {
    const cwd = testdir({ [longName]: 'long', 'short.txt': 'short' })
    const file = resolve(cwd, 'a.tar')
    await mode.replace({ file, cwd }, [longName, 'short.txt'])
    const { size } = nodeFs.statSync(file)
    assert.deepEqual(pathsOf(file), [longName, 'short.txt'])

    // not newer: no entry is added
    const before = new Date(pinned.getTime() - 1000)
    await mode.update(
      { file, cwd },
      [longName, 'short.txt'],
      withMtimes({ [longName]: before, 'short.txt': before }),
    )
    assert.equal(nodeFs.statSync(file).size, size)
    assert.deepEqual(pathsOf(file), [longName, 'short.txt'])

    // newer: the entry is added
    await mode.update(
      { file, cwd },
      [longName, 'short.txt'],
      withMtimes({ [longName]: future, 'short.txt': before }),
    )
    assert.deepEqual(pathsOf(file), [longName, 'short.txt', longName])

    // A GNU long path gives the same key.
    const gnu = resolve(cwd, 'gnu.tar')
    nodeFs.writeFileSync(
      gnu,
      cat(
        longPath(longName),
        ent({ path: 'short', type: 'File', mtime: pinned }, 'long'),
        EOA,
      ),
    )
    await mode.update(
      { file: gnu, cwd },
      [longName],
      withMtimes({ [longName]: before }),
    )
    assert.deepEqual(pathsOf(gnu), [longName])
  })
})
