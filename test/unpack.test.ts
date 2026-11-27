import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { basename } from 'node:path'
import zlib from 'node:zlib'
import { any, assert, describe, test } from 'ubqtest'
import { Header, type HeaderData } from '../src/header.js'
import { gzip, type Codec } from '../src/codec.js'
import type { ExtractFS, ExtractFSSync } from '../src/fs.js'
import { ReadEntry, ReadEntrySync } from '../src/read-entry.js'
import { Pax } from '../src/pax.js'
import { makeTar } from './fixtures/make-tar.js'
import {
  extract,
  extractSync,
  fsPath,
  hookFs,
  isWindows,
  linkTarget,
  resolve,
  rootOf,
  runExtract,
  SKIP,
  statMode,
  testdir,
  Unpack,
  UnpackSync,
} from './helpers.js'

// The modules of Node fit the adapter types as they are.
const fs: ExtractFS = nodeFsPromises
const fsSync: ExtractFSSync = nodeFs

const fixtures = resolve(import.meta.dirname, './fixtures')
const tars = resolve(fixtures, 'tars')
const parses = resolve(fixtures, 'parse')

const modes = ['async', 'sync'] as const

// Gzip for the sync reader, which has no codec of its own.
const gunzip: Codec = {
  ...gzip,
  decompressSync: (data, limit) =>
    zlib.gunzipSync(data, isFinite(limit.maxOutputLength) ? limit : {}),
}

const makeCompressedBomb = () => {
  const payload = Buffer.alloc(8 * 1024 * 1024)
  return zlib.gzipSync(
    makeTar([
      { path: 'bomb', size: payload.length, type: 'File' },
      payload,
      '',
      '',
    ]),
  )
}

const poopError = () => Object.assign(new Error('poop'), { code: 'EPOOP' })
const thrower = (er: Error) => () => {
  throw er
}

const read = (file: string) => nodeFs.readFileSync(file, 'utf8')
const isFile = (f: string) => nodeFs.lstatSync(f).isFile()
const isSymlink = (f: string) => nodeFs.lstatSync(f).isSymbolicLink()
const modeOf = (f: string) => nodeFs.lstatSync(f).mode & 0o7777

const ATIME = new Date('1979-07-01T19:10:00.000Z')
const MTIME = new Date('2011-03-27T22:16:31.000Z')
const times = { atime: ATIME, ctime: MTIME, mtime: MTIME }

describe('basic file unpack tests', () => {
  const cases: Record<string, Record<string, string>> = {
    'emptypax.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'one-byte.txt': 'a',
    },
    'body-byte-counts.tar': {
      '1024-bytes.txt': 'x'.repeat(1023) + '\n',
      '512-bytes.txt': 'x'.repeat(511) + '\n',
      'one-byte.txt': 'a',
      'zero-byte.txt': '',
    },
    'utf8.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'Ω.txt': 'Ω',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω',
    },
    'file.tar': {
      'one-byte.txt': 'a',
    },
    'global-header.tar': {
      'one-byte.txt': 'a',
    },
    'long-pax.tar': {
      ['120-byte-filename-' + 'c'.repeat(102)]: 'c'.repeat(100),
    },
    'long-paths.tar': {
      ['100-byte-filename-' + 'c'.repeat(82)]: 'c'.repeat(100),
      ['120-byte-filename-' + 'c'.repeat(102)]: 'c'.repeat(100),
      ['170-byte-filename-' + 'c'.repeat(152)]: 'c'.repeat(100),
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt':
        'short\n',
      ['long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/' +
      'c'.repeat(100)]: 'c'.repeat(100),
      ['long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/' +
      'c'.repeat(120)]: 'c'.repeat(100),
      ['long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/' +
      'x'.repeat(50) +
      'c'.repeat(120)]: 'c'.repeat(100),
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω',
    },
  }

  for (const [tarfile, expect] of Object.entries(cases)) {
    const tf = resolve(tars, tarfile)
    for (const mode of modes) {
      for (const strict of [true, false]) {
        const name = `${tarfile} ${mode} ${strict ? 'strict' : 'loose'}`
        test(name, async () => {
          // Unpack through a symbolic link to the directory.
          const root = testdir({ dir: {} })
          const dir = root + '/dir'
          const cwd = root + '/link'
          nodeFs.symlinkSync(dir, cwd)
          if (mode === 'sync') {
            const input = nodeFs.readFileSync(tf)
            extractSync({ cwd, strict, fs: fsSync, input })
          } else {
            await extract({ cwd, strict, fs: nodeFsPromises, file: tf })
          }
          for (const [file, content] of Object.entries(expect)) {
            assert.equal(read(resolve(dir, file)), content, file)
          }
        })
      }
    }
  }
})

describe('cwd option', () => {
  const input = new Uint8Array(1024)

  test('cwd is required', () => {
    const opt = { fs, input } as unknown as { cwd: string; fs: ExtractFS }
    assert.throws(() => new Unpack({ ...opt, input }), {
      name: 'TypeError',
      message: 'cwd is required',
    })
  })

  test('cwd must be absolute', async () => {
    const expect = {
      name: 'TypeError',
      message: 'cwd must be an absolute path',
    }
    assert.throws(() => new Unpack({ cwd: 'a/b', fs, input }), expect)
    assert.throws(
      () => new UnpackSync({ cwd: 'c:foo', fs: fsSync, input }),
      expect,
    )
    assert.throws(
      () => extractSync({ cwd: '.', fs: fsSync, input }),
      expect,
    )
    await assert.rejects(extract({ cwd: '', fs, input }), expect)
    assert.throws(
      () => new Unpack({ cwd: 'c:foo', platform: 'win32', fs, input }),
      expect,
    )
  })

  test('cwd is normalized', () => {
    assert.equal(new Unpack({ cwd: '/a/b/../c//', fs, input }).cwd, '/a/c')
    const win = { platform: 'win32', fs, input } as const
    assert.equal(new Unpack({ cwd: 'C:\\a\\b\\', ...win }).cwd, 'C:/a/b')
    assert.equal(new Unpack({ cwd: 'c:/', ...win }).cwd, 'c:/')
    assert.equal(new Unpack({ cwd: '/a/', ...win }).cwd, '/a')
  })
})

describe('links!', () => {
  const data = nodeFs.readFileSync(tars + '/links.tar')
  const stripData = nodeFs.readFileSync(tars + '/links-strip.tar')

  const checkSymlink = (dir: string) => {
    assert(isSymlink(dir + '/symlink'))
    assert.equal(nodeFs.readlinkSync(dir + '/symlink'), 'hardlink-2')
  }
  const check = (dir: string) => {
    const hl1 = nodeFs.lstatSync(dir + '/hardlink-1')
    const hl2 = nodeFs.lstatSync(dir + '/hardlink-2')
    assert.equal(hl1.dev, hl2.dev)
    assert.equal(hl1.ino, hl2.ino)
    assert.equal(hl1.nlink, 2)
    assert.equal(hl2.nlink, 2)
    checkSymlink(dir)
  }
  const checkForStrip = (dir: string) => {
    const hl1 = nodeFs.lstatSync(dir + '/hardlink-1')
    const hl2 = nodeFs.lstatSync(dir + '/hardlink-2')
    const hl3 = nodeFs.lstatSync(dir + '/1/2/3/hardlink-3')
    assert.equal(hl1.dev, hl2.dev)
    assert.equal(hl1.ino, hl2.ino)
    assert.equal(hl1.dev, hl3.dev)
    assert.equal(hl1.ino, hl3.ino)
    assert.equal(hl1.nlink, 3)
    assert.equal(hl2.nlink, 3)
    checkSymlink(dir)
  }
  const checkForStrip3 = (dir: string) => {
    // strips the linkpath entirely, so the link doesn't get extracted.
    assert.throws(() => nodeFs.lstatSync(dir + '/3'), { code: 'ENOENT' })
  }

  const cases = [
    ['no strip', {}, data, check],
    ['strip', { strip: 1 }, stripData, checkForStrip],
    ['strip 3', { strip: 3 }, stripData, checkForStrip3],
  ] as const
  for (const [name, opt, tar, checkDir] of cases) {
    for (const mode of modes) {
      test(`${mode} ${name}`, async () => {
        const cwd = testdir({})
        await runExtract(mode, { cwd, ...opt }, tar)
        checkDir(cwd)
      })
    }
  }
})

describe('links without cleanup (exercise clobbering code)', () => {
  // All tests of this group unpack into one directory. Each test after
  // the first writes over the entries that the test before it made.
  const dir = testdir({})
  const data = nodeFs.readFileSync(tars + '/links.tar')

  // Put things in the way of the entries. This fails if the entries
  // are there.
  const clobberThisJunk = () => {
    try {
      nodeFs.mkdirSync(dir + '/hardlink-1')
      nodeFs.mkdirSync(dir + '/hardlink-2')
      nodeFs.writeFileSync(dir + '/symlink', 'not a symlink')
    } catch {}
  }

  const check = () => {
    const hl1 = nodeFs.lstatSync(dir + '/hardlink-1')
    const hl2 = nodeFs.lstatSync(dir + '/hardlink-2')
    assert.equal(hl1.dev, hl2.dev)
    assert.equal(hl1.ino, hl2.ino)
    assert.equal(hl1.nlink, 2)
    assert.equal(hl2.nlink, 2)
    assert(isSymlink(dir + '/symlink'))
    assert.equal(nodeFs.readlinkSync(dir + '/symlink'), 'hardlink-2')
  }

  const cases = [
    ['async', 'async', {}],
    ['sync', 'sync', {}],
    ['async again', 'async', {}],
    ['sync again', 'sync', {}],
    ['async unlink', 'async', { unlink: true }],
    ['sync unlink', 'sync', { unlink: true }],
  ] as const
  for (const [name, mode, opt] of cases) {
    test(name, async () => {
      clobberThisJunk()
      const { warnings } = await runExtract(
        mode,
        { cwd: dir, ...opt },
        data,
      )
      assert.deepEqual(warnings, [])
      check()
    })
  }
})

test('nested dir dupe', async () => {
  const dir = testdir({ d: { e: { e: { p: {} } } } })
  const expect = {
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt': 'short\n',
    ['d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/' + 'c'.repeat(100)]: 'c'.repeat(
      100,
    ),
    ['d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/' + 'c'.repeat(120)]: 'c'.repeat(
      100,
    ),
    ['d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/' +
    'x'.repeat(50) +
    'c'.repeat(120)]: 'c'.repeat(100),
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω',
  }
  // while we're at it, why not use gzip too?
  const data = zlib.gzipSync(nodeFs.readFileSync(tars + '/long-paths.tar'))
  await runExtract('async', { cwd: dir, strip: 8 }, data)

  assert.deepEqual(nodeFs.readdirSync(dir), ['d'])
  for (const [f, content] of Object.entries(expect)) {
    assert.equal(read(dir + '/' + f), content)
  }
})

describe('symlink in dir path', () => {
  const data = makeTar([
    { path: 'd/i', type: 'Directory' },
    { path: 'd/i/r/dir', type: 'Directory', mode: 0o751, mtime: MTIME },
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: ATIME,
      ctime: MTIME,
    },
    'a',
    { path: 'd/i/r/link', type: 'Link', linkpath: 'd/i/r/file', ...times },
    {
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      ...times,
    },
    { path: 'd/i/r/symlink/x', type: 'File', size: 0, ...times },
    '',
    '',
  ])

  const checkSymlinkError = (warnings: unknown[][], cwd: string) => {
    assert.equal(warnings.length, 1)
    assert.match<unknown>(warnings[0], [
      'TAR_ENTRY_ERROR',
      'TAR_SYMLINK_ERROR: Cannot extract through symbolic link',
      {
        name: 'SymlinkError',
        code: 'TAR_SYMLINK_ERROR',
        tarCode: 'TAR_ENTRY_ERROR',
        path: cwd + '/d/i/r/symlink/',
        symlink: cwd + '/d/i/r/symlink',
      },
    ])
  }

  for (const mode of modes) {
    test(`no clobbering, ${mode}`, async () => {
      const cwd = testdir({})
      const { warnings } = await runExtract(mode, { cwd }, data)
      assert.equal(modeOf(cwd + '/d/i'), statMode(0o755))
      assert.equal(modeOf(cwd + '/d/i/r/dir'), statMode(0o751))
      assert(isFile(cwd + '/d/i/r/file'), 'got file')
      assert(isSymlink(cwd + '/d/i/r/symlink'), 'got symlink')
      assert.throws(() => nodeFs.statSync(cwd + '/d/i/r/symlink/x'), Error)
      checkSymlinkError(warnings, cwd)
    })

    test(`extract through symlink, ${mode}`, async () => {
      const cwd = testdir({})
      const opt = { cwd, preservePaths: true }
      const { warnings } = await runExtract(mode, opt, data)
      assert.deepEqual(warnings, [])
      assert.equal(modeOf(cwd + '/d/i/r/dir'), statMode(0o751))
      assert(isFile(cwd + '/d/i/r/file'), 'got file')
      assert(isSymlink(cwd + '/d/i/r/symlink'), 'got symlink')
      assert(isFile(cwd + '/d/i/r/dir/x'), 'x thru link')
      assert(isFile(cwd + '/d/i/r/symlink/x'), 'x thru link')
    })

    test(`clobber through symlink, ${mode}`, async () => {
      const cwd = testdir({})
      const opt = { cwd, unlink: true }
      const { warnings } = await runExtract(mode, opt, data)
      assert.deepEqual(warnings, [])
      assert.equal(modeOf(cwd + '/d/i/r/dir'), statMode(0o751))
      assert(isFile(cwd + '/d/i/r/file'), 'got file')
      assert(!isSymlink(cwd + '/d/i/r/symlink'), 'no link')
      assert(
        nodeFs.lstatSync(cwd + '/d/i/r/symlink').isDirectory(),
        'sym is dir',
      )
      assert(isFile(cwd + '/d/i/r/symlink/x'), 'x thru link')
    })

    test(`clobber through symlink with busted unlink, ${mode}`, async () => {
      const poop = new Error('poop')
      const cwd = testdir({})
      const opt = { cwd, unlink: true }
      const { warnings } = await runExtract(mode, opt, data, {
        unlink: thrower(poop),
      })
      assert.deepEqual<unknown>(warnings, [
        ['TAR_ENTRY_ERROR', 'poop', poop],
      ])
    })

    test(`clobber dirs, ${mode}`, async () => {
      const cwd = testdir({
        d: { i: { r: { dir: {}, file: {}, link: {}, symlink: {} } } },
      })
      const opt = { cwd, chmod: true, processUmask: 0o22 }
      const { warnings } = await runExtract(mode, opt, data)
      assert.equal(modeOf(cwd + '/d/i/r/dir'), statMode(0o751))
      assert(isFile(cwd + '/d/i/r/file'), 'got file')
      assert(isSymlink(cwd + '/d/i/r/symlink'), 'got symlink')
      assert.throws(() => nodeFs.statSync(cwd + '/d/i/r/symlink/x'), Error)
      checkSymlinkError(warnings, cwd)
    })
  }
})

describe('unsupported entries', () => {
  const unknown = new Header({ path: 'qux', size: 4 })
  unknown.encode()
  assert(unknown.block)
  unknown.block[156] = 'Z'.charCodeAt(0)
  const data = makeTar([
    { path: 'dev/random', type: 'CharacterDevice' },
    { path: 'dev/hd0', type: 'BlockDevice' },
    { path: 'dev/fifo0', type: 'FIFO' },
    // The header of the unknown type and its body do not have a valid
    // checksum. Each one gives a warning.
    unknown.block,
    'asdf',
    '',
    '',
  ])

  for (const mode of modes) {
    test(`basic, warns, ${mode}`, async () => {
      const cwd = testdir({})
      const { warnings } = await runExtract(mode, { cwd }, data)
      assert.equal(nodeFs.readdirSync(cwd).length, 0)
      assert.match<unknown>(warnings, [
        [
          'TAR_ENTRY_UNSUPPORTED',
          'unsupported entry type: CharacterDevice',
          { entry: { path: 'dev/random', unsupported: true } },
        ],
        [
          'TAR_ENTRY_UNSUPPORTED',
          'unsupported entry type: BlockDevice',
          { entry: { path: 'dev/hd0', unsupported: true } },
        ],
        [
          'TAR_ENTRY_UNSUPPORTED',
          'unsupported entry type: FIFO',
          { entry: { path: 'dev/fifo0', unsupported: true } },
        ],
        ['TAR_ENTRY_INVALID', 'checksum failure', { header: any.object }],
        ['TAR_ENTRY_INVALID', 'checksum failure', { header: any.object }],
      ])
    })

    test(`strict, throws, ${mode}`, async () => {
      const cwd = testdir({})
      const er = await assert.rejects(
        runExtract(mode, { cwd, strict: true }, data),
        {
          message:
            'TAR_ENTRY_UNSUPPORTED: unsupported entry type: CharacterDevice',
          tarCode: 'TAR_ENTRY_UNSUPPORTED',
          cwd,
        },
      )
      assert.match<unknown>(er, { entry: { path: 'dev/random' } })
      assert.equal(nodeFs.readdirSync(cwd).length, 0)
    })
  }

  test('a device entry with a bad path gets the path warning', async () => {
    const cwd = testdir({})
    const data = makeTar([
      { path: 'a/../dev', type: 'CharacterDevice' },
      '',
      '',
    ])
    const { warnings } = await runExtract('async', { cwd }, data)
    assert.deepEqual(
      warnings.map(w => w.slice(0, 2)),
      [['TAR_ENTRY_ERROR', "path contains '..'"]],
    )
  })
})

describe('file in dir path', () => {
  const data = makeTar([
    { path: 'd/i/r/file', type: 'File', size: 1, ...times },
    'a',
    { path: 'd/i/r/file/a/b/c', type: 'File', size: 1, ...times },
    'b',
    '',
    '',
  ])

  for (const mode of modes) {
    test(`fail because of file, ${mode}`, async () => {
      const cwd = testdir({})
      const { warnings } = await runExtract(mode, { cwd }, data)
      assert.equal(read(cwd + '/d/i/r/file'), 'a')
      assert.throws(
        () => nodeFs.statSync(cwd + '/d/i/r/file/a/b/c'),
        Error,
      )
      assert.match<unknown>(warnings, [
        ['TAR_ENTRY_ERROR', /^EEXIST/, { code: 'EEXIST' }],
      ])
    })

    test(`clobber on through, ${mode}`, async () => {
      const cwd = testdir({})
      await runExtract(mode, { cwd, unlink: true }, data)
      assert(nodeFs.statSync(cwd + '/d/i/r/file').isDirectory())
      assert.equal(read(cwd + '/d/i/r/file/a/b/c'), 'b')
    })
  }
})

for (const mode of modes) {
  test(`set umask option, ${mode}`, async () => {
    const cwd = testdir({})
    const data = makeTar([
      { path: 'd/i/r/dir', type: 'Directory', mode: 0o751 },
      { path: 'd/i/r/f', type: 'File' },
      '',
      '',
    ])
    await runExtract(mode, { umask: 0o027, cwd }, data)
    assert.equal(modeOf(cwd + '/d/i/r'), statMode(0o750))
    assert.equal(modeOf(cwd + '/d/i/r/dir'), statMode(0o751))
    assert.equal(modeOf(cwd + '/d/i/r/f'), statMode(0o640))
  })

  test(`dmode and fmode options, ${mode}`, async () => {
    const cwd = testdir({})
    const data = makeTar([{ path: 'd/f', type: 'File' }, '', ''])
    await runExtract(mode, { dmode: 0o700, fmode: 0o600, cwd }, data)
    assert.equal(modeOf(cwd + '/d'), statMode(0o700))
    assert.equal(modeOf(cwd + '/d/f'), statMode(0o600))
  })
}

// A tar with one file of one byte at the path.
const oneFileTar = (path: string, content: string) =>
  makeTar([{ path, type: 'File', size: 1, ...times }, content, '', ''])

describe('absolute paths', () => {
  const setup = () => {
    const dir = testdir({})
    const absolute = resolve(dir, 'd/i/r/absolute')
    const root = rootOf(absolute)
    // A path of Windows has one root, the drive.
    const extra = isWindows ? '' : '///'
    const extraAbsolute = extra + absolute
    const relative = absolute.slice(root.length)
    return { dir, absolute, extraAbsolute, relative, root: extra + root }
  }

  for (const mode of modes) {
    test(`warn and correct, ${mode}`, async () => {
      const { dir, extraAbsolute, relative, root } = setup()
      const data = oneFileTar(extraAbsolute, 'a')
      const { warnings } = await runExtract(mode, { cwd: dir }, data)
      assert.match<unknown>(warnings, [
        [
          'TAR_ENTRY_INFO',
          `stripping ${root} from absolute path`,
          { path: extraAbsolute, code: 'TAR_ENTRY_INFO' },
        ],
      ])
      assert(isFile(resolve(dir, relative)), 'is file')
    })

    test(`preserve absolute path, ${mode}`, async () => {
      const { dir, absolute, extraAbsolute } = setup()
      const data = oneFileTar(extraAbsolute, 'a')
      const opt = { preservePaths: true, cwd: dir }
      const { warnings } = await runExtract(mode, opt, data)
      assert.deepEqual(warnings, [])
      assert(isFile(absolute), 'is file')
    })
  }
})

describe('.. paths', () => {
  const fmode = 0o755
  const dotted = 'a/b/c/../d'
  const data = oneFileTar(dotted, 'd')

  for (const mode of modes) {
    test(`warn and skip, ${mode}`, async () => {
      const dir = testdir({})
      const { warnings } = await runExtract(
        mode,
        { fmode, cwd: dir },
        data,
      )
      assert.match<unknown>(warnings, [
        [
          'TAR_ENTRY_ERROR',
          "path contains '..'",
          { path: dotted, code: 'TAR_ENTRY_ERROR' },
        ],
      ])
      assert.deepEqual(nodeFs.readdirSync(dir), [])
    })

    test(`preserve dotted path, ${mode}`, async () => {
      const dir = testdir({})
      const resolved = resolve(dir, dotted)
      const opt = { fmode, preservePaths: true, cwd: dir }
      const { warnings } = await runExtract(mode, opt, data)
      assert.deepEqual(warnings, [])
      assert(isFile(resolved), 'is file')
      assert.equal(modeOf(resolved), statMode(fmode))
    })
  }
})

describe('fail all stats', () => {
  const poop = poopError()
  const data = makeTar([
    { path: 'd/i/r/file/', type: 'Directory', ...times },
    { path: 'd/i/r/dir/', type: 'Directory', mode: 0o751, ...times },
    { path: 'd/i/r/file', type: 'File', size: 1, ...times },
    'a',
    { path: 'd/i/r/link', type: 'Link', linkpath: 'd/i/r/file', ...times },
    {
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      ...times,
    },
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      // don't fail statting the cwd, or we get different errors
      const fail = (p: unknown) => {
        if (p !== cwd) throw poop
      }
      // One entry at a time. If not, an entry can make each
      // directory first, and then it needs no lstat.
      const { warnings } = await runExtract(mode, { cwd, jobs: 1 }, data, {
        stat: fail,
        lstat: fail,
      })
      // One warning for each of the 5 entries.
      assert.deepEqual<unknown>(
        warnings,
        Array.from({ length: 5 }, () => ['TAR_ENTRY_ERROR', 'poop', poop]),
      )
    })
  }
})

describe('fail symlink', () => {
  const poop = poopError()
  const data = makeTar([
    { path: 'd/i/r/dir/', type: 'Directory', mode: 0o751, ...times },
    {
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      ...times,
    },
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      const { warnings } = await runExtract(mode, { cwd }, data, {
        symlink: thrower(poop),
      })
      assert.deepEqual<unknown>(warnings, [
        ['TAR_ENTRY_ERROR', 'poop', poop],
      ])
    })
  }
})

describe('fail chmod', () => {
  const poop = poopError()
  const data = makeTar([
    { path: 'd/i/r/dir/', type: 'Directory', ...times },
    { path: 'd/i/r/dir/', type: 'Directory', mode: 0o751, ...times },
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      const opt = { cwd, chmod: true, processUmask: 0o22 }
      const { warnings } = await runExtract(mode, opt, data, {
        chmod: thrower(poop),
      })
      assert.deepEqual<unknown>(warnings, [
        ['TAR_ENTRY_ERROR', 'poop', poop],
      ])
    })
  }
})

describe('fail mkdir', () => {
  const poop = poopError()
  const data = makeTar([
    { path: 'dir/', type: 'Directory', mode: 0o751, ...times },
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      const { warnings } = await runExtract(mode, { cwd }, data, {
        mkdir: thrower(poop),
      })
      assert.match<unknown>(warnings, [
        [
          'TAR_ENTRY_ERROR',
          /^ENOENT: no such file or directory/,
          {
            code: 'ENOENT',
            syscall: 'lstat',
            path: fsPath(resolve(cwd, 'dir')),
          },
        ],
      ])
      for (const [, message, er] of warnings) {
        assert.equal<unknown>(message, er.message)
      }
    })
  }
})

describe('fail write', () => {
  const poop = poopError()
  const data = makeTar([
    { path: 'x', type: 'File', size: 1, mode: 0o751, mtime: MTIME },
    'x',
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      const { warnings, calls } = await runExtract(mode, { cwd }, data, {
        write: thrower(poop),
      })
      assert.deepEqual<unknown>(warnings, [
        ['TAR_ENTRY_ERROR', 'poop', poop],
      ])
      // The file is closed, and its times are not set.
      assert.deepEqual(
        calls.map(c => c[0]).filter(op => op !== 'mkdir'),
        ['stat', 'lstat', 'open', 'write', 'close'],
      )
    })
  }
})

// Each case: the name, the option, the time of the file on disk, and
// the time of the file in the tar. The file on disk must stay.
const skipCases = [
  [
    'skip existing',
    { keep: true },
    '2011-03-27T22:16:31.000Z',
    '2013-12-19T17:00:00.000Z',
  ],
  [
    'skip newer',
    { newer: true },
    '2013-12-19T17:00:00.000Z',
    '2011-03-27T22:16:31.000Z',
  ],
] as const
for (const [name, opt, onDisk, inTar] of skipCases) {
  describe(name, () => {
    const date = new Date(onDisk)
    const data = makeTar([
      {
        path: 'x',
        type: 'File',
        size: 1,
        mode: 0o751,
        mtime: new Date(inTar),
      },
      'x',
      '',
      '',
    ])

    for (const mode of modes) {
      test(mode, async () => {
        const dir = testdir({ x: 'y' })
        nodeFs.utimesSync(dir + '/x', date, date)
        await runExtract(mode, { cwd: dir, ...opt }, data)
        const st = nodeFs.lstatSync(dir + '/x')
        assert.equal(st.atime.toISOString(), date.toISOString())
        assert.equal(st.mtime.toISOString(), date.toISOString())
        assert.equal(read(dir + '/x'), 'y')
      })
    }
  })
}

describe('newer option', () => {
  for (const mode of modes) {
    test(`an entry that has no mtime is extracted, ${mode}`, async () => {
      const data = makeTar([
        { type: 'File', path: 'x', size: 3 },
        'new',
        '',
        '',
      ])
      const cwd = testdir({ x: 'old' })
      const opt = { cwd, newer: true }
      const { warnings } = await runExtract(mode, opt, data)
      assert.deepEqual(warnings, [])
      assert.equal(read(cwd + '/x'), 'new')
    })

    test(`an entry that is newer is extracted, ${mode}`, async () => {
      const data = makeTar([
        {
          type: 'File',
          path: 'x',
          size: 3,
          mtime: new Date('2100-01-01'),
        },
        'new',
        '',
        '',
      ])
      const cwd = testdir({ x: 'old' })
      await runExtract(mode, { cwd, newer: true }, data)
      assert.equal(read(cwd + '/x'), 'new')
    })
  }
})

describe('times', () => {
  const date = MTIME
  const data = makeTar([
    { path: 'x/', type: 'Directory', size: 0, ...times },
    { path: 'x/y', type: 'File', size: 1, mode: 0o751, ...times },
    'x',
    { path: 'x/z', type: 'File', size: 1, mtime: MTIME },
    'x',
    '',
    '',
  ])

  for (const mode of modes) {
    test(`no mtime, ${mode}`, async () => {
      const dir = testdir({})
      await runExtract(mode, { cwd: dir, noMtime: true }, data)
      // this may fail if it's run on March 27, 2011
      const stx = nodeFs.lstatSync(dir + '/x')
      assert.notEqual(stx.atime.toISOString(), date.toISOString())
      assert.notEqual(stx.mtime.toISOString(), date.toISOString())
      const sty = nodeFs.lstatSync(dir + '/x/y')
      assert.notEqual(sty.atime.toISOString(), date.toISOString())
      assert.notEqual(sty.mtime.toISOString(), date.toISOString())
      assert.equal(read(dir + '/x/y'), 'x')
    })

    test(`times of the entries are set, ${mode}`, async () => {
      const dir = testdir({})
      const start = Date.now() - 1000
      await runExtract(mode, { cwd: dir }, data)
      const sty = nodeFs.lstatSync(dir + '/x/y')
      assert.deepEqual(sty.mtime, MTIME)
      assert.deepEqual(sty.atime, ATIME)
      // An entry with no atime gets the time of the extraction.
      const stz = nodeFs.lstatSync(dir + '/x/z')
      assert.deepEqual(stz.mtime, MTIME)
      assert.greaterThanOrEqual(stz.atime.getTime(), start)
    })
  }
})

test('unpack big enough to pause/drain', async () => {
  const dir = testdir({})
  await extract({
    cwd: dir,
    strip: 3,
    strict: true,
    fs: nodeFsPromises,
    file: fixtures + '/parses.tar',
    maxReadSize: 4096,
  })
  assert.deepEqual(
    nodeFs.readdirSync(dir).sort(),
    nodeFs.readdirSync(parses).sort(),
  )
})

describe('set owner', () => {
  const myUid = 501
  const myGid = 1024
  const ids = { processUid: myUid, processGid: myGid }
  const input = new Uint8Array(1024)

  test('as root, defaults to true', () => {
    const u = new Unpack({ cwd: '/x', fs, input, processUid: 0 })
    assert.equal(u.preserveOwner, true, 'preserveOwner enabled')
    const off = { preserveOwner: false, processUid: 0 }
    assert.equal(
      new Unpack({ cwd: '/x', fs, input, ...off }).preserveOwner,
      false,
    )
    const set = { uid: 1, gid: 1, processUid: 0 }
    assert.equal(
      new Unpack({ cwd: '/x', fs, input, ...set }).preserveOwner,
      false,
    )
  })

  test('as non-root, defaults to false', () => {
    const u = new Unpack({ cwd: '/x', fs, input, processUid: 501 })
    assert.equal(u.preserveOwner, false, 'preserveOwner disabled')
    const none = new UnpackSync({ cwd: '/x', fs: fsSync, input })
    assert.equal(none.preserveOwner, false)
  })

  const data = makeTar([
    { uid: 2456124561, gid: 813708013, path: 'foo/', type: 'Directory' },
    {
      uid: myUid,
      gid: 813708013,
      path: 'foo/my-uid-different-gid',
      type: 'File',
      size: 3,
    },
    'qux',
    {
      uid: 2456124561,
      path: 'foo/different-uid-nogid',
      type: 'Directory',
    },
    {
      uid: 2456124561,
      path: 'foo/different-uid-nogid/bar',
      type: 'File',
      size: 3,
    },
    'qux',
    {
      gid: 813708013,
      path: 'foo/different-gid-nouid/bar',
      type: 'File',
      size: 3,
    },
    'qux',
    { uid: myUid, gid: myGid, path: 'foo-mine/', type: 'Directory' },
    {
      uid: myUid,
      gid: myGid,
      path: 'foo-mine/bar',
      type: 'File',
      size: 3,
    },
    'qux',
    { uid: myUid, path: 'foo-mine/nogid', type: 'Directory' },
    { uid: myUid, path: 'foo-mine/nogid/bar', type: 'File', size: 3 },
    'qux',
    '',
    '',
  ])

  const chowns = (calls: unknown[][]) =>
    calls.filter(c => String(c[0]).endsWith('chown'))

  for (const mode of modes) {
    test(`chown failure results in unpack failure, ${mode}`, async () => {
      const fail = () => {
        throw new Error('expected chown failure')
      }
      const cwd = testdir({})
      const opt = { cwd, preserveOwner: true, ...ids, jobs: 1 }
      const { warnings } = await runExtract(mode, opt, data, {
        chown: fail,
        lchown: fail,
        fchown: fail,
      })
      // A failure for a directory is not reported. Each of the 3
      // files with a different owner fails.
      assert.deepEqual(
        warnings.map(w => [w[1], (w[2].entry as ReadEntry).path]),
        [
          ['expected chown failure', 'foo/my-uid-different-gid'],
          ['expected chown failure', 'foo/different-uid-nogid/bar'],
          ['expected chown failure', 'foo/different-gid-nouid/bar'],
        ],
      )
    })

    test(`chown when true, ${mode}`, async () => {
      const cwd = testdir({})
      const opt = { cwd, preserveOwner: true, ...ids, jobs: 1 }
      const { warnings, calls } = await runExtract(mode, opt, data, {
        chown: () => SKIP,
        lchown: () => SKIP,
        fchown: () => SKIP,
      })
      assert.deepEqual(warnings, [])
      // The owner of the open file, or of the directory with no
      // symlink followed. An entry with the ids of the process is
      // not changed.
      assert.deepEqual(chowns(calls), [
        ['lchown', cwd + '/foo', 2456124561, 813708013],
        ['fchown', cwd + '/foo/my-uid-different-gid', myUid, 813708013],
        // An id that the archive does not have is the id of the process.
        ['lchown', cwd + '/foo/different-uid-nogid', 2456124561, myGid],
        [
          'fchown',
          cwd + '/foo/different-uid-nogid/bar',
          2456124561,
          myGid,
        ],
        ['fchown', cwd + '/foo/different-gid-nouid/bar', myUid, 813708013],
      ])
    })

    test(`no chown when false, ${mode}`, async () => {
      const cwd = testdir({})
      const opt = { cwd, preserveOwner: false, ...ids }
      const { warnings, calls } = await runExtract(mode, opt, data, {})
      assert.deepEqual(warnings, [])
      assert.deepEqual(chowns(calls), [])
      assert.equal(read(cwd + '/foo/my-uid-different-gid'), 'qux')
    })

    test(`forceChown, ${mode}`, async () => {
      const cwd = testdir({})
      const data = makeTar([
        { uid: 7, gid: 8, path: 'd', type: 'Directory' },
        { uid: 7, gid: 8, path: 'd/f', type: 'File' },
        '',
        '',
      ])
      const opt = { cwd, forceChown: true, processUid: 7, processGid: 8 }
      const { calls } = await runExtract(mode, opt, data, {
        lchown: () => SKIP,
        fchown: () => SKIP,
      })
      assert.deepEqual(chowns(calls), [
        ['lchown', cwd + '/d', 7, 8],
        ['fchown', cwd + '/d/f', 7, 8],
      ])
    })

    test(`no chown with no known owner, ${mode}`, async () => {
      const cwd = testdir({})
      // This header has no uid and no gid.
      const block = makeTar([{ path: 'f', type: 'File' }])
      block.fill(0, 108, 124)
      block.fill(' ', 148, 156)
      const sum = block.reduce((a, b) => a + b, 0)
      block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
      const data = Buffer.concat([block, Buffer.alloc(1024)])
      const { warnings, calls } = await runExtract(
        mode,
        { cwd, forceChown: true },
        data,
        {},
      )
      assert.deepEqual(warnings, [])
      assert.deepEqual(chowns(calls), [])
      assert.equal(read(cwd + '/f'), '')
    })
  }
})

describe('unpack when dir is not writable', () => {
  const data = makeTar([
    { path: 'a/', type: 'Directory', mode: 0o444 },
    { path: 'a/b', type: 'File', size: 1 },
    'a',
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const dir = testdir({})
      await runExtract(mode, { cwd: dir, strict: true }, data)
      assert.equal(modeOf(dir + '/a'), statMode(0o744))
      assert.equal(read(dir + '/a/b'), 'a')
    })
  }
})

describe('transmute chars on windows', () => {
  const data = makeTar([
    { path: '<|>?:.txt', size: 5, type: 'File' },
    '<|>?:',
    '',
    '',
  ])

  const hex = 'ef80bcef81bcef80beef80bfef80ba2e747874'
  const uglyName = Buffer.from(hex, 'hex').toString()

  for (const mode of modes) {
    test(mode, async () => {
      const dir = testdir({})
      await runExtract(mode, { cwd: dir, platform: 'win32' }, data)
      assert.deepEqual(nodeFs.readdirSync(dir), [uglyName])
      assert.equal(read(resolve(dir, uglyName)), '<|>?:')
    })

    test(`safely, with absolutes, ${mode}`, async () => {
      const data = makeTar([
        { path: 'c:/x/y/z/<|>?:.txt', size: 5, type: 'File' },
        '<|>?:',
        '',
        '',
      ])
      const uglyPath = 'c:/x/y/z/' + uglyName
      const cwd = testdir({})
      const entries: (ReadEntry | ReadEntrySync)[] = []
      // don't actually make the directory
      const { fs, fsSync, calls } = hookFs({
        mkdir: thrower(new Error('poop')),
      })
      const opt = {
        cwd,
        platform: 'win32',
        preservePaths: true,
        onEntry: (e: ReadEntry | ReadEntrySync) => entries.push(e),
        input: data,
      } as const
      if (mode === 'sync') extractSync({ ...opt, fs: fsSync })
      else await extract({ ...opt, fs })
      assert.equal(entries[0]?.path, uglyPath)
      assert.equal(entries[0]?.absolute, uglyPath)
      assert.deepEqual(
        calls.filter(c => c[0] === 'mkdir').map(c => c[1]),
        ['c:/x/y/z'],
      )
    })
  }
})

describe('explicit chmod', () => {
  const data = makeTar([
    { path: 'x/y/z', mode: 0o775, type: 'Directory' },
    '',
    '',
  ])

  const chmods = (calls: unknown[][]) =>
    calls.filter(c => c[0] === 'chmod')

  for (const mode of modes) {
    test(`use explicit chmod when required by umask, ${mode}`, async () => {
      const cwd = testdir({})
      const opt = { cwd, chmod: true, processUmask: 0o22 }
      const { calls } = await runExtract(mode, opt, data, {})
      assert.equal(modeOf(cwd + '/x/y/z'), statMode(0o775))
      assert.deepEqual(chmods(calls), [['chmod', cwd + '/x/y/z', 0o775]])
    })

    test(`the default process umask is 0o22, ${mode}`, async () => {
      const cwd = testdir({})
      const { calls } = await runExtract(
        mode,
        { cwd, chmod: true },
        data,
        {},
      )
      assert.equal(modeOf(cwd + '/x/y'), statMode(0o755))
      assert.deepEqual(chmods(calls), [['chmod', cwd + '/x/y/z', 0o775]])
    })

    test(`dont use explicit chmod if chmod flag not set, ${mode}`, async () => {
      const cwd = testdir({})
      const opt = { cwd, processUmask: 0o22 }
      const { calls } = await runExtract(mode, opt, data, {})
      assert.equal(modeOf(cwd + '/x/y/z'), statMode(0o755))
      assert.deepEqual(chmods(calls), [])
    })

    test(`chmod of the extraction directory, ${mode}`, async () => {
      const root = testdir({ cwd: {} })
      const cwd = root + '/cwd'
      nodeFs.chmodSync(cwd, 0o700)
      const opt = { cwd, chmod: true, processUmask: 0o22, dmode: 0o775 }
      const { calls } = await runExtract(mode, opt, data, {})
      assert.equal(modeOf(cwd), statMode(0o775))
      // Only the last directory of a path that is made gets the mode.
      assert.equal(modeOf(cwd + '/x'), statMode(0o755))
      assert.equal(modeOf(cwd + '/x/y'), statMode(0o775))
      assert.equal(chmods(calls)[0]?.[1], cwd)
    })
  }
})

describe('chmod of an existing directory', () => {
  const data = makeTar([
    { path: 'd', mode: 0o7755, type: 'Directory' },
    '',
    '',
  ])
  const chmods = (calls: unknown[][]) =>
    calls.filter(c => c[0] === 'chmod')

  for (const mode of modes) {
    test(`no setuid, setgid, or sticky bit from the entry, ${mode}`, async () => {
      const cwd = testdir({ d: { keep: 'x' } })
      nodeFs.chmodSync(cwd + '/d', 0o700)
      const opt = { cwd, chmod: true, processUmask: 0o22 }
      const { calls } = await runExtract(mode, opt, data, {})
      assert.deepEqual(chmods(calls), [['chmod', cwd + '/d', 0o755]])
      assert.equal(modeOf(cwd + '/d'), statMode(0o755))
    })

    test(
      `a sticky bit on disk is removed, ${mode}`,
      { skip: isWindows && 'Windows has no sticky bit' },
      async () => {
        const cwd = testdir({ d: { keep: 'x' } })
        nodeFs.chmodSync(cwd + '/d', 0o1755)
        const opt = { cwd, chmod: true, processUmask: 0o22 }
        const { calls } = await runExtract(mode, opt, data, {})
        assert.deepEqual(chmods(calls), [['chmod', cwd + '/d', 0o755]])
        assert.equal(modeOf(cwd + '/d'), 0o755)
      },
    )
  }
})

describe('strict mode stops the entries that wait', () => {
  // Each entry has the same path, so each one waits for the entry
  // before it.
  const data = makeTar([
    { path: 'x', type: 'File', size: 1 },
    'a',
    { path: 'x', type: 'File', size: 1 },
    'b',
    { path: 'x', type: 'File', size: 1 },
    'c',
    '',
    '',
  ])

  test('no entry is extracted after the first error', async () => {
    const poop = poopError()
    const cwd = testdir({})
    let opens = 0
    const hooked = hookFs({
      open: () => {
        if (opens++ === 0) throw poop
      },
    })
    // The file system is slow, so all the entries are read before
    // the first one fails.
    const slow: ExtractFS = {
      ...hooked.fs,
      open: async (path, flags, mode) => {
        await new Promise(res => setTimeout(res, 20))
        return hooked.fs.open(path, flags, mode)
      },
    }
    const er = await assert.rejects(
      extract({ cwd, fs: slow, input: data, strict: true }),
      { message: 'poop' },
    )
    assert.equal(er, poop)
    assert.equal(opens, 1)
    assert.deepEqual(nodeFs.readdirSync(cwd), [])
  })
})

describe('the uid and gid options', () => {
  const input = new Uint8Array(1024)
  const ids = { processUid: 501, processGid: 20 }
  const entry = (uid?: number, gid?: number) => ({ uid, gid }) as ReadEntry
  const owner = (uid: number, gid: number, e: ReadEntry) =>
    new Unpack({ cwd: '/x', fs, input, uid, gid, ...ids }).owner(e)

  test('an unsigned 32-bit integer is used', () => {
    assert.deepEqual(owner(0, 0, entry(7, 8)), { uid: 0, gid: 0 })
    assert.deepEqual(owner(2 ** 32 - 1, 2 ** 32 - 1, entry(7, 8)), {
      uid: 2 ** 32 - 1,
      gid: 2 ** 32 - 1,
    })
  })

  test('an option that is not one is an error', () => {
    const expect = {
      name: 'TypeError',
      message: 'uid and gid must be unsigned 32-bit integers',
    }
    for (const bad of [-1, 1.5, 2 ** 32, NaN, Infinity]) {
      assert.throws(() => owner(bad, 3, entry(7, 8)), expect)
      assert.throws(() => owner(3, bad, entry(7, 8)), expect)
      assert.throws(
        () =>
          extractSync({
            cwd: '/x',
            fs: fsSync,
            input,
            uid: bad,
            gid: bad,
          }),
        expect,
      )
    }
  })

  test('an owner in the archive that is not one is not used', () => {
    const preserve = (e: ReadEntry) =>
      new Unpack({
        cwd: '/x',
        fs,
        input,
        preserveOwner: true,
        ...ids,
      }).owner(e)
    for (const bad of [-1, 1.5, 2 ** 32, NaN, Infinity]) {
      // The process owner is used in its place.
      assert.deepEqual(preserve(entry(bad, 8)), { uid: 501, gid: 8 })
      assert.deepEqual(preserve(entry(7, bad)), { uid: 7, gid: 20 })
    }
  })

  for (const mode of modes) {
    test(`the owner that a file gets, ${mode}`, async () => {
      const data = makeTar([
        { path: 'f', type: 'File', size: 1, uid: 7, gid: 8 },
        'x',
        '',
        '',
      ])
      const hooks = { fchown: () => SKIP }
      const chowns = async (uid: number, gid: number) => {
        const cwd = testdir({})
        const opt = { cwd, uid, gid, ...ids }
        const { calls, warnings } = await runExtract(
          mode,
          opt,
          data,
          hooks,
        )
        assert.deepEqual(warnings, [])
        return calls.filter(c => c[0] === 'fchown').map(c => c.slice(2))
      }
      assert.deepEqual(await chowns(2 ** 32 - 1, 0), [[2 ** 32 - 1, 0]])
      await assert.rejects(chowns(-1, 2 ** 32), {
        name: 'TypeError',
        message: 'uid and gid must be unsigned 32-bit integers',
      })
    })
  }
})

describe('chown implicit dirs and also the entries', () => {
  test('throws when setting uid/gid improperly', () => {
    const input = new Uint8Array(1024)
    const base = { cwd: '/x', fs, input }
    assert.throws(() => new Unpack({ ...base, uid: 420 }), {
      name: 'TypeError',
      message: 'cannot set owner without number uid and gid',
    })
    assert.throws(() => new Unpack({ ...base, gid: 666 }), {
      name: 'TypeError',
      message: 'cannot set owner without number uid and gid',
    })
    assert.throws(
      () => new Unpack({ ...base, uid: 1, gid: 2, preserveOwner: true }),
      {
        name: 'TypeError',
        message:
          'cannot preserve owner in archive and also set owner explicitly',
      },
    )
  })

  const data = makeTar([
    { path: 'a/b/c', mode: 0o775, type: 'File', size: 1 },
    '.',
    {
      path: 'x/y/z',
      mode: 0o775,
      uid: 12345,
      gid: 54321,
      type: 'File',
      size: 1,
    },
    '.',
    '',
    '',
  ])

  // Each case: the name, and the ids that the process has.
  const cases = [
    ['ids of the process not known', {}],
    ['processUid is 420', { processUid: 420, processGid: 1 }],
    ['processGid is 666', { processUid: 1, processGid: 666 }],
  ] as const
  for (const [name, ids] of cases) {
    for (const mode of modes) {
      for (const preservePaths of [false, true]) {
        const n = `${name}, ${mode}, preservePaths=${preservePaths}`
        test(n, async () => {
          const cwd = testdir({})
          const opt = { cwd, uid: 420, gid: 666, jobs: 1, preservePaths }
          // The hooks let the test run as non-root.
          const { calls } = await runExtract(
            mode,
            { ...opt, ...ids },
            data,
            {
              chown: () => SKIP,
              lchown: () => SKIP,
              fchown: () => SKIP,
            },
          )
          // Each directory that is made, and each file.
          const expect = [
            ['lchown', cwd + '/a', 420, 666],
            ['lchown', cwd + '/a/b', 420, 666],
            ['fchown', cwd + '/a/b/c', 420, 666],
            ['lchown', cwd + '/x', 420, 666],
            ['lchown', cwd + '/x/y', 420, 666],
            ['fchown', cwd + '/x/y/z', 420, 666],
          ]
          assert.deepEqual(
            calls
              .filter(c => String(c[0]).endsWith('chown'))
              .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
            expect,
          )
        })
      }
    }
  }

  for (const mode of modes) {
    test(`no chown for the ids of the process, ${mode}`, async () => {
      const cwd = testdir({})
      const opt = { cwd, uid: 420, gid: 666 }
      const ids = { processUid: 420, processGid: 666 }
      const { calls } = await runExtract(
        mode,
        { ...opt, ...ids },
        data,
        {},
      )
      assert.deepEqual(
        calls.filter(c => String(c[0]).endsWith('chown')),
        [],
      )
    })
  }
})

describe('bad cwd setting', () => {
  const cases: HeaderData[] = [
    // the cwd itself
    { path: './', type: 'Directory' },
    // a file directly in the cwd
    { path: 'a', type: 'File' },
    // a file nested within a subdir of the cwd
    { path: 'a/b/c', type: 'File' },
  ]

  // Each case: what the cwd is, its path in the test directory, and
  // the code of the error.
  const cwdCases = [
    ['a file', 'file', 'ENOTDIR'],
    ['missing', 'asdf/asdf/asdf', 'ENOENT'],
  ] as const

  for (const c of cases) {
    const data = makeTar([{ ...c, mode: 0o775, size: 0 }, '', ''])

    for (const [what, sub, code] of cwdCases) {
      for (const mode of modes) {
        test(`${c.type} ${c.path}, cwd is ${what}, ${mode}`, async () => {
          const cwd = testdir({ file: 'xyz' }) + '/' + sub
          const expect = {
            name: 'CwdError',
            message: `${code}: Cannot cd into '${cwd}'`,
            path: cwd,
            code,
          }
          await assert.rejects(runExtract(mode, { cwd }, data), expect)
        })
      }
    }
  }

  for (const mode of modes) {
    test(`an error of stat with no code, ${mode}`, async () => {
      const cwd = testdir({})
      const data = makeTar([{ path: 'a', type: 'File' }, '', ''])
      await assert.rejects(
        runExtract(mode, { cwd }, data, {
          stat: thrower(new Error('no stat')),
        }),
        { name: 'CwdError', code: 'ENOTDIR' },
      )
    })
  }

  test('entries after a cwd error are not extracted', async () => {
    const cwd = testdir({}) + '/missing'
    const data = makeTar([
      { path: 'a', type: 'File' },
      { path: 'b', type: 'File' },
      { path: 'c', type: 'File' },
      '',
      '',
    ])
    const { fs, calls } = hookFs()
    await assert.rejects(extract({ cwd, fs, input: data, jobs: 1 }), {
      name: 'CwdError',
    })
    assert.deepEqual(calls, [['stat', cwd]])
  })
})

const enc = new TextEncoder()
const dec = new TextDecoder()
const brace = (chunk: Uint8Array) =>
  enc.encode(
    dec
      .decode(chunk)
      .split('')
      .map(c => '[' + c + ']')
      .join(''),
  )

describe('transform', () => {
  const cases: Record<string, Record<string, string>> = {
    'emptypax.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'one-byte.txt': '[a]',
    },
    'body-byte-counts.tar': {
      '1024-bytes.txt': '[x]'.repeat(1023) + '[\n]',
      '512-bytes.txt': '[x]'.repeat(511) + '[\n]',
      'one-byte.txt': '[a]',
      'zero-byte.txt': '',
    },
    'utf8.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'Ω.txt': '[Ω]',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt':
        '[Ω]',
    },
  }

  const wanted = (entry: { path: string }) =>
    [
      'zero-byte.txt',
      'one-byte.txt',
      '1024-bytes.txt',
      '512-bytes.txt',
      'Ω.txt',
    ].includes(basename(entry.path))
  const transform = (entry: ReadEntry) =>
    wanted(entry) ?
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => controller.enqueue(brace(chunk)),
      })
    : undefined
  const transformSync = (entry: ReadEntrySync) =>
    wanted(entry) ? brace : undefined

  for (const [tarfile, expect] of Object.entries(cases)) {
    const input = nodeFs.readFileSync(resolve(tars, tarfile))
    for (const mode of modes) {
      for (const strict of [true, false]) {
        const name = `${tarfile} ${mode} ${strict ? 'strict' : 'loose'}`
        test(name, async () => {
          const cwd = testdir({})
          if (mode === 'sync') {
            const transform = transformSync
            extractSync({ cwd, strict, transform, fs: fsSync, input })
          } else {
            await extract({ cwd, strict, transform, fs, input })
          }
          for (const [file, content] of Object.entries(expect)) {
            assert.equal(read(resolve(cwd, file)), content, file)
          }
        })
      }
    }
  }

  test('a transform stream can add data when it ends', async () => {
    const cwd = testdir({})
    const input = makeTar([
      { path: 'empty', type: 'File', size: 0 },
      { path: 'x', type: 'File', size: 3 },
      'abc',
      { path: 'dir', type: 'Directory' },
      '',
      '',
    ])
    const transform = () =>
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => controller.enqueue(brace(chunk)),
        flush: controller => controller.enqueue(enc.encode('!')),
      })
    await extract({ cwd, transform, fs, input })
    assert.equal(read(cwd + '/empty'), '!')
    assert.equal(read(cwd + '/x'), '[a][b][c]!')
    assert(nodeFs.statSync(cwd + '/dir').isDirectory())
  })
})

describe('transform error', () => {
  const input = nodeFs.readFileSync(resolve(tars, 'body-byte-counts.tar'))
  const poop = new Error('poop')
  const transform = () =>
    new TransformStream<Uint8Array, Uint8Array>({
      transform: thrower(poop),
    })
  const transformSync = () => thrower(poop)

  // Each of the 3 files with content fails. The empty file is made.
  for (const mode of modes) {
    test(`${mode} strict`, async () => {
      const cwd = testdir({})
      const opt = { cwd, strict: true, input }
      if (mode === 'sync') {
        const er = assert.throws(
          () =>
            extractSync({ ...opt, transform: transformSync, fs: fsSync }),
          { message: 'poop' },
        )
        assert.equal(er, poop)
      } else {
        const er = await assert.rejects(
          extract({ ...opt, transform, fs }),
          { message: 'poop' },
        )
        assert.equal(er, poop)
      }
    })

    test(`${mode} loose`, async () => {
      const cwd = testdir({})
      const errors: unknown[] = []
      const opt = {
        cwd,
        input,
        onwarn: (_c: string, _m: string, er: unknown) => errors.push(er),
      }
      if (mode === 'sync') {
        extractSync({ ...opt, transform: transformSync, fs: fsSync })
      } else {
        await extract({ ...opt, transform, fs })
      }
      assert.deepEqual(errors, [poop, poop, poop])
      assert.equal(read(cwd + '/zero-byte.txt'), '')
    })
  }

  test('a transform stream that fails after some output', async () => {
    const cwd = testdir({})
    const data = makeTar([
      { path: 'x', type: 'File', size: 1024 },
      'a'.repeat(512),
      'b'.repeat(512),
      { path: 'y', type: 'File', size: 1 },
      'y',
      '',
      '',
    ])
    const transform = (entry: ReadEntry) =>
      entry.path !== 'x' ?
        undefined
      : new TransformStream<Uint8Array, Uint8Array>({
          transform: (chunk, controller) => {
            controller.enqueue(chunk)
            controller.error(poop)
          },
        })
    const warnings: unknown[][] = []
    await extract({
      cwd,
      transform,
      fs,
      input: [data.subarray(0, 700), data.subarray(700)],
      onwarn: (code, _, er) => warnings.push([code, er]),
    })
    assert.deepEqual(warnings, [['TAR_ENTRY_ERROR', poop]])
    assert.equal(read(cwd + '/y'), 'y')
  })
})

describe('an entry settles one time when its transform fails', () => {
  const poop = new Error('poop')
  const data = makeTar([
    { path: 'x', type: 'File', size: 1024 },
    'a'.repeat(512),
    'b'.repeat(512),
    { path: 'y', type: 'File', size: 1 },
    'y',
    '',
    '',
  ])
  // The body of x arrives in two chunks.
  const input = [data.subarray(0, 1024), data.subarray(1024)]

  test('async', async () => {
    // This transform fails for each chunk.
    const transform = (entry: ReadEntry) =>
      entry.path !== 'x' ?
        undefined
      : new TransformStream<Uint8Array, Uint8Array>({
          transform: thrower(poop),
        })
    const cwd = testdir({})
    const warnings: unknown[][] = []
    await extract({
      cwd,
      transform,
      fs,
      input,
      onwarn: (code, _, er) => warnings.push([code, er]),
    })
    assert.deepEqual(warnings, [['TAR_ENTRY_ERROR', poop]])
    assert.equal(read(cwd + '/y'), 'y')
  })

  test('sync', () => {
    const transform = (entry: ReadEntrySync) =>
      entry.path !== 'x' ? undefined : thrower(poop)
    const cwd = testdir({})
    const warnings: unknown[][] = []
    extractSync({
      cwd,
      transform,
      fs: fsSync,
      input,
      onwarn: (code, _, er) => warnings.push([code, er]),
    })
    assert.deepEqual(warnings, [['TAR_ENTRY_ERROR', poop]])
    assert.equal(read(cwd + '/y'), 'y')
  })
})

describe('content that arrives in more than one chunk', () => {
  const body = 'a'.repeat(700) + 'b'.repeat(700) + 'c'.repeat(700)
  const data = makeTar([
    { path: 'd', type: 'Directory' },
    { path: 'd/x', type: 'File', size: body.length, mtime: MTIME },
    body,
    { path: 'd/y', type: 'File', size: 1 },
    'y',
    '',
    '',
  ])
  const chunks: Uint8Array[] = []
  for (let i = 0; i < data.length; i += 600) {
    chunks.push(data.subarray(i, i + 600))
  }
  const poop = new Error('poop')

  for (const mode of modes) {
    test(`the file is written as the chunks arrive, ${mode}`, async () => {
      const cwd = testdir({})
      const { warnings, calls } = await runExtract(
        mode,
        { cwd },
        chunks,
        {},
      )
      assert.deepEqual(warnings, [])
      assert.equal(read(cwd + '/d/x'), body)
      assert.equal(read(cwd + '/d/y'), 'y')
      assert.deepEqual(nodeFs.statSync(cwd + '/d/x').mtime, MTIME)
      const writes = calls.filter(
        c => c[0] === 'write' && c[1] === cwd + '/d/x',
      )
      assert.deepEqual(
        writes.map(c => [c[1], (c[2] as Uint8Array).length]),
        [
          [cwd + '/d/x', 176],
          [cwd + '/d/x', 600],
          [cwd + '/d/x', 600],
          [cwd + '/d/x', 600],
          [cwd + '/d/x', 124],
        ],
      )
    })

    test(`a write error skips the rest of the content, ${mode}`, async () => {
      const cwd = testdir({})
      let writes = 0
      const { warnings, calls } = await runExtract(mode, { cwd }, chunks, {
        write: () => {
          if (++writes === 2) throw poop
        },
      })
      assert.deepEqual<unknown>(warnings, [
        ['TAR_ENTRY_ERROR', 'poop', poop],
      ])
      assert.equal(read(cwd + '/d/y'), 'y')
      const ops = calls.filter(c => c[1] === cwd + '/d/x').map(c => c[0])
      assert.deepEqual(ops, ['lstat', 'open', 'write', 'write', 'close'])
    })

    test(`an archive that ends in the content, ${mode}`, async () => {
      const cwd = testdir({})
      const { calls } = await assert
        .rejects(runExtract(mode, { cwd }, chunks.slice(0, 3), {}), {
          tarCode: 'TAR_BAD_ARCHIVE',
          recoverable: false,
          cwd,
        })
        .then(() => hookFs())
      assert.deepEqual(calls, [])
      // The file is closed.
      const { fs, fsSync, calls: all } = hookFs()
      const opt = { cwd: testdir({}), input: chunks.slice(0, 3) }
      const expect = { message: /^TAR_BAD_ARCHIVE: Truncated input/ }
      if (mode === 'sync') {
        assert.throws(() => extractSync({ ...opt, fs: fsSync }), expect)
      } else await assert.rejects(extract({ ...opt, fs }), expect)
      assert.deepEqual(
        all.filter(c => c[1] === opt.cwd + '/d/x').map(c => c[0]),
        ['lstat', 'open', 'write', 'write', 'close'],
      )
    })
  }

  test('a write error with a transform stream', async () => {
    const cwd = testdir({})
    let writes = 0
    const { fs, calls } = hookFs({
      write: () => {
        if (++writes === 2) throw poop
      },
    })
    const warnings: unknown[][] = []
    await extract({
      cwd,
      fs,
      input: chunks,
      transform: () => new TransformStream<Uint8Array, Uint8Array>(),
      onwarn: (code, _, er) => warnings.push([code, er]),
    })
    assert.deepEqual(warnings, [['TAR_ENTRY_ERROR', poop]])
    assert.equal(read(cwd + '/d/y'), 'y')
    const ops = calls.filter(c => c[1] === cwd + '/d/x').map(c => c[0])
    assert.deepEqual(ops, ['lstat', 'open', 'write', 'write', 'close'])
  })

  test('an archive that ends in the content, with a transform stream', async () => {
    const cwd = testdir({})
    const { fs, calls } = hookFs()
    await assert.rejects(
      extract({
        cwd,
        fs,
        input: chunks.slice(0, 3),
        transform: () => new TransformStream<Uint8Array, Uint8Array>(),
      }),
      { message: /^TAR_BAD_ARCHIVE: Truncated input/, cwd },
    )
    assert.equal(calls[calls.length - 1]?.[0], 'close')
  })

  // A pair of streams that passes the data on, and that fails when
  // it is stopped.
  const badPair = (): TransformStream<Uint8Array, Uint8Array> => {
    let controller: ReadableStreamDefaultController<Uint8Array>
    const stopped: string[] = []
    const stop = (how: string) => {
      stopped.push(how)
      throw new Error('cannot stop')
    }
    return Object.assign(
      {
        readable: new ReadableStream<Uint8Array>({
          start: c => {
            controller = c
          },
          cancel: () => stop('cancel'),
        }),
        writable: new WritableStream<Uint8Array>({
          write: chunk => controller.enqueue(chunk),
          abort: () => stop('abort'),
        }),
      },
      { stopped },
    )
  }

  test('a write error with streams that fail when stopped', async () => {
    const cwd = testdir({})
    let writes = 0
    const { fs } = hookFs({
      write: () => {
        if (++writes === 2) throw poop
      },
    })
    const pairs: unknown[] = []
    const warnings: unknown[][] = []
    await extract({
      cwd,
      fs,
      input: chunks,
      transform: entry => {
        if (entry.path !== 'd/x') return undefined
        const pair = badPair()
        pairs.push(pair)
        return pair
      },
      onwarn: (code, _, er) => warnings.push([code, er]),
    })
    assert.deepEqual(warnings, [['TAR_ENTRY_ERROR', poop]])
    assert.match(pairs, [{ stopped: any.arrayWith('cancel') }])
    assert.equal(read(cwd + '/d/y'), 'y')
  })

  test('the end of the archive with streams that fail when stopped', async () => {
    const cwd = testdir({})
    const pairs: unknown[] = []
    await assert.rejects(
      extract({
        cwd,
        fs,
        input: chunks.slice(0, 3),
        transform: () => {
          const pair = badPair()
          pairs.push(pair)
          return pair
        },
      }),
      { message: /^TAR_BAD_ARCHIVE: Truncated input/ },
    )
    assert.match(pairs, [{ stopped: ['cancel', 'abort'] }])
  })

  test('an input that fails in the content', async () => {
    const cwd = testdir({})
    const input = (async function* () {
      yield* chunks.slice(0, 3)
      throw poop
    })()
    const { fs, calls } = hookFs()
    const er = await assert.rejects(extract({ cwd, fs, input }), {
      message: 'poop',
    })
    assert.equal(er, poop)
    assert.equal(calls[calls.length - 1]?.[0], 'close')
  })

  test('an input that fails when it is released', async () => {
    const cwd = testdir({})
    let i = 0
    const input: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({
        next: async () =>
          i < chunks.length ?
            { value: chunks[i++] as Uint8Array, done: false }
          : { value: undefined, done: true },
        return: async () => {
          throw poop
        },
      }),
    }
    const { fs } = hookFs()
    const er = await assert.rejects(extract({ cwd, fs, input }), {
      message: 'poop',
    })
    assert.equal(er, poop)
    // The entries are extracted before the input is released.
    assert.equal(read(cwd + '/d/y'), 'y')
  })
})

describe('futimes/fchown failures', () => {
  const tardata = nodeFs.readFileSync(resolve(tars, 'utf8.tar'))
  const poop = new Error('poop')
  const second = new Error('second error')

  for (const method of ['utimes', 'chown'] as const) {
    const forceChown = method === 'chown'
    const ids = { processUid: 1, processGid: 1 }

    describe(method + ' fallback', () => {
      for (const mode of modes) {
        for (const strict of [true, false]) {
          test(`${mode} ${strict ? 'strict' : 'loose'}`, async () => {
            const cwd = testdir({})
            const opt = { cwd, strict, forceChown, ...ids }
            const { warnings, calls } = await runExtract(
              mode,
              opt,
              tardata,
              {
                [`f${method}`]: thrower(poop),
                // The real chown fails for a user that is not root.
                chown: () => SKIP,
                lchown: () => SKIP,
              },
            )
            assert.deepEqual(warnings, [])
            assert.equal(read(cwd + '/Ω.txt'), 'Ω')
            // The 3 files of the archive.
            assert.equal(calls.filter(c => c[0] === method).length, 3)
          })
        }
      }
    })

    describe('also fail ' + method, () => {
      for (const mode of modes) {
        test(`${mode} loose`, async () => {
          const cwd = testdir({})
          const opt = { cwd, forceChown, ...ids }
          const { warnings } = await runExtract(mode, opt, tardata, {
            [`f${method}`]: thrower(poop),
            [method]: thrower(second),
            lchown: () => SKIP,
          })
          assert.deepEqual<unknown>(
            warnings.map(w => w[2]),
            [poop, poop, poop],
          )
        })

        test(`${mode} strict`, async () => {
          const cwd = testdir({})
          const opt = { cwd, strict: true, forceChown, ...ids }
          const er = await assert.rejects(
            runExtract(mode, opt, tardata, {
              [`f${method}`]: thrower(poop),
              [method]: thrower(second),
              lchown: () => SKIP,
            }),
            { message: 'poop' },
          )
          assert.equal(er, poop)
        })
      }
    })
  }
})

describe('onEntry option', () => {
  const data = makeTar([
    { path: 'd/i', type: 'Directory' },
    { path: 'd/i/r/dir', type: 'Directory', mode: 0o751, mtime: MTIME },
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: ATIME,
      ctime: MTIME,
    },
    'a',
    { path: 'a/../b', type: 'File' },
    '',
    '',
  ])

  test('sync', () => {
    const cwd = testdir({})
    const seen: [string, boolean][] = []
    extractSync({
      cwd,
      fs: fsSync,
      input: data,
      onEntry: entry => {
        // The entry is not extracted yet.
        seen.push([entry.path, nodeFs.existsSync(cwd + '/' + entry.path)])
      },
    })
    assert.deepEqual(seen, [
      ['d/i', false],
      ['d/i/r/dir', false],
      ['d/i/r/file', false],
      ['a/../b', false],
    ])
    assert.equal(read(cwd + '/d/i/r/file'), 'a')
  })

  test('async, a promise is awaited', async () => {
    const cwd = testdir({})
    const seen: [string, boolean][] = []
    await extract({
      cwd,
      fs,
      input: data,
      jobs: 1,
      onEntry: async entry => {
        await new Promise(res => setTimeout(res, 5))
        seen.push([entry.path, nodeFs.existsSync(cwd + '/' + entry.path)])
      },
    })
    assert.deepEqual(seen, [
      ['d/i', false],
      ['d/i/r/dir', false],
      ['d/i/r/file', false],
      ['a/../b', false],
    ])
    assert.equal(read(cwd + '/d/i/r/file'), 'a')
  })

  test('an error of onEntry stops the extraction', async () => {
    const poop = new Error('poop')
    const cwd = testdir({})
    const onEntry = (entry: { path: string }) => {
      if (entry.path === 'd/i/r/dir') throw poop
    }
    const opt = { cwd, input: data, onEntry }
    assert.equal(
      await assert.rejects(extract({ ...opt, fs }), { message: 'poop' }),
      poop,
    )
    assert.equal(
      assert.throws(() => extractSync({ ...opt, fs: fsSync }), {
        message: 'poop',
      }),
      poop,
    )
    assert.deepEqual(nodeFs.readdirSync(cwd + '/d/i'), [])
  })
})

describe('do not reuse hardlinks, only nlink=1 files', () => {
  const now = new Date('2018-04-30T18:30:39.025Z')
  const data = makeTar([
    {
      path: 'overwriteme',
      type: 'File',
      size: 4,
      mode: 0o644,
      mtime: now,
    },
    'foo\n',
    {
      path: 'link',
      linkpath: 'overwriteme',
      type: 'Link',
      mode: 0o644,
      mtime: now,
    },
    { path: 'link', type: 'File', size: 4, mode: 0o644, mtime: now },
    'bar\n',
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const dir = testdir({})
      await runExtract(mode, { cwd: dir }, data)
      assert.equal(read(dir + '/link'), 'bar\n')
      assert.equal(read(dir + '/overwriteme'), 'foo\n')
      assert.equal(nodeFs.statSync(dir + '/link').nlink, 1)
      assert.equal(nodeFs.statSync(dir + '/overwriteme').nlink, 1)
    })
  }
})

describe('an existing file', () => {
  const data = makeTar([
    { path: 'f', type: 'File', size: 3 },
    'new',
    '',
    '',
  ])
  const ops = (calls: unknown[][]) =>
    calls.map(c => c[0]).filter(op => op !== 'stat' && op !== 'lstat')
  // With the platform 'win32', a file is renamed before it is
  // removed, and an entry is never written into an existing file.
  const remove = isWindows ? ['rename', 'unlink'] : ['unlink']
  const reuse = isWindows ? remove : []

  for (const mode of modes) {
    test(`is written in place, ${mode}`, async () => {
      const cwd = testdir({ f: 'old content' })
      const { calls } = await runExtract(mode, { cwd }, data, {})
      assert.deepEqual(ops(calls), [...reuse, 'open', 'write', 'close'])
      assert.equal(read(cwd + '/f'), 'new')
    })

    test(`is removed first with unlink, ${mode}`, async () => {
      const cwd = testdir({ f: 'old content' })
      const opt = { cwd, unlink: true }
      const { calls } = await runExtract(mode, opt, data, {})
      assert.deepEqual(ops(calls), [...remove, 'open', 'write', 'close'])
      assert.equal(read(cwd + '/f'), 'new')
    })

    test(`a ContiguousFile entry does not write in place, ${mode}`, async () => {
      const cwd = testdir({ f: 'old content' })
      const data = makeTar([
        { path: 'f', type: 'ContiguousFile', size: 3 },
        'new',
        '',
        '',
      ])
      const { calls } = await runExtract(mode, { cwd }, data, {})
      assert.deepEqual(ops(calls), [...remove, 'open', 'write', 'close'])
      assert.equal(read(cwd + '/f'), 'new')
    })

    test(`a symlink is removed, not followed, ${mode}`, async () => {
      const cwd = testdir({ target: 'target content' })
      nodeFs.symlinkSync('target', cwd + '/f')
      const { warnings } = await runExtract(mode, { cwd }, data)
      assert.deepEqual(warnings, [])
      assert.equal(read(cwd + '/target'), 'target content')
      assert(isFile(cwd + '/f'))
      assert.equal(read(cwd + '/f'), 'new')
    })

    test(`a directory entry over a file, ${mode}`, async () => {
      const cwd = testdir({ d: 'a file', e: { sub: {} }, g: 'a file' })
      const data = makeTar([
        { path: 'd', type: 'Directory' },
        // A directory that is not empty cannot be replaced.
        { path: 'e', type: 'File' },
        { path: 'g', type: 'GNUDumpDir' },
        '',
        '',
      ])
      const { warnings, calls } = await runExtract(
        mode,
        { cwd, jobs: 1 },
        data,
        {},
      )
      assert.match<unknown>(warnings, [
        ['TAR_ENTRY_ERROR', /^ENOTEMPTY/, { code: 'ENOTEMPTY' }],
      ])
      assert(nodeFs.statSync(cwd + '/d').isDirectory())
      assert(nodeFs.statSync(cwd + '/g').isDirectory())
      assert.deepEqual(ops(calls), [
        ...remove,
        'mkdir',
        'rmdir',
        ...remove,
        'mkdir',
      ])
    })

    test(`a directory entry over a directory, ${mode}`, async () => {
      const cwd = testdir({ d: { keep: 'd' }, g: { keep: 'g' } })
      const data = makeTar([
        { path: 'd', type: 'Directory' },
        { path: 'g', type: 'GNUDumpDir' },
        '',
        '',
      ])
      const { warnings, calls } = await runExtract(
        mode,
        { cwd, jobs: 1 },
        data,
        {},
      )
      assert.deepEqual(warnings, [])
      assert.equal(read(cwd + '/d/keep'), 'd')
      assert.equal(read(cwd + '/g/keep'), 'g')
      assert.deepEqual(ops(calls), ['mkdir', 'mkdir'])
    })
  }
})

describe('trying to unpack a non-zlib gzip file should fail', () => {
  const data = Buffer.from('hello this is not gzip data')
  const dataGzip = Buffer.concat([Buffer.from([0x1f, 0x8b]), data])

  test('abort if gzip has an error', async () => {
    const cwd = testdir({})
    await assert.rejects(runExtract('async', { cwd }, dataGzip), {
      recoverable: false,
      cwd,
      tarCode: 'TAR_ABORT',
    })
    await assert.rejects(
      runExtract('sync', { cwd, codecs: [gunzip] }, dataGzip),
      {
        errno: any.number,
        code: /^Z/,
        recoverable: false,
        cwd,
        tarCode: 'TAR_ABORT',
      },
    )
    // The sync form has no gzip support of its own.
    await assert.rejects(runExtract('sync', { cwd }, dataGzip), {
      message: 'the gzip codec has no decompressSync function',
      recoverable: false,
      cwd,
      tarCode: 'TAR_ABORT',
    })
  })

  for (const mode of modes) {
    test(`bad archive if no gzip, ${mode}`, async () => {
      const cwd = testdir({})
      const onwarn = () => assert.fail('an error, not a warning')
      await assert.rejects(runExtract(mode, { cwd, onwarn }, data), {
        message: 'TAR_BAD_ARCHIVE: Unrecognized archive format',
        tarCode: 'TAR_BAD_ARCHIVE',
        recoverable: false,
        cwd,
      })
    })

    test(`a bad header is a warning, ${mode}`, async () => {
      const cwd = testdir({})
      // A size field that is not a number.
      const block = makeTar([{ path: 'f', type: 'File' }])
      block.write('zzzzzzzzzzz', 124)
      const input = Buffer.concat([
        block,
        makeTar([{ path: 'g', type: 'File' }, '', '']),
      ])
      const { warnings } = await runExtract(mode, { cwd }, input)
      assert.match<unknown>(warnings, [
        ['TAR_ENTRY_INVALID', 'checksum failure', { cwd }],
      ])
      assert.deepEqual(nodeFs.readdirSync(cwd), ['g'])
    })
  }
})

describe('a header that cannot be read', () => {
  // A number that is not valid.
  const block = makeTar([{ path: 'bad', type: 'File' }])
  block.set([0x81, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 100)
  const data = Buffer.concat([
    block,
    makeTar([{ path: 'good', type: 'File' }, '', '']),
  ])

  for (const mode of modes) {
    test(`${mode} loose`, async () => {
      const cwd = testdir({})
      const { warnings } = await runExtract(mode, { cwd }, data)
      assert.match<unknown>(warnings, [
        [
          'TAR_ENTRY_INVALID',
          'invalid base256 encoding',
          {
            name: 'Error',
            message: 'invalid base256 encoding',
            tarCode: 'TAR_ENTRY_INVALID',
            cwd,
          },
        ],
      ])
      assert.deepEqual(nodeFs.readdirSync(cwd), ['good'])
    })

    test(`${mode} strict`, async () => {
      const cwd = testdir({})
      await assert.rejects(runExtract(mode, { cwd, strict: true }, data), {
        message: 'invalid base256 encoding',
        tarCode: 'TAR_ENTRY_INVALID',
        cwd,
      })
      assert.deepEqual(nodeFs.readdirSync(cwd), [])
    })
  }
})

describe('max decompression ratio', () => {
  const data = makeCompressedBomb()
  const expect = (cwd: string) => ({
    tarCode: 'TAR_ABORT',
    recoverable: false,
    cwd,
    message: /max decompression ratio exceeded/,
  })

  test('aborts compressed bombs by default', async () => {
    const cwd = testdir({})
    await assert.rejects(runExtract('async', { cwd }, data), expect(cwd))
    await assert.rejects(
      runExtract('sync', { cwd, codecs: [gunzip] }, data),
      { tarCode: 'TAR_ABORT', recoverable: false, cwd },
    )
  })

  for (const mode of modes) {
    test(`can be disabled explicitly, ${mode}`, async () => {
      const cwd = testdir({})
      const opt = {
        cwd,
        maxDecompressionRatio: Infinity,
        codecs: [gunzip],
      }
      await runExtract(mode, opt, data)
      assert.equal(
        nodeFs.statSync(resolve(cwd, 'bomb')).size,
        8 * 1024 * 1024,
      )
    })
  }
})

describe('handle errors on fs.close', () => {
  const poop = new Error('poop')
  const data = makeTar([
    { path: 'file', type: 'File', size: 1, ...times },
    'a',
    '',
    '',
  ])

  for (const mode of modes) {
    test(`${mode} strict`, async () => {
      const cwd = testdir({})
      const er = await assert.rejects(
        runExtract(mode, { cwd, strict: true }, data, {
          close: thrower(poop),
        }),
        { message: 'poop' },
      )
      assert.equal(er, poop)
    })

    test(`${mode} loose`, async () => {
      const cwd = testdir({})
      const { warnings } = await runExtract(mode, { cwd }, data, {
        close: thrower(poop),
      })
      assert.deepEqual<unknown>(warnings, [
        ['TAR_ENTRY_ERROR', 'poop', poop],
      ])
    })
  }
})

describe('using strip option when top level file exists', () => {
  const data = makeTar([
    { path: 'top', type: 'File', size: 0 },
    { path: 'x', type: 'Directory' },
    { path: 'x/a', type: 'File', size: 'a'.length },
    'a',
    { path: 'y', type: 'GNUDumpDir' },
    { path: 'y/b', type: 'File', size: 'b'.length },
    'b',
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({ y: {} })
      const { warnings } = await runExtract(mode, { cwd, strip: 1 }, data)
      assert.deepEqual(warnings, [])
      assert.equal(nodeFs.statSync(cwd).isDirectory(), true)
      assert.equal(read(cwd + '/a'), 'a')
      assert.equal(read(cwd + '/b'), 'b')
      assert.throws(() => nodeFs.statSync(cwd + '/top'), {
        code: 'ENOENT',
      })
    })
  }
})

describe('handle EPERMs when creating symlinks', () => {
  // https://github.com/npm/node-tar/issues/265
  const msg =
    'You do not have sufficient privilege to perform this operation.'
  const data = makeTar([
    { path: 'x', type: 'Directory' },
    { path: 'x/y', type: 'File', size: 'hello, world'.length },
    'hello, world',
    { path: 'x/link1', type: 'SymbolicLink', linkpath: './y' },
    { path: 'x/link2', type: 'SymbolicLink', linkpath: './y' },
    { path: 'x/link3', type: 'SymbolicLink', linkpath: './y' },
    { path: 'x/z', type: 'File', size: 'hello, world'.length },
    'hello, world',
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      const { warnings } = await runExtract(mode, { cwd }, data, {
        symlink: () => {
          throw Object.assign(new Error(msg), { code: 'EPERM' })
        },
      })
      assert.deepEqual(
        warnings.map(([code, message]) => [code, message]),
        [
          ['TAR_ENTRY_ERROR', msg],
          ['TAR_ENTRY_ERROR', msg],
          ['TAR_ENTRY_ERROR', msg],
        ],
        'got expected warnings',
      )
      assert.equal(read(`${cwd}/x/y`), 'hello, world')
      assert.equal(read(`${cwd}/x/z`), 'hello, world')
      assert.deepEqual(nodeFs.readdirSync(`${cwd}/x`).sort(), ['y', 'z'])
    })
  }
})

describe('close the file after an error', () => {
  const data = makeTar([
    { type: 'Directory', path: 'x' },
    { type: 'File', size: 1, path: 'x/y', ...times },
    '.',
    '',
    '',
  ])

  // Each file that was opened is closed one time.
  const checkClosed = (calls: unknown[][]) => {
    const opened = calls.filter(c => c[0] === 'open').map(c => c[1])
    const closed = calls.filter(c => c[0] === 'close').map(c => c[1])
    assert.notEqual(opened.length, 0)
    assert.deepEqual(closed, opened)
  }

  for (const mode of modes) {
    test(`error writing, ${mode}`, async () => {
      const cwd = testdir({})
      const { warnings, calls } = await runExtract(mode, { cwd }, data, {
        write: thrower(new Error('nope')),
      })
      assert.equal(warnings.length, 1)
      checkClosed(calls)
    })

    test(`error writing, and then an error of close, ${mode}`, async () => {
      const cwd = testdir({})
      const { warnings, calls } = await runExtract(mode, { cwd }, data, {
        write: thrower(new Error('nope')),
        close: thrower(new Error('no close')),
      })
      assert.deepEqual(
        warnings.map(w => w[1]),
        ['nope'],
      )
      checkClosed(calls)
    })

    test(`error setting mtime, ${mode}`, async () => {
      const cwd = testdir({})
      // have to fail both, because we fall back
      const { warnings, calls } = await runExtract(mode, { cwd }, data, {
        futimes: thrower(new Error('nope')),
        utimes: thrower(new Error('nooooope')),
      })
      assert.deepEqual(
        warnings.map(w => w[1]),
        ['nope'],
      )
      checkClosed(calls)
    })
  }
})

for (const mode of modes) {
  test(`do not hang on large files that fail to open(), ${mode}`, async () => {
    const data = makeTar([
      { type: 'Directory', path: 'x' },
      { type: 'File', size: 31745, path: 'x/y' },
      'x'.repeat(31745),
      { type: 'File', size: 1, path: 'x/z' },
      'z',
      '',
      '',
    ])
    const cwd = testdir({})
    const input = [
      data.subarray(0, 2048),
      data.subarray(2048, 4096),
      data.subarray(4096),
    ]
    const { warnings } = await runExtract(mode, { cwd }, input, {
      open: (p: unknown) => {
        if (p === cwd + '/x/y') throw new Error('nope')
      },
    })
    assert.deepEqual(
      warnings.map(w => w.slice(0, 2)),
      [['TAR_ENTRY_ERROR', 'nope']],
    )
    assert.equal(read(cwd + '/x/z'), 'z')
  })
}

describe('recognize C:.. as a dot path part', () => {
  const data = makeTar([
    { type: 'File', path: 'C:../x/y/z', size: 1 },
    'z',
    { type: 'File', path: 'x:..\\y\\z', size: 1 },
    'x',
    { type: 'File', path: 'Y:foo', size: 1 },
    'y',
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      const opt = { cwd, platform: 'win32' } as const
      const { warnings } = await runExtract(mode, opt, data)
      assert.equal(read(`${cwd}/foo`), 'y')
      assert.deepEqual<unknown>(
        warnings.map(([c, w, d]) => [
          c,
          w,
          d.path,
          (d.entry as ReadEntry).path,
        ]),
        [
          [
            'TAR_ENTRY_ERROR',
            "path contains '..'",
            'C:../x/y/z',
            'C:../x/y/z',
          ],
          [
            'TAR_ENTRY_ERROR',
            "path contains '..'",
            'x:../y/z',
            'x:../y/z',
          ],
          [
            'TAR_ENTRY_INFO',
            'stripping Y: from absolute path',
            'Y:foo',
            'foo',
          ],
        ],
      )
    })
  }
})

describe('excessively deep subfolder nesting', () => {
  const data = nodeFs.readFileSync(
    resolve(fixtures, 'excessively-deep.tar'),
  )

  // Each case: the name, the option, and the limit that it gives.
  const cases = [
    ['default', {}, 1024],
    ['set md', { maxDepth: 64 }, 64],
  ] as const
  for (const [name, opt, maxDepth] of cases) {
    for (const mode of modes) {
      test(`${mode} ${name}`, async () => {
        const cwd = testdir({})
        const { warnings } = await runExtract(mode, { cwd, ...opt }, data)
        assert.match<unknown>(warnings, [
          [
            'TAR_ENTRY_ERROR',
            'path excessively deep',
            {
              entry: any.instanceOf(
                mode === 'sync' ? ReadEntrySync : ReadEntry,
              ),
              path: /^\.(\/a){1024,}\/foo.txt$/,
              depth: 222372,
              maxDepth,
            },
          ],
        ])
        assert.deepEqual(nodeFs.readdirSync(cwd), [])
      })
    }
  }

  for (const mode of modes) {
    test(`${mode} no limit`, async () => {
      const cwd = testdir({})
      const deep = 'a/'.repeat(1100) + 'f'
      const data = makeTar([
        new Pax({ path: deep }).encode(),
        { path: 'f', type: 'File' },
        '',
        '',
      ])
      const opt = { cwd, maxDepth: Infinity }
      const { warnings } = await runExtract(mode, opt, data, {
        // do not make the directories
        mkdir: thrower(new Error('no mkdir')),
      })
      assert.match<unknown>(warnings, [
        ['TAR_ENTRY_ERROR', /^ENOENT/, { path: fsPath(cwd + '/a') }],
      ])
    })
  }
})

describe('ignore self-referential hardlinks', () => {
  const data = makeTar([
    { path: 'autolink', linkpath: './autolink', type: 'Link' },
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      const { warnings } = await runExtract(mode, { cwd }, data)
      const link = fsPath(cwd + '/autolink')
      assert.deepEqual(
        warnings.map(([, message]) => message),
        [`ENOENT: no such file or directory, link '${link}' -> '${link}'`],
      )
      assert.deepEqual(nodeFs.readdirSync(cwd), [], 'nothing extracted')
    })
  }
})

for (const mode of modes) {
  test(`valid relative symlink with .. should be extracted, ${mode}`, async () => {
    const data = makeTar([
      { path: 'foo/', type: 'Directory', mode: 0o755 },
      { path: 'foo/file.txt', type: 'File', mode: 0o644, size: 11 },
      'hello world',
      { path: 'bar/', type: 'Directory', mode: 0o755 },
      {
        path: 'bar/link.txt',
        type: 'SymbolicLink',
        linkpath: '../foo/file.txt',
      },
      {
        path: 'bar/badlink.txt',
        type: 'SymbolicLink',
        linkpath: '../../oh/no',
      },
      '',
      '',
    ])
    const dir = testdir({})
    const { warnings } = await runExtract(mode, { cwd: dir }, data)

    assert(isFile(dir + '/foo/file.txt'))
    assert(isSymlink(dir + '/bar/link.txt'))
    assert.equal(
      nodeFs.readlinkSync(dir + '/bar/link.txt'),
      linkTarget('../foo/file.txt'),
    )
    assert.equal(read(dir + '/bar/link.txt'), 'hello world')
    assert.throws(() => nodeFs.lstatSync(dir + '/bar/badlink.txt'), Error)
    assert.deepEqual(
      warnings.map(w => w.slice(0, 2)),
      [['TAR_ENTRY_ERROR', 'linkpath escapes extraction directory']],
    )
  })
}

describe('no linking through a symlink', () => {
  for (const type of ['Link', 'SymbolicLink'] as const) {
    describe(type, () => {
      const exploit = makeTar([
        {
          type,
          path: 'exploit',
          linkpath: 'a/b/escape/exploited-file',
          mode: 0o755,
        },
        '',
        '',
      ])

      // An archive cannot make a symlink that leaves the directory,
      // so this one is on disk before the extraction.
      const setup = () => {
        const cwd = testdir({
          x: {},
          a: { b: {} },
          'exploited-file': 'original content',
        })
        nodeFs.symlinkSync('../..', cwd + '/a/b/escape')
        return cwd
      }

      for (const mode of modes) {
        test(mode, async () => {
          const cwd = setup()
          await assert.rejects(
            runExtract(mode, { cwd, strict: true }, exploit),
            {
              name: 'SymlinkError',
              message:
                'TAR_SYMLINK_ERROR: Cannot extract through symbolic link',
              path: cwd + '/a/b/escape/exploited-file',
              symlink: cwd + '/a/b/escape',
            },
          )
          assert.throws(() => nodeFs.lstatSync(cwd + '/exploit'), {
            code: 'ENOENT',
          })
        })

        test(`${mode}, permitted with preservePaths`, async () => {
          const cwd = setup()
          const opt = { cwd, strict: true, preservePaths: true }
          await runExtract(mode, opt, exploit)
          nodeFs.writeFileSync(cwd + '/exploit', 'pwned')
          assert.equal(read(cwd + '/exploited-file'), 'pwned')
        })
      }
    })
  }

  for (const mode of modes) {
    test(`a symlink to the extraction directory, ${mode}`, async () => {
      const cwd = testdir({})
      const data = makeTar([
        { type: 'Directory', path: 'd' },
        { type: 'SymbolicLink', path: 'd/up', linkpath: '..' },
        { type: 'SymbolicLink', path: 'here', linkpath: '.' },
        '',
        '',
      ])
      const { warnings } = await runExtract(mode, { cwd }, data)
      assert.deepEqual(warnings, [])
      assert.equal(nodeFs.readlinkSync(cwd + '/d/up'), '..')
      assert.equal(nodeFs.readlinkSync(cwd + '/here'), '.')
    })
  }
})

describe('numeric pax/entry name discernment', () => {
  const numericName = '12345'
  const alphaName = 'abcde'
  for (const strict of [true, false]) {
    for (const paxName of [numericName, alphaName]) {
      for (const entryName of [numericName, alphaName]) {
        const data = makeTar([
          new Pax(
            { path: paxName, size: '12345\n'.length },
            false,
          ).encode(),
          {
            type: 'File',
            path: entryName,
            mode: 0o755,
            ctime: new Date('2000-01-01T00:00:00.000Z'),
            mtime: new Date('2000-01-01T00:00:00.000Z'),
            size: '12345\n'.length,
          },
          '12345\n',
          '',
          '',
        ])
        for (const mode of modes) {
          const name = `strict=${strict} paxName=${paxName} entryName=${entryName} ${mode}`
          test(name, async () => {
            const dir = testdir({})
            await runExtract(mode, { strict, cwd: dir }, data)
            assert.equal(read(dir + '/' + paxName), '12345\n')
          })
        }
      }
    }
  }
})

describe('rename a file before unlink on windows', () => {
  const data = makeTar([
    { type: 'File', path: 'x', size: 3 },
    'new',
    '',
    '',
  ])
  const opt = (cwd: string) => ({ cwd, platform: 'win32' }) as const

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({ x: 'old' })
      const { warnings, calls } = await runExtract(
        mode,
        opt(cwd),
        data,
        {},
      )
      assert.deepEqual(warnings, [])
      const file = resolve(cwd, 'x')
      const renames = calls.filter(c => c[0] === 'rename')
      assert.match<unknown>(renames, [
        ['rename', file, /\/x\.DELETE\.[0-9a-f]{32}$/],
      ])
      const name = String(renames[0]?.[2])
      assert.equal(name.slice(0, file.length), file)
      assert.deepEqual(
        calls.filter(c => c[0] === 'unlink'),
        [['unlink', name]],
      )
      assert.deepEqual(nodeFs.readdirSync(cwd), ['x'])
      assert.equal(read(cwd + '/x'), 'new')
      // Windows has no flag that refuses a symbolic link. The fs of
      // Windows has the flag for a file mapping.
      const { O_CREAT, O_TRUNC, O_WRONLY, UV_FS_O_FILEMAP } =
        nodeFs.constants
      assert.deepEqual(
        calls.filter(c => c[0] === 'open').map(c => c[2]),
        [isWindows ? UV_FS_O_FILEMAP | O_TRUNC | O_CREAT | O_WRONLY : 'w'],
      )
    })

    test(`${mode} rename fails`, async () => {
      const cwd = testdir({ x: 'old' })
      const { warnings } = await runExtract(mode, opt(cwd), data, {
        rename: thrower(new Error('no rename')),
      })
      assert.deepEqual(
        warnings.map(w => w.slice(0, 2)),
        [['TAR_ENTRY_ERROR', 'no rename']],
      )
      assert.equal(read(cwd + '/x'), 'old')
    })
  }
})

describe('file name that the file system refuses', () => {
  // Windows does not find a name of this length.
  const code = isWindows ? 'ENOENT' : 'ENAMETOOLONG'
  const name = 'x'.repeat(1000)
  const data = makeTar([
    new Pax({ path: name }).encode(),
    { type: 'File', path: 'x', size: 1 },
    'x',
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      const { warnings } = await runExtract(mode, { cwd }, data)
      assert.match<unknown>(warnings, [
        ['TAR_ENTRY_ERROR', new RegExp('^' + code), { code }],
      ])
      assert.deepEqual(nodeFs.readdirSync(cwd), [])
    })
  }
})

describe('an error of the times or the owner of a directory is ignored', () => {
  const data = makeTar([
    { type: 'Directory', path: 'x', mtime: MTIME, uid: 7, gid: 8 },
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      const opt = { cwd, forceChown: true }
      const { warnings, calls } = await runExtract(mode, opt, data, {
        lutimes: thrower(new Error('nope')),
        lchown: thrower(new Error('nope')),
      })
      assert.deepEqual(warnings, [])
      assert.equal(calls.filter(c => c[0] === 'lutimes').length, 1)
      assert.equal(calls.filter(c => c[0] === 'lchown').length, 1)
      assert(nodeFs.statSync(cwd + '/x').isDirectory())
    })
  }
})

describe('the write flag', () => {
  const data = makeTar([{ type: 'File', path: 'x', size: 1 }, 'x', '', ''])
  const { O_CREAT, O_TRUNC, O_WRONLY, O_NOFOLLOW, UV_FS_O_FILEMAP } =
    nodeFs.constants
  // Windows has no O_NOFOLLOW. It writes a small file through a file
  // mapping.
  const flag = isWindows ? UV_FS_O_FILEMAP : O_NOFOLLOW

  for (const mode of modes) {
    test(`the flag from the constants of the fs, ${mode}`, async () => {
      const cwd = testdir({})
      const { calls } = await runExtract(mode, { cwd }, data, {})
      assert.deepEqual(
        calls.filter(c => c[0] === 'open'),
        [['open', cwd + '/x', flag | O_TRUNC | O_CREAT | O_WRONLY, 0o666]],
      )
    })

    test(`an fs with no constants, ${mode}`, async () => {
      const cwd = testdir({})
      const { fs, fsSync, calls } = hookFs()
      const opt = { cwd, input: data }
      if (mode === 'sync') {
        extractSync({ ...opt, fs: { ...fsSync, constants: undefined } })
      } else await extract({ ...opt, fs: { ...fs, constants: undefined } })
      assert.deepEqual(
        calls.filter(c => c[0] === 'open'),
        [['open', cwd + '/x', 'w', 0o666]],
      )
    })
  }
})

describe('jobs option', () => {
  const data = makeTar([
    { path: 'a', type: 'File' },
    { path: 'b', type: 'File' },
    { path: 'c', type: 'File' },
    { path: 'd', type: 'File' },
    { path: 'e', type: 'File' },
    '',
    '',
  ])

  // With the platform 'win32', one entry is extracted at a time.
  for (const [jobs, expect] of [
    [1, 1],
    [2, isWindows ? 1 : 2],
    [undefined, isWindows ? 1 : 5],
  ] as const) {
    test(`jobs=${jobs}`, async () => {
      const cwd = testdir({})
      const { fs, calls } = hookFs()
      // The most files that are open at one time. Each open waits
      // until the expected number of files are open.
      let open = 0
      let most = 0
      let release = () => {}
      const full = new Promise<void>(res => (release = res))
      const counted: ExtractFS = {
        ...fs,
        open: async (...args) => {
          most = Math.max(most, ++open)
          if (open === expect) release()
          await full
          const handle = await fs.open(...args)
          return {
            ...handle,
            close: () => {
              open--
              return handle.close()
            },
          }
        },
      }
      await extract({ cwd, fs: counted, input: data, jobs })
      assert.equal(most, expect)
      assert.equal(calls.filter(c => c[0] === 'close').length, 5)
      assert.deepEqual(nodeFs.readdirSync(cwd).sort(), [
        'a',
        'b',
        'c',
        'd',
        'e',
      ])
    })
  }
})

test('a symlink waits for the entry that makes its target', async () => {
  const cwd = testdir({})
  const data = makeTar([
    { path: 'a/dir', type: 'Directory', mode: 0o755 },
    { path: 'a/link', type: 'SymbolicLink', linkpath: 'dir' },
    { path: 'a/link/x', type: 'File', size: 1 },
    'x',
    '',
    '',
  ])
  // The directory takes a long time to make. The link must not exist
  // before its target, or the file that goes through the link fails.
  const fs: ExtractFS = {
    ...nodeFsPromises,
    constants: nodeFs.constants,
    mkdir: async (dir, opt) => {
      if (String(dir).endsWith('/a/dir')) {
        await new Promise(res => setTimeout(res, 50))
      }
      return nodeFsPromises.mkdir(dir, opt)
    },
  }
  const warnings: string[] = []
  await extract({
    cwd,
    fs,
    input: data,
    preservePaths: true,
    onwarn: (_, message) => {
      warnings.push(message)
    },
  })
  assert.deepEqual(warnings, [])
  assert.equal(nodeFs.readFileSync(cwd + '/a/dir/x', 'utf8'), 'x')
})
