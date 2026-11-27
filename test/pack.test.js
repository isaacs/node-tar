import {
  any,
  assert,
  cleanup,
  describe,
  env,
  mockImport,
  test,
  testdir,
} from 'ubqtest'
import { Pack, PackSync } from '../src/pack.js'
import fs from 'fs'
import path, { resolve } from 'path'
import { fileURLToPath } from 'url'
import { Parser } from '../src/parse.js'

import { Header } from '../src/header.js'
import zlib from 'zlib'
import * as miniz from 'minizlib'
import mutateFS from 'mutate-fs'
import { Minipass } from 'minipass'
import EE from 'events'
import { ReadEntry } from '../src/read-entry.js'
import { normalizeWindowsPath as normPath } from '../src/normalize-windows-path.js'
import { chmodrSync } from 'chmodr'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const fixtures = path.resolve(__dirname, 'fixtures')
const files = path.resolve(fixtures, 'files')
const tars = path.resolve(fixtures, 'tars')

env({ USER: 'isaacs' })
const isWindows = process.platform === 'win32'

const ctime = new Date('2017-05-10T01:03:12.000Z')
const atime = new Date('2017-04-17T00:00:00.000Z')
const mtime = new Date('2016-04-01T19:00:00.000Z')

cleanup(
  mutateFS.statMutate((_er, st) => {
    if (st) {
      st.ctime = ctime
      st.atime = atime
      st.mtime = mtime
    }
  }),
)

// Make sure that the fixture files have the links and modes that the
// tests expect.
{
  const one = fs.statSync(files + '/hardlink-1')
  const two = fs.statSync(files + '/hardlink-2')
  if (one.dev !== two.dev || one.ino !== two.ino) {
    try {
      fs.unlinkSync(files + '/hardlink-2')
    } catch (e) {}
    fs.linkSync(files + '/hardlink-1', files + '/hardlink-2')
  }
  chmodrSync(files, 0o644)
}

const fileMode = isWindows ? 0o666 : 0o644
const dirMode = isWindows ? 0o777 : 0o755

// The header fields of an entry that Pack reads from the fixture files.
const header = fields => ({
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

const fileHeader = fields =>
  header({ type: 'File', mode: fileMode, ...fields })

const dirHeader = fields =>
  header({ type: 'Directory', mode: dirMode, size: 0, ...fields })

// The name field of the 512 byte block at this offset.
const nameAt = (data, offset) =>
  data
    .subarray(offset, offset + 100)
    .toString()
    .replace(/\0.*$/, '')

// Resolves to the error that the stream emits.
const errorOf = stream =>
  new Promise(res => stream.once('error', er => res(er)))

const wait = ms => new Promise(res => setTimeout(res, ms))

test('pack a file', async () => {
  const seen = []
  const data = await new Pack({
    cwd: files,
    onWriteEntry: e => seen.push(e),
  })
    .end('one-byte.txt')
    .concat()
  assert.equal(data.length, 2048)
  assert.match(data.subarray(512).toString(), /^a\0{511}\0{1024}$/)
  const expect = fileHeader({ path: 'one-byte.txt', size: 1 })
  assert.match(new Header(data), expect)

  const ps = new PackSync({ cwd: files })
  const sout = []
  ps.on('data', chunk => sout.push(chunk))
  ps.add('one-byte.txt').end()
  const sync = Buffer.concat(sout)

  assert.equal(sync.subarray(512).length, data.subarray(512).length)
  assert.equal(
    sync.subarray(512).toString(),
    data.subarray(512).toString(),
  )
  assert.match(new Header(sync), expect)
  assert.deepEqual(
    seen.map(e => e.path),
    ['one-byte.txt'],
  )
})

test('pack a file with a prefix', async () => {
  const data = await new Pack({ mtime, cwd: files, prefix: 'package/' })
    .end('.dotfile')
    .concat()
  assert.equal(data.length, 2048)
  assert.match(data.subarray(512).toString(), /^.\n\0{510}\0{1024}$/)
  const expect = fileHeader({ path: 'package/.dotfile', size: 2 })
  assert.match(new Header(data), expect)

  const sync = new PackSync({ cwd: files, prefix: 'package' })
    .add('.dotfile')
    .end()
    .read()
  assert.equal(
    sync.subarray(512).toString(),
    data.subarray(512).toString(),
  )
  assert.match(new Header(sync), expect)
})

test('portable pack a dir', async () => {
  const opt = { cwd: files, portable: true, gzip: true }
  const zipped = await new Pack(opt).add('dir').end().concat()
  assert.equal(zipped[9], 255, 'gzip OS flag set to "unknown"')
  const data = new miniz.Gunzip().end(zipped).read()
  // dir/, dir/x, and the nulls
  // neither the dir or the file have any body bits
  const portable = {
    uname: '',
    mtime: undefined,
    atime: undefined,
    ctime: undefined,
  }
  const expect = dirHeader({ ...portable, path: 'dir/', mode: 0o755 })
  assert.match(new Header(data), expect)
  assert.equal(data.length, 2048)
  assert.match(data.subarray(1024).toString(), /^\0{1024}$/)

  const syncgz = new PackSync(opt).add('dir').end().read()
  assert.equal(syncgz[9], 255, 'gzip OS flag set to "unknown"')
  const sync = new miniz.Gunzip().end(syncgz).read()

  assert.equal(
    sync.subarray(512).toString(),
    data.subarray(512).toString(),
  )
  assert.match(new Header(sync), expect)

  const expect2 = fileHeader({
    ...portable,
    path: 'dir/x',
    mode: 0o644,
    size: 0,
    mtime,
  })
  assert.match(new Header(data.subarray(512)), expect2)
  assert.match(new Header(sync.subarray(512)), expect2)
})

test('use process cwd if cwd not specified', async () => {
  const cwd = process.cwd()
  cleanup(_ => process.chdir(cwd))
  process.chdir(files)

  const data = await new Pack().add('dir').end().concat()
  // dir/, dir/x, and the nulls
  // neither the dir or the file have any body bits
  const expect = dirHeader({ path: 'dir/' })
  assert.match(new Header(data), expect)
  assert.equal(data.length, 2048)
  assert.match(data.subarray(1024).toString(), /^\0{1024}$/)

  const sync = new PackSync({ cwd: files }).add('dir').end().read()
  assert.equal(
    sync.subarray(512).toString(),
    data.subarray(512).toString(),
  )
  assert.match(new Header(sync), expect)

  const expect2 = fileHeader({ path: 'dir/x', size: 0 })
  assert.match(new Header(data.subarray(512)), expect2)
  assert.match(new Header(sync.subarray(512)), expect2)
})

test('filter', async () => {
  // only include directories, so dir/x should not appear
  const filter = (_path, stat) => stat.isDirectory()

  const data = await new Pack({ cwd: files, filter })
    .add('dir')
    .end()
    .concat()
  const expect = dirHeader({ path: 'dir/' })
  assert.match(new Header(data), expect)
  assert.equal(data.length, 1536)
  assert.match(data.subarray(512).toString(), /^\0{1024}$/)

  const sync = new PackSync({ cwd: files, filter }).add('dir').end().read()
  assert.equal(
    sync.subarray(512).toString(),
    data.subarray(512).toString(),
  )
  assert.match(new Header(sync), expect)
})

test('add the same dir twice (exercise cache code)', async () => {
  // only include directories, so dir/x should not appear
  const filter = (_path, stat) => stat.isDirectory()

  const pack = new Pack({ cwd: files, filter }).add('dir').add('dir').end()
  const data = await pack.concat()
  const expect = dirHeader({ path: 'dir/' })
  assert.match(new Header(data), expect)
  assert.match(new Header(data.subarray(512)), expect)
  assert.equal(data.length, 2048)
  assert.match(data.subarray(1024).toString(), /^\0{1024}$/)

  const sync = new PackSync({
    cwd: files,
    filter,
    linkCache: pack.linkCache,
    readdirCache: pack.readdirCache,
    statCache: pack.statCache,
  })
    .add('dir')
    .add('dir')
    .end()
    .read()
  assert.equal(
    sync.subarray(1024).toString(),
    data.subarray(1024).toString(),
  )
  assert.match(new Header(sync), expect)
  assert.match(new Header(sync.subarray(512)), expect)
})

const compressions = [
  ['gzip', zlib.unzipSync],
  ['brotli', zlib.brotliDecompressSync],
  ['zstd', zlib.zstdDecompressSync],
]

for (const [name] of compressions) {
  test(`if ${name} is truthy, make it an object`, () => {
    const opt = { [name]: true }
    new Pack(opt)
    assert.equal(typeof opt[name], 'object')
  })
}

for (const [name, opt] of [
  ['both gzip and brotli are', { gzip: true, brotli: true }],
  ['both gzip and zstd are', { gzip: true, zstd: true }],
  ['both brotli and zstd are', { brotli: true, zstd: true }],
  [
    'gzip, brotli, and zstd are all',
    { gzip: true, brotli: true, zstd: true },
  ],
]) {
  test(`throws if ${name} truthy`, () => {
    assert.throws(_ => new Pack(opt), {
      message: 'gzip, brotli, zstd are mutually exclusive',
    })
  })
}

// The type and path of each header in the archive. A file entry also
// has the start of its body.
const listEntries = data => {
  const entries = []
  for (let i = 0; i < data.length; i += 512) {
    const slice = data.subarray(i, i + 512)
    const h = new Header(slice)
    if (h.nullBlock) {
      entries.push('null block')
    } else if (h.cksumValid) {
      entries.push([h.type, h.path])
    } else if (entries.at(-1)[0] === 'File') {
      entries.at(-1).push(slice.toString().replace(/\0.*$/, ''))
    }
  }
  return entries
}

const deep = 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/'
// Each folder below long-path/, and then the files of the last folder.
const deepEntries = [
  ...[...deep.matchAll(/\//g)]
    .slice(1)
    .map(m => ['Directory', deep.slice(0, m.index + 1)]),
  ['File', `${deep}a.txt`, 'short\n'],
  ['File', deep + 'c'.repeat(100), '1'.repeat(100)],
  ['ExtendedHeader', 'PaxHeader/' + 'c'.repeat(89)],
  ['File', deep + 'c'.repeat(99), '2'.repeat(100)],
  ['ExtendedHeader', 'PaxHeader/' + 'x'.repeat(50) + 'c'.repeat(39)],
  ['File', deep + 'x'.repeat(50) + 'c'.repeat(49), 'c'.repeat(100)],
  ['ExtendedHeader', 'PaxHeader/Ω.txt'],
  ['File', `${deep}Ω.txt`, 'Ω'],
  'null block',
  'null block',
]

for (const [name, decompress] of compressions) {
  test(`${name}, also a very deep path`, async () => {
    const zipped = await new Pack({ cwd: files, [name]: { flush: 1 } })
      .add('dir')
      .add('long-path')
      .end()
      .concat()
    assert.deepEqual(listEntries(decompress(zipped)), [
      ['Directory', 'dir/'],
      ['Directory', 'long-path/'],
      ['File', 'dir/x'],
      ...deepEntries,
    ])
  })
}

for (const [name, decompress] of compressions) {
  test(`very deep ${name} path, sync`, () => {
    const pack = new PackSync({ cwd: files, [name]: true })
      .add('dir')
      .add('long-path')
      .end()

    // these do nothing!
    pack.pause()
    pack.resume()

    const zipped = pack.read()
    assert(zipped instanceof Buffer)
    assert.deepEqual(listEntries(decompress(zipped)), [
      ['Directory', 'dir/'],
      ['File', 'dir/x'],
      ['Directory', 'long-path/'],
      ...deepEntries,
    ])
  })
}

test('write after end', () => {
  const p = new Pack()
  p.end()
  assert.throws(_ => p.add('nope'), { message: 'write after end' })
})

test('emit error when stat fail', async () => {
  cleanup(mutateFS.statFail(new Error('xyz')))
  assert.throws(_ => new PackSync({ cwd: files }).add('one-byte.txt'), {
    message: 'xyz',
  })

  const er = await errorOf(new Pack({ cwd: files }).add('one-byte.txt'))
  assert.match(er, { message: 'xyz' })
})

test('readdir fail', async () => {
  cleanup(mutateFS.fail('readdir', new Error('xyz')))
  assert.throws(_ => new PackSync({ cwd: files }).add('dir'), {
    message: 'xyz',
  })

  const er = await errorOf(new Pack({ cwd: files }).add('dir'))
  assert.match(er, { message: 'xyz' })
})

test('pipe into a slow reader', async () => {
  const out = []
  const mp = new Minipass()
  const mp2 = new Minipass()
  const p = new Pack({ cwd: files }).add('long-path').end()
  p.pause()
  p.pipe(mp).pipe(mp2)
  const ended = new Promise(res => mp.on('end', res))
  await wait(100)
  mp2.on('data', c => out.push(c))
  await wait(100)
  p.resume()
  await ended

  const data = Buffer.concat(out)
  assert.match(new Header(data), dirHeader({ path: 'long-path/' }))
  assert.equal(data.length, 21504)
  assert.match(data.subarray(data.length - 1024).toString(), /^\0{1024}$/)
})

test('pipe into a slow gzip reader', async () => {
  const mp2 = new miniz.Unzip()
  const p = new Pack({ cwd: files, gzip: true }).add('long-path').end()
  p.pause()

  // The count of the drain timers that did not run yet.
  let timers = 0
  class SlowStream extends EE {
    write(chunk) {
      mp2.write(chunk)
      timers++
      setTimeout(_ => {
        timers--
        this.emit('drain')
        p.resume()
      })
      return false
    }

    end(chunk) {
      return mp2.end(chunk)
    }
  }
  const ss = new SlowStream()

  await wait(1)
  p.pipe(ss)
  p.resume()

  const data = await mp2.concat()
  while (timers > 0) {
    await wait(1)
  }
  assert.match(new Header(data), dirHeader({ path: 'long-path/' }))
  assert.equal(data.length, 21504)
  assert.match(data.subarray(data.length - 1024).toString(), /^\0{1024}$/)
})

test('ignores mid-queue', async () => {
  // we let the first one through, and then ignore all the others
  // so that we trigger the case where an ignored entry is not the
  // head of the queue.
  let didFirst = false
  const p = new Pack({
    cwd: tars,
    filter: (p, _st) => {
      if (p === './') {
        return true
      }
      if (!didFirst) {
        return (didFirst = true)
      }
      return false
    },
  })

  p.add('')
  p.end()
  const data = await p.concat()
  assert.equal(nameAt(data, 0), './')
  assert.contains(fs.readdirSync(tars), nameAt(data, 512))
})

describe('warnings', () => {
  const f = path.resolve(files, '512-bytes.txt')
  test('preservePaths=false strict=false', async () => {
    const warnings = []
    const data = await new Pack({
      cwd: files,
      onwarn: (c, m, p) => warnings.push([c, m, p]),
    })
      .end(f)
      .concat()

    assert.equal(data.length, 2048)
    assert.match(warnings, [
      [
        'TAR_ENTRY_INFO',
        /stripping .* from absolute path/,
        { path: normPath(f) },
      ],
    ])

    assert.match(new Header(data), {
      path: normPath(f).replace(/^(\/|[a-z]:\/)/i, ''),
    })
  })

  for (const strict of [true, false]) {
    test(`preservePaths=true strict=${strict}`, async () => {
      const warnings = []
      const data = await new Pack({
        cwd: files,
        strict,
        preservePaths: true,
        onwarn: (c, m, p) => warnings.push([c, m, p]),
      })
        .end(f)
        .concat()
      assert.equal(warnings.length, 0)
      assert.match(new Header(data), { path: normPath(f) })
    })
  }

  test('preservePaths=false strict=true', async () => {
    const er = await errorOf(new Pack({ strict: true, cwd: files }).end(f))
    assert.match(er, {
      message: /stripping .* from absolute path/,
      path: normPath(f),
    })
  })
})

describe('no dir recurse', () => {
  const run = Class =>
    new Class({
      cwd: testdir({ x: { y: 'y' } }),
      noDirRecurse: true,
    }).end('x')

  const check = data => {
    assert.equal(data.length, 512 + 1024)
    assert.equal(data.subarray(512).toString(), '\0'.repeat(1024))
    assert.match(new Header(data), {
      type: 'Directory',
      path: 'x/',
      size: 0,
    })
  }

  test('async', async () => check(await run(Pack).concat()))

  test('sync', () => check(run(PackSync).read()))
})

describe(
  'follow',
  { skip: isWindows && 'file symlinks not available' },
  () => {
    const check = data => {
      assert.equal(data.length, 2048)
      assert.match(new Header(data, 0), {
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
    }

    test('async', async () =>
      check(
        await new Pack({ cwd: files, follow: true })
          .end('symlink')
          .concat(),
      ))

    test('sync', () =>
      check(
        new PackSync({ cwd: files, follow: true }).end('symlink').read(),
      ))
  },
)

describe('pack ReadEntries', () => {
  const entry = path =>
    new ReadEntry(new Header({ path, type: 'File', size: 1 }))

  // Writes the one byte body of the entry.
  const endEntry = readEntry => {
    const buf = Buffer.alloc(512)
    buf.write('x')
    readEntry.end(buf)
  }

  const check = (data, path) => {
    assert.equal(data.length, 2048)
    assert.match(data.subarray(1024).toString(), /^\0+$/)
    assert.equal(nameAt(data, 0), path)
    assert.equal(data.subarray(512, 514).toString(), 'x\0')
  }

  for (const [name, opt, path] of [
    ['basic', undefined, 'x'],
    ['prefix', { prefix: 'y' }, 'y/x'],
  ]) {
    test(name, async () => {
      const readEntry = entry('x')
      const p = new Pack(opt)
      p.end(readEntry)
      const data = p.concat()
      endEntry(readEntry)
      check(await data, path)
    })
  }

  test('filter out', async () => {
    const entries = ['a', 'x', 'y'].map(entry)
    const p = new Pack({ filter: p => p === 'x' })
    p.add(entries[0])
    p.add(entries[1])
    p.end(entries[2])
    const data = p.concat()
    entries.forEach(endEntry)
    check(await data, 'x')
  })
})

describe('filter out everything', () => {
  const run = Class =>
    new Class({ cwd: files, filter: _ => false }).end('./')

  const check = data => {
    assert.equal(data.length, 1024)
    assert.match(data.toString(), /^\0+$/)
  }

  test('sync', () => check(run(PackSync).read()))

  test('async', async () => check(await run(Pack).concat()))
})

describe('fs.open fails', () => {
  const poop = new Error('poop')

  test('async', async () => {
    cleanup(mutateFS.fail('open', poop))
    const er = await errorOf(new Pack({ cwd: files }).end('one-byte.txt'))
    assert.equal(er, poop)
  })

  test('sync', () => {
    cleanup(mutateFS.fail('open', poop))
    assert.throws(_ => new PackSync({ cwd: files }).end('one-byte.txt'), {
      message: poop.message,
    })
  })
})

const write = opts =>
  new Promise((resolve, reject) => {
    const p = new Pack()
    let totalSize = 0
    p.on('data', d => (totalSize += d.length))
    p.once('error', reject)
    p.once('end', () => resolve(totalSize))

    const file1 = new ReadEntry(
      new Header({
        path: 'file1.txt',
        size: 5,
        type: 'File',
      }),
    )
    if (opts.before) {
      file1.end('file1')
      p.add(file1)
    } else {
      p.add(file1)
      file1.end('file1')
    }

    p.end()
  })

test('padding works regardless of arite/add order', async () => {
  const res = await Promise.all([
    write({ before: true }),
    write({ before: false }),
  ])
  assert.equal(
    res[0],
    res[1],
    'length is the same regardless of write/add order',
  )
})

// The data of an async Pack or of a PackSync that ended.
const dataOf = p => (p instanceof PackSync ? p.read() : p.concat())

const classes = [
  ['async', Pack],
  ['sync', PackSync],
]

describe('prefix and subdirs', () => {
  const expect = [
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

  for (const [name, Class] of classes) {
    for (const path of ['.', './']) {
      test(`${name} ${path}`, async () => {
        const dir = testdir({
          in: {
            a: { b: { c: { d: 'ddd' }, d: 'ddd' }, d: 'ddd' },
            d: 'ddd',
          },
        })
        const p = new Class({ cwd: dir + '/in', prefix: 'out/x' })
        const data = await dataOf(p.end(path))
        expect.forEach((e, i) =>
          assert.equal(
            e,
            data.subarray(i * 512, i * 512 + e.length).toString(),
          ),
        )
      })
    }
  }
})

// https://github.com/npm/node-tar/issues/284
describe('prefix and hard links', () => {
  const expect = [
    'out/x/\0',
    {
      type: 'File',
      size: 3,
      path: 'out/x/target',
      linkpath: '',
    },
    'ddd\0\0\0\0\0\0\0\0\0\0\0',
    {
      path: 'out/x/y',
      type: 'Link',
      linkpath: 'out/x/target',
    },
    'out/x/z/\0',
    'out/x/z/b/\0',
    {
      path: 'out/x/z/d',
      type: 'Link',
      linkpath: 'out/x/target',
    },
    'out/x/z/b/c/\0',
    {
      path: 'out/x/z/b/d',
      type: 'Link',
      linkpath: 'out/x/target',
    },
    {
      path: 'out/x/z/b/c/d',
      type: 'Link',
      linkpath: 'out/x/target',
    },
    '\0',
    '\0',
  ]

  for (const [name, Class] of classes) {
    for (const path of ['.', './']) {
      test(`${name} ${path}`, async () => {
        const dir = testdir({ in: { target: 'ddd', z: { b: { c: {} } } } })
        for (const link of ['y', 'z/d', 'z/b/d', 'z/b/c/d']) {
          fs.linkSync(resolve(dir, 'in/target'), resolve(dir, 'in', link))
        }
        const p = new Class({
          cwd: dir + '/in',
          prefix: 'out/x',
          noDirRecurse: true,
          jobs: 1,
        })
        p.write(path)
        for (const entry of [
          'target',
          'y',
          'z',
          'z/b',
          'z/d',
          'z/b/c',
          'z/b/d',
          'z/b/c/d',
        ]) {
          p.write(`./${entry}`)
        }
        const data = await dataOf(p.end())
        expect.forEach((e, i) => {
          if (typeof e === 'string') {
            assert.equal(
              data.subarray(i * 512, i * 512 + e.length).toString(),
              e,
            )
          } else {
            assert.match(
              new Header(data.subarray(i * 512, (i + 1) * 512)),
              e,
            )
          }
        })
      })
    }
  }
})

// Makes a package folder with three hard links to the target, and goes
// into the folder that has it. Returns the path of the target.
const linkedPackage = (targetPath, extra = {}) => {
  const dir = testdir({
    output: {},
    ...extra,
    pkgB: {
      'package.json': JSON.stringify({
        name: 'pkgb',
        version: '1.2.3',
        main: './dist/index.js',
      }),
      'aaa.js': 'console.log("hello, world")',
      dist: {},
    },
  })
  const target = resolve(dir, targetPath)
  for (const link of ['index.js', 'foo.js', 'dist/index.js']) {
    fs.linkSync(target, resolve(dir, 'pkgB', link))
  }
  const cwd = process.cwd()
  cleanup(() => process.chdir(cwd))
  process.chdir(dir)
  return target
}

// A Pack class with an fs that gives sorted readdir results, and that
// is slow to lstat the target.
const slowTargetPack = async target => {
  const mockFs = {
    ...fs,
    // ensure that readdir is sorted, for test consistency
    readdir: (...args) => {
      const cb = args.pop()
      fs.readdir(...args, (er, results) => {
        return cb(
          er,
          results?.sort((a, b) => a.localeCompare(b, 'en')),
        )
      })
    },
    // make it take longer to stat the target, so it comes in last,
    // even though it's typically first in the queue.
    lstat: (path, cb) => {
      if (path === target) {
        setTimeout(() => fs.lstat(target, cb), 200)
      } else {
        return fs.lstat(path, cb)
      }
    },
  }
  const { Pack } = await mockImport(
    () => import('../src/pack.js'),
    [[() => import('fs'), { ...mockFs, default: mockFs }]],
  )
  return Pack
}

// Packs pkgB with many jobs, and calls onReadEntry for each entry of the
// archive.
const packLinkedPackage = async (Pack, onReadEntry) => {
  const p = new Pack({ jobs: 999 })
    .add('pkgB')
    .end()
    .pipe(
      new Parser({
        onReadEntry(entry) {
          onReadEntry(entry)
          entry.resume()
        },
      }),
    )
  await new Promise(res => p.on('end', res))
}

// https://github.com/isaacs/node-tar/issues/448
test('aggressive async link target timing', async () => {
  const target = linkedPackage('pkgB/aaa.js')
  const Pack = await slowTargetPack(target)
  let sawFile = false
  let sawLinks = 0
  await packLinkedPackage(Pack, entry => {
    if (entry.path === 'pkgB/aaa.js') {
      sawFile = true
      assert.equal(entry.type, 'File')
    } else if (entry.type === 'Link') {
      assert.equal(entry.linkpath, 'pkgB/aaa.js')
      assert.equal(sawFile, true)
      sawLinks++
    }
  })
  assert.equal(sawFile, true)
  assert.equal(sawLinks, 3)
})

// regression in PENDINGLINKS update, if only ONE hardlink is seen
// it'll be treated as the "link" if not current entry, and deferred
// forever.
test('avoid permanent link deferral', async () => {
  const target = linkedPackage('externalTarget', {
    externalTarget: 'hello',
  })
  const Pack = await slowTargetPack(target)
  const links = new Set()
  await packLinkedPackage(Pack, entry => {
    if (entry.type === 'Link') {
      links.add(entry.path)
      links.add(entry.linkpath)
    }
  })
  assert.deepEqual(
    links,
    new Set(['pkgB/index.js', 'pkgB/foo.js', 'pkgB/dist/index.js']),
  )
})

describe('end with a callback', () => {
  test('callback only', async () => {
    let called = 0
    const p = new Pack({ cwd: files }).add('one-byte.txt')
    p.end(() => called++)
    assert.equal(called, 1)
    const data = await p.concat()
    assert.equal(nameAt(data, 0), 'one-byte.txt')
    assert.equal(data.length, 2048)
  })

  test('path and callback', async () => {
    let called = 0
    const p = new Pack({ cwd: files })
    p.end('one-byte.txt', () => called++)
    assert.equal(called, 1)
    const data = await p.concat()
    assert.equal(nameAt(data, 0), 'one-byte.txt')
    assert.equal(data.length, 2048)
  })
})
