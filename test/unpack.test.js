import { Unpack, UnpackSync } from '../src/unpack.js'

import fs, { readFileSync } from 'fs'
import { Minipass } from 'minipass'
import * as z from 'minizlib'
import path from 'path'
import {
  any,
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
import zlib from 'zlib'
import { Header } from '../src/header.js'
import { extract } from '../src/extract.js'
import { makeTar } from './fixtures/make-tar.js'

const fixtures = path.resolve(import.meta.dirname, 'fixtures')
const tars = path.resolve(fixtures, 'tars')
const parses = path.resolve(fixtures, 'parse')

import mutateFS from 'mutate-fs'
import { normalizeWindowsPath as normPath } from '../src/normalize-windows-path.js'

import { ReadEntry } from '../src/read-entry.js'
import { Pax } from '../src/pax.js'

const makeCompressedBomb = () => {
  const payload = Buffer.alloc(8 * 1024 * 1024)
  return zlib.gzipSync(
    makeTar([
      {
        path: 'bomb',
        size: payload.length,
        type: 'File',
      },
      payload,
      '',
      '',
    ]),
  )
}

// On Windows in particular, the "really deep folder path" file
// often tends to cause problems, which don't indicate a failure
// of this library, it's just what happens on Windows with super
// long file paths.
const isWindows = process.platform === 'win32'
const isLongFile = f =>
  f.match(/r.e.a.l.l.y.-.d.e.e.p.-.f.o.l.d.e.r.-.p.a.t.h/)

spyOn(process, 'umask', () => 0o22)

const modes = ['async', 'sync']

// Resolve when the stream emits the event.
const emits = (stream, ev = 'close') =>
  new Promise(res => stream.once(ev, res))

// End the stream with the data. Resolve when the stream closes.
const end = (stream, data) => {
  const done = emits(stream)
  stream.end(data)
  return done
}

// Pipe the file into the stream. Resolve when the stream closes.
const pipeFile = (file, stream) => {
  const done = emits(stream)
  fs.createReadStream(file).pipe(stream)
  return done
}

const make = (mode, opt) =>
  mode === 'sync' ? new UnpackSync(opt) : new Unpack(opt)

// Write the data to an unpack stream of the mode, and wait for the
// end of its work.
const finish = async (mode, unpack, data) => {
  if (mode === 'sync') {
    unpack.end(data)
  } else {
    await end(unpack, data)
  }
}

// Unpack the data in the mode ('async' or 'sync').
const run = (mode, opt, data) => finish(mode, make(mode, opt), data)

// Unpack the data. Return each warning as [code, message, data].
const runWarnings = async (mode, opt, data) => {
  const warnings = []
  const onwarn = (c, w, d) => warnings.push([c, w, d])
  await run(mode, { ...opt, onwarn }, data)
  return warnings
}

// Unpack the data with Unpack. Return the first error of the stream.
const asyncError = (opt, data) => {
  const unpack = new Unpack(opt)
  const error = emits(unpack, 'error')
  unpack.end(data)
  return error
}

// Replace the chown functions of fs until the test ends. Return the
// list of the [uid, gid] of each call.
const fakeChowns = () => {
  const { chown, lchown, fchown, chownSync, lchownSync, fchownSync } = fs
  cleanup(() =>
    Object.assign(fs, {
      chown,
      lchown,
      fchown,
      chownSync,
      lchownSync,
      fchownSync,
    }),
  )
  const calls = []
  fs.chown =
    fs.lchown =
    fs.fchown =
      (_path, uid, gid, cb) => {
        calls.push([uid, gid])
        cb()
      }
  fs.chownSync =
    fs.lchownSync =
    fs.fchownSync =
      (_path, uid, gid) => {
        calls.push([uid, gid])
      }
  return calls
}

// Make the chown functions of fs fail until the test ends.
const failChowns = er => {
  for (const method of ['chown', 'lchown', 'fchown']) {
    cleanup(mutateFS.fail(method, er))
  }
}

// Until the test ends, record the fd of each path that fs.open opens,
// and each fd that fs.close gets.
const trackFds = () => {
  const opens = {}
  const closes = []
  const { open } = fs
  cleanup(() => (fs.open = open))
  fs.open = (...args) => {
    const cb = args.pop()
    args.push((er, fd) => {
      opens[args[0]] = fd
      cb(er, fd)
    })
    return open.call(fs, ...args)
  }
  cleanup(
    mutateFS.mutateArgs('close', ([fd]) => {
      closes.push(fd)
      return [fd]
    }),
  )
  return { opens, closes }
}

describe('basic file unpack tests', () => {
  const cases = {
    'emptypax.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'one-byte.txt': 'a',
    },
    'body-byte-counts.tar': {
      '1024-bytes.txt': new Array(1024).join('x') + '\n',
      '512-bytes.txt': new Array(512).join('x') + '\n',
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
      '120-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc':
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    },
    'long-paths.tar': {
      '100-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc':
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '120-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc':
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '170-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc':
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt':
        'short\n',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc':
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc':
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc':
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω',
    },
  }

  for (const [tarfile, expect] of Object.entries(cases)) {
    const tf = path.resolve(tars, tarfile)
    for (const mode of modes) {
      for (const strict of [true, false]) {
        const name = `${tarfile} ${mode} ${strict ? 'strict' : 'loose'}`
        test(name, async () => {
          // Unpack through a symbolic link to the directory.
          const root = testdir({ dir: {} })
          const dir = root + '/dir'
          const linkdir = root + '/link'
          fs.symlinkSync(dir, linkdir)
          const unpack = make(mode, { cwd: linkdir, strict })
          if (mode === 'sync') {
            unpack.end(fs.readFileSync(tf))
          } else {
            await pipeFile(tf, unpack)
          }
          for (const [file, content] of Object.entries(expect)) {
            if (isWindows && isLongFile(file)) {
              continue
            }
            const f = path.resolve(dir, file)
            assert.equal(fs.readFileSync(f, 'utf8'), content, file)
          }
        })
      }
    }
  }
})

test('cwd default to process cwd', () => {
  const u = new Unpack()
  const us = new UnpackSync()
  const cwd = normPath(process.cwd())
  assert.equal(u.cwd, cwd)
  assert.equal(us.cwd, cwd)
})

describe('links!', () => {
  const data = fs.readFileSync(tars + '/links.tar')
  const stripData = fs.readFileSync(tars + '/links-strip.tar')

  const checkSymlink = dir => {
    // doesn't work on win32 without special privs
    if (isWindows) {
      return
    }
    assert(fs.lstatSync(dir + '/symlink').isSymbolicLink())
    assert.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
  }
  const check = dir => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    assert.equal(hl1.dev, hl2.dev)
    assert.equal(hl1.ino, hl2.ino)
    assert.equal(hl1.nlink, 2)
    assert.equal(hl2.nlink, 2)
    checkSymlink(dir)
  }
  const checkForStrip = dir => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    const hl3 = fs.lstatSync(dir + '/1/2/3/hardlink-3')
    assert.equal(hl1.dev, hl2.dev)
    assert.equal(hl1.ino, hl2.ino)
    assert.equal(hl1.dev, hl3.dev)
    assert.equal(hl1.ino, hl3.ino)
    assert.equal(hl1.nlink, 3)
    assert.equal(hl2.nlink, 3)
    checkSymlink(dir)
  }
  const checkForStrip3 = dir => {
    // strips the linkpath entirely, so the link doesn't get extracted.
    assert.throws(() => fs.lstatSync(dir + '/3'), { code: 'ENOENT' })
  }

  const cases = [
    ['no strip', {}, data, check],
    ['strip', { strip: 1 }, stripData, checkForStrip],
    ['strip 3', { strip: 3 }, stripData, checkForStrip3],
  ]
  for (const [name, opt, tar, checkDir] of cases) {
    test(`async ${name}`, async () => {
      const dir = testdir({})
      const unpack = new Unpack({ cwd: dir, ...opt })
      let finished = false
      let finishedAtClose = false
      unpack.on('finish', () => (finished = true))
      unpack.on('close', () => (finishedAtClose = finished))
      await end(unpack, tar)
      assert(finishedAtClose, 'emitted finish before close')
      checkDir(dir)
    })

    test(`sync ${name}`, () => {
      const dir = testdir({})
      new UnpackSync({ cwd: dir, ...opt }).end(tar)
      checkDir(dir)
    })
  }
})

describe('links without cleanup (exercise clobbering code)', () => {
  // All tests of this group unpack into one directory. Each test after
  // the first writes over the entries that the test before it made.
  const dir = testdir({})
  const data = fs.readFileSync(tars + '/links.tar')

  // Put things in the way of the entries. This fails if the entries
  // are there.
  const clobberThisJunk = () => {
    try {
      fs.mkdirSync(dir + '/hardlink-1')
      fs.mkdirSync(dir + '/hardlink-2')
      fs.writeFileSync(dir + '/symlink', 'not a symlink')
    } catch {}
  }

  const check = () => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    assert.equal(hl1.dev, hl2.dev)
    assert.equal(hl1.ino, hl2.ino)
    assert.equal(hl1.nlink, 2)
    assert.equal(hl2.nlink, 2)
    if (!isWindows) {
      const sym = fs.lstatSync(dir + '/symlink')
      assert(sym.isSymbolicLink())
      assert.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    }
  }

  test('async', async () => {
    clobberThisJunk()
    const unpack = new Unpack({ cwd: dir })
    let prefinished = false
    let prefinishedAtFinish = false
    unpack.on('prefinish', () => (prefinished = true))
    unpack.on('finish', () => (prefinishedAtFinish = prefinished))
    await end(unpack, data)
    assert(prefinishedAtFinish, 'emitted prefinish before finish')
    check()
  })

  const cases = [
    ['sync', 'sync', {}],
    ['async again', 'async', {}],
    ['sync again', 'sync', {}],
    ['async unlink', 'async', { unlink: true }],
    ['sync unlink', 'sync', { unlink: true }],
  ]
  for (const [name, mode, opt] of cases) {
    test(name, async () => {
      clobberThisJunk()
      await run(mode, { cwd: dir, ...opt }, data)
      check()
    })
  }
})

test('nested dir dupe', async () => {
  const dir = testdir({ d: { e: { e: { p: {} } } } })
  const expect = {
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt': 'short\n',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc':
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc':
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc':
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω',
  }

  const unpack = new Unpack({ cwd: dir, strip: 8 })
  const data = fs.readFileSync(tars + '/long-paths.tar')
  // while we're at it, why not use gzip too?
  const zip = new z.Gzip()
  zip.pipe(unpack)
  const done = emits(unpack)
  zip.end(data)
  await done

  assert.deepEqual(fs.readdirSync(dir), ['d'])
  for (const [f, content] of Object.entries(expect)) {
    assert.equal(fs.readFileSync(dir + '/' + f, 'utf8'), content)
  }
})

describe(
  'symlink in dir path',
  {
    skip: isWindows && 'symlinks not fully supported',
  },
  () => {
    const data = makeTar([
      {
        path: 'd/i',
        type: 'Directory',
      },
      {
        path: 'd/i/r/dir',
        type: 'Directory',
        mode: 0o751,
        mtime: new Date('2011-03-27T22:16:31.000Z'),
      },
      {
        path: 'd/i/r/file',
        type: 'File',
        size: 1,
        atime: new Date('1979-07-01T19:10:00.000Z'),
        ctime: new Date('2011-03-27T22:16:31.000Z'),
      },
      'a',
      {
        path: 'd/i/r/link',
        type: 'Link',
        linkpath: 'd/i/r/file',
        atime: new Date('1979-07-01T19:10:00.000Z'),
        ctime: new Date('2011-03-27T22:16:31.000Z'),
        mtime: new Date('2011-03-27T22:16:31.000Z'),
      },
      {
        path: 'd/i/r/symlink',
        type: 'SymbolicLink',
        linkpath: './dir',
        atime: new Date('1979-07-01T19:10:00.000Z'),
        ctime: new Date('2011-03-27T22:16:31.000Z'),
        mtime: new Date('2011-03-27T22:16:31.000Z'),
      },
      {
        path: 'd/i/r/symlink/x',
        type: 'File',
        size: 0,
        atime: new Date('1979-07-01T19:10:00.000Z'),
        ctime: new Date('2011-03-27T22:16:31.000Z'),
        mtime: new Date('2011-03-27T22:16:31.000Z'),
      },
      '',
      '',
    ])

    const isFile = f => fs.lstatSync(f).isFile()
    const isSymlink = f => fs.lstatSync(f).isSymbolicLink()
    const dirMode = f => fs.lstatSync(f).mode & 0o7777

    const checkSymlinkError = (warnings, cwd) => {
      assert.equal(warnings.length, 1)
      assert.equal(warnings[0][0], 'TAR_ENTRY_ERROR')
      assert.equal(
        warnings[0][1],
        'TAR_SYMLINK_ERROR: Cannot extract through symbolic link',
      )
      assert.match(warnings[0][2], {
        name: 'SymlinkError',
        code: 'TAR_SYMLINK_ERROR',
        tarCode: 'TAR_ENTRY_ERROR',
        path: cwd + '/d/i/r/symlink/',
        symlink: cwd + '/d/i/r/symlink',
      })
    }

    for (const mode of modes) {
      test(`no clobbering, ${mode}`, async () => {
        const cwd = testdir({})
        const warnings = await runWarnings(mode, { cwd }, data)
        assert.equal(dirMode(cwd + '/d/i'), 0o755)
        assert.equal(dirMode(cwd + '/d/i/r/dir'), 0o751)
        assert(isFile(cwd + '/d/i/r/file'), 'got file')
        assert(isSymlink(cwd + '/d/i/r/symlink'), 'got symlink')
        assert.throws(() => fs.statSync(cwd + '/d/i/r/symlink/x'), Error)
        checkSymlinkError(warnings, cwd)
      })

      test(`extract through symlink, ${mode}`, async () => {
        const cwd = testdir({})
        const opt = { cwd, preservePaths: true }
        const warnings = await runWarnings(mode, opt, data)
        assert.deepEqual(warnings, [])
        assert.equal(dirMode(cwd + '/d/i/r/dir'), 0o751)
        assert(isFile(cwd + '/d/i/r/file'), 'got file')
        assert(isSymlink(cwd + '/d/i/r/symlink'), 'got symlink')
        assert(isFile(cwd + '/d/i/r/dir/x'), 'x thru link')
        assert(isFile(cwd + '/d/i/r/symlink/x'), 'x thru link')
      })

      test(`clobber through symlink, ${mode}`, async () => {
        const cwd = testdir({})
        const opt = { cwd, unlink: true }
        const warnings = await runWarnings(mode, opt, data)
        assert.deepEqual(warnings, [])
        assert.equal(dirMode(cwd + '/d/i/r/dir'), 0o751)
        assert(isFile(cwd + '/d/i/r/file'), 'got file')
        assert(!isSymlink(cwd + '/d/i/r/symlink'), 'no link')
        assert(
          fs.lstatSync(cwd + '/d/i/r/symlink').isDirectory(),
          'sym is dir',
        )
        assert(isFile(cwd + '/d/i/r/symlink/x'), 'x thru link')
      })
    }

    test('clobber through symlink with busted unlink', async () => {
      const poop = new Error('poop')
      const cwd = testdir({})
      cleanup(mutateFS.fail('unlink', poop))
      const opt = { cwd, unlink: true }
      const warnings = await runWarnings('async', opt, data)
      assert.deepEqual(warnings, [['TAR_ENTRY_ERROR', 'poop', poop]])
    })

    // The sync case gives the umask of the process. The async case
    // reads it from the process.
    const clobberDirsCases = [
      ['async', { chmod: true }],
      ['sync', { chmod: true, processUmask: 0o22 }],
    ]
    for (const [mode, opt] of clobberDirsCases) {
      test(`clobber dirs, ${mode}`, async () => {
        const cwd = testdir({
          d: {
            i: {
              r: {
                dir: {},
                file: {},
                link: {},
                symlink: {},
              },
            },
          },
        })
        const warnings = await runWarnings(mode, { cwd, ...opt }, data)
        assert.equal(dirMode(cwd + '/d/i/r/dir'), 0o751)
        assert(isFile(cwd + '/d/i/r/file'), 'got file')
        assert(isSymlink(cwd + '/d/i/r/symlink'), 'got symlink')
        assert.throws(() => fs.statSync(cwd + '/d/i/r/symlink/x'), Error)
        checkSymlinkError(warnings, cwd)
      })
    }
  },
)

describe('unsupported entries', () => {
  const unknown = new Header({ path: 'qux', size: 4 })
  unknown.encode()
  unknown.block?.write('Z', 156)
  const data = makeTar([
    {
      path: 'dev/random',
      type: 'CharacterDevice',
    },
    {
      path: 'dev/hd0',
      type: 'BlockDevice',
    },
    {
      path: 'dev/fifo0',
      type: 'FIFO',
    },
    // note: unrecognized types are ignored, so this won't emit a warning.
    // gnutar and bsdtar treat unrecognized types as 'file', so it may be
    // worth doing the same thing, but with a warning.
    unknown.block,
    'asdf',
    '',
    '',
  ])

  // The header of the unknown type and its body do not have a valid
  // checksum. Each one gives a warning with this path.
  const invalid = ['qux', 'asdf']

  test('basic, warns', async () => {
    const cwd = testdir({})
    const warnings = await runWarnings('async', { cwd }, data)
    assert.equal(fs.readdirSync(cwd).length, 0)
    assert.match(warnings, [
      [
        'TAR_ENTRY_UNSUPPORTED',
        'unsupported entry type: CharacterDevice',
        { entry: { path: 'dev/random' } },
      ],
      [
        'TAR_ENTRY_UNSUPPORTED',
        'unsupported entry type: BlockDevice',
        { entry: { path: 'dev/hd0' } },
      ],
      [
        'TAR_ENTRY_UNSUPPORTED',
        'unsupported entry type: FIFO',
        { entry: { path: 'dev/fifo0' } },
      ],
      ...invalid.map(path => [
        'TAR_ENTRY_INVALID',
        'checksum failure',
        { header: { path } },
      ]),
    ])
  })

  test('strict, throws', async () => {
    const cwd = testdir({})
    const warnings = []
    const errors = []
    const u = new Unpack({
      cwd,
      strict: true,
      onwarn: (c, w, d) => warnings.push([c, w, d]),
    })
    u.on('error', e => errors.push(e))
    await end(u, data)
    assert.equal(fs.readdirSync(cwd).length, 0)
    assert.deepEqual(warnings, [])
    assert.match(errors, [
      {
        message:
          'TAR_ENTRY_UNSUPPORTED: unsupported entry type: CharacterDevice',
        entry: { path: 'dev/random' },
      },
      {
        message:
          'TAR_ENTRY_UNSUPPORTED: unsupported entry type: BlockDevice',
        entry: { path: 'dev/hd0' },
      },
      {
        message: 'TAR_ENTRY_UNSUPPORTED: unsupported entry type: FIFO',
        entry: { path: 'dev/fifo0' },
      },
      ...invalid.map(path => ({
        message: 'TAR_ENTRY_INVALID: checksum failure',
        header: { path },
      })),
    ])
  })
})

describe('file in dir path', () => {
  const data = makeTar([
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    'a',
    {
      path: 'd/i/r/file/a/b/c',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    'b',
    '',
    '',
  ])

  for (const mode of modes) {
    test(`fail because of file, ${mode}`, async () => {
      const cwd = testdir({})
      await run(mode, { cwd }, data)
      assert.equal(fs.readFileSync(cwd + '/d/i/r/file', 'utf8'), 'a')
      assert.throws(() => fs.statSync(cwd + '/d/i/r/file/a/b/c'), Error)
    })

    test(`clobber on through, ${mode}`, async () => {
      const cwd = testdir({})
      await run(mode, { cwd, unlink: true }, data)
      assert(fs.statSync(cwd + '/d/i/r/file').isDirectory())
      assert.equal(fs.readFileSync(cwd + '/d/i/r/file/a/b/c', 'utf8'), 'b')
    })
  }
})

test('set umask option', async () => {
  const cwd = testdir({})

  const data = makeTar([
    {
      path: 'd/i/r/dir',
      type: 'Directory',
      mode: 0o751,
    },
    '',
    '',
  ])

  await run('async', { umask: 0o027, cwd }, data)
  assert.equal(
    fs.statSync(cwd + '/d/i/r').mode & 0o7777,
    isWindows ? 0o666 : 0o750,
  )
  assert.equal(
    fs.statSync(cwd + '/d/i/r/dir').mode & 0o7777,
    isWindows ? 0o666 : 0o751,
  )
})

// A tar with one file of one byte at the path.
const oneFileTar = (path, content) =>
  makeTar([
    {
      path,
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    content,
    '',
    '',
  ])

describe('absolute paths', () => {
  const setup = () => {
    const dir = testdir({})
    const absolute = path.resolve(dir, 'd/i/r/absolute')
    const root = path.parse(absolute).root
    const extraAbsolute = root + root + root + absolute
    assert(path.isAbsolute(extraAbsolute))
    assert(path.isAbsolute(absolute))
    const relative = absolute.slice(root.length)
    assert(!path.isAbsolute(relative))
    return { dir, absolute, root, extraAbsolute, relative }
  }

  for (const mode of modes) {
    test(`warn and correct, ${mode}`, async () => {
      const { dir, root, extraAbsolute, relative } = setup()
      const data = oneFileTar(extraAbsolute, 'a')
      const warnings = await runWarnings(mode, { cwd: dir }, data)
      const r = normPath(root)
      assert.match(warnings, [
        [
          'TAR_ENTRY_INFO',
          `stripping ${r}${r}${r}${r} from absolute path`,
          { path: normPath(extraAbsolute), code: 'TAR_ENTRY_INFO' },
        ],
      ])
      assert(fs.lstatSync(path.resolve(dir, relative)).isFile(), 'is file')
    })

    test(`preserve absolute path, ${mode}`, async () => {
      const { dir, absolute, extraAbsolute } = setup()
      // if we use the extraAbsolute path here, we end up creating a dir
      // like C:\C:\C:\C:\path\to\absolute, which is both 100% valid on
      // windows, as well as SUUUUUPER annoying.
      const data = oneFileTar(isWindows ? absolute : extraAbsolute, 'a')
      const opt = { preservePaths: true, cwd: dir }
      const warnings = await runWarnings(mode, opt, data)
      assert.deepEqual(warnings, [])
      assert(fs.lstatSync(absolute).isFile(), 'is file')
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
      const warnings = await runWarnings(mode, { fmode, cwd: dir }, data)
      assert.match(warnings, [
        [
          'TAR_ENTRY_ERROR',
          "path contains '..'",
          { path: dotted, code: 'TAR_ENTRY_ERROR' },
        ],
      ])
      assert.throws(() => fs.lstatSync(path.resolve(dir, dotted)), Error)
    })

    test(`preserve dotted path, ${mode}`, async () => {
      const dir = testdir({})
      const resolved = path.resolve(dir, dotted)
      const opt = { fmode, preservePaths: true, cwd: dir }
      const warnings = await runWarnings(mode, opt, data)
      assert.deepEqual(warnings, [])
      assert(fs.lstatSync(resolved).isFile(), 'is file')
      assert.equal(
        fs.lstatSync(resolved).mode & 0o777,
        isWindows ? 0o666 : fmode,
      )
    })
  }
})

const poopError = () => Object.assign(new Error('poop'), { code: 'EPOOP' })

describe('fail all stats', () => {
  const poop = poopError()

  // Make each stat function of fs fail until the test ends.
  const setup = () => {
    const dir = normPath(testdir({}))
    const { stat, fstat, lstat, statSync, fstatSync, lstatSync } = fs
    cleanup(() =>
      Object.assign(fs, {
        stat,
        fstat,
        lstat,
        statSync,
        fstatSync,
        lstatSync,
      }),
    )
    fs.stat =
      fs.lstat =
      fs.fstat =
        (...args) => {
          // don't fail statting the cwd, or we get different errors
          if (normPath(args[0]) === dir) {
            return lstat(dir, args.pop())
          }
          process.nextTick(() => args.pop()(poop))
        }
    fs.statSync =
      fs.lstatSync =
      fs.fstatSync =
        (...args) => {
          if (normPath(args[0]) === dir) {
            return lstatSync(dir)
          }
          throw poop
        }
    return dir
  }

  const data = makeTar([
    {
      path: 'd/i/r/file/',
      type: 'Directory',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    'a',
    {
      path: 'd/i/r/link',
      type: 'Link',
      linkpath: 'd/i/r/file',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    {
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = setup()
      const warnings = await runWarnings(mode, { cwd }, data)
      // One warning for each of the 5 entries.
      assert.deepEqual(
        warnings,
        Array.from({ length: 5 }, () => ['TAR_ENTRY_ERROR', 'poop', poop]),
      )
    })
  }
})

describe('fail symlink', () => {
  const poop = poopError()
  const data = makeTar([
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    {
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      cleanup(mutateFS.fail('symlink', poop))
      const warnings = await runWarnings(mode, { cwd }, data)
      assert.deepEqual(warnings, [['TAR_ENTRY_ERROR', 'poop', poop]])
    })
  }
})

describe('fail chmod', () => {
  const poop = poopError()
  const data = makeTar([
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      cleanup(mutateFS.fail('chmod', poop))
      const opt = { cwd, chmod: true, processUmask: 0o22 }
      const warnings = await runWarnings(mode, opt, data)
      assert.deepEqual(warnings, [['TAR_ENTRY_ERROR', 'poop', poop]])
    })
  }
})

describe('fail mkdir', () => {
  const poop = poopError()
  const data = makeTar([
    {
      path: 'dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    '',
    '',
  ])

  for (const mode of ['sync', 'async']) {
    test(mode, async () => {
      const cwd = testdir({})
      cleanup(mutateFS.fail('mkdir', poop))
      const warnings = await runWarnings(mode, { cwd }, data)
      assert.match(warnings, [
        [
          'TAR_ENTRY_ERROR',
          /^ENOENT: no such file or directory/,
          {
            code: 'ENOENT',
            syscall: 'lstat',
            path: normPath(path.resolve(cwd, 'dir')),
          },
        ],
      ])
      for (const [, message, er] of warnings) {
        assert.equal(message, er.message)
      }
    })
  }
})

describe('fail write', () => {
  const poop = poopError()
  const data = makeTar([
    {
      path: 'x',
      type: 'File',
      size: 1,
      mode: 0o751,
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    'x',
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      cleanup(mutateFS.fail('write', poop))
      const warnings = await runWarnings(mode, { cwd }, data)
      assert.deepEqual(warnings[0], ['TAR_ENTRY_ERROR', 'poop', poop])
      assert.equal(warnings.length, 1)
      for (const [, message, er] of warnings) {
        assert.equal(message, er.message)
      }
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
]
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
        fs.utimesSync(dir + '/x', date, date)
        await run(mode, { cwd: dir, ...opt }, data)
        const st = fs.lstatSync(dir + '/x')
        assert.equal(st.atime.toISOString(), date.toISOString())
        assert.equal(st.mtime.toISOString(), date.toISOString())
        assert.equal(fs.readFileSync(dir + '/x', 'utf8'), 'y')
      })
    }
  })
}

describe('no mtime', () => {
  const date = new Date('2011-03-27T22:16:31.000Z')
  const data = makeTar([
    {
      path: 'x/',
      type: 'Directory',
      size: 0,
      atime: date,
      ctime: date,
      mtime: date,
    },
    {
      path: 'x/y',
      type: 'File',
      size: 1,
      mode: 0o751,
      atime: date,
      ctime: date,
      mtime: date,
    },
    'x',
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const dir = testdir({})
      await run(mode, { cwd: dir, noMtime: true }, data)
      // this may fail if it's run on March 27, 2011
      const stx = fs.lstatSync(dir + '/x')
      assert.notEqual(stx.atime.toISOString(), date.toISOString())
      assert.notEqual(stx.mtime.toISOString(), date.toISOString())
      const sty = fs.lstatSync(dir + '/x/y')
      assert.notEqual(sty.atime.toISOString(), date.toISOString())
      assert.notEqual(sty.mtime.toISOString(), date.toISOString())
      assert.equal(fs.readFileSync(dir + '/x/y', 'utf8'), 'x')
    })
  }
})

test('unpack big enough to pause/drain', async () => {
  const dir = testdir({})
  const u = new Unpack({
    cwd: dir,
    strip: 3,
    strict: true,
  })
  const ignored = []
  u.on('ignoredEntry', entry => ignored.push(entry.path))
  await pipeFile(fixtures + '/parses.tar', u)
  assert.deepEqual(ignored, [])
  assert.deepEqual(fs.readdirSync(dir), fs.readdirSync(parses))
})

describe('set owner', () => {
  // fake it on platforms that don't have getuid
  const myUid = 501
  const myGid = 1024
  const fakeIds = (uid = myUid) => {
    stub(process, 'getuid', () => uid)
    stub(process, 'getgid', () => myGid)
  }

  // can't actually do this because it requires root, but we can
  // verify that chown gets called.
  test('as root, defaults to true', () => {
    fakeIds(0)
    const u = new Unpack()
    assert.equal(u.preserveOwner, true, 'preserveOwner enabled')
  })

  test('as non-root, defaults to false', () => {
    fakeIds(501)
    const u = new Unpack()
    assert.equal(u.preserveOwner, false, 'preserveOwner disabled')
  })

  const data = makeTar([
    {
      uid: 2456124561,
      gid: 813708013,
      path: 'foo/',
      type: 'Directory',
    },
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
    {
      uid: myUid,
      gid: myGid,
      path: 'foo-mine/',
      type: 'Directory',
    },
    {
      uid: myUid,
      gid: myGid,
      path: 'foo-mine/bar',
      type: 'File',
      size: 3,
    },
    'qux',
    {
      uid: myUid,
      path: 'foo-mine/nogid',
      type: 'Directory',
    },
    {
      uid: myUid,
      path: 'foo-mine/nogid/bar',
      type: 'File',
      size: 3,
    },
    'qux',
    '',
    '',
  ])

  for (const mode of ['sync', 'async']) {
    test(`chown failure results in unpack failure, ${mode}`, async () => {
      fakeIds()
      const poop = new Error('expected chown failure')
      failChowns(poop)
      const cwd = testdir({})
      const opt = { cwd, preserveOwner: true }
      const warnings = await runWarnings(mode, opt, data)
      assert.equal(warnings[0]?.[2], poop)
    })

    test(`chown when true, ${mode}`, async () => {
      fakeIds()
      const chowns = fakeChowns()
      const cwd = testdir({})
      await run(mode, { cwd, preserveOwner: true }, data)
      assert(chowns.length >= 5, 'called chowns')
    })

    test(`no chown when false, ${mode}`, async () => {
      fakeIds()
      failChowns(new Error('poop'))
      const dir = testdir({})
      await run(mode, { cwd: dir, preserveOwner: false }, data)
      const dirStat = fs.statSync(dir + '/foo')
      assert.notEqual(dirStat.uid, 2456124561)
      assert.notEqual(dirStat.gid, 813708013)
      const fileStat = fs.statSync(dir + '/foo/my-uid-different-gid')
      assert.notEqual(fileStat.uid, 2456124561)
      assert.notEqual(fileStat.gid, 813708013)
      const dirStat2 = fs.statSync(dir + '/foo/different-uid-nogid')
      assert.notEqual(dirStat2.uid, 2456124561)
      const fileStat2 = fs.statSync(dir + '/foo/different-uid-nogid/bar')
      assert.notEqual(fileStat2.uid, 2456124561)
    })
  }
})

describe('unpack when dir is not writable', () => {
  const data = makeTar([
    {
      path: 'a/',
      type: 'Directory',
      mode: 0o444,
    },
    {
      path: 'a/b',
      type: 'File',
      size: 1,
    },
    'a',
    '',
    '',
  ])

  for (const mode of ['sync', 'async']) {
    test(mode, async () => {
      const dir = testdir({})
      await run(mode, { cwd: dir, strict: true }, data)
      assert.equal(
        fs.statSync(dir + '/a').mode & 0o7777,
        isWindows ? 0o666 : 0o744,
      )
      assert.equal(fs.readFileSync(dir + '/a/b', 'utf8'), 'a')
    })
  }
})

describe('transmute chars on windows', () => {
  const data = makeTar([
    {
      path: '<|>?:.txt',
      size: 5,
      type: 'File',
    },
    '<|>?:',
    '',
    '',
  ])

  const hex = 'ef80bcef81bcef80beef80bfef80ba2e747874'
  const uglyName = Buffer.from(hex, 'hex').toString()

  for (const mode of modes) {
    test(mode, async () => {
      const dir = testdir({})
      await run(mode, { cwd: dir, win32: true }, data)
      assert.deepEqual(fs.readdirSync(dir), [uglyName])
      const ugly = path.resolve(dir, uglyName)
      assert.equal(fs.readFileSync(ugly, 'utf8'), '<|>?:')
    })
  }
})

test('safely transmute chars on windows with absolutes', async () => {
  // don't actually make the directory
  cleanup(mutateFS.fail('mkdir', new Error('poop')))

  const data = makeTar([
    {
      path: 'c:/x/y/z/<|>?:.txt',
      size: 5,
      type: 'File',
    },
    '<|>?:',
    '',
    '',
  ])

  const hex = 'ef80bcef81bcef80beef80bfef80ba2e747874'
  const uglyName = Buffer.from(hex, 'hex').toString()
  const uglyPath = 'c:/x/y/z/' + uglyName

  const u = new Unpack({
    win32: true,
    preservePaths: true,
  })
  const entry = emits(u, 'entry')
  await end(u, data)
  assert.equal((await entry).path, uglyPath)
})

describe('explicit chmod', () => {
  const data = makeTar([
    {
      path: 'x/y/z',
      mode: 0o775,
      type: 'Directory',
    },
    '',
    '',
  ])

  const zMode = cwd => fs.statSync(cwd + '/x/y/z').mode & 0o777

  for (const mode of modes) {
    test(`use explicit chmod when required by umask, ${mode}`, async () => {
      const cwd = testdir({})
      await run(mode, { cwd, chmod: true, processUmask: 0o22 }, data)
      assert.equal(zMode(cwd), isWindows ? 0o666 : 0o775)
    })

    test(`dont use explicit chmod if chmod flag not set, ${mode}`, async () => {
      const cwd = testdir({})
      stub(process, 'umask', () => {
        throw new Error('should not call process.umask()')
      })
      await run(mode, { cwd }, data)
      assert.equal(zMode(cwd), isWindows ? 0o666 : 0o755)
    })
  }
})

describe('chown implicit dirs and also the entries', () => {
  test('throws when setting uid/gid improperly', () => {
    assert.throws(() => new Unpack({ uid: 420 }), {
      name: 'TypeError',
      message: 'cannot set owner without number uid and gid',
    })
    assert.throws(() => new Unpack({ gid: 666 }), {
      name: 'TypeError',
      message: 'cannot set owner without number uid and gid',
    })
    assert.throws(
      () => new Unpack({ uid: 1, gid: 2, preserveOwner: true }),
      {
        name: 'TypeError',
        message:
          'cannot preserve owner in archive and also set owner explicitly',
      },
    )
  })

  const data = makeTar([
    {
      path: 'a/b/c',
      mode: 0o775,
      type: 'File',
      size: 1,
      uid: null,
      gid: null,
    },
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

  // Each case: the name, and the ids that the process seems to have.
  const cases = [
    ['ids of the process', {}],
    ['processUid is 420', { getuid: 420 }],
    ['processGid is 666', { getgid: 666 }],
  ]
  for (const [name, ids] of cases) {
    for (const mode of modes) {
      test(`${name}, ${mode}`, async () => {
        for (const [method, id] of Object.entries(ids)) {
          stub(process, method, () => id)
        }
        // The fake chown functions let the test run as non-root.
        const chowns = fakeChowns()
        const cwd = testdir({})
        await run(mode, { cwd, uid: 420, gid: 666 }, data)
        assert.deepEqual(
          chowns,
          Array.from({ length: 8 }, () => [420, 666]),
        )
      })
    }
  }
})

describe('bad cwd setting', () => {
  const cases = [
    // the cwd itself
    {
      path: './',
      type: 'Directory',
    },
    // a file directly in the cwd
    {
      path: 'a',
      type: 'File',
    },
    // a file nested within a subdir of the cwd
    {
      path: 'a/b/c',
      type: 'File',
    },
  ]

  // Each case: what the cwd is, its path in the test directory, and
  // the code of the error.
  const cwdCases = [
    ['a file', 'file', 'ENOTDIR'],
    ['missing', 'asdf/asdf/asdf', 'ENOENT'],
  ]

  for (const c of cases) {
    const data = makeTar([
      {
        path: c.path,
        mode: 0o775,
        type: c.type,
        size: 0,
        uid: null,
        gid: null,
      },
      '',
      '',
    ])

    for (const [what, sub, code] of cwdCases) {
      test(`${c.type} ${c.path}, cwd is ${what}`, async () => {
        const cwd = testdir({ file: 'xyz' }) + '/' + sub
        const opt = { cwd }
        const expect = {
          name: 'CwdError',
          message: `${code}: Cannot cd into '${normPath(cwd)}'`,
          path: normPath(cwd),
          code,
        }
        assert.throws(() => new UnpackSync(opt).end(data), expect)
        assert.match(await asyncError(opt, data), expect)
      })
    }
  }
})

describe('transform', () => {
  const cases = {
    'emptypax.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'one-byte.txt': '[a]',
    },
    'body-byte-counts.tar': {
      '1024-bytes.txt': new Array(1024).join('[x]') + '[\n]',
      '512-bytes.txt': new Array(512).join('[x]') + '[\n]',
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

  const txFn = entry => {
    switch (path.basename(entry.path)) {
      case 'zero-bytes.txt':
        return entry

      case 'one-byte.txt':
      case '1024-bytes.txt':
      case '512-bytes.txt':
      case 'Ω.txt':
        return new Bracer()
    }
  }

  class Bracer extends Minipass {
    write(data) {
      const d = data
        .toString()
        .split('')
        .map(c => '[' + c + ']')
        .join('')
      return super.write(d)
    }
  }

  for (const [tarfile, expect] of Object.entries(cases)) {
    const tf = path.resolve(tars, tarfile)
    for (const mode of modes) {
      for (const strict of [true, false]) {
        const name = `${tarfile} ${mode} ${strict ? 'strict' : 'loose'}`
        test(name, async () => {
          const dir = testdir({})
          const unpack = make(mode, { cwd: dir, strict, transform: txFn })
          if (mode === 'sync') {
            unpack.end(fs.readFileSync(tf))
          } else {
            await pipeFile(tf, unpack)
          }
          for (const [file, content] of Object.entries(expect)) {
            const f = path.resolve(dir, file)
            assert.equal(fs.readFileSync(f, 'utf8'), content, file)
          }
        })
      }
    }
  }
})

describe('transform error', () => {
  const tarfile = path.resolve(tars, 'body-byte-counts.tar')
  const tardata = fs.readFileSync(tarfile)
  const poop = new Error('poop')

  const txFn = () => {
    const tx = new Minipass()
    tx.write = () => tx.emit('error', poop)
    tx.resume()
    return tx
  }

  for (const mode of ['sync', 'async']) {
    test(`${mode} strict`, async () => {
      const dir = testdir({})
      const opt = { cwd: dir, strict: true, transform: txFn }
      const unpack = make(mode, opt)
      const errors = []
      unpack.on('error', er => errors.push(er))
      await finish(mode, unpack, tardata)
      assert.deepEqual(errors, [poop, poop, poop])
    })

    test(`${mode} loose`, async () => {
      const dir = testdir({})
      const unpack = make(mode, { cwd: dir, transform: txFn })
      const errors = []
      unpack.on('warn', (_code, _msg, er) => errors.push(er))
      await finish(mode, unpack, tardata)
      assert.deepEqual(errors, [poop, poop, poop])
    })
  }
})

describe('futimes/fchown failures', () => {
  const archive = path.resolve(tars, 'utf8.tar')
  const tardata = fs.readFileSync(archive)

  const poop = new Error('poop')
  const second = new Error('second error')

  for (const method of ['utimes', 'chown']) {
    const forceChown = method === 'chown'

    describe(method + ' fallback', () => {
      // The tests of this group unpack into one directory.
      const cwd = testdir({})
      for (const mode of modes) {
        for (const strict of [true, false]) {
          test(`${mode} ${strict ? 'strict' : 'loose'}`, async () => {
            cleanup(mutateFS.fail('f' + method, poop))
            // forceChown will fail on systems where the user is not root
            // and/or the uid/gid in the archive aren't valid. We're just
            // verifying coverage here, so make the method auto-pass.
            cleanup(mutateFS.pass(method))
            const unpack = make(mode, { cwd, strict, forceChown })
            const problems = []
            unpack.on('error', er => problems.push(er))
            unpack.on('warn', (_code, _msg, er) => problems.push(er))
            await finish(mode, unpack, tardata)
            assert.deepEqual(problems, [])
            assert.equal(fs.readFileSync(cwd + '/Ω.txt', 'utf8'), 'Ω')
          })
        }
      }
    })

    describe('also fail ' + method, () => {
      for (const mode of modes) {
        for (const strict of [true, false]) {
          test(`${mode} ${strict ? 'strict' : 'loose'}`, async () => {
            cleanup(mutateFS.fail('f' + method, poop))
            cleanup(mutateFS.fail(method, second))
            const cwd = testdir({})
            const unpack = make(mode, { cwd, strict, forceChown })
            const errors = []
            if (strict) {
              unpack.on('error', er => errors.push(er))
            } else {
              unpack.on('warn', (_code, _msg, er) => errors.push(er))
            }
            await finish(mode, unpack, tardata)
            assert.deepEqual(errors, [poop, poop, poop])
          })
        }
      }
    })
  }
})

describe('onReadEntry option is preserved', () => {
  const data = makeTar([
    {
      path: 'd/i',
      type: 'Directory',
    },
    {
      path: 'd/i/r/dir',
      type: 'Directory',
      mode: 0o751,
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
    },
    'a',
    '',
    '',
  ])

  for (const mode of ['sync', 'async']) {
    test(mode, async () => {
      let oecalls = 0
      const onReadEntry = _entry => oecalls++
      const dir = testdir({})
      await run(mode, { cwd: dir, onReadEntry }, data)
      assert.equal(oecalls, 3)
    })
  }
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
    {
      path: 'link',
      type: 'File',
      size: 4,
      mode: 0o644,
      mtime: now,
    },
    'bar\n',
    '',
    '',
  ])

  const checks = {
    link: 'bar\n',
    overwriteme: 'foo\n',
  }

  for (const mode of modes) {
    test(mode, async () => {
      const dir = testdir({})
      await run(mode, { cwd: dir }, data)
      for (const f in checks) {
        assert.equal(fs.readFileSync(dir + '/' + f, 'utf8'), checks[f], f)
        assert.equal(fs.statSync(dir + '/' + f).nlink, 1, f)
      }
    })
  }
})

describe('trying to unpack a non-zlib gzip file should fail', () => {
  const data = Buffer.from('hello this is not gzip data')
  const dataGzip = Buffer.concat([Buffer.from([0x1f, 0x8b]), data])

  test('abort if gzip has an error', async () => {
    const cwd = testdir({})
    const expect = {
      message: /^zlib/,
      errno: any.number,
      code: /^Z/,
      recoverable: false,
      cwd: normPath(cwd),
      tarCode: 'TAR_ABORT',
    }
    const opts = { cwd, gzip: true }
    assert.match(await asyncError(opts, dataGzip), expect, 'async emits')
    assert.throws(
      () => new UnpackSync(opts).end(dataGzip),
      expect,
      'sync throws',
    )
  })

  test('bad archive if no gzip', async () => {
    const expect = {
      tarCode: 'TAR_BAD_ARCHIVE',
      recoverable: false,
    }
    const opts = { cwd: testdir({}) }
    assert.match(await asyncError(opts, data), expect, 'async emits')
    assert.throws(
      () => new UnpackSync(opts).end(data),
      expect,
      'sync throws',
    )
  })
})

describe('max decompression ratio', () => {
  const data = makeCompressedBomb()

  test('aborts compressed bombs by default', async () => {
    const cwd = testdir({})
    const expect = {
      tarCode: 'TAR_ABORT',
      recoverable: false,
      cwd: normPath(cwd),
      message: /max decompression ratio exceeded/,
    }
    assert.match(await asyncError({ cwd }, data), expect)
    assert.throws(
      () => new UnpackSync({ cwd }).end(data),
      expect,
      'sync throws',
    )
  })

  test('can be disabled explicitly', async () => {
    const cwd = testdir({})
    const u = new Unpack({
      cwd,
      maxDecompressionRatio: Infinity,
    })
    const errors = []
    u.on('error', er => errors.push(er))
    await end(u, data)
    assert.deepEqual(errors, [])
    assert.equal(
      fs.statSync(path.resolve(cwd, 'bomb')).size,
      8 * 1024 * 1024,
    )
  })
})

describe('handle errors on fs.close', () => {
  const poop = new Error('poop')
  const data = makeTar([
    {
      path: 'file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    'a',
    '',
    '',
  ])

  test('async', async () => {
    const cwd = testdir({})
    // have to actually close them, or else windows gets mad
    cleanup(mutateFS.fail('close', poop))
    const u = new Unpack({ cwd, strict: true })
    const errors = []
    u.on('error', er => errors.push(er))
    await end(u, data)
    assert.deepEqual(errors, [poop])
  })

  test('sync', () => {
    const cwd = normPath(testdir({}))
    cleanup(mutateFS.fail('close', poop))
    assert.throws(
      () => new UnpackSync({ cwd, strict: true }).end(data),
      { message: poop.message },
      'sync',
    )
  })
})

describe('using strip option when top level file exists', () => {
  const data = makeTar([
    {
      path: 'top',
      type: 'File',
      size: 0,
    },
    {
      path: 'x',
      type: 'Directory',
    },
    {
      path: 'x/a',
      type: 'File',
      size: 'a'.length,
    },
    'a',
    {
      path: 'y',
      type: 'GNUDumpDir',
    },
    {
      path: 'y/b',
      type: 'File',
      size: 'b'.length,
    },
    'b',
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({ y: {} })
      await run(mode, { cwd, strip: 1 }, data)
      assert.equal(fs.statSync(cwd).isDirectory(), true)
      assert.equal(fs.readFileSync(cwd + '/a', 'utf8'), 'a')
      assert.equal(fs.readFileSync(cwd + '/b', 'utf8'), 'b')
      assert.throws(() => fs.statSync(cwd + '/top'), { code: 'ENOENT' })
    })
  }
})

describe('handle EPERMs when creating symlinks', () => {
  // https://github.com/npm/node-tar/issues/265
  const msg =
    'You do not have sufficient privilege to perform this operation.'
  const er = Object.assign(new Error(msg), {
    code: 'EPERM',
  })
  const data = makeTar([
    {
      path: 'x',
      type: 'Directory',
    },
    {
      path: 'x/y',
      type: 'File',
      size: 'hello, world'.length,
    },
    'hello, world',
    {
      path: 'x/link1',
      type: 'SymbolicLink',
      linkpath: './y',
    },
    {
      path: 'x/link2',
      type: 'SymbolicLink',
      linkpath: './y',
    },
    {
      path: 'x/link3',
      type: 'SymbolicLink',
      linkpath: './y',
    },
    {
      path: 'x/z',
      type: 'File',
      size: 'hello, world'.length,
    },
    'hello, world',
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      cleanup(mutateFS.fail('symlink', er))
      const warnings = await runWarnings(mode, { cwd }, data)
      assert.deepEqual(
        warnings.map(([code, message]) => [code, message]),
        [
          ['TAR_ENTRY_ERROR', msg],
          ['TAR_ENTRY_ERROR', msg],
          ['TAR_ENTRY_ERROR', msg],
        ],
        'got expected warnings',
      )
      assert.equal(fs.readFileSync(`${cwd}/x/y`, 'utf8'), 'hello, world')
      assert.equal(fs.readFileSync(`${cwd}/x/z`, 'utf8'), 'hello, world')
      assert.throws(() => fs.statSync(`${cwd}/x/link1`), {
        code: 'ENOENT',
      })
      assert.throws(() => fs.statSync(`${cwd}/x/link2`), {
        code: 'ENOENT',
      })
      assert.throws(() => fs.statSync(`${cwd}/x/link3`), {
        code: 'ENOENT',
      })
    })
  }
})

// Make sure that each fd that fs.open gave was closed.
const checkFdsClosed = ({ opens, closes }) => {
  const opened = Object.entries(opens)
  assert.notEqual(opened.length, 0)
  for (const [path, fd] of opened) {
    assert.equal(closes.includes(fd), true, 'closed fd for ' + path)
  }
}

test('close fd when error writing', async () => {
  const data = makeTar([
    {
      type: 'Directory',
      path: 'x',
    },
    {
      type: 'File',
      size: 1,
      path: 'x/y',
    },
    '.',
    '',
    '',
  ])
  cleanup(mutateFS.fail('write', new Error('nope')))
  const fds = trackFds()
  const cwd = testdir({})
  await runWarnings('async', { cwd }, data)
  checkFdsClosed(fds)
})

test('close fd when error setting mtime', async () => {
  const data = makeTar([
    {
      type: 'Directory',
      path: 'x',
    },
    {
      type: 'File',
      size: 1,
      path: 'x/y',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    '.',
    '',
    '',
  ])
  // have to clobber these both, because we fall back
  cleanup(mutateFS.fail('futimes', new Error('nope')))
  cleanup(mutateFS.fail('utimes', new Error('nooooope')))
  const fds = trackFds()
  const cwd = testdir({})
  await runWarnings('async', { cwd }, data)
  checkFdsClosed(fds)
})

test('do not hang on large files that fail to open()', async () => {
  const data = makeTar([
    {
      type: 'Directory',
      path: 'x',
    },
    {
      type: 'File',
      size: 31745,
      path: 'x/y',
    },
    'x'.repeat(31745),
    '',
    '',
  ])
  cleanup(mutateFS.fail('open', new Error('nope')))
  const dir = testdir({})

  const warnings = []
  const unpack = new Unpack({
    cwd: dir,
    onwarn: (code, msg) => warnings.push([code, msg]),
  })
  const done = emits(unpack)
  const tick = () => new Promise(res => setTimeout(res))
  unpack.write(data.subarray(0, 2048))
  await tick()
  unpack.write(data.subarray(2048, 4096))
  await tick()
  unpack.write(data.subarray(4096))
  await tick()
  unpack.end()
  await done
  assert.deepEqual(warnings, [['TAR_ENTRY_ERROR', 'nope']])
})

describe('recognize C:.. as a dot path part', () => {
  // Load the unpack module with the path functions of Windows.
  const setup = () => {
    if (!isWindows) {
      env({ TESTING_TAR_FAKE_PLATFORM: 'win32' })
    }
    return mockImport(
      () => import('../src/unpack.js'),
      [
        [
          () => import('path'),
          {
            ...path.win32,
            win32: path.win32,
            posix: path.posix,
          },
        ],
      ],
    )
  }

  const data = makeTar([
    {
      type: 'File',
      path: 'C:../x/y/z',
      size: 1,
    },
    'z',
    {
      type: 'File',
      path: 'x:..\\y\\z',
      size: 1,
    },
    'x',
    {
      type: 'File',
      path: 'Y:foo',
      size: 1,
    },
    'y',
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const { Unpack, UnpackSync } = await setup()
      const cwd = testdir({})
      const warnings = []
      const opt = {
        cwd,
        onwarn: (c, w, { entry, path }) =>
          warnings.push([c, w, path, entry.path]),
      }
      if (mode === 'sync') {
        new UnpackSync(opt).end(data)
      } else {
        await end(new Unpack(opt), data)
      }
      assert.equal(fs.readFileSync(`${cwd}/foo`, 'utf8'), 'y')
      assert.deepEqual(warnings, [
        [
          'TAR_ENTRY_ERROR',
          "path contains '..'",
          'C:../x/y/z',
          'C:../x/y/z',
        ],
        ['TAR_ENTRY_ERROR', "path contains '..'", 'x:../y/z', 'x:../y/z'],
        [
          'TAR_ENTRY_INFO',
          'stripping Y: from absolute path',
          'Y:foo',
          'foo',
        ],
      ])
    })
  }
})

describe('excessively deep subfolder nesting', () => {
  const tf = path.resolve(fixtures, 'excessively-deep.tar')
  const data = fs.readFileSync(tf)

  // Each case: the name, the option, and the limit that it gives.
  const cases = [
    ['default', {}, 1024],
    ['set md', { maxDepth: 64 }, 64],
  ]
  for (const [name, opt, maxDepth] of cases) {
    for (const mode of modes) {
      test(`${mode} ${name}`, async () => {
        const cwd = testdir({})
        const warnings = await runWarnings(mode, { cwd, ...opt }, data)
        assert.match(warnings, [
          [
            'TAR_ENTRY_ERROR',
            'path excessively deep',
            {
              entry: any.instanceOf(ReadEntry),
              path: /^\.(\/a){1024,}\/foo.txt$/,
              depth: 222372,
              maxDepth,
            },
          ],
        ])
      })
    }
  }
})

describe('ignore self-referential hardlinks', () => {
  const data = makeTar([
    {
      path: 'autolink',
      linkpath: './autolink',
      type: 'Link',
    },
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      const warnings = await runWarnings(mode, { cwd }, data)
      // The snapshot must not have the path of the test directory.
      assert.snapshot(
        warnings.map(([, message]) => message.replaceAll(cwd, '{CWD}')),
      )
      assert.deepEqual(fs.readdirSync(cwd), [], 'nothing extracted')
    })
  }
})

test('valid relative symlink with .. should be extracted', async () => {
  const makeTar = () => {
    // foo/file.txt (regular file)
    // bar/link.txt -> ../foo/file.txt (valid relative symlink)
    const chunks = []

    const fooDirHeader = Buffer.alloc(512)
    new Header({
      path: 'foo/',
      type: 'Directory',
      mode: 0o755,
    }).encode(fooDirHeader, 0)
    chunks.push(fooDirHeader)

    const fileContent = 'hello world'
    const fileHeader = Buffer.alloc(512)
    new Header({
      path: 'foo/file.txt',
      type: 'File',
      mode: 0o644,
      size: fileContent.length,
    }).encode(fileHeader, 0)
    chunks.push(fileHeader)

    const contentBuf = Buffer.alloc(512)
    contentBuf.write(fileContent)
    chunks.push(contentBuf)

    const barDirHeader = Buffer.alloc(512)
    new Header({
      path: 'bar/',
      type: 'Directory',
      mode: 0o755,
    }).encode(barDirHeader, 0)
    chunks.push(barDirHeader)

    const symlinkHeader = Buffer.alloc(512)
    new Header({
      path: 'bar/link.txt',
      type: 'SymbolicLink',
      linkpath: '../foo/file.txt',
    }).encode(symlinkHeader, 0)
    chunks.push(symlinkHeader)

    const escapedSymlinkHeader = Buffer.alloc(512)
    new Header({
      path: 'bar/badlink.txt',
      type: 'SymbolicLink',
      linkpath: '../../oh/no',
    }).encode(escapedSymlinkHeader)
    chunks.push(escapedSymlinkHeader)

    chunks.push(Buffer.alloc(1024))

    return Buffer.concat(chunks)
  }

  const dir = testdir({
    'test.tar': makeTar(),
  })

  const warnings = []

  await extract({
    cwd: dir,
    file: dir + '/test.tar',
    onwarn: (c, m) => warnings.push([c, m]),
  })

  assert(fs.lstatSync(dir + '/foo/file.txt').isFile())
  assert(fs.lstatSync(dir + '/bar/link.txt').isSymbolicLink())
  assert.equal(fs.readlinkSync(dir + '/bar/link.txt'), '../foo/file.txt')
  assert.equal(
    fs.readFileSync(dir + '/bar/link.txt', 'utf8'),
    'hello world',
  )
  assert.throws(() => fs.statSync(dir + '/bar/badlink.txt'), Error)
  assert.match(warnings, [
    ['TAR_ENTRY_ERROR', 'linkpath escapes extraction directory'],
  ])
})

describe('no linking through a symlink', () => {
  const types = ['Link', 'SymbolicLink']
  for (const type of types) {
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
      const expect = {
        name: 'SymlinkError',
        message: /^TAR_SYMLINK_ERROR/,
        path: /a.b.escape.exploited-file$/,
        symlink: /a.b.escape$/,
      }

      for (const mode of ['sync', 'async']) {
        test(mode, async () => {
          const cwd = testdir({
            x: {},
            a: { b: {} },
            'exploited-file': 'original content',
          })
          // An archive cannot make a symlink that leaves the
          // directory, so this one is on disk before the extraction.
          fs.symlinkSync('../..', cwd + '/a/b/escape')
          const opt = { cwd, strict: true }
          if (mode === 'sync') {
            assert.throws(() => {
              new UnpackSync(opt).end(exploit)
            }, expect)
          } else {
            assert.match(await asyncError(opt, exploit), expect)
          }
          fs.writeFileSync(cwd + '/x/exploit', 'pwned')
          assert.equal(
            fs.readFileSync(cwd + '/exploited-file', 'utf8'),
            'original content',
          )
        })
      }
    })
  }
})

describe('numeric pax/entry name discernment', () => {
  const numericName = '12345'
  const alphaName = 'abcde'
  for (const strict of [true, false]) {
    describe('strict=' + strict, () => {
      for (const paxName of [numericName, alphaName]) {
        describe('paxName=' + paxName, () => {
          for (const entryName of [numericName, alphaName]) {
            describe('entryName=' + entryName, () => {
              const paxHeader = new Pax(
                {
                  path: paxName,
                  size: '12345\n'.length,
                },
                false,
              )
              const paxData = paxHeader.encode()
              const data = makeTar([
                paxData,
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

              test('sync', () => {
                const dir = testdir({})
                new UnpackSync({ strict, cwd: dir }).end(data)
                assert.equal(
                  readFileSync(dir + '/' + paxName, 'utf8'),
                  '12345\n',
                )
              })

              test('async', async () => {
                const dir = testdir({})
                await new Promise(r => {
                  new Unpack({ strict, cwd: dir }).on('end', r).end(data)
                })
                assert.equal(
                  readFileSync(dir + '/' + paxName, 'utf8'),
                  '12345\n',
                )
              })
            })
          }
        })
      }
    })
  }
})

describe('rename a file before unlink on windows', () => {
  // Load the unpack module with the file removal of Windows.
  const setup = () => {
    if (!isWindows) {
      env({ TESTING_TAR_FAKE_PLATFORM: 'win32' })
    }
    return mockImport(() => import('../src/unpack.js'), [])
  }

  const data = makeTar([
    {
      type: 'File',
      path: 'x',
      size: 3,
    },
    'new',
    '',
    '',
  ])

  // Unpack the data over a file in the mode. Return the folder, and
  // each warning as [code, message].
  const unpackOver = async mode => {
    const { Unpack, UnpackSync } = await setup()
    const cwd = testdir({ x: 'old' })
    const warnings = []
    const opt = { cwd, onwarn: (c, w) => warnings.push([c, w]) }
    if (mode === 'sync') {
      new UnpackSync(opt).end(data)
    } else {
      await end(new Unpack(opt), data)
    }
    return { cwd, warnings }
  }

  for (const mode of modes) {
    const method = mode === 'sync' ? 'renameSync' : 'rename'

    test(mode, async () => {
      const renames = []
      cleanup(
        mutateFS.mutateArgs(method, args => {
          renames.push(args.slice(0, 2))
          return args
        }),
      )
      const { cwd, warnings } = await unpackOver(mode)
      assert.deepEqual(warnings, [])
      const file = normPath(path.resolve(cwd, 'x'))
      assert.match(renames, [
        [
          file,
          name => /^\.DELETE\.[0-9a-f]{32}$/.test(name.slice(file.length)),
        ],
      ])
      assert.equal(renames[0][1].slice(0, file.length), file)
      assert.deepEqual(fs.readdirSync(cwd), ['x'])
      assert.equal(fs.readFileSync(cwd + '/x', 'utf8'), 'new')
    })

    test(`${mode} rename fails`, async () => {
      const er = new Error('no rename')
      if (mode === 'sync') {
        spyOn(fs, method, () => {
          throw er
        })
      } else {
        cleanup(mutateFS.fail(method, er))
      }
      const { cwd, warnings } = await unpackOver(mode)
      assert.deepEqual(warnings, [['TAR_ENTRY_ERROR', 'no rename']])
      assert.equal(fs.readFileSync(cwd + '/x', 'utf8'), 'old')
    })
  }
})

describe('newer option with an entry that has no mtime', () => {
  const data = makeTar([
    {
      type: 'File',
      path: 'x',
      size: 3,
    },
    'new',
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({ x: 'old' })
      const warnings = await runWarnings(mode, { cwd, newer: true }, data)
      assert.deepEqual(warnings, [])
      assert.equal(fs.readFileSync(cwd + '/x', 'utf8'), 'new')
    })
  }
})

describe('file name that the file system refuses', () => {
  const name = 'x'.repeat(1000)
  const data = makeTar([
    new Pax({ path: name }).encode(),
    {
      type: 'File',
      path: 'x',
      size: 1,
    },
    'x',
    '',
    '',
  ])

  for (const mode of modes) {
    test(mode, async () => {
      const cwd = testdir({})
      const warnings = await runWarnings(mode, { cwd }, data)
      assert.match(warnings, [
        ['TAR_ENTRY_ERROR', /^ENAMETOOLONG/, { code: 'ENAMETOOLONG' }],
      ])
      assert.deepEqual(fs.readdirSync(cwd), [])
    })
  }
})

test('sync unpack ignores an error of utimes on a directory', () => {
  const data = makeTar([
    {
      type: 'Directory',
      path: 'x',
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    '',
    '',
  ])
  const utimes = spyOn(fs, 'lutimesSync', () => {
    throw new Error('nope')
  })
  const cwd = testdir({})
  const warnings = []
  new UnpackSync({
    cwd,
    onwarn: (c, w) => warnings.push([c, w]),
  }).end(data)
  assert.deepEqual(warnings, [])
  assert.equal(utimes.calls.length, 1)
  assert(fs.statSync(cwd + '/x').isDirectory())
})
