import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import zlib from 'node:zlib'
import {
  assert,
  cleanup,
  describe,
  env,
  mockImport,
  spyOn,
  stub,
  test,
  testdir,
} from 'ubqtest'
import type { Codec } from '../src/codec.js'
import * as core from '../src/index.js'
import * as tar from '../src/server/index.js'
import { files } from './create-helpers.js'
import { collect } from './create-helpers.js'
import { isDeno, isWindows } from './helpers.js'

// Options that fit `create` and `createSync`.
type Options = Pick<
  tar.CreateOptions,
  'gzip' | 'brotli' | 'zstd' | 'processUid' | 'processUname'
>

const tree = () =>
  testdir({
    src: { 'a.txt': 'alpha', sub: { 'b.txt': 'beta' } },
    out: {},
  })

// Make a folder, and make it the working directory of the test.
const chdir = (dir: string) => {
  const before = process.cwd()
  process.chdir(dir)
  cleanup(() => process.chdir(before))
  return dir
}

const text = (dir: string, path: string) =>
  nodeFs.readFileSync(resolve(dir, path), 'utf8')

const listed = async (opt: tar.ListOptions) => {
  const found: string[] = []
  await tar.list({ ...opt, onEntry: entry => found.push(entry.path) })
  return found
}
const listedSync = (opt: tar.ListOptionsSync) => {
  const found: string[] = []
  tar.listSync({ ...opt, onEntry: entry => found.push(entry.path) })
  return found
}

describe('the exports', () => {
  test('all of the core, and the sync commands and classes', () => {
    const names = Object.keys(tar).sort()
    for (const name of Object.keys(core)) assert.contains(names, name)
    assert.deepEqual(
      names.filter(name => !(name in core)),
      [
        'PackSync',
        'ReadEntrySync',
        'TarReaderSync',
        'UnpackSync',
        'createSync',
        'entriesSync',
        'extractSync',
        'listSync',
        'replaceSync',
        'updateSync',
        'zlibCodecs',
        'zlibStream',
      ],
    )
    assert.equal(tar.c, tar.create)
    assert.equal(tar.x, tar.extract)
    assert.equal(tar.t, tar.list)
    assert.equal(tar.r, tar.replace)
    assert.equal(tar.u, tar.update)
    // The commands are not the commands of the core.
    for (const name of [
      'create',
      'extract',
      'list',
      'replace',
      'update',
      'entries',
    ] as const) {
      assert.notEqual<unknown>(tar[name], core[name])
    }
    assert.equal(tar.Pack, core.Pack)
    assert.equal(tar.Parser, core.Parser)
    assert.equal(tar.Header, core.Header)
  })
})

describe('the defaults', () => {
  test('async commands, in the working directory', async () => {
    const dir = chdir(tree())
    await tar.create({ file: 'a.tar' }, ['src'])
    const expect = ['src/', 'src/a.txt', 'src/sub/', 'src/sub/b.txt']
    assert.deepEqual(await listed({ file: 'a.tar' }), expect)
    assert.deepEqual(await listed({ file: 'a.tar' }), expect)

    // a relative cwd
    await tar.extract({ file: 'a.tar', cwd: 'out' })
    assert.equal(text(dir, 'out/src/sub/b.txt'), 'beta')
    // no cwd
    nodeFs.rmSync(resolve(dir, 'src'), { recursive: true })
    await tar.extract({ file: 'a.tar' })
    assert.equal(text(dir, 'src/a.txt'), 'alpha')

    await tar.replace({ file: 'a.tar', cwd: 'out/src' }, ['a.txt'])
    assert.deepEqual(await listed({ file: 'a.tar' }), [...expect, 'a.txt'])
    const old = new Date('1999-01-01T00:00:00Z')
    nodeFs.utimesSync(resolve(dir, 'src/a.txt'), old, old)
    await tar.update({ file: 'a.tar' }, ['src/a.txt', 'out/src/a.txt'])
    assert.deepEqual(await listed({ file: 'a.tar' }), [
      ...expect,
      'a.txt',
      'out/src/a.txt',
    ])

    const found: string[] = []
    for await (const entry of tar.entries(
      nodeFs.readFileSync(resolve(dir, 'a.tar')),
    )) {
      found.push(entry.path)
    }
    assert.equal(found.length, 6)
  })

  test('sync commands, in the working directory', () => {
    const dir = chdir(tree())
    tar.createSync({ file: 'a.tar' }, ['src'])
    const expect = ['src/', 'src/a.txt', 'src/sub/', 'src/sub/b.txt']
    assert.deepEqual(listedSync({ file: 'a.tar' }), expect)

    tar.extractSync({ file: 'a.tar', cwd: 'out' })
    assert.equal(text(dir, 'out/src/sub/b.txt'), 'beta')
    nodeFs.rmSync(resolve(dir, 'src'), { recursive: true })
    tar.extractSync({ file: 'a.tar' })
    assert.equal(text(dir, 'src/a.txt'), 'alpha')

    tar.replaceSync({ file: 'a.tar', cwd: 'out/src' }, ['a.txt'])
    assert.deepEqual(listedSync({ file: 'a.tar' }), [...expect, 'a.txt'])
    const old = new Date('1999-01-01T00:00:00Z')
    nodeFs.utimesSync(resolve(dir, 'src/a.txt'), old, old)
    tar.updateSync({ file: 'a.tar' }, ['src/a.txt', 'out/src/a.txt'])
    assert.deepEqual(listedSync({ file: 'a.tar' }), [
      ...expect,
      'a.txt',
      'out/src/a.txt',
    ])

    const found = [
      ...tar.entriesSync(nodeFs.readFileSync(resolve(dir, 'a.tar'))),
    ]
    assert.equal(found.length, 6)
  })

  test('a relative cwd, from a different directory', async () => {
    const dir = tree()
    const cwd = relative(process.cwd(), resolve(dir, 'src'))
    assert.notEqual(cwd, resolve(cwd))
    const stream = tar.create({ cwd }, ['a.txt'])
    const data = await collect(stream)
    assert.deepEqual(
      [...tar.entriesSync(data)].map(e => e.path),
      ['a.txt'],
    )
    const sync = Buffer.concat([...tar.createSync({ cwd }, ['a.txt'])])
    assert.deepEqual(
      [...tar.entriesSync(sync)].map(e => e.path),
      ['a.txt'],
    )
  })

  // Windows has no process.getuid, so no file is a file of the user
  // of the process.
  const noUid = isWindows && 'Windows has no process.getuid'
  test('the user of the process', { skip: noUid }, async () => {
    env({ USER: 'someone' })
    const dir = tree()
    const uname = async (opt: Options) => {
      const data = await collect(
        tar.create({ cwd: dir, ...opt, file: undefined }, ['src/a.txt']),
      )
      const sync = Buffer.concat([
        ...tar.createSync({ cwd: dir, ...opt, file: undefined }, [
          'src/a.txt',
        ]),
      ])
      const [a] = [...tar.entriesSync(data)]
      const [b] = [...tar.entriesSync(sync)]
      assert.equal(a?.uname, b?.uname)
      return a?.uname
    }
    assert.equal(await uname({}), 'someone')
    // The options of the caller win.
    assert.equal(await uname({ processUname: 'custom' }), 'custom')
    assert.equal(await uname({ processUid: -1 }), '')
    assert.equal(await uname({ processUid: undefined }), 'someone')
  })

  test('a runtime with no process.getuid', async () => {
    stub(process, 'getuid', undefined)
    stub(process, 'getgid', undefined)
    const dir = chdir(tree())
    await tar.create({ file: 'a.tar' }, ['src'])
    tar.createSync({ file: 's.tar' }, ['src'])
    // The first pack can change an access time, so compare the
    // entries, not the bytes.
    const users = (file: string) =>
      [...tar.entriesSync(nodeFs.readFileSync(file))].map(e => [
        e.path,
        e.uname,
        e.uid,
      ])
    assert.equal(users('a.tar').length, 4)
    assert.deepEqual(users('a.tar'), users('s.tar'))
    assert.equal(
      tar.entriesSync(nodeFs.readFileSync('a.tar')).next().value?.uname,
      '',
    )
    await tar.extract({ file: 'a.tar', cwd: 'out' })
    assert.equal(text(dir, 'out/src/a.txt'), 'alpha')
    nodeFs.rmSync('out/src', { recursive: true })
    tar.extractSync({ file: 's.tar', cwd: 'out' })
    assert.equal(text(dir, 'out/src/a.txt'), 'alpha')
  })

  test('process.umask is called only for chmod', async () => {
    const dir = tree()
    const file = resolve(dir, 'a.tar')
    const cwd = resolve(dir, 'out')
    tar.createSync({ file, cwd: dir }, ['src'])
    const umask = spyOn(process, 'umask', () => 0o22)

    await tar.extract({ file, cwd })
    tar.extractSync({ file, cwd })
    await tar.list({ file })
    await tar.extract({ file, cwd, chmod: true, processUmask: 0o22 })
    tar.extractSync({ file, cwd, chmod: true, processUmask: 0o22 })
    assert.equal(umask.calls.length, 0)

    await tar.extract({ file, cwd, chmod: true })
    assert.equal(umask.calls.length, 1)
    tar.extractSync({ file, cwd, chmod: true })
    assert.equal(umask.calls.length, 2)
    assert.equal(text(cwd, 'src/a.txt'), 'alpha')
  })

  test('the options of the caller win', async () => {
    const dir = tree()
    const file = resolve(dir, 'a.tar')
    tar.createSync({ file, cwd: dir }, ['src'])

    // fs
    const opened: string[] = []
    const fs = {
      ...nodeFsPromises,
      open: (path: string, flags: string) => {
        opened.push(path)
        return nodeFsPromises.open(path, flags)
      },
    }
    const fsSync = {
      ...nodeFs,
      openSync: (path: string, flags: string) => {
        opened.push(path)
        return nodeFs.openSync(path, flags)
      },
    }
    assert.equal((await listed({ file, fs })).length, 4)
    assert.equal(listedSync({ file, fs: fsSync }).length, 4)
    assert.deepEqual(opened, [file, file])
    // An option that is set to undefined gets the default.
    assert.equal((await listed({ file, fs: undefined })).length, 4)

    // platform
    const win = await collect(
      tar.create({ cwd: dir, platform: 'win32' }, ['src\\a.txt']),
    )
    assert.deepEqual(
      [...tar.entriesSync(win)].map(e => e.path),
      ['src/a.txt'],
    )
    // On Windows, the default is 'win32', and Windows itself takes
    // the `\` as a separator.
    if (!isWindows) {
      await assert.rejects(
        collect(tar.create({ cwd: dir }, ['src\\a.txt'])),
        { code: 'ENOENT' },
      )
    }

    // codecs: the codec of the caller is before the zlib codecs
    const used: string[] = []
    const [gz] = tar.zlibCodecs()
    assert(gz)
    const mine: Codec = {
      ...gz,
      compress: options => {
        used.push('compress')
        return gz.compress!(options)
      },
      decompress: () => {
        used.push('decompress')
        return gz.decompress()
      },
    }
    const data = await collect(
      tar.create({ cwd: dir, gzip: true, codecs: [mine] }, ['src/a.txt']),
    )
    assert.deepEqual(
      new Uint8Array(data.subarray(0, 2)),
      new Uint8Array([0x1f, 0x8b]),
    )
    assert.equal((await listed({ input: data, codecs: [mine] })).length, 1)
    assert.deepEqual(used, ['compress', 'decompress'])
    assert.equal((await listed({ input: data })).length, 1)
    assert.deepEqual(used, ['compress', 'decompress'])
  })
})

describe('compression', () => {
  const formats = [
    ['gzip', 'a.tgz', zlib.gunzipSync],
    ['brotli', 'a.tbr', zlib.brotliDecompressSync],
    ['zstd', 'a.tzst', zlib.zstdDecompressSync],
  ] as const
  const expect = ['src/', 'src/a.txt', 'src/sub/', 'src/sub/b.txt']

  for (const [name, archive, unzip] of formats) {
    test(`${name}: async`, async () => {
      const dir = tree()
      const file = resolve(dir, archive)
      // With portable, the archive has no access times, so two packs
      // of the folder have the same bytes.
      const opt = { cwd: dir, [name]: true, portable: true }
      await tar.create({ ...opt, file }, ['src'])
      const plain = unzip(nodeFs.readFileSync(file))
      assert.deepEqual(
        [...tar.entriesSync(plain)].map(e => e.path),
        expect,
      )
      assert.deepEqual(await listed({ file }), expect)
      await tar.extract({ file, cwd: resolve(dir, 'out') })
      assert.equal(text(dir, 'out/src/sub/b.txt'), 'beta')

      // to a stream, and from data in memory
      const data = await collect(tar.create(opt, ['src']))
      assert.deepEqual(new Uint8Array(unzip(data)), new Uint8Array(plain))
      assert.deepEqual(await listed({ input: data, file }), expect)
      const found: string[] = []
      for await (const entry of tar.entries(data, { file })) {
        found.push(entry.path)
      }
      assert.deepEqual(found, expect)
    })

    test(`${name}: sync`, () => {
      const dir = tree()
      const file = resolve(dir, archive)
      const opt = { cwd: dir, [name]: true, portable: true }
      tar.createSync({ ...opt, file }, ['src'])
      const plain = unzip(nodeFs.readFileSync(file))
      assert.deepEqual(
        [...tar.entriesSync(plain)].map(e => e.path),
        expect,
      )
      assert.deepEqual(listedSync({ file }), expect)
      tar.extractSync({ file, cwd: resolve(dir, 'out') })
      assert.equal(text(dir, 'out/src/sub/b.txt'), 'beta')

      const data = Buffer.concat([...tar.createSync(opt, ['src'])])
      assert.deepEqual(new Uint8Array(unzip(data)), new Uint8Array(plain))
      assert.deepEqual(listedSync({ input: data, file }), expect)
      assert.deepEqual(
        [...tar.entriesSync(data, { file })].map(e => e.path),
        expect,
      )
    })

    test(`${name}: replace and update refuse the archive`, async () => {
      const dir = tree()
      const file = resolve(dir, archive)
      tar.createSync({ file, cwd: dir, [name]: true }, ['src'])
      const before = nodeFs.readFileSync(file)
      const refused = { message: 'cannot append to compressed archives' }
      const opt = { file, cwd: dir }
      await assert.rejects(tar.replace(opt, ['src/a.txt']), refused)
      await assert.rejects(tar.update(opt, ['src/a.txt']), refused)
      assert.throws(() => tar.replaceSync(opt, ['src/a.txt']), refused)
      assert.throws(() => tar.updateSync(opt, ['src/a.txt']), refused)
      // also with a name that does not show the format
      const other = resolve(dir, 'a.tar')
      nodeFs.copyFileSync(file, other)
      const o = { file: other, cwd: dir }
      if (name !== 'brotli') {
        await assert.rejects(tar.replace(o, ['src/a.txt']), refused)
        assert.throws(() => tar.replaceSync(o, ['src/a.txt']), refused)
      }
      assert.deepEqual(nodeFs.readFileSync(file), before)
    })
  }

  test('the options of zlib', async () => {
    const dir = tree()
    nodeFs.writeFileSync(
      resolve(dir, 'src/big.txt'),
      'abc '.repeat(50_000),
    )
    const size = async (opt: Options) => {
      const a = await collect(
        tar.create({ cwd: dir, ...opt, file: undefined }, ['src']),
      )
      const s = Buffer.concat([
        ...tar.createSync({ cwd: dir, ...opt, file: undefined }, ['src']),
      ])
      return [a.length, s.length] as const
    }
    const more = async (big: Options, small: Options, by: number) => {
      const [a, s] = await size(big)
      const [b, t] = await size(small)
      assert.greaterThan(a, by * b)
      assert.greaterThan(s, by * t)
    }
    await more({ gzip: { level: 0 } }, { gzip: { level: 9 } }, 10)
    const quality = zlib.constants.BROTLI_PARAM_QUALITY
    await more(
      { brotli: { params: { [quality]: 0 } } },
      { brotli: { params: { [quality]: 11 } } },
      1,
    )
    const checksum = zlib.constants.ZSTD_c_checksumFlag
    await more(
      { zstd: { params: { [checksum]: 1 } } },
      { zstd: { params: { [checksum]: 0 } } },
      1,
    )
  })

  test('two formats', () => {
    assert.throws(() => tar.create({ gzip: true, zstd: true }, ['x']), {
      name: 'TypeError',
      message: 'gzip, zstd are mutually exclusive',
    })
  })

  test('portable gzip has no system byte', async () => {
    const dir = testdir()
    const paths = ['dir', 'one-byte.txt', '1024-bytes.txt', 'long-path']
    const opt = { cwd: files, gzip: true, portable: true }
    const at = (name: string) => resolve(dir, name)
    tar.createSync({ ...opt, file: at('sync.tgz') }, paths)
    await tar.create({ ...opt, file: at('async.tgz') }, paths)
    // The byte is 255, which means that the system is not known.
    assert.equal(nodeFs.readFileSync(at('sync.tgz'))[9], 255)
    assert.equal(nodeFs.readFileSync(at('async.tgz'))[9], 255)

    // With no portable option, the header names the system.
    tar.createSync({ ...opt, portable: false, file: at('os.tgz') }, paths)
    assert.equal(
      nodeFs.readFileSync(at('os.tgz'))[9],
      zlib.gzipSync('')[9],
    )
    assert.notEqual(zlib.gzipSync('')[9], 255)
  })
})

// The mockImport of ubq does not replace `node:zlib` on Deno.
const noMock = isDeno && 'ubq cannot mock node:zlib on Deno'
describe('a runtime with no zstd', { skip: noMock }, () => {
  test('the entry point loads, and has no zstd codec', async () => {
    const lean = await mockImport(
      () => import('../src/server/index.js'),
      [
        [
          () => import('node:zlib'),
          {
            createZstdCompress: undefined,
            createZstdDecompress: undefined,
            zstdCompressSync: undefined,
            zstdDecompressSync: undefined,
          } as unknown as Partial<typeof zlib>,
        ],
      ],
    )
    assert.deepEqual(
      lean.zlibCodecs().map(c => c.name),
      ['gzip', 'brotli'],
    )
    const dir = tree()
    assert.throws(
      () => lean.createSync({ cwd: dir, zstd: true }, ['src']),
      {
        name: 'TypeError',
        message: 'no codec named zstd has a compressSync function',
      },
    )
    const gz = Buffer.concat([
      ...lean.createSync({ cwd: dir, gzip: true }, ['src/a.txt']),
    ])
    assert.equal([...lean.entriesSync(gz)].length, 1)
    // Zstd data is not a known format.
    const zst = Buffer.concat([
      ...tar.createSync({ cwd: dir, zstd: true }, ['src/a.txt']),
    ])
    assert.equal([...tar.entriesSync(zst)].length, 1)
    assert.throws(() => [...lean.entriesSync(zst, { strict: true })], {
      tarCode: 'TAR_BAD_ARCHIVE',
    })
  })
})

describe('Windows', () => {
  test('a process that is not on Windows has the platform posix', async () => {
    stub(process, 'platform', 'linux')
    const posix = await mockImport(
      () => import('../src/server/index.js'),
      [[() => import('../src/server/codecs.js'), {}]],
    )
    // The readers need no cwd. The `\\` is a character of the name
    // of the entry.
    const block = new Uint8Array(512)
    new posix.Header({ path: 'a\\b', type: 'File', size: 0 }).encode(block)
    const data = Buffer.concat([block, new Uint8Array(1024)])
    const pathOf = (opt: { platform?: 'win32' | 'posix' }) =>
      [...posix.entriesSync(data, opt)].map(e => e.path)
    assert.deepEqual(pathOf({}), ['a\\b'])
    // The option of the caller wins.
    assert.deepEqual(pathOf({ platform: 'win32' }), ['a/b'])
  })

  test('the platform of the process is the default', async () => {
    stub(process, 'platform', 'win32')
    const win = await mockImport(
      () => import('../src/server/index.js'),
      [[() => import('../src/server/codecs.js'), {}]],
    )
    const dir = tree()
    const data = Buffer.concat([
      ...win.createSync({ cwd: dir }, ['src\\a.txt']),
    ])
    assert.deepEqual(
      [...win.entriesSync(data)].map(e => e.path),
      ['src/a.txt'],
    )
    // The option of the caller wins. With 'posix', the `\\` is a
    // character of the name, and no file has that name. On Windows,
    // the cwd of the test is not an absolute path for 'posix'.
    const posix = () => [
      ...win.createSync({ cwd: dir, platform: 'posix' }, ['src\\a.txt']),
    ]
    assert.throws(
      posix,
      isWindows ?
        { name: 'TypeError', message: 'cwd must be an absolute path' }
      : { code: 'ENOENT' },
    )
  })
})
