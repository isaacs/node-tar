import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import zlib from 'node:zlib'
import { any, assert, beforeEach, describe, test } from 'ubqtest'
import type { HeaderData } from '../src/header.js'
import type { Codec, CodecStream } from '../src/codec.js'
import type { PackOptions, PackOptionsSync } from '../src/options.js'
import { entries, entriesSync } from '../src/entries.js'
import type { CreateFileHandle, CreateFS, CreateStats } from '../src/fs.js'
import { PackJob } from '../src/pack.js'
import { ReadEntry } from '../src/read-entry.js'
import type { WarnData } from '../src/warn.js'
import { WriteEntry } from '../src/write-entry.js'
import {
  atime,
  collect,
  ctime,
  dirMode,
  failing,
  fileMode,
  files,
  fixtures,
  fs,
  fsSync,
  headerAt,
  listBlocks,
  modes,
  mtime,
  Pack,
  pack,
  PackSync,
  packSync,
  paths,
  pin,
  read,
  tracked,
  uid,
  type Mode,
  type Options,
  type Over,
} from './create-helpers.js'
import {
  cat,
  ent,
  EOA,
  file,
  fsPath,
  isWindows,
  noSymlink,
  pax,
  resolve,
  rootOf,
  testdir,
  xorCodec,
} from './helpers.js'

/** Define the test one time for each mode. */
const each = (
  name: string,
  fn: (mode: Mode) => Promise<void>,
  skip: string | false = false,
) => {
  for (const mode of modes) {
    test(`${name}, ${mode.name}`, { skip }, () => fn(mode))
  }
}

/** Skip each test of the group if the user cannot make a link. */
const needsSymlink = () =>
  beforeEach(({ skip }) => {
    if (noSymlink) skip(noSymlink)
  })

// The header fields of an entry that a pack reads from the fixtures.
const header = (fields: HeaderData) => ({
  cksumValid: true,
  needPax: false,
  mtime,
  cksum: any.number,
  linkpath: '',
  uname: 'isaacs',
  gname: '',
  devmaj: 0,
  devmin: 0,
  atime,
  ctime,
  nullBlock: false,
  ...fields,
})
const fileHeader = (fields: HeaderData) =>
  header({ type: 'File', mode: fileMode, ...fields })
const dirHeader = (fields: HeaderData) =>
  header({ type: 'Directory', mode: dirMode, size: 0, ...fields })

type Warning = [code: string, message: string, data: WarnData]
const warner = () => {
  const warnings: Warning[] = []
  return {
    warnings,
    onwarn: (c: string, m: string, d: WarnData) => {
      warnings.push([c, m, d])
    },
  }
}

// Change the result of each lstat and stat.
const statOver = (
  change: (stat: CreateStats, path: string) => CreateStats | void,
): Over => {
  const fix = (stat: CreateStats, path: string) =>
    change(pin(stat), path) ?? stat
  return {
    async: {
      lstat: async path => fix(await nodeFsPromises.lstat(path), path),
      stat: async path => fix(await nodeFsPromises.stat(path), path),
    },
    sync: {
      lstatSync: path => fix(nodeFs.lstatSync(path), path),
      statSync: path => fix(nodeFs.statSync(path), path),
    },
  }
}

// Change the `read` of each file.
const readOver = (
  change: (length: number) => number,
  result?: number,
): Over => ({
  async: {
    open: async (path, flags, mode) => {
      const handle: CreateFileHandle = await nodeFsPromises.open(
        path,
        flags,
        mode,
      )
      return {
        read: async (buf, off, length, pos) => {
          const res = await handle.read(buf, off, change(length), pos)
          return result === undefined ? res : { bytesRead: result }
        },
        write: (...a) => handle.write(...a),
        stat: () => handle.stat(),
        close: () => handle.close(),
      }
    },
  },
  sync: {
    readSync: (fd, buf, off, length, pos) => {
      const res = nodeFs.readSync(fd, buf, off, change(length), pos)
      return result === undefined ? res : result
    },
  },
})

const f100 = '100-byte-filename-' + 'c'.repeat(82)
const deepDir = 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/'
const deep = deepDir + 'x'.repeat(50) + 'c'.repeat(120)
const om = deepDir + 'Ω.txt'

describe('one path', () => {
  each('a file', async mode => {
    const seen: [WriteEntry, unknown][] = []
    const data = await mode.run(
      {
        cwd: files,
        onWriteEntry: entry => {
          seen.push([entry, entry.header])
        },
      },
      ['one-byte.txt'],
    )
    assert.equal(data.length, 2048)
    assert.match(data.subarray(512).toString(), /^a\0{511}\0{1024}$/)
    const expect = fileHeader({ path: 'one-byte.txt', size: 1 })
    assert.match(headerAt(data), expect)
    // The entry has the same fields, and its header is made after
    // the call of onWriteEntry.
    assert.equal(seen.length, 1)
    const [entry, before] = seen[0] as [WriteEntry, unknown]
    assert.equal(before, undefined)
    assert.match(entry, {
      path: 'one-byte.txt',
      absolute: resolve(files, 'one-byte.txt'),
      type: 'File',
      mode: fileMode,
      uid,
      uname: 'isaacs',
      gname: undefined,
      size: 1,
      mtime,
      atime,
      ctime,
      linkpath: undefined,
      dev: any.number,
      ino: any.number,
      nlink: 1,
      body: new Uint8Array([0x61]),
    })
    assert.match(entry.header, {
      path: 'one-byte.txt',
      size: 1,
      needPax: false,
    })
  })

  each('a file with a name of 100 bytes', async mode => {
    const data = await mode.run({ cwd: files }, [f100])
    assert.equal(data.length, 2048)
    assert.equal(data.subarray(0, 100).toString(), f100)
    assert.match(
      headerAt(data),
      fileHeader({ path: './' + f100, size: 100 }),
    )
    assert.equal(
      data.subarray(512, 1024).toString('hex'),
      '63'.repeat(100) + '00'.repeat(412),
    )
  })

  each('a directory', async mode => {
    const data = await mode.run({ cwd: files, noDirRecurse: true }, [
      'dir',
    ])
    assert.equal(data.length, 512 + 1024)
    assert.match(headerAt(data), dirHeader({ path: 'dir/' }))
  })

  each('an empty path is the cwd', async mode => {
    const seen: string[] = []
    const data = await mode.run(
      {
        cwd: resolve(files, 'dir'),
        noDirRecurse: true,
        onWriteEntry: entry => seen.push(entry.path),
      },
      [''],
    )
    assert.equal(data.length, 512 + 1024)
    assert.match(headerAt(data), dirHeader({ path: './' }))
    assert.deepEqual(seen, ['./'])
  })

  each('a symbolic link', async mode => {
    const data = await mode.run({ cwd: files }, ['symlink'])
    assert.equal(data.length, 512 + 1024)
    assert.match(headerAt(data), {
      type: 'SymbolicLink',
      path: 'symlink',
      size: 0,
      linkpath: 'hardlink-2',
      cksumValid: true,
    })
  })

  each('a file of zero bytes is not opened', async mode => {
    const { calls, over } = tracked()
    const data = await mode.run({ cwd: files }, ['zero-byte.txt'], over)
    assert.equal(data.length, 512 + 1024)
    assert.match(
      headerAt(data),
      fileHeader({ path: 'zero-byte.txt', size: 0 }),
    )
    assert.deepEqual(calls, [`lstat ${resolve(files, 'zero-byte.txt')}`])
  })

  for (const [name, noPax, length] of [
    ['a very deep path has a PAX header', false, 2048],
    ['a very deep path with noPax', true, 1024],
  ] as const) {
    each(name, async mode => {
      let entry: WriteEntry | undefined
      const data = await mode.run(
        { cwd: files, noPax, onWriteEntry: e => (entry = e) },
        [deep],
      )
      assert.equal(data.length, length + 1024)
      assert.match(entry?.header, { needPax: true, path: deep, size: 100 })
    })
  }

  each('a file that does not exist', async mode => {
    const f = fsPath(resolve(files, 'does not exist'))
    await assert.rejects(mode.run({ cwd: files }, ['does not exist']), {
      message: `ENOENT: no such file or directory, lstat '${f}'`,
      code: 'ENOENT',
      path: f,
      syscall: 'lstat',
    })
  })

  each(
    'a type that is not a file, a directory, or a link is skipped',
    async mode => {
      const data = await mode.run(
        { cwd: files },
        ['one-byte.txt'],
        statOver(stat => {
          stat.isFile = () => false
        }),
      )
      assert.equal(data.length, 1024)
      assert.match(data.toString(), /^\0+$/)
    },
  )

  each(
    'the uname of a file that another user owns is empty',
    async mode => {
      const data = await mode.run({ cwd: files, processUid: uid + 1 }, [
        'one-byte.txt',
      ])
      assert.match(headerAt(data), { uid, uname: '' })
    },
  )

  each('the uname is empty with no processUname', async mode => {
    const data = await mode.run({ cwd: files, processUname: undefined }, [
      'one-byte.txt',
    ])
    assert.match(headerAt(data), { uid, uname: '' })
  })

  each('the uname is empty with no processUid', async mode => {
    const data = await mode.run({ cwd: files, processUid: undefined }, [
      'one-byte.txt',
    ])
    assert.match(headerAt(data), { uid, uname: '' })
  })
})

describe('a path needs cwd and fs', () => {
  const expect = {
    name: 'TypeError',
    message: 'a path needs the cwd and fs options',
  }
  test('async', () => {
    assert.throws(() => new Pack().add('x'), expect)
    assert.throws(() => new Pack({ cwd: files }).add('x'), expect)
    assert.throws(() => new Pack({ fs }).add('x'), expect)
  })
  test('sync', () => {
    assert.throws(() => new PackSync().add('x'), expect)
    assert.throws(() => new PackSync({ cwd: files }).add('x'), expect)
    assert.throws(() => new PackSync({ fs: fsSync }).add('x'), expect)
  })
  each('the root directory', async mode => {
    // The root has one name in it, which is a file of zero bytes.
    const zero = resolve(files, 'zero-byte.txt')
    const { calls, over } = tracked({
      async: {
        readdir: async () => ['name'],
        lstat: path => fs.lstat(path === '/name' ? zero : path),
      },
      sync: {
        readdirSync: () => ['name'],
        lstatSync: path =>
          fsSync.lstatSync(path === '/name' ? zero : path),
      },
    })
    const data = await mode.run({ cwd: '/' }, [''], over)
    assert.deepEqual(paths(data), ['./', 'name'])
    assert.deepEqual(calls, [
      'lstat /',
      'readdir /',
      'lstat /',
      'lstat /name',
    ])
  })

  each('cwd is normalized', async mode => {
    const data = await mode.run({ cwd: files + '/dir/..//' }, [
      'one-byte.txt',
    ])
    assert.match(headerAt(data), { path: 'one-byte.txt', size: 1 })
  })
})

describe('add and end', () => {
  test('add after end throws', () => {
    const expect = { message: 'write after end' }
    assert.throws(() => pack({ cwd: files }).end().add('x'), expect)
    assert.throws(() => packSync({ cwd: files }).end().add('x'), expect)
  })

  test('a sync pack ends when it is read to its end', () => {
    const p = packSync({ cwd: files }).add('one-byte.txt')
    assert.equal(p.ended, false)
    assert.equal(Buffer.concat([...p]).length, 2048)
    assert.equal(p.ended, true)
    assert.throws(() => p.add('x'), { message: 'write after end' })
    assert.deepEqual(p.next(), { value: undefined, done: true })
  })

  test('an async pack waits for add and for end', async () => {
    const p = pack({ cwd: files })
    const first = p.next()
    let settled = false
    void first.then(() => (settled = true))
    await new Promise(res => setTimeout(res, 20))
    assert.equal(settled, false)
    p.add('one-byte.txt')
    const res = await first
    assert.equal(res.value?.length, 1024)
    const second = p.next()
    await new Promise(res => setTimeout(res, 20))
    p.end()
    assert.equal((await second).value?.length, 1024)
    assert.deepEqual(await p.next(), { value: undefined, done: true })
  })

  test('a pack is its own iterator', () => {
    const p = pack({})
    assert.equal(p[Symbol.asyncIterator](), p)
    const s = packSync({})
    assert.equal(s[Symbol.iterator](), s)
  })

  test('PackJob has the path and the absolute path', () => {
    assert.match(new PackJob('a', '/x/a'), {
      path: 'a',
      absolute: '/x/a',
      up: undefined,
      linkpath: undefined,
      ready: undefined,
    })
  })

  test('the same directory two times', async () => {
    const filter = (_: string, stat: unknown) =>
      (stat as CreateStats).isDirectory()
    for (const mode of modes) {
      const data = await mode.run({ cwd: files, filter }, ['dir', 'dir'])
      const expect = dirHeader({ path: 'dir/' })
      assert.match(headerAt(data), expect)
      assert.match(headerAt(data, 512), expect)
      assert.equal(data.length, 2048)
    }
  })
})

describe('prefix', () => {
  for (const prefix of ['package/', 'package']) {
    each(`a file with the prefix ${prefix}`, async mode => {
      const data = await mode.run({ cwd: files, prefix }, ['.dotfile'])
      assert.equal(data.length, 2048)
      assert.match(data.subarray(512).toString(), /^.\n\0{510}\0{1024}$/)
      assert.match(
        headerAt(data),
        fileHeader({ path: 'package/.dotfile', size: 2 }),
      )
    })
  }

  const subdirs = [
    'out/x/\0',
    'out/x/a/\0',
    'out/x/d\0',
    'ddd\0',
    'out/x/a/b/\0',
    'out/x/a/d\0',
    'ddd\0',
    'out/x/a/b/c/\0',
    'out/x/a/b/d\0',
    'ddd\0',
    'out/x/a/b/c/d\0',
    'ddd\0',
    '\0',
    '\0',
  ]
  // The readdir of the two file systems must give the same order.
  const sorted: Over = {
    async: { readdir: async path => (await fs.readdir(path)).sort() },
    sync: { readdirSync: path => fsSync.readdirSync(path).sort() },
  }
  for (const path of ['.', './']) {
    each(`subdirectories of ${path}`, async mode => {
      const dir = testdir({
        in: {
          a: { b: { c: { d: 'ddd' }, d: 'ddd' }, d: 'ddd' },
          d: 'ddd',
        },
      })
      const data = await mode.run(
        { cwd: dir + '/in', prefix: 'out/x' },
        [path],
        sorted,
      )
      subdirs.forEach((e, i) =>
        assert.equal(
          data.subarray(i * 512, i * 512 + e.length).toString(),
          e,
        ),
      )
    })
  }
})

describe('filter', () => {
  each('gets the path and the stat', async mode => {
    // Only directories, so dir/x is not in the archive.
    const seen: string[] = []
    const data = await mode.run(
      {
        cwd: files,
        filter: (path, stat) => {
          seen.push(path)
          return (stat as CreateStats).isDirectory()
        },
      },
      ['dir'],
    )
    assert.match(headerAt(data), dirHeader({ path: 'dir/' }))
    assert.equal(data.length, 512 + 1024)
    assert.deepEqual(seen, ['dir', 'dir/x'])
  })

  each('a filter that refuses each path', async mode => {
    const { calls, over } = tracked()
    const data = await mode.run(
      { cwd: files, filter: () => false },
      ['./'],
      over,
    )
    assert.equal(data.length, 1024)
    assert.match(data.toString(), /^\0+$/)
    // A directory that is refused is not read.
    assert.deepEqual(calls, [`lstat ${files}`])
  })

  each('is called in the order of the queue', async mode => {
    // Accept the directory and the first path in it only.
    let first = true
    const seen: string[] = []
    const data = await mode.run(
      {
        cwd: resolve(fixtures, 'tars'),
        jobs: 8,
        filter: path => {
          seen.push(path)
          if (path === './') return true
          const res = first
          first = false
          return res
        },
      },
      [''],
    )
    const names = nodeFs.readdirSync(resolve(fixtures, 'tars')).sort()
    assert.deepEqual(seen, ['./', ...names])
    assert.deepEqual(paths(data), ['./', names[0] as string])
  })
})

describe('order of the entries', () => {
  // Each directory below long-path/, and then the files of the last
  // directory.
  const deepBlocks = [
    ...[...deepDir.matchAll(/\//g)]
      .slice(1)
      .map(m => ['Directory', deepDir.slice(0, m.index + 1)]),
    ['File', `${deepDir}a.txt`, 'short\n'],
    ['File', deepDir + 'c'.repeat(100), '1'.repeat(100)],
    ['ExtendedHeader', 'PaxHeader/' + 'c'.repeat(89)],
    ['File', deepDir + 'c'.repeat(99), '2'.repeat(100)],
    ['ExtendedHeader', 'PaxHeader/' + 'x'.repeat(50) + 'c'.repeat(39)],
    ['File', deepDir + 'x'.repeat(50) + 'c'.repeat(49), 'c'.repeat(100)],
    ['ExtendedHeader', 'PaxHeader/Ω.txt'],
    ['File', `${deepDir}Ω.txt`, 'Ω'],
    'null block',
    'null block',
  ]

  test('async: the entries of a directory go to the end', async () => {
    const data = await (modes[0] as Mode).run({ cwd: files }, [
      'dir',
      'long-path',
    ])
    assert.deepEqual(listBlocks(data), [
      ['Directory', 'dir/'],
      ['Directory', 'long-path/'],
      ['File', 'dir/x'],
      ...deepBlocks,
    ])
  })

  test('sync: the entries of a directory come before the next path', async () => {
    const data = await (modes[1] as Mode).run({ cwd: files }, [
      'dir',
      'long-path',
    ])
    assert.deepEqual(listBlocks(data), [
      ['Directory', 'dir/'],
      ['File', 'dir/x'],
      ['Directory', 'long-path/'],
      ...deepBlocks,
    ])
  })

  each('the names of a directory are sorted', async mode => {
    // A file system that gives the names in the reverse order.
    const data = await mode.run({ cwd: fixtures }, ['tars'], {
      async: {
        readdir: async path => (await fs.readdir(path)).sort().reverse(),
      },
      sync: {
        readdirSync: path => fsSync.readdirSync(path).sort().reverse(),
      },
    })
    const names = nodeFs.readdirSync(resolve(fixtures, 'tars')).sort()
    assert.greaterThan(names.length, 1)
    assert.deepEqual(paths(data), [
      'tars/',
      ...names.map(name => `tars/${name}`),
    ])
  })
})

describe('errors of the file system', () => {
  const poop = new Error('poop')
  for (const [name, path] of [
    ['lstat', 'one-byte.txt'],
    ['readdir', 'dir'],
    ['readlink', 'symlink'],
    ['open', 'one-byte.txt'],
  ] as const) {
    each(`${name} fails`, async mode => {
      const { open, over } = tracked(failing(name, poop))
      const er = await assert.rejects(
        mode.run({ cwd: files }, [path], over),
        { message: 'poop' },
      )
      assert.equal(er, poop)
      assert.equal(open.size, 0)
    })
  }

  each('stat fails, with follow', async mode => {
    await assert.rejects(
      mode.run(
        { cwd: files, follow: true },
        ['one-byte.txt'],
        failing('stat', poop),
      ),
      { message: 'poop' },
    )
  })

  each('close fails', async mode => {
    // With `fail`, each read fails also.
    let fail = false
    const first = new Error('first')
    const over: Over = {
      async: {
        open: async (path, flags) => {
          const handle = await nodeFsPromises.open(path, flags)
          const res: CreateFileHandle = {
            read: (...a) =>
              fail ? Promise.reject(first) : handle.read(...a),
            write: (...a) => handle.write(...a),
            stat: () => handle.stat(),
            close: async () => {
              await handle.close()
              throw poop
            },
          }
          return res
        },
      },
      sync: {
        readSync: (...a) => {
          if (fail) throw first
          return nodeFs.readSync(...a)
        },
        closeSync: fd => {
          nodeFs.closeSync(fd)
          throw poop
        },
      },
    }
    for (const maxReadSize of [undefined, 100]) {
      fail = false
      await assert.rejects(
        mode.run({ cwd: files, maxReadSize }, ['1024-bytes.txt'], over),
        { message: 'poop' },
      )
      // An error of close does not hide the first error.
      fail = true
      await assert.rejects(
        mode.run({ cwd: files, maxReadSize }, ['1024-bytes.txt'], over),
        { message: 'first' },
      )
    }
  })

  each('read fails', async mode => {
    // Each path is a file, then read a path that is a directory.
    const { open, over } = tracked(
      statOver(stat => {
        stat.isFile = () => true
        stat.isDirectory = () => false
        stat.size = 123
      }),
    )
    await assert.rejects(mode.run({ cwd: fixtures }, ['files'], over), {
      code: 'EISDIR',
      syscall: 'read',
    })
    assert.equal(open.size, 0)
  })

  for (const maxReadSize of [undefined, 100, 2]) {
    each(`read gives no bytes, maxReadSize=${maxReadSize}`, async mode => {
      const { open, over } = tracked(readOver(n => n, 0))
      await assert.rejects(
        mode.run({ cwd: files, maxReadSize }, ['1024-bytes.txt'], over),
        {
          message: 'encountered unexpected EOF',
          path: resolve(files, '1024-bytes.txt'),
          syscall: 'read',
          code: 'EOF',
        },
      )
      assert.equal(open.size, 0)
    })

    each(
      `the file is larger than its stat, maxReadSize=${maxReadSize}`,
      async mode => {
        const { open, over } = tracked(
          statOver(stat => {
            stat.size = 3
          }),
        )
        await assert.rejects(
          mode.run({ cwd: files, maxReadSize }, ['512-bytes.txt'], over),
          {
            message: 'did not encounter expected EOF',
            path: resolve(files, '512-bytes.txt'),
            syscall: 'read',
            code: 'EOF',
          },
        )
        assert.equal(open.size, 0)
      },
    )
  }
})

describe('short reads', () => {
  const cases = {
    '1024-bytes.txt': 'x'.repeat(1023) + '\n',
    [f100]: 'c'.repeat(100),
  }
  for (const [filename, contents] of Object.entries(cases)) {
    for (const maxReadSize of [undefined, 1024, 100, 111, 2]) {
      const name = filename.split('byte').shift() + 'byte'
      each(`${name} maxReadSize=${maxReadSize}`, async mode => {
        const { open, over } = tracked(readOver(n => Math.ceil(n / 2)))
        const data = await mode.run(
          { cwd: files, maxReadSize },
          [filename],
          over,
        )
        assert.equal(
          data.length,
          512 * Math.ceil(1 + contents.length / 512) + 1024,
        )
        assert.equal(
          data.subarray(512).toString().replace(/\0.*$/, ''),
          contents,
        )
        assert.match(read(data), [{ body: contents }])
        assert.equal(open.size, 0)
      })
    }
  }

  each('a file of some blocks, read in parts of one block', async mode => {
    const dir = testdir({ f: 'abc'.repeat(1000) })
    const data = await mode.run({ cwd: dir, maxReadSize: 512 }, ['f'])
    assert.equal(data.length, 512 + 3072 + 1024)
    assert.match(read(data), [{ body: 'abc'.repeat(1000) }])
  })

  each('the size of each read, and of each chunk', async mode => {
    const dir = testdir({ f: 'abc'.repeat(1000), g: 'g'.repeat(512) })
    const sizes = async (maxReadSize: number, name: string) => {
      const reads: number[] = []
      const over = readOver(n => (reads.push(n), n))
      const p =
        mode.name === 'async' ?
          pack({ cwd: dir, maxReadSize }, over.async)
        : packSync({ cwd: dir, maxReadSize }, over.sync)
      const chunks: number[] = []
      for await (const chunk of p.add(name).end())
        chunks.push(chunk.length)
      return { reads, chunks }
    }
    // A file of maxReadSize or less, with the bytes that fill its
    // last block, is read one time, into the chunk of its header.
    assert.deepEqual(await sizes(512, 'g'), {
      reads: [512],
      chunks: [1024, 1024],
    })
    assert.deepEqual(await sizes(3072, 'f'), {
      reads: [3072],
      chunks: [512 + 3072, 1024],
    })
    // A larger file is read in parts. The last read asks for the
    // bytes to the end of the last block.
    assert.deepEqual(await sizes(511, 'g'), {
      reads: [511, 1],
      chunks: [512, 511, 1, 1024],
    })
    assert.deepEqual(await sizes(2000, 'f'), {
      reads: [2000, 1072],
      chunks: [512, 2000, 1000, 72, 1024],
    })
  })
})

describe('warnings for an absolute path', () => {
  const f = resolve(files, '512-bytes.txt')
  const root = rootOf(f)
  // A path of Windows has one root, the drive.
  const extra = isWindows ? '' : '///'
  const abs = extra + f
  const stripped = f.slice(root.length)

  each('the root is removed, with a warning', async mode => {
    const { warnings, onwarn } = warner()
    const seen: WriteEntry[] = []
    const data = await mode.run(
      { cwd: files, onwarn, onWriteEntry: e => seen.push(e) },
      [abs],
    )
    assert.equal(data.length, 2048)
    assert.match<unknown>(warnings, [
      [
        'TAR_ENTRY_INFO',
        `stripping ${extra + root} from absolute path`,
        { path: abs, entry: seen[0], code: 'TAR_ENTRY_INFO' },
      ],
    ])
    assert.match(headerAt(data), { path: stripped, size: 512 })
  })

  for (const strict of [true, false]) {
    each(`preservePaths and strict=${strict}`, async mode => {
      const { warnings, onwarn } = warner()
      const data = await mode.run(
        { cwd: files, strict, preservePaths: true, onwarn },
        [f],
      )
      assert.equal(warnings.length, 0)
      assert.match(headerAt(data), { path: f, size: 512 })
    })
  }

  each('strict throws', async mode => {
    const { open, over } = tracked()
    await assert.rejects(
      mode.run({ strict: true, cwd: files }, [f], over),
      { message: /stripping .* from absolute path/, path: f },
    )
    assert.equal(open.size, 0)
  })

  each('the file option is in the data of a warning', async mode => {
    const { warnings, onwarn } = warner()
    await mode.run({ cwd: files, onwarn, file: 'out.tar' }, [f])
    assert.match<unknown>(warnings, [
      [any.string, any.string, { file: 'out.tar' }],
    ])
  })

  each('a root only is the directory ./', async mode => {
    const { warnings, onwarn } = warner()
    const data = await mode.run(
      { cwd: files, onwarn, noDirRecurse: true },
      [root],
    )
    assert.match(headerAt(data), { type: 'Directory', path: './' })
    assert.match<unknown>(warnings, [
      [any.string, `stripping ${root} from absolute path`, any.object],
    ])
  })
})

describe('noDirRecurse and follow', () => {
  each('noDirRecurse does not read the directory', async mode => {
    const { calls, over } = tracked()
    const cwd = testdir({ x: { y: 'y' } })
    const data = await mode.run({ cwd, noDirRecurse: true }, ['x'], over)
    assert.equal(data.length, 512 + 1024)
    assert.match(headerAt(data), {
      type: 'Directory',
      path: 'x/',
      size: 0,
    })
    assert.deepEqual(calls, [`lstat ${resolve(cwd, 'x')}`])
  })

  each('follow adds the target of a link', async mode => {
    const data = await mode.run({ cwd: files, follow: true }, ['symlink'])
    assert.equal(data.length, 2048)
    assert.match(headerAt(data), {
      type: 'File',
      cksumValid: true,
      needPax: false,
      path: 'symlink',
      mode: fileMode,
      size: 26,
    })
    assert.match(
      data.subarray(512).toString(),
      /this link is like diamond\n\0+$/,
    )
  })

  each(
    'follow adds what is in a linked directory',
    async mode => {
      const cwd = testdir({ real: { f: 'ff' }, top: {} })
      nodeFs.symlinkSync('../real', resolve(cwd, 'top/link'))
      const data = await mode.run({ cwd, follow: true }, ['top'])
      assert.deepEqual(paths(data), ['top/', 'top/link/', 'top/link/f'])
    },
    noSymlink,
  )
})

describe('mtime and portable', () => {
  const date = new Date('1979-07-01T19:10:00.000Z')

  each('mtime sets the mtime of each entry', async mode => {
    const data = await mode.run({ cwd: files, mtime: date }, ['dir'])
    assert.match(headerAt(data), { path: 'dir/', mtime: date })
    assert.match(headerAt(data, 512), { path: 'dir/x', mtime: date })
  })

  each('noMtime writes no mtime', async mode => {
    const data = await mode.run(
      { cwd: files, noMtime: true, mtime: date },
      ['dir'],
    )
    assert.match(headerAt(data), { path: 'dir/', mtime: undefined })
    assert.match(headerAt(data, 512), { path: 'dir/x', mtime: undefined })
  })

  const pexpect = {
    atime: undefined,
    charset: undefined,
    comment: undefined,
    ctime: undefined,
    gid: undefined,
    gname: undefined,
    linkpath: undefined,
    path: om,
    size: 2,
    uid: undefined,
    uname: undefined,
    dev: undefined,
    ino: undefined,
    nlink: undefined,
  }
  const hexpect = {
    size: 2,
    ctime: undefined,
    atime: undefined,
    uid: undefined,
    uname: '',
    gid: undefined,
    gname: '',
  }
  for (const [name, opt, expect] of [
    ['nothing of the system', {}, mtime],
    ['no mtime', { noMtime: true }, undefined],
    ['mtime of the caller', { mtime: date }, date],
  ] as const) {
    each(`portable: ${name}`, async mode => {
      const data = await mode.run({ cwd: files, portable: true, ...opt }, [
        om,
      ])
      const entry = read(data)[0]?.entry
      assert(entry)
      assert.match(entry.extended, { ...pexpect, mtime: expect })
      assert.match(entry.header, { ...hexpect, mtime: expect })
      // The body of the PAX header has only the path, the mtime, and
      // the size.
      assert.equal(
        data
          .subarray(512, 1024)
          .toString()
          .replace(/\0+$/, '')
          .replace(/^\d+ mtime=\d+\n/m, ''),
        `71 path=${om}\n9 size=2\n`,
      )
    })
  }

  each('portable: a directory has no mtime', async mode => {
    const data = await mode.run(
      { cwd: files, portable: true, noDirRecurse: true },
      ['long-path/'],
    )
    assert.match(headerAt(data), {
      path: 'long-path/',
      ctime: undefined,
      atime: undefined,
      uid: undefined,
      uname: '',
      gid: undefined,
      gname: '',
      mtime: undefined,
    })
  })

  each('portable: the group and others cannot write', async mode => {
    const data = await mode.run(
      { cwd: files, portable: true },
      ['dir'],
      statOver(stat => {
        stat.mode |= 0o66
        stat.mode &= ~0o700
      }),
    )
    assert.match(headerAt(data), { path: 'dir/', mode: 0o755 })
    assert.match(headerAt(data, 512), { path: 'dir/x', mode: 0o644 })
  })

  each('a directory that can be read can be listed', async mode => {
    const data = await mode.run(
      { cwd: files, noDirRecurse: true },
      ['dir'],
      statOver(stat => {
        stat.mode = (stat.mode & ~0o777) | 0o440
      }),
    )
    assert.match(headerAt(data), { path: 'dir/', mode: 0o550 })
  })
})

describe('win32', () => {
  each('a \\ in a path, in cwd, and in prefix is a /', async mode => {
    const seen: string[] = []
    const data = await mode.run(
      {
        cwd: files.replaceAll('/', '\\'),
        prefix: 'pre\\fix',
        platform: 'win32',
        noDirRecurse: true,
        onWriteEntry: e => seen.push(e.path, String(e.absolute)),
      },
      ['long-path\\r'],
    )
    assert.deepEqual(seen, ['long-path/r/', resolve(files, 'long-path/r')])
    assert.match(headerAt(data), { path: 'pre/fix/long-path/r/' })
  })

  each('the characters of winchars are decoded', async mode => {
    const uglyName = Buffer.from(
      'ef80bcef81bcef80beef80bf2e747874',
      'hex',
    ).toString()
    const dir = testdir({ [uglyName]: '<|>?' })
    const seen: string[] = []
    const data = await mode.run(
      {
        cwd: dir,
        platform: 'win32',
        onWriteEntry: e => seen.push(e.path, String(e.absolute)),
      },
      [uglyName],
    )
    assert.deepEqual(seen, ['<|>?.txt', resolve(dir, uglyName)])
    assert.match(read(data), [
      { entry: { path: '<|>?.txt' }, body: '<|>?' },
    ])
  })

  each('a \\ in the target of a link is a /', async mode => {
    const data = await mode.run(
      { cwd: files, platform: 'win32' },
      ['symlink'],
      {
        async: { readlink: async () => 'a\\b' },
        sync: { readlinkSync: () => 'a\\b' },
      },
    )
    assert.match(headerAt(data), { path: 'symlink', linkpath: 'a/b' })
  })

  each('a drive letter is removed', async mode => {
    const { warnings, onwarn } = warner()
    const tar = cat(file('c:\\a\\b.txt', 'x'), EOA)
    const data = await mode.repack({ platform: 'win32', onwarn }, tar)
    assert.deepEqual(paths(data), ['a/b.txt'])
    assert.match<unknown>(warnings, [
      [
        'TAR_ENTRY_INFO',
        'stripping c:/ from absolute path',
        { path: 'c:/a/b.txt' },
      ],
    ])
  })

  each('a \\ in an entry of the caller is a /', async mode => {
    const data = await mode.run({ platform: 'win32' }, [
      new WriteEntry({ path: 'a\\b', type: 'Link', linkpath: 'c\\d' }),
      new WriteEntry({ path: 'e\\f' }),
    ])
    assert.match(read(data), [
      { entry: { path: 'a/b', linkpath: 'c/d' } },
      { entry: { path: 'e/f', linkpath: undefined } },
    ])
  })

  each('not win32: a \\ is a character of the name', async mode => {
    const posix = { platform: 'posix' } as const
    const data = await mode.run(posix, [new WriteEntry({ path: 'a\\b' })])
    assert.deepEqual(paths(data), ['a\\b'])
    // Also in a prefix, and in the target of a link.
    const link = await mode.run(
      { ...posix, cwd: files, prefix: 'pre\\fix' },
      ['symlink'],
      {
        async: { readlink: async () => 'a\\b' },
        sync: { readlinkSync: () => 'a\\b' },
      },
    )
    assert.match(headerAt(link), {
      path: 'pre\\fix/symlink',
      linkpath: 'a\\b',
    })
  })
})

describe('hard links', () => {
  each('the second path of a file is a Link', async mode => {
    const data = await mode.run({ cwd: fixtures }, [
      'files/hardlink-1',
      'files/hardlink-2',
    ])
    assert.equal(data.length, 512 * 3 + 1024)
    assert.match(
      headerAt(data),
      fileHeader({ path: 'files/hardlink-1', size: 26 }),
    )
    assert.match(
      headerAt(data, 1024),
      header({
        type: 'Link',
        path: 'files/hardlink-2',
        mode: fileMode,
        size: 0,
        linkpath: 'files/hardlink-1',
      }),
    )
  })

  each('a first path that is not in cwd is not a target', async mode => {
    const data = await mode.run({ cwd: resolve(files, 'dir') }, [
      '../hardlink-1',
      '../hardlink-2',
      '../hardlink-1',
    ])
    assert.match(read(data), [
      { entry: { type: 'File', path: '../hardlink-1' } },
      { entry: { type: 'File', path: '../hardlink-2' } },
      { entry: { type: 'File', path: '../hardlink-1' } },
    ])
  })

  each('a file that the filter refuses is not a target', async mode => {
    const data = await mode.run(
      { cwd: files, filter: path => path !== 'hardlink-1' },
      ['hardlink-1', 'hardlink-2'],
    )
    assert.match(read(data), [
      { entry: { type: 'File', path: 'hardlink-2' }, body: /diamond/ },
    ])
  })

  // https://github.com/npm/node-tar/issues/284
  const long = 'y'.repeat(250)
  const linkedDir = () => {
    const cwd = testdir({ target: 'ddd', z: { b: { c: {} } } })
    for (const link of ['z/b/c/d', 'z/b/d', 'z/d', 'y', long]) {
      nodeFs.linkSync(cwd + '/target', cwd + '/' + link)
    }
    return cwd
  }
  const names = [
    'target',
    'y',
    long,
    'z',
    'z/b',
    'z/d',
    'z/b/c',
    'z/b/d',
    'z/b/c/d',
  ]
  // What the archive of `names` has, where each path starts with
  // `dir`, and each link has the target `linkpath`.
  const expect = (dir: string, linkpath: string) => {
    const link = (name: string) => ({
      entry: { type: 'Link', path: dir + name, linkpath, size: 0 },
    })
    const folder = (name: string) => ({
      entry: { type: 'Directory', path: dir + name },
    })
    return [
      { entry: { type: 'Directory', path: dir || './' } },
      {
        entry: { type: 'File', path: dir + 'target', linkpath: undefined },
        body: 'ddd',
      },
      link('y'),
      link(long),
      folder('z/'),
      folder('z/b/'),
      link('z/d'),
      folder('z/b/c/'),
      link('z/b/d'),
      link('z/b/c/d'),
    ]
  }

  for (const root of ['.', './']) {
    each(`prefix and hard links, from ${root}`, async mode => {
      const dir = root === '.' ? './' : root
      const data = await mode.run(
        { cwd: linkedDir(), prefix: 'out/x', noDirRecurse: true },
        [root, ...names.map(name => dir + name)],
      )
      assert.match<unknown>(read(data), expect('out/x/', 'out/x/target'))
      // The PAX header of the long name has the prefix two times.
      const at = data.indexOf('266 path=out/x/' + long)
      assert.equal(at, 512 * 5)
      assert.contains(
        data.subarray(at, at + 512).toString(),
        '25 linkpath=out/x/target\n',
      )
    })

    each(`hard links and no prefix, from ${root}`, async mode => {
      const dir = root === '.' ? './' : root
      const data = await mode.run(
        { cwd: linkedDir(), noDirRecurse: true },
        [root, ...names.map(name => dir + name)],
      )
      assert.match<unknown>(read(data), expect('./', 'target'))
    })
  }

  each('all the links are found in a directory', async mode => {
    const data = await mode.run({ cwd: linkedDir(), jobs: 3 }, ['.'])
    const found = read(data)
    const kinds = (type: string) =>
      found.filter(f => f.entry.type === type).length
    assert.equal(kinds('File'), 1)
    assert.equal(kinds('Link'), 5)
    assert.equal(kinds('Directory'), 4)
    // The file comes before each link to it.
    const target = found.find(f => f.entry.type === 'File')?.entry.path
    const first = found.findIndex(f => f.entry.type === 'File')
    found.forEach((f, i) => {
      if (f.entry.type !== 'Link') return
      assert.equal<unknown>('./' + f.entry.linkpath, target)
      assert.greaterThan(i, first)
    })
  })

  // Makes a package folder with three hard links to the target.
  const linkedPackage = (targetPath: string, extra = {}) => {
    const dir = testdir({
      output: {},
      ...extra,
      pkgB: {
        'package.json': JSON.stringify({ name: 'pkgb', version: '1.2.3' }),
        'aaa.js': 'console.log("hello, world")',
        dist: {},
      },
    })
    const target = resolve(dir, targetPath)
    for (const link of ['index.js', 'foo.js', 'dist/index.js']) {
      nodeFs.linkSync(target, resolve(dir, 'pkgB', link))
    }
    return { dir, target }
  }
  // A file system with sorted readdir results, and with an lstat of
  // the target that takes much more time than each other call.
  const slowTarget = (target: string): Partial<CreateFS> => ({
    readdir: async path =>
      (await fs.readdir(path)).sort((a, b) => a.localeCompare(b, 'en')),
    lstat: async path => {
      if (path === target) await new Promise(res => setTimeout(res, 200))
      return fs.lstat(path)
    },
  })

  // https://github.com/isaacs/node-tar/issues/448
  test('the file is first when its lstat is the slowest', async () => {
    const { dir, target } = linkedPackage('pkgB/aaa.js')
    const p = pack({ cwd: dir, jobs: 999 }, slowTarget(target))
    const found = read(await collect(p.add('pkgB').end()))
    const at = found.findIndex(f => f.entry.path === 'pkgB/aaa.js')
    assert.equal(found[at]?.entry.type, 'File')
    const links = found.filter(f => f.entry.type === 'Link')
    assert.equal(links.length, 3)
    for (const link of links) {
      assert.equal(link.entry.linkpath, 'pkgB/aaa.js')
      assert.greaterThan(found.indexOf(link), at)
    }
  })

  test('a target that is not in the archive', async () => {
    const { dir, target } = linkedPackage('externalTarget', {
      externalTarget: 'hello',
    })
    const p = pack({ cwd: dir, jobs: 999 }, slowTarget(target))
    const found = read(await collect(p.add('pkgB').end()))
    assert.match(
      found
        .filter(f => /index|foo/.test(f.entry.path))
        .map(f => [f.entry.type, f.entry.path, f.entry.linkpath, f.body]),
      [
        ['File', 'pkgB/foo.js', undefined, 'hello'],
        ['Link', 'pkgB/index.js', 'pkgB/foo.js', ''],
        ['Link', 'pkgB/dist/index.js', 'pkgB/foo.js', ''],
      ],
    )
  })
})

describe('entries of the caller', () => {
  const bodies = (text: string) => {
    const bytes = new TextEncoder().encode(text)
    const parts = [bytes.subarray(0, 2), bytes.subarray(2)]
    return {
      sync: [
        ['a string', text],
        ['a Uint8Array', bytes],
        ['an array of chunks', parts],
        ['a sync iterator', parts.values()],
      ] as const,
      async: [
        ['a Blob', new Blob([text])],
        ['a ReadableStream', new Blob([text]).stream()],
        [
          'an async iterable',
          (async function* () {
            yield* parts
          })(),
        ],
      ] as const,
    }
  }

  for (const text of ['hello', 'x'.repeat(512), '']) {
    test(`a body of ${text.length} bytes, of each kind`, async () => {
      const blocks = 512 * Math.ceil(text.length / 512)
      for (const mode of modes) {
        const { sync, async } = bodies(text)
        for (const [name, body] of [
          ...sync,
          ...(mode.name === 'async' ? async : []),
        ]) {
          const size = text.length
          const entry = new WriteEntry(
            { path: 'a', mode: 0o644, size },
            body,
          )
          const data = await mode.run({}, [entry])
          assert.equal(data.length, 512 + blocks + 1024, name)
          assert.match(
            read(data),
            [{ entry: { path: 'a', mode: 0o644, size }, body: text }],
            name,
          )
          assert.match(entry.header, { path: 'a', size })
        }
      }
    })
  }

  test('a sync pack does not take an async body', () => {
    const expect = {
      name: 'TypeError',
      message:
        'PackSync needs a body that is a string, a Uint8Array, or an iterable',
    }
    for (const [, body] of bodies('hello').async) {
      const entry = new WriteEntry({ path: 'a', size: 5 }, body)
      const p = packSync({}).add(entry)
      assert.equal(p.next().value?.length, 512)
      assert.throws(() => p.next(), expect)
    }
  })

  each('a body that is longer than the size', async mode => {
    for (const body of ['hello', [new Uint8Array(2), new Uint8Array(2)]]) {
      await assert.rejects(
        mode.run({}, [new WriteEntry({ path: 'a/b', size: 3 }, body)]),
        { message: 'writing more data than expected', path: 'a/b' },
      )
    }
  })

  each('a body that is shorter than the size', async mode => {
    for (const body of ['hello', [new Uint8Array(2)], undefined]) {
      await assert.rejects(
        mode.run({}, [new WriteEntry({ path: 'a/b', size: 600 }, body)]),
        {
          message: 'encountered unexpected EOF',
          path: 'a/b',
          code: 'EOF',
        },
      )
    }
  })

  each('the body of an entry with the size 0 is not read', async mode => {
    const body: Iterable<Uint8Array> = {
      [Symbol.iterator]: () => {
        throw new Error('the body is read')
      },
    }
    const data = await mode.run({}, [
      new WriteEntry({ path: 'a', size: 0 }, body),
    ])
    assert.equal(data.length, 512 + 1024)
  })

  each('the options change the entry', async mode => {
    const { warnings, onwarn } = warner()
    const date = new Date('1979-07-01T19:10:00.000Z')
    const make = () =>
      new WriteEntry(
        {
          path: '/a/b',
          mode: 0o666,
          uid: 1,
          gid: 2,
          uname: 'u',
          gname: 'g',
          mtime,
          atime,
          ctime,
          dev: 1,
          ino: 2,
          nlink: 3,
        },
        'abc',
      )
    const plain = make()
    const data = await mode.run({ onwarn, prefix: 'p' }, [plain])
    assert.match<unknown>(warnings, [
      [
        'TAR_ENTRY_INFO',
        'stripping / from absolute path',
        { path: '/a/b', entry: plain },
      ],
    ])
    assert.match(read(data), [
      {
        entry: {
          path: 'p/a/b',
          mode: 0o666,
          uid: 1,
          gid: 2,
          uname: 'u',
          gname: 'g',
          mtime,
          atime,
          ctime,
        },
        body: 'abc',
      },
    ])
    assert.equal(plain.path, 'a/b')

    const portable = make()
    const kept = make()
    const other = await mode.run(
      { onwarn, portable: true, mtime: date, preservePaths: true },
      [portable, kept],
    )
    assert.equal(warnings.length, 1)
    assert.matchOnly(
      { ...portable },
      {
        path: '/a/b',
        type: 'File',
        mode: 0o644,
        uid: undefined,
        gid: undefined,
        uname: undefined,
        gname: undefined,
        size: 3,
        mtime: date,
        atime: undefined,
        ctime: undefined,
        linkpath: undefined,
        dev: undefined,
        ino: undefined,
        nlink: undefined,
        body: any.instanceOf(Uint8Array),
        absolute: undefined,
        header: any.object,
      },
    )
    assert.deepEqual(paths(other), ['/a/b', '/a/b'])
  })

  each('an entry with no mode has no mode', async mode => {
    const entry = new WriteEntry({ path: 'a', type: 'Directory' })
    const data = await mode.run({ portable: true }, [entry])
    assert.equal(entry.mode, undefined)
    assert.equal(headerAt(data).mode, undefined)
    assert.deepEqual(paths(data), ['a'])
  })

  each('the filter does not get an entry of the caller', async mode => {
    const data = await mode.run({ filter: () => false }, [
      new WriteEntry({ path: 'a' }),
    ])
    assert.deepEqual(paths(data), ['a'])
  })

  each('paths and entries are written in the order of add', async mode => {
    const data = await mode.run({ cwd: files, jobs: 2 }, [
      'one-byte.txt',
      new WriteEntry({ path: 'mem-1' }, '1'),
      'zero-byte.txt',
      '512-bytes.txt',
      new WriteEntry({ path: 'mem-2' }, '2'),
      new WriteEntry({ path: 'mem-3' }, '3'),
      'dir',
    ])
    assert.deepEqual(paths(data), [
      'one-byte.txt',
      'mem-1',
      'zero-byte.txt',
      '512-bytes.txt',
      'mem-2',
      'mem-3',
      'dir/',
      'dir/x',
    ])
  })
})

describe('entries of another archive', () => {
  const tar = cat(
    ent(
      {
        path: '$',
        type: 'File',
        mode: 0o755,
        uid: 123,
        gid: 321,
        uname: 'u',
        gname: 'g',
        mtime,
        ctime: new Date('1979-07-01'),
        atime: new Date('1980-08-17'),
      },
      '$$$$$$$$$$',
    ),
    ent({ path: 'blep', type: 'SymbolicLink', linkpath: 'xyz' }),
    EOA,
  )

  each('a file and a link', async mode => {
    const seen: [string, unknown][] = []
    const data = await mode.repack(
      { onWriteEntry: e => seen.push([e.path, e.header]) },
      tar,
    )
    assert.equal(data.length, 512 * 3 + 1024)
    assert.deepEqual(seen, [
      ['$', undefined],
      ['blep', undefined],
    ])
    // Each field of the header is the same. The old code did not
    // write the gname.
    assert.deepEqual(data, Buffer.from(tar))
  })

  each('an entry is added with no source of entries', async mode => {
    const p = mode.name === 'async' ? pack({}) : packSync({})
    const reader = mode.name === 'async' ? entries(tar) : entriesSync(tar)
    const { value } = await reader.next()
    assert(value)
    ;(p as Pack).add(value as ReadEntry)
    const data = await collect(p.end())
    assert.match(read(data), [
      { entry: { path: '$' }, body: '$$$$$$$$$$' },
    ])
  })

  each('a body of whole blocks has no padding', async mode => {
    const data = await mode.repack(
      {},
      cat(file('x', '@'.repeat(512)), EOA),
    )
    assert.equal(data.length, 1024 + 1024)
    assert.match(data.subarray(512, 1024).toString(), /^@+$/)
  })

  each('a portable directory has no mtime', async mode => {
    const data = await mode.repack(
      { portable: true },
      cat(
        ent({
          path: '$',
          type: 'Directory',
          mode: 0o755,
          uid: 123,
          gid: 321,
          ctime: new Date('1979-07-01'),
          atime: new Date('1980-08-17'),
          mtime: new Date('1997-06-21'),
        }),
        EOA,
      ),
    )
    assert.match(headerAt(data), { path: '$', mtime: undefined })
  })

  const longName = '$'.repeat(199)
  const longTar = cat(
    pax([
      ['path', longName],
      ['SCHILY.dev', '7'],
      ['SCHILY.ino', '8'],
      ['SCHILY.nlink', '9'],
    ]),
    tar,
  )
  for (const [name, opt, expect] of [
    [
      'a long path gets a PAX header',
      {},
      { mtime, uname: 'u', gname: 'g' },
    ],
    [
      'a long path, portable',
      { portable: true },
      { mtime, ctime: undefined, atime: undefined, uname: '', gname: '' },
    ],
    [
      'a long path, portable and noMtime',
      { noMtime: true, portable: true },
      {
        mtime: undefined,
        ctime: undefined,
        atime: undefined,
        uname: '',
        gname: '',
      },
    ],
  ] as const) {
    each(name, async mode => {
      const data = await mode.repack(opt, longTar)
      assert.match(headerAt(data), { type: 'ExtendedHeader' })
      assert.match(data.subarray(1024, 1124).toString(), /^\$+\0?$/)
      assert.match(headerAt(data, 1024), expect)
      const body = data.subarray(1536, 2048).toString().replace(/\0*$/, '')
      assert.equal(body, '$$$$$$$$$$')
      const text = data.subarray(512, 1024).toString()
      assert.contains(text, `209 path=${longName}\n`)
      // The numbers of the file system are kept, but not for a
      // portable archive.
      const numbers = 'SCHILY.dev=7\n16 SCHILY.ino=8\n18 SCHILY.nlink=9\n'
      if ('portable' in opt) assert.notContains(text, 'SCHILY')
      else assert.contains(text, numbers)
    })
  }

  describe('an absolute path', () => {
    const absTar = cat(file('/a/b/c', 'x'), EOA)
    each('the root is removed, with a warning', async mode => {
      const { warnings, onwarn } = warner()
      const data = await mode.repack({ onwarn }, absTar)
      assert.match<unknown>(warnings, [
        [
          'TAR_ENTRY_INFO',
          'stripping / from absolute path',
          { path: '/a/b/c' },
        ],
      ])
      assert.deepEqual(paths(data), ['a/b/c'])
    })
    each('preservePaths', async mode => {
      const { warnings, onwarn } = warner()
      const data = await mode.repack(
        { onwarn, preservePaths: true },
        absTar,
      )
      assert.deepEqual(warnings, [])
      assert.deepEqual(paths(data), ['/a/b/c'])
    })
    each('strict throws', async mode => {
      await assert.rejects(mode.repack({ strict: true }, absTar), {
        message: /stripping \/ from absolute path/,
      })
    })
  })

  each('prefix', async mode => {
    const data = await mode.repack({ prefix: 'y' }, tar)
    assert.match(read(data), [
      { entry: { path: 'y/$' }, body: '$$$$$$$$$$' },
      { entry: { path: 'y/blep', linkpath: 'xyz' } },
    ])
  })

  each('the filter gets the path and the entry', async mode => {
    const seen: unknown[] = []
    const data = await mode.repack(
      {
        filter: (path, entry) => {
          seen.push(path, entry.constructor.name)
          return path === 'x'
        },
      },
      cat(file('a', '1'), file('x', '2'), file('y', '3'), EOA),
    )
    const kind = mode.name === 'async' ? 'ReadEntry' : 'ReadEntrySync'
    assert.deepEqual(seen, ['a', kind, 'x', kind, 'y', kind])
    assert.match(read(data), [{ entry: { path: 'x' }, body: '2' }])
  })

  each('two archives, and a path between them', async mode => {
    const one = cat(file('a', '1'), file('b', '2'), EOA)
    const two = cat(file('c', '3'), EOA)
    const p =
      mode.name === 'async' ?
        pack({ cwd: files }).add(entries(one)).add('dir').add(entries(two))
      : packSync({ cwd: files })
          .add(entriesSync(one))
          .add('dir')
          .add(entriesSync(two))
    const data = await collect(p.end())
    assert.deepEqual(
      paths(data),
      mode.name === 'async' ?
        ['a', 'b', 'dir/', 'c', 'dir/x']
      : ['a', 'b', 'dir/', 'dir/x', 'c'],
    )
  })

  // https://github.com/npm/node-tar/issues/284
  describe('hard links', () => {
    const long = 'y'.repeat(250)
    const link = (path: string) =>
      ent({ path, type: 'Link', linkpath: 'target' })
    const dir = (path: string) => ent({ path, type: 'Directory' })
    const linksTar = (start: string) =>
      cat(
        dir(start),
        file(start + 'target', 'ddd'),
        link(start + 'y'),
        pax([
          ['path', start + long],
          ['linkpath', 'target'],
        ]),
        link(long.slice(0, 99)),
        dir(start + 'z/'),
        link(start + 'z/d'),
        EOA,
      )
    const expect = (start: string, linkpath: string) => [
      { entry: { type: 'Directory', path: start } },
      { entry: { type: 'File', path: start + 'target' }, body: 'ddd' },
      { entry: { type: 'Link', path: start + 'y', linkpath } },
      { entry: { type: 'Link', path: start + long, linkpath } },
      { entry: { type: 'Directory', path: start + 'z/' } },
      { entry: { type: 'Link', path: start + 'z/d', linkpath } },
    ]

    each('the prefix is put before each target', async mode => {
      const data = await mode.repack({ prefix: 'out/x' }, linksTar('./'))
      assert.match<unknown>(read(data), expect('out/x/', 'out/x/target'))
    })

    each('no prefix', async mode => {
      const data = await mode.repack({}, linksTar('./'))
      assert.match<unknown>(read(data), expect('./', 'target'))
    })
  })
})

describe('onWriteEntry', () => {
  each('can change the fields', async mode => {
    const cwd = testdir({ 'README.md': 'hello, world' })
    const data = await mode.run(
      {
        cwd,
        onWriteEntry: entry => {
          entry.path = 'bloorg.md'
          entry.mode = 0o600
          entry.mtime = new Date(0)
          entry.uname = 'someone'
          entry.gname = 'some'
        },
      },
      ['README.md'],
    )
    assert.match(read(data), [
      {
        entry: {
          path: 'bloorg.md',
          mode: 0o600,
          mtime: new Date(0),
          uname: 'someone',
          gname: 'some',
        },
        body: 'hello, world',
      },
    ])
  })

  each('can change the body', async mode => {
    const cwd = testdir({ a: 'hello', b: 'x'.repeat(2000), c: 'x' })
    const { open, over } = tracked()
    const data = await mode.run(
      {
        cwd,
        maxReadSize: 1024,
        onWriteEntry: entry => {
          if (entry.path === 'a') entry.body = new Uint8Array([0x48])
          if (entry.path === 'b')
            entry.body = new TextEncoder().encode('B')
          if (entry.path !== 'c') entry.size = entry.path.length
          else entry.type = 'OldFile'
        },
      },
      ['a', 'b', 'c'],
      over,
    )
    assert.match(read(data), [
      { entry: { path: 'a', size: 1 }, body: 'H' },
      { entry: { path: 'b', size: 1 }, body: 'B' },
      { entry: { path: 'c', size: 1 }, body: 'x' },
    ])
    assert.equal(open.size, 0)
  })

  test('a promise is awaited before the header is written', async () => {
    const order: string[] = []
    const p = pack({
      cwd: files,
      onWriteEntry: async entry => {
        order.push(`start ${entry.path}`)
        await new Promise(res => setTimeout(res, 10))
        entry.path = 'changed/' + entry.path
        order.push(`end ${entry.path}`)
      },
    })
    p.add('dir')
      .add(new WriteEntry({ path: 'mem' }, 'm'))
      .end()
    const data = await collect(p)
    assert.deepEqual(paths(data), [
      'changed/dir/',
      'changed/mem',
      'changed/dir/x',
    ])
    assert.deepEqual(order, [
      'start dir/',
      'end changed/dir/',
      'start mem',
      'end changed/mem',
      'start dir/x',
      'end changed/dir/x',
    ])
  })

  test('a sync pack does not wait for a promise', async () => {
    const p = packSync({
      cwd: files,
      onWriteEntry: async entry => {
        await Promise.resolve()
        entry.path = 'late'
      },
    })
    const data = await collect(p.add('one-byte.txt'))
    assert.deepEqual(paths(data), ['one-byte.txt'])
  })

  const poop = new Error('poop')
  each('an error goes to the caller', async mode => {
    for (const maxReadSize of [undefined, 100]) {
      const { open, over } = tracked()
      const er = await assert.rejects(
        mode.run(
          {
            cwd: files,
            maxReadSize,
            onWriteEntry: () => {
              throw poop
            },
          },
          ['1024-bytes.txt'],
          over,
        ),
        { message: 'poop' },
      )
      assert.equal(er, poop)
      assert.equal(open.size, 0)
    }
  })

  test('a promise that rejects goes to the caller', async () => {
    const { open, over } = tracked()
    const p = pack(
      { cwd: files, onWriteEntry: () => Promise.reject(poop) },
      over.async,
    )
    await assert.rejects(collect(p.add('512-bytes.txt').end()), {
      message: 'poop',
    })
    assert.equal(open.size, 0)
    const mem = pack({ onWriteEntry: () => Promise.reject(poop) })
    await assert.rejects(
      collect(mem.add(new WriteEntry({ path: 'a' })).end()),
      {
        message: 'poop',
      },
    )
  })

  each('a header value that cannot be encoded', async mode => {
    for (const [change, expect] of [
      [
        (entry: WriteEntry) => (entry.size = 2 ** 60),
        {
          message:
            'cannot encode number outside of javascript safe integer range',
        },
      ],
      [
        (entry: WriteEntry) => (entry.type = 'Nope' as 'File'),
        { name: 'TypeError', message: 'invalid entry type: Nope' },
      ],
    ] as const) {
      for (const maxReadSize of [undefined, 100]) {
        const { open, over } = tracked()
        await assert.rejects(
          mode.run(
            { cwd: files, maxReadSize, onWriteEntry: change },
            ['dir', '1024-bytes.txt', '512-bytes.txt', 'one-byte.txt'],
            over,
          ),
          expect,
        )
        assert.equal(open.size, 0)
      }
      await assert.rejects(
        mode.run({ onWriteEntry: change }, [
          new WriteEntry({ path: 'a' }),
        ]),
        expect,
      )
    }
  })
})

describe('a path that changes while the pack reads it', () => {
  needsSymlink()

  // A file system that calls `swap` after the first lstat of `path`.
  const swapAfterLstat = (path: string, swap: () => void): Over => {
    let done = false
    const after = (p: string) => {
      if (p !== path || done) return
      done = true
      swap()
    }
    return {
      async: {
        lstat: async p => {
          const stat = await fs.lstat(p)
          after(p)
          return stat
        },
      },
      sync: {
        lstatSync: p => {
          const stat = fsSync.lstatSync(p)
          after(p)
          return stat
        },
      },
    }
  }

  const fileFixture = () => {
    const cwd = testdir({
      tree: { a: 'aaa', victim: 'not secret', z: 'zzz' },
      secret: 'SECRET DATA',
    })
    const victim = resolve(cwd, 'tree/victim')
    const over = swapAfterLstat(victim, () => {
      nodeFs.rmSync(victim)
      nodeFs.symlinkSync('../secret', victim)
    })
    return { cwd, victim, over }
  }

  for (const maxReadSize of [undefined, 4]) {
    each(
      `a file that is a symlink at open is not read, maxReadSize=${maxReadSize}`,
      async mode => {
        const { cwd, victim, over } = fileFixture()
        const { warnings, onwarn } = warner()
        const t = tracked(over)
        const data = await mode.run(
          { cwd, onwarn, maxReadSize },
          ['tree/a', 'tree/victim', 'tree/z'],
          t.over,
        )
        assert.notContains(data.toString(), 'SECRET')
        assert.deepEqual(paths(data), ['tree/a', 'tree/z'])
        assert.match<unknown>(warnings, [
          [
            'TAR_ENTRY_ERROR',
            'file changed between lstat and open',
            { path: 'tree/victim', absolute: victim },
          ],
        ])
        assert.equal(t.open.size, 0)
      },
    )
  }

  each('a file that is a symlink at open: strict throws', async mode => {
    const { cwd, victim, over } = fileFixture()
    const t = tracked(over)
    await assert.rejects(
      mode.run({ cwd, strict: true }, ['tree'], t.over),
      {
        message: 'TAR_ENTRY_ERROR: file changed between lstat and open',
        tarCode: 'TAR_ENTRY_ERROR',
        absolute: victim,
      },
    )
    assert.equal(t.open.size, 0)
  })

  const dirFixture = () => {
    const cwd = testdir({
      tree: { a: 'aaa', victim: { inside: 'ok' } },
      private: { secret: 'SECRET DATA' },
      moved: {},
    })
    const victim = resolve(cwd, 'tree/victim')
    const over = swapAfterLstat(victim, () => {
      nodeFs.renameSync(victim, resolve(cwd, 'moved/victim'))
      nodeFs.symlinkSync('../private', victim)
    })
    return { cwd, victim, over }
  }

  each(
    'a directory that is a symlink at readdir is not listed',
    async mode => {
      const { cwd, victim, over } = dirFixture()
      const { warnings, onwarn } = warner()
      const data = await mode.run({ cwd, onwarn }, ['tree'], over)
      assert.notContains(data.toString(), 'SECRET')
      assert.notContains(data.toString(), 'secret')
      assert.deepEqual(paths(data), ['tree/', 'tree/a'])
      assert.match<unknown>(warnings, [
        [
          'TAR_ENTRY_ERROR',
          'directory changed between lstat and readdir',
          { path: 'tree/victim', absolute: victim },
        ],
      ])
    },
  )

  each(
    'a directory that is a symlink at readdir: strict throws',
    async mode => {
      const { cwd, over } = dirFixture()
      await assert.rejects(
        mode.run({ cwd, strict: true }, ['tree'], over),
        {
          message:
            'TAR_ENTRY_ERROR: directory changed between lstat and readdir',
        },
      )
    },
  )

  each('with follow, the pack does not compare', async mode => {
    // The stat of a different file, as if the path changed.
    const other = nodeFs.statSync(resolve(files, 'dir'))
    const { calls, over } = tracked(
      statOver(stat => {
        stat.dev = other.dev
        stat.ino = other.ino + 12345
      }),
    )
    const data = await mode.run(
      { cwd: files, follow: true },
      ['dir'],
      over,
    )
    assert.deepEqual(paths(data), ['dir/', 'dir/x'])
    assert.deepEqual(calls, [
      `stat ${resolve(files, 'dir')}`,
      `readdir ${resolve(files, 'dir')}`,
      `stat ${resolve(files, 'dir/x')}`,
    ])
  })
})

describe('follow and a link to a directory above', () => {
  needsSymlink()

  const loops = () => {
    const cwd = testdir({ top: { sub: { f: 'ff' }, g: 'gg' } })
    nodeFs.symlinkSync('.', resolve(cwd, 'top/self-1'))
    nodeFs.symlinkSync('.', resolve(cwd, 'top/self-2'))
    nodeFs.symlinkSync('..', resolve(cwd, 'top/sub/up-1'))
    nodeFs.symlinkSync('../../top', resolve(cwd, 'top/sub/up-2'))
    return cwd
  }

  each('a directory that is its own ancestor is skipped', async mode => {
    const cwd = loops()
    const { warnings, onwarn } = warner()
    const data = await mode.run({ cwd, follow: true, onwarn }, ['top'])
    assert.deepEqual(paths(data).sort(), [
      'top/',
      'top/g',
      'top/sub/',
      'top/sub/f',
    ])
    assert.equal(warnings.length, 4)
    assert.deepEqual(
      warnings
        .map(([code, message, data]) => [code, message, data.path])
        .sort(),
      ['top/self-1', 'top/self-2', 'top/sub/up-1', 'top/sub/up-2'].map(
        path => ['TAR_ENTRY_ERROR', 'directory is its own ancestor', path],
      ),
    )
    assert.match(warnings[0]?.[2], {
      absolute: any.string,
      tarCode: 'TAR_ENTRY_ERROR',
    })
  })

  each('a link to a directory above the first path', async mode => {
    const cwd = testdir({ top: { sub: {} }, other: 'o' })
    nodeFs.symlinkSync('../..', resolve(cwd, 'top/sub/out'))
    const { warnings, onwarn } = warner()
    const data = await mode.run({ cwd, follow: true, onwarn }, ['top'])
    assert.deepEqual(paths(data).sort(), [
      'top/',
      'top/sub/',
      'top/sub/out/',
      'top/sub/out/other',
    ])
    assert.match<unknown>(warnings, [
      [
        'TAR_ENTRY_ERROR',
        'directory is its own ancestor',
        { path: 'top/sub/out/top' },
      ],
    ])
  })

  each('strict throws', async mode => {
    await assert.rejects(
      mode.run({ cwd: loops(), follow: true, strict: true }, ['top']),
      { message: 'TAR_ENTRY_ERROR: directory is its own ancestor' },
    )
  })

  each('the same directory at two places is not a loop', async mode => {
    const cwd = testdir({ real: { f: 'ff' }, top: {} })
    nodeFs.symlinkSync('../real', resolve(cwd, 'top/one'))
    nodeFs.symlinkSync('../real', resolve(cwd, 'top/two'))
    const { warnings, onwarn } = warner()
    const data = await mode.run({ cwd, follow: true, onwarn }, ['top'])
    assert.deepEqual(paths(data).sort(), [
      'top/',
      'top/one/',
      'top/one/f',
      'top/two/',
      'top/two/f',
    ])
    assert.deepEqual(warnings, [])
  })

  each('no follow: the links are entries', async mode => {
    const data = await mode.run({ cwd: loops() }, ['top'])
    assert.match(
      read(data)
        .filter(f => f.entry.type === 'SymbolicLink')
        .map(f => [f.entry.path, f.entry.linkpath])
        .sort(),
      [
        ['top/self-1', '.'],
        ['top/self-2', '.'],
        ['top/sub/up-1', '..'],
        ['top/sub/up-2', '../../top'],
      ],
    )
  })
})

describe('reading on demand', () => {
  // 20 files of 3000 bytes. With maxReadSize 1024, the pack keeps the
  // files open while it reads them.
  const tree = () =>
    testdir({
      d: Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [
          `f${String(i).padStart(2, '0')}`,
          String(i).repeat(3000).slice(0, 3000),
        ]),
      ),
    })
  const lstats = (calls: string[]) =>
    calls.filter(c => c.startsWith('lstat ') && /f\d\d$/.test(c)).length
  const wait = () => new Promise(res => setTimeout(res, 50))

  test('async: files are read only when the consumer asks', async () => {
    const cwd = tree()
    const { calls, open, over } = tracked()
    const p = pack({ cwd, jobs: 3, maxReadSize: 1024 }, over.async)
    p.add('d').end()
    await wait()
    assert.deepEqual(calls, [])

    // The directory.
    assert.equal((await p.next()).value?.length, 512)
    await wait()
    assert.deepEqual(
      calls.map(c => c.split(' ')[0]),
      ['lstat', 'readdir', 'lstat'],
    )
    assert.equal(open.size, 0)

    // The header of the first file. The pack reads `jobs` paths.
    assert.equal((await p.next()).value?.length, 512)
    await wait()
    assert.equal(lstats(calls), 3)
    assert.equal(open.size, 3)

    // The body of the first file, and the header of the second.
    for (let i = 0; i < 5; i++) await p.next()
    await wait()
    assert.equal(lstats(calls), 4)
    assert.equal(open.size, 3)

    // Stop. Each file is closed.
    assert.deepEqual(await p.return(), { value: undefined, done: true })
    assert.equal(open.size, 0)
    assert.equal(lstats(calls), 4)
    assert.deepEqual(await p.next(), { value: undefined, done: true })
    assert.throws(() => p.add('d'), { message: 'write after end' })
  })

  test('sync: files are read only when the consumer asks', () => {
    const cwd = tree()
    const { calls, open, over } = tracked()
    const p = packSync({ cwd, maxReadSize: 1024 }, over.sync)
    p.add('d')
    assert.deepEqual(calls, [])
    assert.equal(p.next().value?.length, 512)
    assert.equal(lstats(calls), 0)
    assert.equal(p.next().value?.length, 512)
    assert.equal(lstats(calls), 1)
    assert.equal(open.size, 1)
    assert.equal(p.next().value?.length, 1024)
    assert.deepEqual(p.return(), { value: undefined, done: true })
    assert.equal(open.size, 0)
    assert.equal(lstats(calls), 1)
    assert.deepEqual(p.next(), { value: undefined, done: true })
    assert.throws(() => p.add('d'), { message: 'write after end' })
  })

  test('return before the first read', async () => {
    const { calls, over } = tracked()
    const p = pack({ cwd: files, gzip: true }, over.async).add('dir')
    assert.deepEqual(await p.return(), { value: undefined, done: true })
    const s = packSync({ cwd: files }, over.sync).add('dir')
    assert.deepEqual(s.return(), { value: undefined, done: true })
    await wait()
    assert.deepEqual(calls, [])
  })

  test('return while the pack waits for add', async () => {
    const p = pack({ cwd: files })
    const first = p.next()
    await wait()
    await p.return()
    // The pack ends as if the caller called end().
    assert.equal((await first).value?.length, 1024)
    assert.deepEqual(await p.next(), { value: undefined, done: true })
  })

  each('all the files are in the archive', async mode => {
    const cwd = tree()
    for (const jobs of [1, 2, 50]) {
      const { open, over } = tracked()
      const data = await mode.run(
        { cwd, jobs, maxReadSize: 1024 },
        ['d'],
        over,
      )
      const found = read(data)
      assert.equal(found.length, 21)
      for (const { entry, body } of found.slice(1)) {
        const n = String(Number(entry.path.slice(-2)))
        assert.equal(body, n.repeat(3000).slice(0, 3000), entry.path)
      }
      assert.equal(open.size, 0)
    }
  })

  test('an error closes the files that the pack read ahead', async () => {
    const cwd = tree()
    const bad = resolve(cwd, 'd/f01')
    const poop = new Error('poop')
    for (const fail of ['lstat', 'open'] as const) {
      const real = tracked()
      const t = tracked({
        async: {
          ...real.over.async,
          [fail]: (path: string, ...a: [string]) =>
            path === bad ?
              Promise.reject(poop)
            : real.over.async[fail](path, ...a),
        },
      })
      const p = pack({ cwd, jobs: 6, maxReadSize: 1024 }, t.over.async)
      await assert.rejects(collect(p.add('d').end()), { message: 'poop' })
      assert.equal(real.open.size, 0)
      assert.greaterThan(lstats(real.calls), 3)
    }
  })

  test('an error in the body closes the files', async () => {
    const cwd = tree()
    const { open, over } = tracked(readOver(n => n, 0))
    const p = pack({ cwd, jobs: 6, maxReadSize: 1024 }, over.async)
    await assert.rejects(collect(p.add('d').end()), {
      message: 'encountered unexpected EOF',
    })
    assert.equal(open.size, 0)
  })

  test('a source of entries that fails is closed', async () => {
    const poop = new Error('poop')
    let returned = 0
    const source = (fail: boolean): AsyncIterable<WriteEntry> => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (fail) throw poop
          return { value: new WriteEntry({ path: 'a' }), done: false }
        },
        return: async () => {
          returned++
          return { value: undefined, done: true }
        },
      }),
    })
    await assert.rejects(collect(pack({}).add(source(true)).end()), {
      message: 'poop',
    })
    assert.equal(returned, 0)
    const p = pack({}).add(source(false)).end()
    assert.equal((await p.next()).value?.length, 512)
    await p.return()
    assert.equal(returned, 1)
  })
})

describe('compression', () => {
  // Codecs of node:zlib. They record the options that they get.
  const seen: unknown[] = []
  const zlibCodec = (
    name: string,
    make: (options?: object) => zlib.Gzip | zlib.ZstdCompress,
    sync: (data: Uint8Array, options?: object) => Uint8Array,
  ): Codec => ({
    name,
    headLength: 0,
    detect: () => false,
    decompress: () => new DecompressionStream('gzip') as CodecStream,
    compress: options => {
      seen.push(options)
      const z = make(options)
      return {
        writable: new WritableStream({
          write: chunk =>
            new Promise<void>((res, rej) =>
              z.write(chunk, er => (er ? rej(er) : res())),
            ),
          close: () => {
            z.end()
          },
        }),
        readable: new ReadableStream({
          start: controller => {
            z.on('data', chunk => controller.enqueue(chunk))
            z.on('end', () => controller.close())
          },
        }),
      }
    },
    compressSync: (data, options) => {
      seen.push(options)
      return sync(data, options)
    },
  })
  const codecs = [
    zlibCodec('gzip', zlib.createGzip, zlib.gzipSync),
    zlibCodec(
      'brotli',
      zlib.createBrotliCompress,
      zlib.brotliCompressSync,
    ),
    zlibCodec('zstd', zlib.createZstdCompress, zlib.zstdCompressSync),
  ]
  const decompress = {
    gzip: zlib.gunzipSync,
    brotli: zlib.brotliDecompressSync,
    zstd: zlib.zstdDecompressSync,
  }
  const expect = ['dir/', 'dir/x']

  for (const name of ['gzip', 'brotli', 'zstd'] as const) {
    each(`${name}: the codec gets the value of the option`, async mode => {
      seen.length = 0
      const zipped = await mode.run(
        { cwd: files, codecs, [name]: { flush: 1 } },
        ['dir'],
      )
      assert.deepEqual(paths(decompress[name](zipped)), expect)
      assert.deepEqual(seen, [{ flush: 1 }])
    })

    each(`${name}: true gives no options`, async mode => {
      seen.length = 0
      const zipped = await mode.run({ cwd: files, codecs, [name]: true }, [
        'dir',
      ])
      assert.deepEqual(paths(decompress[name](zipped)), expect)
      assert.deepEqual(seen, [{}])
    })

    each(`${name}: portable`, async mode => {
      seen.length = 0
      const opt = {
        cwd: files,
        codecs,
        portable: true,
        [name]: { level: 1 },
      }
      await mode.run(opt, ['dir'])
      // Only the gzip codec gets the option.
      assert.deepEqual(seen, [
        name === 'gzip' ? { level: 1, portable: true } : { level: 1 },
      ])
      assert.deepEqual(opt[name], { level: 1 })
    })
  }

  test('the gzip of the runtime, async', async () => {
    const zipped = await collect(
      pack({ cwd: files, gzip: true }).add('dir').add('long-path').end(),
    )
    assert.equal(zipped[0], 0x1f)
    assert.equal(zipped[1], 0x8b)
    const data = zlib.gunzipSync(zipped)
    assert.equal(data.length, 512 * 2 + 21504)
    assert.deepEqual(listBlocks(data).slice(0, 3), [
      ['Directory', 'dir/'],
      ['Directory', 'long-path/'],
      ['File', 'dir/x'],
    ])
  })

  test('the gzip of the runtime, portable', async () => {
    const opt = { cwd: files, portable: true, gzip: true }
    const zipped = await collect(pack(opt).add('dir').end())
    assert.equal(zipped[9], 255, 'gzip OS flag set to "unknown"')
    const data = zlib.gunzipSync(zipped)
    assert.equal(data.length, 2048)
    const portable = {
      uname: '',
      mtime: undefined,
      atime: undefined,
      ctime: undefined,
    }
    assert.match(
      headerAt(data),
      dirHeader({ ...portable, path: 'dir/', mode: 0o755 }),
    )
    assert.match(
      headerAt(data, 512),
      fileHeader({
        ...portable,
        path: 'dir/x',
        mode: 0o644,
        size: 0,
        mtime,
      }),
    )
    // Not portable: the stream of the runtime, with no change.
    const plain = await collect(
      pack({ cwd: files, gzip: {} }).add('dir').end(),
    )
    assert.deepEqual(paths(zlib.gunzipSync(plain)), expect)
  })

  test('a codec of the caller, in the compress option', async () => {
    const opt = { cwd: files, compress: xorCodec }
    for (const mode of modes) {
      const plain = await mode.run({ cwd: files }, ['dir'])
      const zipped = await mode.run(opt, ['dir'])
      assert.deepEqual(
        zipped,
        Buffer.from(xorCodec.compressSync?.(plain) as Uint8Array),
      )
    }
    // An option with the name of the codec does not select it.
    const named = { cwd: files, codecs: [xorCodec], xor: true }
    const data = await collect(
      pack(named as Options)
        .add('dir')
        .end(),
    )
    assert.deepEqual(paths(data), expect)
  })

  each('the compress option gives options to the codec', async mode => {
    seen.length = 0
    const [gz] = codecs
    assert(gz)
    const options = { level: 1 }
    const opt: Options = { cwd: files, compress: [gz, options] }
    const zipped = await mode.run(opt, ['dir'])
    assert.deepEqual(paths(zlib.gunzipSync(zipped)), expect)
    // Only a codec with the name gzip gets the portable option.
    await mode.run({ ...opt, portable: true }, ['dir'])
    const other = { ...gz, name: 'other' }
    await mode.run({ ...opt, compress: other, portable: true }, ['dir'])
    assert.deepEqual(seen, [
      { level: 1 },
      { level: 1, portable: true },
      {},
    ])
    assert.deepEqual(options, { level: 1 })
  })

  for (const [name, opt, message] of [
    ['gzip and brotli', { gzip: true, brotli: true }, 'gzip, brotli'],
    ['gzip and zstd', { gzip: true, zstd: true }, 'gzip, zstd'],
    ['brotli and zstd', { brotli: {}, zstd: {} }, 'brotli, zstd'],
    [
      'gzip, brotli, and zstd',
      { gzip: true, brotli: true, zstd: true },
      'gzip, brotli, zstd',
    ],
    [
      'gzip and a codec of the caller',
      { gzip: true, compress: xorCodec },
      'gzip, compress',
    ],
  ] as const) {
    test(`${name} are mutually exclusive`, () => {
      const expect = {
        name: 'TypeError',
        message: `${message} are mutually exclusive`,
      }
      assert.throws(() => new Pack(opt as PackOptions), expect)
      assert.throws(() => new PackSync(opt as PackOptionsSync), expect)
    })
  }

  test('an option with no codec that can compress', () => {
    const none: Codec = { ...xorCodec, compress: undefined }
    const noSync: Codec = { ...xorCodec, compressSync: undefined }
    assert.throws(() => new Pack({ brotli: true }), {
      name: 'TypeError',
      message: 'no codec named brotli has a compress function',
    })
    assert.throws(() => new Pack({ compress: [none, {}] }), {
      message: 'no codec named xor has a compress function',
    })
    assert.throws(() => new PackSync({ zstd: true }), {
      name: 'TypeError',
      message: 'no codec named zstd has a compressSync function',
    })
    assert.throws(() => new PackSync({ gzip: true }), {
      message: 'no codec named gzip has a compressSync function',
    })
    assert.throws(() => new PackSync({ compress: noSync }), {
      message: 'no codec named xor has a compressSync function',
    })
    // A codec that the pack does not use needs no function.
    assert.equal(new Pack({ codecs: [none] }).codec, undefined)
    assert.equal(new Pack({ compress: noSync }).codec, noSync)
  })

  test('an error of the pack goes through the compression', async () => {
    const { open, over } = tracked()
    for (const opt of [{ gzip: true }, { codecs, brotli: true }]) {
      const p = pack({ cwd: files, ...opt }, over.async)
      await assert.rejects(
        collect(p.add('dir').add('does-not-exist').end()),
        { code: 'ENOENT' },
      )
    }
    assert.equal(open.size, 0)
  })

  test('an error of the codec goes to the caller', async () => {
    const poop = new Error('poop')
    const bad: Codec = {
      ...xorCodec,
      compress: () =>
        new TransformStream<Uint8Array, Uint8Array>({
          transform: () => {
            throw poop
          },
        }),
      compressSync: () => {
        throw poop
      },
    }
    const opt = { cwd: files, compress: bad }
    for (const mode of modes) {
      const { open, over } = tracked()
      const er = await assert.rejects(
        mode.run(opt, ['1024-bytes.txt', 'dir'], over),
        { message: 'poop' },
      )
      assert.equal(er, poop)
      assert.equal(open.size, 0)
    }
  })

  test('return stops a pack that compresses', async () => {
    const { open, over } = tracked()
    const dir = testdir({ a: 'a'.repeat(5000), b: 'b'.repeat(5000) })
    const p = pack(
      {
        cwd: dir,
        maxReadSize: 512,
        compress: xorCodec,
      },
      over.async,
    )
    assert.equal((await p.add('a').add('b').end().next()).value?.length, 4)
    await p.next()
    await p.return()
    await assert.eventually(() => open.size, 0)
    assert.deepEqual(await p.next(), { value: undefined, done: true })
  })
})

describe('a slow consumer gets all the data', () => {
  test('async', async () => {
    const p = pack({ cwd: files }).add('long-path').end()
    const parts: Uint8Array[] = []
    for (;;) {
      await new Promise(res => setTimeout(res, 1))
      const { done, value } = await p.next()
      if (done) break
      parts.push(value)
    }
    const data = Buffer.concat(parts)
    assert.match(headerAt(data), dirHeader({ path: 'long-path/' }))
    assert.equal(data.length, 21504)
    assert.match(
      data.subarray(data.length - 1024).toString(),
      /^\0{1024}$/,
    )
  })

  test('async, gzip', async () => {
    const p = pack({ cwd: files, gzip: true }).add('long-path').end()
    const parts: Uint8Array[] = []
    for (;;) {
      await new Promise(res => setTimeout(res, 1))
      const { done, value } = await p.next()
      if (done) break
      parts.push(value)
    }
    const data = zlib.gunzipSync(Buffer.concat(parts))
    assert.match(headerAt(data), dirHeader({ path: 'long-path/' }))
    assert.equal(data.length, 21504)
  })
})

test('no hard link to a path beside the cwd', () => {
  // The name of the folder 'bc' starts with the name of the cwd 'b'.
  const dir = testdir({ b: {}, bc: { x: 'content' } })
  nodeFs.linkSync(resolve(dir, 'bc/x'), resolve(dir, 'b/y'))
  const pack = new PackSync({
    cwd: resolve(dir, 'b'),
    fs: nodeFs,
    preservePaths: true,
  })
  pack.add(resolve(dir, 'bc/x')).add('y').end()
  const found = [...entriesSync([...pack])].map(e => [
    e.type,
    e.path,
    e.linkpath,
  ])
  // The second path is in the cwd, so it is the target of later links.
  assert.deepEqual(found, [
    ['File', resolve(dir, 'bc/x'), undefined],
    ['File', 'y', undefined],
  ])
})

test('a hard link with a cwd that is a root', () => {
  // Two empty files that are one file, in a file system of memory.
  const stat = {
    ...nodeFs.lstatSync(import.meta.filename),
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    dev: 1,
    ino: 2,
    nlink: 2,
    size: 0,
  }
  const seen: string[] = []
  const fs = {
    lstatSync: (path: string) => {
      seen.push(path)
      return stat
    },
  } as unknown as PackOptionsSync['fs']
  const pack = new PackSync({ cwd: '/', fs })
  pack.add('x').add('y').end()
  const found = [...entriesSync([...pack])].map(e => [
    e.type,
    e.path,
    e.linkpath,
  ])
  assert.deepEqual(seen, ['/x', '/y'])
  assert.deepEqual(found, [
    ['File', 'x', undefined],
    ['Link', 'y', 'x'],
  ])
})
