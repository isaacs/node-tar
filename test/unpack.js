import { Unpack, UnpackSync } from '../dist/esm/unpack.js'

import fs, { readdirSync } from 'fs'
import { Minipass } from 'minipass'
import * as z from 'minizlib'
import path from 'path'
import { rimraf } from 'rimraf'
import t from 'tap'
import { fileURLToPath } from 'url'
import { Header } from '../dist/esm/header.js'
import { makeTar } from './fixtures/make-tar.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fixtures = path.resolve(__dirname, 'fixtures')
const tars = path.resolve(fixtures, 'tars')
const parses = path.resolve(fixtures, 'parse')

import eos from 'end-of-stream'
import { mkdirp } from 'mkdirp'
import mutateFS from 'mutate-fs'
import { normalizeWindowsPath as normPath } from '../dist/esm/normalize-windows-path.js'

import { ReadEntry } from '../dist/esm/read-entry.js'

// On Windows in particular, the "really deep folder path" file
// often tends to cause problems, which don't indicate a failure
// of this library, it's just what happens on Windows with super
// long file paths.
const isWindows = process.platform === 'win32'
const isLongFile = f =>
  f.match(/r.e.a.l.l.y.-.d.e.e.p.-.f.o.l.d.e.r.-.p.a.t.h/)

t.capture(process, 'umask', () => 0o22)

t.test('basic file unpack tests', t => {
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
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt':
        'Ω',
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
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt':
        'Ω',
    },
  }

  const tarfiles = Object.keys(cases)
  t.plan(tarfiles.length)
  t.jobs = tarfiles.length

  tarfiles.forEach(tarfile => {
    t.test(tarfile, t => {
      const tf = path.resolve(tars, tarfile)
      const dir = t.testdir({})
      const linkdir = dir + '.link'
      t.beforeEach(async () => {
        await rimraf(linkdir)
        fs.symlinkSync(dir, linkdir)
      })

      const check = t => {
        const expect = cases[tarfile]
        Object.keys(expect).forEach(file => {
          const f = path.resolve(dir, file)
          if (isWindows && isLongFile(file)) {
            return
          }
          t.equal(fs.readFileSync(f, 'utf8'), expect[file], file)
        })
        t.end()
      }

      t.plan(2)

      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new Unpack({ cwd: linkdir, strict: true })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, () => check(t))
        })
        t.test('loose', t => {
          const unpack = new Unpack({ cwd: linkdir })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, () => check(t))
        })
      })

      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new UnpackSync({ cwd: linkdir })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
        t.test('loose', t => {
          const unpack = new UnpackSync({ cwd: linkdir })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
      })
    })
  })
})

t.test('cwd default to process cwd', t => {
  const u = new Unpack()
  const us = new UnpackSync()
  const cwd = normPath(process.cwd())
  t.equal(u.cwd, cwd)
  t.equal(us.cwd, cwd)
  t.end()
})

t.test('links!', t => {
  const dir = t.testdir({})
  const data = fs.readFileSync(tars + '/links.tar')
  const stripData = fs.readFileSync(tars + '/links-strip.tar')

  t.plan(6)
  t.beforeEach(() => mkdirp(dir))
  t.afterEach(() => rimraf(dir))

  const check = t => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    t.equal(hl1.dev, hl2.dev)
    t.equal(hl1.ino, hl2.ino)
    t.equal(hl1.nlink, 2)
    t.equal(hl2.nlink, 2)
    if (!isWindows) {
      // doesn't work on win32 without special privs
      const sym = fs.lstatSync(dir + '/symlink')
      t.ok(sym.isSymbolicLink())
      t.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    }
    t.end()
  }
  const checkForStrip = t => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    const hl3 = fs.lstatSync(dir + '/1/2/3/hardlink-3')
    t.equal(hl1.dev, hl2.dev)
    t.equal(hl1.ino, hl2.ino)
    t.equal(hl1.dev, hl3.dev)
    t.equal(hl1.ino, hl3.ino)
    t.equal(hl1.nlink, 3)
    t.equal(hl2.nlink, 3)
    if (!isWindows) {
      const sym = fs.lstatSync(dir + '/symlink')
      t.ok(sym.isSymbolicLink())
      t.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    }
    t.end()
  }
  const checkForStrip3 = t => {
    // strips the linkpath entirely, so the link doesn't get extracted.
    t.throws(() => fs.lstatSync(dir + '/3'), { code: 'ENOENT' })
    t.end()
  }

  t.test('async', t => {
    const unpack = new Unpack({ cwd: dir })
    let finished = false
    unpack.on('finish', () => (finished = true))
    unpack.on('close', () =>
      t.ok(finished, 'emitted finish before close'),
    )
    unpack.on('close', () => check(t))
    unpack.end(data)
  })

  t.test('sync', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })

  t.test('sync strip', t => {
    const unpack = new UnpackSync({ cwd: dir, strip: 1 })
    unpack.end(stripData)
    checkForStrip(t)
  })

  t.test('async strip', t => {
    const unpack = new Unpack({ cwd: dir, strip: 1 })
    let finished = false
    unpack.on('finish', () => (finished = true))
    unpack.on('close', () =>
      t.ok(finished, 'emitted finish before close'),
    )
    unpack.on('close', () => checkForStrip(t))
    unpack.end(stripData)
  })

  t.test('sync strip 3', t => {
    const unpack = new UnpackSync({ cwd: dir, strip: 3 })
    unpack.end(fs.readFileSync(tars + '/links-strip.tar'))
    checkForStrip3(t)
  })

  t.test('async strip 3', t => {
    const unpack = new Unpack({ cwd: dir, strip: 3 })
    let finished = false
    unpack.on('finish', () => (finished = true))
    unpack.on('close', () =>
      t.ok(finished, 'emitted finish before close'),
    )
    unpack.on('close', () => checkForStrip3(t))
    unpack.end(stripData)
  })
})

t.test('links without cleanup (exercise clobbering code)', t => {
  const dir = t.testdir({})
  const data = fs.readFileSync(tars + '/links.tar')

  t.plan(6)

  t.beforeEach(() => {
    // clobber this junk
    try {
      mkdirp.sync(dir + '/hardlink-1')
      mkdirp.sync(dir + '/hardlink-2')
      fs.writeFileSync(dir + '/symlink', 'not a symlink')
    } catch (er) {}
  })

  const check = t => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    t.equal(hl1.dev, hl2.dev)
    t.equal(hl1.ino, hl2.ino)
    t.equal(hl1.nlink, 2)
    t.equal(hl2.nlink, 2)
    if (!isWindows) {
      const sym = fs.lstatSync(dir + '/symlink')
      t.ok(sym.isSymbolicLink())
      t.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    }
    t.end()
  }

  t.test('async', t => {
    const unpack = new Unpack({ cwd: dir })
    let prefinished = false
    unpack.on('prefinish', () => (prefinished = true))
    unpack.on('finish', () =>
      t.ok(prefinished, 'emitted prefinish before finish'),
    )
    unpack.on('close', () => check(t))
    unpack.end(data)
  })

  t.test('sync', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })

  t.test('async again', t => {
    const unpack = new Unpack({ cwd: dir })
    eos(unpack, () => check(t))
    unpack.end(data)
  })

  t.test('sync again', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })

  t.test('async unlink', t => {
    const unpack = new Unpack({ cwd: dir, unlink: true })
    unpack.on('close', () => check(t))
    unpack.end(data)
  })

  t.test('sync unlink', t => {
    const unpack = new UnpackSync({ cwd: dir, unlink: true })
    unpack.end(data)
    check(t)
  })
})

t.test('nested dir dupe', t => {
  const dir = t.testdir({})
  mkdirp.sync(dir + '/d/e/e/p')
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

  const check = t => {
    const entries = fs.readdirSync(dir)
    t.equal(entries.length, 1)
    t.equal(entries[0], 'd')
    Object.keys(expect).forEach(f => {
      const file = dir + '/' + f
      t.equal(fs.readFileSync(file, 'utf8'), expect[f])
    })
    t.end()
  }

  const unpack = new Unpack({ cwd: dir, strip: 8 })
  const data = fs.readFileSync(tars + '/long-paths.tar')
  // while we're at it, why not use gzip too?
  const zip = new z.Gzip()
  zip.pipe(unpack)
  unpack.on('close', () => check(t))
  zip.end(data)
})

t.test(
  'symlink in dir path',
  {
    skip: isWindows && 'symlinks not fully supported',
  },
  t => {
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

    t.test('no clobbering', t => {
      const warnings = []
      const cwd = t.testdir({})
      const u = new Unpack({
        cwd,
        onwarn: (c, w, d) => warnings.push([c, w, d]),
      })
      u.on('close', () => {
        t.equal(
          fs.lstatSync(cwd + '/d/i').mode & 0o7777,
          isWindows ? 0o666 : 0o755,
        )
        t.equal(
          fs.lstatSync(cwd + '/d/i/r/dir').mode & 0o7777,
          isWindows ? 0o666 : 0o751,
        )
        t.ok(fs.lstatSync(cwd + '/d/i/r/file').isFile(), 'got file')
        if (!isWindows) {
          t.ok(
            fs.lstatSync(cwd + '/d/i/r/symlink').isSymbolicLink(),
            'got symlink',
          )
          t.throws(() => fs.statSync(cwd + '/d/i/r/symlink/x'))
        }
        t.equal(warnings[0][0], 'TAR_ENTRY_ERROR')
        if (!isWindows) {
          t.equal(
            warnings[0][1],
            'TAR_SYMLINK_ERROR: Cannot extract through symbolic link',
          )
          t.match(warnings[0][2], {
            name: 'SymlinkError',
            code: 'TAR_SYMLINK_ERROR',
            tarCode: 'TAR_ENTRY_ERROR',
            path: cwd + '/d/i/r/symlink/',
            symlink: cwd + '/d/i/r/symlink',
          })
        }
        t.equal(warnings.length, 1)
        t.end()
      })
      u.end(data)
    })

    t.test('no clobbering, sync', t => {
      const warnings = []
      const cwd = t.testdir({})
      const u = new UnpackSync({
        cwd,
        onwarn: (c, w, d) => warnings.push([c, w, d]),
      })
      u.end(data)
      t.equal(
        fs.lstatSync(cwd + '/d/i/r/dir').mode & 0o7777,
        isWindows ? 0o666 : 0o751,
      )
      t.ok(fs.lstatSync(cwd + '/d/i/r/file').isFile(), 'got file')
      if (!isWindows) {
        t.ok(
          fs.lstatSync(cwd + '/d/i/r/symlink').isSymbolicLink(),
          'got symlink',
        )
        t.throws(() => fs.statSync(cwd + '/d/i/r/symlink/x'))
      }
      t.equal(warnings.length, 1)
      t.equal(warnings[0][0], 'TAR_ENTRY_ERROR')
      t.equal(
        warnings[0][1],
        'TAR_SYMLINK_ERROR: Cannot extract through symbolic link',
      )
      t.match(warnings[0][2], {
        name: 'SymlinkError',
        path: cwd + '/d/i/r/symlink/',
        symlink: cwd + '/d/i/r/symlink',
      })
      t.end()
    })

    t.test('extract through symlink', t => {
      const warnings = []
      const cwd = t.testdir({})
      const u = new Unpack({
        cwd,
        onwarn: (c, w, d) => warnings.push([c, w, d]),
        preservePaths: true,
      })
      u.on('close', () => {
        t.same(warnings, [])
        t.equal(fs.lstatSync(cwd + '/d/i/r/dir').mode & 0o7777, 0o751)
        t.ok(fs.lstatSync(cwd + '/d/i/r/file').isFile(), 'got file')
        t.ok(
          fs.lstatSync(cwd + '/d/i/r/symlink').isSymbolicLink(),
          'got symlink',
        )
        t.ok(
          fs.lstatSync(cwd + '/d/i/r/dir/x').isFile(),
          'x thru link',
        )
        t.ok(
          fs.lstatSync(cwd + '/d/i/r/symlink/x').isFile(),
          'x thru link',
        )
        t.end()
      })
      u.end(data)
    })

    t.test('extract through symlink sync', t => {
      const warnings = []
      const cwd = t.testdir({})
      const u = new UnpackSync({
        cwd,
        onwarn: (c, w, d) => warnings.push([c, w, d]),
        preservePaths: true,
      })
      u.end(data)
      t.same(warnings, [])
      t.equal(fs.lstatSync(cwd + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(cwd + '/d/i/r/file').isFile(), 'got file')
      t.ok(
        fs.lstatSync(cwd + '/d/i/r/symlink').isSymbolicLink(),
        'got symlink',
      )
      t.ok(fs.lstatSync(cwd + '/d/i/r/dir/x').isFile(), 'x thru link')
      t.ok(
        fs.lstatSync(cwd + '/d/i/r/symlink/x').isFile(),
        'x thru link',
      )
      t.end()
    })

    t.test('clobber through symlink', t => {
      const warnings = []
      const cwd = t.testdir({})
      const u = new Unpack({
        cwd,
        onwarn: (c, w, d) => warnings.push([c, w, d]),
        unlink: true,
      })
      u.on('close', () => {
        t.same(warnings, [])
        t.equal(fs.lstatSync(cwd + '/d/i/r/dir').mode & 0o7777, 0o751)
        t.ok(fs.lstatSync(cwd + '/d/i/r/file').isFile(), 'got file')
        t.notOk(
          fs.lstatSync(cwd + '/d/i/r/symlink').isSymbolicLink(),
          'no link',
        )
        t.ok(
          fs.lstatSync(cwd + '/d/i/r/symlink').isDirectory(),
          'sym is dir',
        )
        t.ok(
          fs.lstatSync(cwd + '/d/i/r/symlink/x').isFile(),
          'x thru link',
        )
        t.end()
      })
      u.end(data)
    })

    t.test('clobber through symlink with busted unlink', t => {
      const poop = new Error('poop')
      // for some reason, resetting fs.unlink in the teardown was breaking
      const reset = mutateFS.fail('unlink', poop)
      const cwd = t.testdir({})
      const warnings = []
      const u = new Unpack({
        cwd,
        onwarn: (c, w, d) => warnings.push([c, w, d]),
        unlink: true,
      })
      u.on('close', () => {
        t.same(warnings, [['TAR_ENTRY_ERROR', 'poop', poop]])
        reset()
        t.end()
      })
      u.end(data)
    })

    t.test('clobber through symlink sync', t => {
      const warnings = []
      const cwd = t.testdir({})
      const u = new UnpackSync({
        cwd,
        onwarn: (c, w, d) => warnings.push([c, w, d]),
        unlink: true,
      })
      u.end(data)
      t.equal(fs.lstatSync(cwd + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(cwd + '/d/i/r/file').isFile(), 'got file')
      t.notOk(
        fs.lstatSync(cwd + '/d/i/r/symlink').isSymbolicLink(),
        'no link',
      )
      t.ok(
        fs.lstatSync(cwd + '/d/i/r/symlink').isDirectory(),
        'sym is dir',
      )
      t.ok(
        fs.lstatSync(cwd + '/d/i/r/symlink/x').isFile(),
        'x thru link',
      )
      t.end()
    })

    t.test('clobber dirs', t => {
      const cwd = t.testdir({
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
      const warnings = []
      const u = new Unpack({
        cwd,
        onwarn: (c, w, d) => {
          warnings.push([c, w, d])
        },
        chmod: true,
      })
      u.on('close', () => {
        t.equal(fs.lstatSync(cwd + '/d/i/r/dir').mode & 0o7777, 0o751)
        t.ok(fs.lstatSync(cwd + '/d/i/r/file').isFile(), 'got file')
        t.ok(
          fs.lstatSync(cwd + '/d/i/r/symlink').isSymbolicLink(),
          'got symlink',
        )
        t.throws(() => fs.statSync(cwd + '/d/i/r/symlink/x'))
        t.equal(warnings.length, 1)
        t.equal(warnings[0][0], 'TAR_ENTRY_ERROR')
        t.equal(
          warnings[0][1],
          'TAR_SYMLINK_ERROR: Cannot extract through symbolic link',
        )
        t.match(warnings[0][2], {
          name: 'SymlinkError',
          path: cwd + '/d/i/r/symlink/',
          symlink: cwd + '/d/i/r/symlink',
        })
        t.end()
      })
      u.end(data)
    })

    t.test('clobber dirs sync', t => {
      const cwd = t.testdir({
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
      const warnings = []
      const u = new UnpackSync({
        cwd,
        onwarn: (c, w, d) => {
          warnings.push([c, w, d])
        },
        chmod: true,
        processUmask: 0o22,
      })
      u.end(data)
      t.equal(fs.lstatSync(cwd + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(cwd + '/d/i/r/file').isFile(), 'got file')
      t.ok(
        fs.lstatSync(cwd + '/d/i/r/symlink').isSymbolicLink(),
        'got symlink',
      )
      t.throws(() => fs.statSync(cwd + '/d/i/r/symlink/x'))
      t.equal(warnings.length, 1)
      t.equal(warnings[0][0], 'TAR_ENTRY_ERROR')
      t.equal(
        warnings[0][1],
        'TAR_SYMLINK_ERROR: Cannot extract through symbolic link',
      )
      t.match(warnings[0][2], {
        name: 'SymlinkError',
        path: cwd + '/d/i/r/symlink/',
        symlink: cwd + '/d/i/r/symlink',
      })
      t.end()
    })

    t.end()
  },
)

t.test('unsupported entries', t => {
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

  t.test('basic, warns', t => {
    const cwd = t.testdir({})
    const warnings = []
    const u = new Unpack({
      cwd,
      onwarn: (c, w, d) => warnings.push([c, w, d]),
    })
    const c = 'TAR_ENTRY_UNSUPPORTED'
    const expect = [
      [
        c,
        'unsupported entry type: CharacterDevice',
        {
          entry: { path: 'dev/random' },
        },
      ],
      [
        c,
        'unsupported entry type: BlockDevice',
        {
          entry: { path: 'dev/hd0' },
        },
      ],
      [
        c,
        'unsupported entry type: FIFO',
        {
          entry: { path: 'dev/fifo0' },
        },
      ],
    ]
    u.on('close', () => {
      t.equal(fs.readdirSync(cwd).length, 0)
      t.match(warnings, expect)
      t.end()
    })
    u.end(data)
  })

  t.test('strict, throws', t => {
    const cwd = t.testdir({})
    const warnings = []
    const errors = []
    const u = new Unpack({
      cwd,
      strict: true,
      onwarn: (c, w, d) => warnings.push([c, w, d]),
    })
    u.on('error', e => errors.push(e))
    u.on('close', () => {
      t.equal(fs.readdirSync(cwd).length, 0)
      t.same(warnings, [])
      t.match(errors, [
        {
          message: 'unsupported entry type: CharacterDevice',
          entry: { path: 'dev/random' },
        },
        {
          message: 'unsupported entry type: BlockDevice',
          entry: { path: 'dev/hd0' },
        },
        {
          message: 'unsupported entry type: FIFO',
          entry: { path: 'dev/fifo0' },
        },
      ])
      t.end()
    })
    u.end(data)
  })

  t.end()
})

t.test('file in dir path', t => {
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

  t.test('fail because of file', t => {
    const check = t => {
      const cwd = t.testdirName
      t.equal(fs.readFileSync(cwd + '/d/i/r/file', 'utf8'), 'a')
      t.throws(() => fs.statSync(cwd + '/d/i/r/file/a/b/c'))
      t.end()
    }

    t.plan(2)

    t.test('async', t => {
      const cwd = t.testdir({})
      new Unpack({ cwd }).on('close', () => check(t)).end(data)
    })

    t.test('sync', t => {
      const cwd = t.testdir({})
      new UnpackSync({ cwd }).end(data)
      check(t)
    })
  })

  t.test('clobber on through', t => {
    const check = t => {
      const cwd = t.testdirName
      t.ok(fs.statSync(cwd + '/d/i/r/file').isDirectory())
      t.equal(fs.readFileSync(cwd + '/d/i/r/file/a/b/c', 'utf8'), 'b')
      t.end()
    }

    t.plan(2)

    t.test('async', t => {
      const cwd = t.testdir({})
      new Unpack({ cwd, unlink: true })
        .on('close', () => check(t))
        .end(data)
    })

    t.test('sync', t => {
      const cwd = t.testdir({})
      new UnpackSync({ cwd, unlink: true }).end(data)
      check(t)
    })
  })

  t.end()
})

t.test('set umask option', t => {
  const cwd = t.testdir({})

  const data = makeTar([
    {
      path: 'd/i/r/dir',
      type: 'Directory',
      mode: 0o751,
    },
    '',
    '',
  ])

  new Unpack({
    umask: 0o027,
    cwd,
  })
    .on('close', () => {
      t.equal(
        fs.statSync(cwd + '/d/i/r').mode & 0o7777,
        isWindows ? 0o666 : 0o750,
      )
      t.equal(
        fs.statSync(cwd + '/d/i/r/dir').mode & 0o7777,
        isWindows ? 0o666 : 0o751,
      )
      t.end()
    })
    .end(data)
})

t.test('absolute paths', t => {
  const dir = t.testdir({})
  t.teardown(() => rimraf(dir))
  t.beforeEach(async () => {
    await rimraf(dir)
    await mkdirp(dir)
  })

  const absolute = path.resolve(dir, 'd/i/r/absolute')
  const root = path.parse(absolute).root
  const extraAbsolute = root + root + root + absolute
  t.ok(path.isAbsolute(extraAbsolute))
  t.ok(path.isAbsolute(absolute))
  const parsed = path.parse(absolute)
  const relative = absolute.slice(parsed.root.length)
  t.notOk(path.isAbsolute(relative))

  const data = makeTar([
    {
      path: extraAbsolute,
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

  t.test('warn and correct', t => {
    const check = t => {
      const r = normPath(root)
      t.match(warnings, [
        [
          `stripping ${r}${r}${r}${r} from absolute path`,
          { path: normPath(absolute), code: 'TAR_ENTRY_INFO' },
        ],
      ])
      t.ok(
        fs.lstatSync(path.resolve(dir, relative)).isFile(),
        'is file',
      )
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        cwd: dir,
        onwarn: (_c, w, d) => warnings.push([w, d]),
      })
        .on('close', () => check(t))
        .end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        cwd: dir,
        onwarn: (_c, w, d) => warnings.push([w, d]),
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.test('preserve absolute path', t => {
    // if we use the extraAbsolute path here, we end up creating a dir
    // like C:\C:\C:\C:\path\to\absolute, which is both 100% valid on
    // windows, as well as SUUUUUPER annoying.
    const data = makeTar([
      {
        path: isWindows ? absolute : extraAbsolute,
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
    const check = t => {
      t.same(warnings, [])
      t.ok(fs.lstatSync(absolute).isFile(), 'is file')
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        preservePaths: true,
        cwd: dir,
        onwarn: (_c, w, d) => warnings.push([w, d]),
      })
        .on('close', () => check(t))
        .end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        preservePaths: true,
        cwd: dir,
        onwarn: (_c, w, d) => warnings.push([w, d]),
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.end()
})

t.test('.. paths', t => {
  const dir = t.testdir({})
  t.beforeEach(async () => {
    await rimraf(dir)
    await mkdirp(dir)
  })

  const fmode = 0o755
  const dotted = 'a/b/c/../d'
  const resolved = path.resolve(dir, dotted)

  const data = makeTar([
    {
      path: dotted,
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z'),
    },
    'd',
    '',
    '',
  ])

  t.test('warn and skip', t => {
    const check = t => {
      t.match(warnings, [
        [
          "path contains '..'",
          { path: dotted, code: 'TAR_ENTRY_ERROR' },
        ],
      ])
      t.throws(() => fs.lstatSync(resolved))
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        fmode: fmode,
        cwd: dir,
        onwarn: (_c, w, d) => warnings.push([w, d]),
      })
        .on('close', () => check(t))
        .end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        fmode: fmode,
        cwd: dir,
        onwarn: (_c, w, d) => warnings.push([w, d]),
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.test('preserve dotted path', t => {
    const check = t => {
      t.same(warnings, [])
      t.ok(fs.lstatSync(resolved).isFile(), 'is file')
      t.equal(
        fs.lstatSync(resolved).mode & 0o777,
        isWindows ? 0o666 : fmode,
      )
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        fmode: fmode,
        preservePaths: true,
        cwd: dir,
        onwarn: (_c, w, d) => warnings.push([w, d]),
      })
        .on('close', () => check(t))
        .end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        fmode: fmode,
        preservePaths: true,
        cwd: dir,
        onwarn: (_c, w, d) => warnings.push([w, d]),
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.end()
})

t.test('fail all stats', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const dir = normPath(t.testdir({}))
  const { stat, fstat, lstat, statSync, fstatSync, lstatSync } = fs
  const unmutate = () =>
    Object.assign(fs, {
      stat,
      fstat,
      lstat,
      statSync,
      fstatSync,
      lstatSync,
    })
  const mutate = () => {
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
  }

  const warnings = []
  t.beforeEach(() => {
    warnings.length = 0
    mkdirp.sync(dir)
    mutate()
  })
  t.afterEach(async () => {
    unmutate()
    await rimraf(dir)
  })

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

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [
      ['poop', poop],
      ['poop', poop],
    ]
    new Unpack({
      cwd: dir,
      onwarn: (_c, w, d) => warnings.push([w, d]),
    })
      .on('close', () => check(t, expect))
      .end(data)
  })

  t.test('sync', t => {
    const expect = [
      ['poop', poop],
      ['poop', poop],
    ]
    new UnpackSync({
      cwd: dir,
      onwarn: (_c, w, d) => warnings.push([w, d]),
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail symlink', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const dir = t.testdir({})
  t.teardown(mutateFS.fail('symlink', poop))

  const warnings = []
  t.beforeEach(async () => {
    warnings.length = 0
    await rimraf(dir)
    await mkdirp(dir)
  })

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

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [['poop', poop]]
    new Unpack({
      cwd: dir,
      onwarn: (_c, w, d) => warnings.push([w, d]),
    })
      .on('close', () => check(t, expect))
      .end(data)
  })

  t.test('sync', t => {
    const expect = [['poop', poop]]
    new UnpackSync({
      cwd: dir,
      onwarn: (_c, w, d) => warnings.push([w, d]),
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail chmod', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const dir = t.testdir()
  t.teardown(mutateFS.fail('chmod', poop))

  const warnings = []
  t.beforeEach(async () => {
    warnings.length = 0
    await rimraf(dir)
    await mkdirp(dir)
  })

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

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [['poop', poop]]
    new Unpack({
      cwd: dir,
      onwarn: (_c, w, d) => warnings.push([w, d]),
      chmod: true,
      processUmask: 0o22,
    })
      .on('close', () => check(t, expect))
      .end(data)
  })

  t.test('sync', t => {
    const expect = [['poop', poop]]
    new UnpackSync({
      cwd: dir,
      onwarn: (_c, w, d) => warnings.push([w, d]),
      chmod: true,
      processUmask: 0o22,
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail mkdir', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  let unmutate
  const dir = t.testdir({})

  const warnings = []
  t.beforeEach(async () => {
    warnings.length = 0
    await rimraf(dir)
    await mkdirp(dir)
    unmutate = mutateFS.fail('mkdir', poop)
  })
  t.afterEach(() => unmutate())

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

  const expect = [
    [
      'ENOENT: no such file or directory',
      {
        code: 'ENOENT',
        syscall: 'lstat',
        path: normPath(path.resolve(dir, 'dir')),
      },
    ],
  ]

  const check = t => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      onwarn: (_c, w, d) => warnings.push([w, d]),
    }).end(data)
    check(t)
  })

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      onwarn: (_c, w, d) => warnings.push([w, d]),
    })
      .on('close', () => check(t))
      .end(data)
  })

  t.end()
})

t.test('fail write', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const dir = t.testdir({})
  t.teardown(mutateFS.fail('write', poop))

  const warnings = []
  t.beforeEach(async () => {
    warnings.length = 0
    await rimraf(dir)
    await mkdirp(dir)
  })

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

  const expect = [['poop', poop]]

  const check = t => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      onwarn: (_c, w, d) => warnings.push([w, d]),
    })
      .on('close', () => check(t))
      .end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      onwarn: (_c, w, d) => warnings.push([w, d]),
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('skip existing', t => {
  const date = new Date('2011-03-27T22:16:31.000Z')
  t.beforeEach(async t => {
    const dir = t.testdir({
      x: 'y',
    })
    fs.utimesSync(dir + '/x', date, date)
  })

  const data = makeTar([
    {
      path: 'x',
      type: 'File',
      size: 1,
      mode: 0o751,
      mtime: new Date('2013-12-19T17:00:00.000Z'),
    },
    'x',
    '',
    '',
  ])

  const check = t => {
    const dir = t.testdirName
    const st = fs.lstatSync(dir + '/x')
    t.equal(st.atime.toISOString(), date.toISOString())
    t.equal(st.mtime.toISOString(), date.toISOString())
    const data = fs.readFileSync(dir + '/x', 'utf8')
    t.equal(data, 'y')
    t.end()
  }

  t.test('async', t => {
    const dir = t.testdirName
    new Unpack({
      cwd: dir,
      keep: true,
    })
      .on('close', () => check(t))
      .end(data)
  })

  t.test('sync', t => {
    const dir = t.testdirName
    new UnpackSync({
      cwd: dir,
      keep: true,
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('skip newer', t => {
  const date = new Date('2013-12-19T17:00:00.000Z')
  t.beforeEach(async t => {
    const dir = t.testdir({ x: 'y' })
    fs.utimesSync(dir + '/x', date, date)
  })

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

  const check = t => {
    const dir = t.testdirName
    const st = fs.lstatSync(dir + '/x')
    t.equal(st.atime.toISOString(), date.toISOString())
    t.equal(st.mtime.toISOString(), date.toISOString())
    const data = fs.readFileSync(dir + '/x', 'utf8')
    t.equal(data, 'y')
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: t.testdirName,
      newer: true,
    })
      .on('close', () => check(t))
      .end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: t.testdirName,
      newer: true,
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('no mtime', t => {
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

  const check = t => {
    const dir = t.testdirName
    // this may fail if it's run on March 27, 2011
    const stx = fs.lstatSync(dir + '/x')
    t.not(stx.atime.toISOString(), date.toISOString())
    t.not(stx.mtime.toISOString(), date.toISOString())
    const sty = fs.lstatSync(dir + '/x/y')
    t.not(sty.atime.toISOString(), date.toISOString())
    t.not(sty.mtime.toISOString(), date.toISOString())
    const data = fs.readFileSync(dir + '/x/y', 'utf8')
    t.equal(data, 'x')
    t.end()
  }

  t.test('async', t => {
    const dir = t.testdir({})
    new Unpack({
      cwd: dir,
      noMtime: true,
    })
      .on('close', () => check(t))
      .end(data)
  })

  t.test('sync', t => {
    const dir = t.testdir({})
    new UnpackSync({
      cwd: dir,
      noMtime: true,
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('unpack big enough to pause/drain', t => {
  const dir = t.testdir({})
  const stream = fs.createReadStream(fixtures + '/parses.tar')
  const u = new Unpack({
    cwd: dir,
    strip: 3,
    strict: true,
  })

  u.on('ignoredEntry', entry =>
    t.fail('should not get ignored entry: ' + entry.path),
  )

  u.on('close', () => {
    t.pass('extraction finished')
    const actual = fs.readdirSync(dir)
    const expected = fs.readdirSync(parses)
    t.same(actual, expected)
    t.end()
  })

  stream.pipe(u)
})

t.test('set owner', t => {
  // fake it on platforms that don't have getuid
  const myUid = 501
  const myGid = 1024
  t.capture(process, 'getuid', () => myUid)
  t.capture(process, 'getgid', () => myGid)

  // can't actually do this because it requires root, but we can
  // verify that chown gets called.
  t.test('as root, defaults to true', t => {
    t.capture(process, 'getuid', () => 0)
    const u = new Unpack()
    t.equal(u.preserveOwner, true, 'preserveOwner enabled')
    t.end()
  })

  t.test('as non-root, defaults to false', t => {
    t.capture(process, 'getuid', () => 501)
    const u = new Unpack()
    t.equal(u.preserveOwner, false, 'preserveOwner disabled')
    t.end()
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

  t.test('chown failure results in unpack failure', t => {
    const poop = new Error('expected chown failure')
    const un = mutateFS.fail('chown', poop)
    const unl = mutateFS.fail('lchown', poop)
    const unf = mutateFS.fail('fchown', poop)

    t.teardown(async () => {
      un()
      unf()
      unl()
    })

    t.test('sync', t => {
      const cwd = t.testdir({})
      let warned = false
      const u = new UnpackSync({
        cwd,
        preserveOwner: true,
        onwarn: (_c, _m, er) => {
          if (!warned) {
            warned = true
            t.equal(er, poop)
          }
        },
      })
      u.end(data)
      t.equal(warned, true)
      t.end()
    })

    t.test('async', t => {
      const cwd = t.testdir({})
      let warned = false
      const u = new Unpack({
        cwd,
        preserveOwner: true,
        onwarn: (_c, _m, er) => {
          if (!warned) {
            warned = true
            t.equal(er, poop)
          }
        },
      })
      u.on('finish', () => {
        t.equal(warned, true)
        t.end()
      })
      u.end(data)
    })

    t.end()
  })

  t.test('chown when true', t => {
    const chown = fs.chown
    const lchown = fs.lchown
    const fchown = fs.fchown
    const chownSync = fs.chownSync
    const fchownSync = fs.fchownSync
    const lchownSync = fs.lchownSync
    let called = 0
    fs.fchown =
      fs.chown =
      fs.lchown =
        (_path, _owner, _group, cb) => {
          called++
          cb()
        }
    fs.chownSync = fs.lchownSync = fs.fchownSync = () => called++

    t.teardown(() => {
      fs.chown = chown
      fs.fchown = fchown
      fs.lchown = lchown
      fs.chownSync = chownSync
      fs.fchownSync = fchownSync
      fs.lchownSync = lchownSync
    })

    t.test('sync', t => {
      const cwd = t.testdir({})
      called = 0
      const u = new UnpackSync({ cwd, preserveOwner: true })
      u.end(data)
      t.ok(called >= 5, 'called chowns')
      t.end()
    })

    t.test('async', t => {
      const cwd = t.testdir({})
      called = 0
      const u = new Unpack({ cwd, preserveOwner: true })
      u.end(data)
      u.on('close', () => {
        t.ok(called >= 5, 'called chowns')
        t.end()
      })
    })

    t.end()
  })

  t.test('no chown when false', t => {
    const poop = new Error('poop')
    const un = mutateFS.fail('chown', poop)
    const unf = mutateFS.fail('fchown', poop)
    const unl = mutateFS.fail('lchown', poop)
    t.teardown(async () => {
      un()
      unf()
      unl()
    })

    const check = t => {
      const dir = t.testdirName
      const dirStat = fs.statSync(dir + '/foo')
      t.not(dirStat.uid, 2456124561)
      t.not(dirStat.gid, 813708013)
      const fileStat = fs.statSync(dir + '/foo/my-uid-different-gid')
      t.not(fileStat.uid, 2456124561)
      t.not(fileStat.gid, 813708013)
      const dirStat2 = fs.statSync(dir + '/foo/different-uid-nogid')
      t.not(dirStat2.uid, 2456124561)
      const fileStat2 = fs.statSync(
        dir + '/foo/different-uid-nogid/bar',
      )
      t.not(fileStat2.uid, 2456124561)
      t.end()
    }

    t.test('sync', t => {
      const dir = t.testdir({})
      const u = new UnpackSync({ cwd: dir, preserveOwner: false })
      u.end(data)
      check(t)
    })

    t.test('async', t => {
      const dir = t.testdir({})
      const u = new Unpack({ cwd: dir, preserveOwner: false })
      u.end(data)
      u.on('close', () => check(t))
    })

    t.end()
  })

  t.end()
})

t.test('unpack when dir is not writable', t => {
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

  const check = t => {
    const dir = t.testdirName
    t.equal(
      fs.statSync(dir + '/a').mode & 0o7777,
      isWindows ? 0o666 : 0o744,
    )
    t.equal(fs.readFileSync(dir + '/a/b', 'utf8'), 'a')
    t.end()
  }

  t.test('sync', t => {
    const dir = t.testdir({})
    const u = new UnpackSync({ cwd: dir, strict: true })
    u.end(data)
    check(t)
  })

  t.test('async', t => {
    const dir = t.testdir({})
    const u = new Unpack({ cwd: dir, strict: true })
    u.end(data)
    u.on('close', () => check(t))
  })

  t.end()
})

t.test('transmute chars on windows', t => {
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

  const check = t => {
    const dir = t.testdirName
    const ugly = path.resolve(dir, uglyName)
    t.same(fs.readdirSync(dir), [uglyName])
    t.equal(fs.readFileSync(ugly, 'utf8'), '<|>?:')
    t.end()
  }

  t.test('async', t => {
    const dir = t.testdir({})
    const u = new Unpack({
      cwd: dir,
      win32: true,
    })
    u.end(data)
    u.on('close', () => check(t))
  })

  t.test('sync', t => {
    const dir = t.testdir({})
    const u = new UnpackSync({
      cwd: dir,
      win32: true,
    })
    u.end(data)
    check(t)
  })

  t.end()
})

t.test('safely transmute chars on windows with absolutes', t => {
  // don't actually make the directory
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('mkdir', poop))

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
  u.on('entry', entry => {
    t.equal(entry.path, uglyPath)
    t.end()
  })

  u.end(data)
})

t.test('use explicit chmod when required by umask', t => {
  const data = makeTar([
    {
      path: 'x/y/z',
      mode: 0o775,
      type: 'Directory',
    },
    '',
    '',
  ])

  const check = async t => {
    const cwd = t.testdirName
    const st = fs.statSync(cwd + '/x/y/z')
    t.equal(st.mode & 0o777, isWindows ? 0o666 : 0o775)
    t.end()
  }

  t.test('async', t => {
    const cwd = t.testdir({})
    const unpack = new Unpack({
      cwd,
      chmod: true,
      processUmask: 0o22,
    })
    unpack.on('close', () => check(t))
    unpack.end(data)
  })

  return t.test('sync', t => {
    const cwd = t.testdir({})
    const unpack = new UnpackSync({
      cwd,
      chmod: true,
      processUmask: 0o22,
    })
    unpack.end(data)
    check(t)
  })
})

t.test('dont use explicit chmod if chmod flag not set', t => {
  t.capture(process, 'umask', () => {
    throw new Error('should not call process.umask()')
  })

  const data = makeTar([
    {
      path: 'x/y/z',
      mode: 0o775,
      type: 'Directory',
    },
    '',
    '',
  ])

  const check = async t => {
    const cwd = t.testdirName
    const st = fs.statSync(cwd + '/x/y/z')
    t.equal(st.mode & 0o777, isWindows ? 0o666 : 0o755)
    t.end()
  }

  t.test('async', t => {
    const cwd = t.testdir({})
    const unpack = new Unpack({ cwd })
    unpack.on('close', () => check(t))
    unpack.end(data)
  })

  return t.test('sync', t => {
    const cwd = t.testdir({})
    const unpack = new UnpackSync({ cwd })
    unpack.end(data)
    check(t)
  })
})

t.test('chown implicit dirs and also the entries', t => {
  const basedir = t.testdir({})

  // club these so that the test can run as non-root
  const chown = fs.chown
  const chownSync = fs.chownSync
  const lchown = fs.lchown
  const lchownSync = fs.lchownSync
  const fchown = fs.fchown
  const fchownSync = fs.fchownSync

  const getuid = process.getuid
  const getgid = process.getgid
  t.teardown(() => {
    fs.chown = chown
    fs.chownSync = chownSync
    fs.lchown = lchown
    fs.lchownSync = lchownSync
    fs.fchown = fchown
    fs.fchownSync = fchownSync
    process.getgid = getgid
  })

  let chowns = 0

  let currentTest = null
  fs.lchown =
    fs.fchown =
    fs.chown =
      (path, uid, gid, cb) => {
        currentTest.equal(uid, 420, 'chown(' + path + ') uid')
        currentTest.equal(gid, 666, 'chown(' + path + ') gid')
        chowns++
        cb()
      }

  fs.lchownSync =
    fs.chownSync =
    fs.fchownSync =
      (path, uid, gid) => {
        currentTest.equal(uid, 420, 'chownSync(' + path + ') uid')
        currentTest.equal(gid, 666, 'chownSync(' + path + ') gid')
        chowns++
      }

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

  const check = async t => {
    currentTest = null
    t.equal(chowns, 8)
    chowns = 0
    await rimraf(basedir)
    t.end()
  }

  t.test('throws when setting uid/gid improperly', t => {
    t.throws(
      () => new Unpack({ uid: 420 }),
      TypeError('cannot set owner without number uid and gid'),
    )
    t.throws(
      () => new Unpack({ gid: 666 }),
      TypeError('cannot set owner without number uid and gid'),
    )
    t.throws(
      () => new Unpack({ uid: 1, gid: 2, preserveOwner: true }),
      TypeError(
        'cannot preserve owner in archive and also set owner explicitly',
      ),
    )
    t.end()
  })

  const tests = () =>
    t
      .test('async', t => {
        currentTest = t
        mkdirp.sync(basedir)
        const unpack = new Unpack({
          cwd: basedir,
          uid: 420,
          gid: 666,
        })
        unpack.on('close', () => check(t))
        unpack.end(data)
      })
      .then(
        t.test('sync', t => {
          currentTest = t
          mkdirp.sync(basedir)
          const unpack = new UnpackSync({
            cwd: basedir,
            uid: 420,
            gid: 666,
          })
          unpack.end(data)
          check(t)
        }),
      )

  tests()

  t.test('make it look like processUid is 420', t => {
    process.getuid = () => 420
    t.end()
  })

  tests()

  t.test('make it look like processGid is 666', t => {
    process.getuid = getuid
    process.getgid = () => 666
    t.end()
  })

  return tests()
})

t.test('bad cwd setting', t => {
  const basedir = t.testdir({})

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

  fs.writeFileSync(basedir + '/file', 'xyz')

  cases.forEach(c =>
    t.test(c.type + ' ' + c.path, t => {
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

      t.test('cwd is a file', t => {
        const cwd = basedir + '/file'
        const opt = { cwd: cwd }

        t.throws(() => new UnpackSync(opt).end(data), {
          name: 'CwdError',
          message: "ENOTDIR: Cannot cd into '" + normPath(cwd) + "'",
          path: normPath(cwd),
          code: 'ENOTDIR',
        })

        new Unpack(opt)
          .on('error', er => {
            t.match(er, {
              name: 'CwdError',
              message:
                "ENOTDIR: Cannot cd into '" + normPath(cwd) + "'",
              path: normPath(cwd),
              code: 'ENOTDIR',
            })
            t.end()
          })
          .end(data)
      })

      return t.test('cwd is missing', t => {
        const cwd = basedir + '/asdf/asdf/asdf'
        const opt = { cwd: cwd }

        t.throws(() => new UnpackSync(opt).end(data), {
          name: 'CwdError',
          message: "ENOENT: Cannot cd into '" + normPath(cwd) + "'",
          path: normPath(cwd),
          code: 'ENOENT',
        })

        new Unpack(opt)
          .on('error', er => {
            t.match(er, {
              name: 'CwdError',
              message:
                "ENOENT: Cannot cd into '" + normPath(cwd) + "'",
              path: normPath(cwd),
              code: 'ENOENT',
            })
            t.end()
          })
          .end(data)
      })
    }),
  )

  t.end()
})

t.test('transform', t => {
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

  const tarfiles = Object.keys(cases)
  t.plan(tarfiles.length)
  t.jobs = tarfiles.length

  tarfiles.forEach(tarfile => {
    t.test(tarfile, t => {
      const tf = path.resolve(tars, tarfile)

      const check = t => {
        const dir = t.testdirName
        const expect = cases[tarfile]
        Object.keys(expect).forEach(file => {
          const f = path.resolve(dir, file)
          t.equal(fs.readFileSync(f, 'utf8'), expect[file], file)
        })
        t.end()
      }

      t.plan(2)

      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const dir = t.testdir({})
          const unpack = new Unpack({
            cwd: dir,
            strict: true,
            transform: txFn,
          })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, () => check(t))
        })
        t.test('loose', t => {
          const dir = t.testdir({})
          const unpack = new Unpack({ cwd: dir, transform: txFn })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, () => check(t))
        })
      })

      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const dir = t.testdir({})
          const unpack = new UnpackSync({
            cwd: dir,
            strict: true,
            transform: txFn,
          })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
        t.test('loose', t => {
          const dir = t.testdir({})
          const unpack = new UnpackSync({ cwd: dir, transform: txFn })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
      })
    })
  })
})

t.test('transform error', t => {
  const tarfile = path.resolve(tars, 'body-byte-counts.tar')
  const tardata = fs.readFileSync(tarfile)
  const poop = new Error('poop')

  const txFn = () => {
    const tx = new Minipass()
    tx.write = () => tx.emit('error', poop)
    tx.resume()
    return tx
  }

  t.test('sync unpack', t => {
    t.test('strict', t => {
      const dir = t.testdir({})
      const unpack = new UnpackSync({
        cwd: dir,
        strict: true,
        transform: txFn,
      })
      const expect = 3
      let actual = 0
      unpack.on('error', er => {
        t.equal(er, poop)
        actual++
      })
      unpack.end(tardata)
      t.equal(actual, expect, 'error count')
      t.end()
    })
    t.test('loose', t => {
      const dir = t.testdir({})
      const unpack = new UnpackSync({ cwd: dir, transform: txFn })
      const expect = 3
      let actual = 0
      unpack.on('warn', (_code, _msg, er) => {
        t.equal(er, poop)
        actual++
      })
      unpack.end(tardata)
      t.equal(actual, expect, 'error count')
      t.end()
    })
    t.end()
  })
  t.test('async unpack', t => {
    const dir = t.testdir({})
    // the last error is about the folder being deleted, just ignore that one
    t.test('strict', t => {
      const unpack = new Unpack({
        cwd: dir,
        strict: true,
        transform: txFn,
      })
      t.plan(3)
      t.teardown(() => {
        unpack.removeAllListeners('error')
        unpack.on('error', () => {})
      })
      unpack.on('error', er => t.equal(er, poop))
      unpack.end(tardata)
    })
    t.test('loose', t => {
      const dir = t.testdir({})
      const unpack = new Unpack({ cwd: dir, transform: txFn })
      t.plan(3)
      t.teardown(() => unpack.removeAllListeners('warn'))
      unpack.on('warn', (_code, _msg, er) => t.equal(er, poop))
      unpack.end(tardata)
    })
    t.end()
  })

  t.end()
})

t.test('futimes/fchown failures', t => {
  const archive = path.resolve(tars, 'utf8.tar')
  const tardata = fs.readFileSync(archive)

  const poop = new Error('poop')
  const second = new Error('second error')

  const methods = ['utimes', 'chown']
  methods.forEach(method => {
    const fc = method === 'chown'
    t.test(method + ' fallback', t => {
      const dir = t.testdir({})
      t.teardown(mutateFS.fail('f' + method, poop))
      // forceChown will fail on systems where the user is not root
      // and/or the uid/gid in the archive aren't valid. We're just
      // verifying coverage here, so make the method auto-pass.
      t.teardown(mutateFS.pass(method))
      t.plan(2)
      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new Unpack({
            cwd: dir,
            strict: true,
            forceChown: fc,
          })
          unpack.on('finish', () => t.end())
          unpack.end(tardata)
        })
        t.test('loose', t => {
          const unpack = new Unpack({ cwd: dir, forceChown: fc })
          unpack.on('finish', () => t.end())
          unpack.on('warn', t.fail)
          unpack.end(tardata)
        })
      })
      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new UnpackSync({
            cwd: dir,
            strict: true,
            forceChown: fc,
          })
          unpack.end(tardata)
          t.end()
        })
        t.test('loose', t => {
          const unpack = new UnpackSync({ cwd: dir, forceChown: fc })
          unpack.on('warn', t.fail)
          unpack.end(tardata)
          t.end()
        })
      })
    })

    t.test('also fail ' + method, t => {
      const unmutate = mutateFS.fail('f' + method, poop)
      const unmutate2 = mutateFS.fail(method, second)
      t.teardown(() => {
        unmutate()
        unmutate2()
      })
      t.plan(2)
      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const dir = t.testdir({})
          const unpack = new Unpack({
            cwd: dir,
            strict: true,
            forceChown: fc,
          })
          t.plan(3)
          unpack.on('error', er => t.equal(er, poop))
          unpack.end(tardata)
        })
        t.test('loose', t => {
          const dir = t.testdir({})
          const unpack = new Unpack({ cwd: dir, forceChown: fc })
          t.plan(3)
          unpack.on('warn', (_code, _m, er) => t.equal(er, poop))
          unpack.end(tardata)
        })
      })
      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const dir = t.testdir({})
          const unpack = new UnpackSync({
            cwd: dir,
            strict: true,
            forceChown: fc,
          })
          t.plan(3)
          unpack.on('error', er => t.equal(er, poop))
          unpack.end(tardata)
        })
        t.test('loose', t => {
          const dir = t.testdir({})
          const unpack = new UnpackSync({ cwd: dir, forceChown: fc })
          t.plan(3)
          unpack.on('warn', (_c, _m, er) => t.equal(er, poop))
          unpack.end(tardata)
        })
      })
    })
  })

  t.end()
})

t.test('onReadEntry option is preserved', t => {
  let oecalls = 0
  const onReadEntry = _entry => oecalls++
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

  const check = t => {
    t.equal(oecalls, 3)
    oecalls = 0
    t.end()
  }

  t.test('sync', t => {
    const dir = t.testdir({})
    const unpack = new UnpackSync({ cwd: dir, onReadEntry })
    unpack.end(data)
    check(t)
  })

  t.test('async', t => {
    const dir = t.testdir({})
    mkdirp.sync(dir)
    const unpack = new Unpack({ cwd: dir, onReadEntry })
    unpack.on('finish', () => check(t))
    unpack.end(data)
  })

  t.end()
})

t.test('do not reuse hardlinks, only nlink=1 files', t => {
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

  const check = t => {
    const dir = t.testdirName
    for (const f in checks) {
      t.equal(fs.readFileSync(dir + '/' + f, 'utf8'), checks[f], f)
      t.equal(fs.statSync(dir + '/' + f).nlink, 1, f)
    }
    t.end()
  }

  t.test('async', t => {
    const dir = t.testdir({})
    const u = new Unpack({ cwd: dir })
    u.on('close', () => check(t))
    u.end(data)
  })

  t.test('sync', t => {
    const dir = t.testdir({})
    const u = new UnpackSync({ cwd: dir })
    u.end(data)
    check(t)
  })

  t.end()
})

t.test('trying to unpack a non-zlib gzip file should fail', t => {
  const data = Buffer.from('hello this is not gzip data')
  const dataGzip = Buffer.concat([Buffer.from([0x1f, 0x8b]), data])

  t.test('abort if gzip has an error', t => {
    const expect = {
      message: /^zlib/,
      errno: Number,
      code: /^Z/,
      recoverable: false,
      cwd: normPath(t.testdirName),
      tarCode: 'TAR_ABORT',
    }
    const opts = {
      cwd: t.testdir({}),
      gzip: true,
    }
    new Unpack(opts)
      .once('error', er => t.match(er, expect, 'async emits'))
      .end(dataGzip)
    const skip =
      !/^v([0-9]|1[0-3])\./.test(process.version) ?
        false
      : 'node prior to v14 did not raise sync zlib errors properly'
    t.throws(
      () => new UnpackSync(opts).end(dataGzip),
      expect,
      'sync throws',
      { skip },
    )
    t.end()
  })

  t.test('bad archive if no gzip', t => {
    t.plan(2)
    const expect = {
      tarCode: 'TAR_BAD_ARCHIVE',
      recoverable: false,
    }
    const opts = { cwd: t.testdir({}) }
    new Unpack(opts)
      .once('error', er => t.match(er, expect, 'async emits'))
      .end(data)
    t.throws(
      () => new UnpackSync(opts).end(data),
      expect,
      'sync throws',
    )
  })

  t.end()
})

t.test('handle errors on fs.close', t => {
  const poop = new Error('poop')
  // have to actually close them, or else windows gets mad
  t.teardown(mutateFS.fail('close', poop))

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

  t.plan(2)
  t.test('async', t => {
    new Unpack({ cwd: t.testdir({}), strict: true })
      .on('error', er => t.equal(er, poop, 'async'))
      .on('end', () => t.end())
      .end(data)
  })
  t.test('sync', t => {
    t.throws(
      () =>
        new UnpackSync({
          cwd: normPath(t.testdir({})),
          strict: true,
        }).end(data),
      poop,
      'sync',
    )
    t.end()
  })
})

t.test('using strip option when top level file exists', t => {
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
  t.plan(2)
  const check = (t, path) => {
    t.equal(fs.statSync(path).isDirectory(), true)
    t.equal(fs.readFileSync(path + '/a', 'utf8'), 'a')
    t.equal(fs.readFileSync(path + '/b', 'utf8'), 'b')
    t.throws(() => fs.statSync(path + '/top'), { code: 'ENOENT' })
    t.end()
  }
  t.test('async', t => {
    const path = t.testdir({ y: {} })
    new Unpack({ cwd: path, strip: 1 })
      .on('end', () => check(t, path))
      .end(data)
  })
  t.test('sync', t => {
    const path = t.testdir({ y: {} })
    new UnpackSync({ cwd: path, strip: 1 }).end(data)
    check(t, path)
  })
})

t.test('handle EPERMs when creating symlinks', t => {
  // https://github.com/npm/node-tar/issues/265
  const msg =
    'You do not have sufficient privilege to perform this operation.'
  const er = Object.assign(new Error(msg), {
    code: 'EPERM',
  })
  t.teardown(mutateFS.fail('symlink', er))
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

  const check = (t, path) => {
    t.match(
      WARNINGS,
      [
        ['TAR_ENTRY_ERROR', msg],
        ['TAR_ENTRY_ERROR', msg],
        ['TAR_ENTRY_ERROR', msg],
      ],
      'got expected warnings',
    )
    t.equal(WARNINGS.length, 3)
    WARNINGS.length = 0
    t.equal(fs.readFileSync(`${path}/x/y`, 'utf8'), 'hello, world')
    t.equal(fs.readFileSync(`${path}/x/z`, 'utf8'), 'hello, world')
    t.throws(() => fs.statSync(`${path}/x/link1`), { code: 'ENOENT' })
    t.throws(() => fs.statSync(`${path}/x/link2`), { code: 'ENOENT' })
    t.throws(() => fs.statSync(`${path}/x/link3`), { code: 'ENOENT' })
  }

  const WARNINGS = []
  t.test('async', t => {
    const dir = t.testdir({})
    const u = new Unpack({
      cwd: dir,
      onwarn: (code, msg, _er) => WARNINGS.push([code, msg]),
    })
    u.on('end', () => {
      check(t, dir)
      t.end()
    })
    u.end(data)
  })
  t.test('sync', t => {
    const dir = t.testdir({})
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (code, msg, _er) => WARNINGS.push([code, msg]),
    })
    u.end(data)
    check(t, dir)
    t.end()
  })
  t.end()
})

t.test('close fd when error writing', t => {
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
  t.teardown(mutateFS.fail('write', new Error('nope')))
  const CLOSES = []
  const OPENS = {}
  const { open } = fs
  t.teardown(() => (fs.open = open))
  fs.open = (...args) => {
    const cb = args.pop()
    args.push((er, fd) => {
      OPENS[args[0]] = fd
      cb(er, fd)
    })
    return open.call(fs, ...args)
  }
  t.teardown(
    mutateFS.mutateArgs('close', ([fd]) => {
      CLOSES.push(fd)
      return [fd]
    }),
  )
  const WARNINGS = []

  const dir = t.testdir({})
  const unpack = new Unpack({
    cwd: dir,
    onwarn: (code, msg) => WARNINGS.push([code, msg]),
  })
  unpack.on('end', () => {
    for (const [path, fd] of Object.entries(OPENS)) {
      t.equal(CLOSES.includes(fd), true, 'closed fd for ' + path)
    }
    t.end()
  })
  unpack.end(data)
})

t.test('close fd when error setting mtime', t => {
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
  t.teardown(mutateFS.fail('futimes', new Error('nope')))
  t.teardown(mutateFS.fail('utimes', new Error('nooooope')))
  const CLOSES = []
  const OPENS = {}
  const { open } = fs
  t.capture(fs, 'open', (...args) => {
    const cb = args.pop()
    args.push((er, fd) => {
      OPENS[args[0]] = fd
      cb(er, fd)
    })
    return open.call(fs, ...args)
  })
  t.teardown(
    mutateFS.mutateArgs('close', ([fd]) => {
      CLOSES.push(fd)
      return [fd]
    }),
  )
  const WARNINGS = []
  const dir = t.testdir({})
  const unpack = new Unpack({
    cwd: dir,
    onwarn: (code, msg) => WARNINGS.push([code, msg]),
  })
  unpack.on('end', () => {
    for (const [path, fd] of Object.entries(OPENS)) {
      t.equal(CLOSES.includes(fd), true, 'closed fd for ' + path)
    }
    t.end()
  })
  unpack.end(data)
})

t.test('do not hang on large files that fail to open()', t => {
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
  t.teardown(mutateFS.fail('open', new Error('nope')))
  const dir = t.testdir({})

  const WARNINGS = []
  const unpack = new Unpack({
    cwd: dir,
    onwarn: (code, msg) => WARNINGS.push([code, msg]),
  })
  unpack.on('end', () => {
    t.strictSame(WARNINGS, [['TAR_ENTRY_ERROR', 'nope']])
    t.end()
  })
  unpack.write(data.subarray(0, 2048))
  setTimeout(() => {
    unpack.write(data.subarray(2048, 4096))
    setTimeout(() => {
      unpack.write(data.subarray(4096))
      setTimeout(() => {
        unpack.end()
      })
    })
  })
})

t.test('recognize C:.. as a dot path part', async t => {
  if (process.platform !== 'win32') {
    process.env.TESTING_TAR_FAKE_PLATFORM = 'win32'
    t.teardown(() => {
      delete process.env.TESTING_TAR_FAKE_PLATFORM
    })
  }
  const { Unpack, UnpackSync } = await t.mockImport(
    '../dist/esm/unpack.js',
    {
      path: {
        ...path.win32,
        win32: path.win32,
        posix: path.posix,
      },
    },
  )

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

  const check = (path, warnings, t) => {
    t.equal(fs.readFileSync(`${path}/foo`, 'utf8'), 'y')
    t.strictSame(warnings, [
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
    ])
    t.end()
  }

  t.test('async', t => {
    const warnings = []
    const path = t.testdir()
    new Unpack({
      cwd: path,
      onwarn: (c, w, { entry, path }) =>
        warnings.push([c, w, path, entry.path]),
    })
      .on('close', () => check(path, warnings, t))
      .end(data)
  })

  t.test('sync', t => {
    const warnings = []
    const path = t.testdir()
    new UnpackSync({
      cwd: path,
      onwarn: (c, w, { entry, path }) =>
        warnings.push([c, w, path, entry.path]),
    }).end(data)
    check(path, warnings, t)
  })

  t.end()
})

t.test('excessively deep subfolder nesting', async t => {
  const tf = path.resolve(fixtures, 'excessively-deep.tar')
  const data = fs.readFileSync(tf)
  const warnings = []
  const onwarn = (c, w, { entry, path, depth, maxDepth }) =>
    warnings.push([c, w, { entry, path, depth, maxDepth }])

  const check = (t, maxDepth = 1024) => {
    t.match(warnings, [
      [
        'TAR_ENTRY_ERROR',
        'path excessively deep',
        {
          entry: ReadEntry,
          path: /^\.(\/a){1024,}\/foo.txt$/,
          depth: 222372,
          maxDepth,
        },
      ],
    ])
    warnings.length = 0
    t.end()
  }

  t.test('async', t => {
    const cwd = t.testdir()
    new Unpack({
      cwd,
      onwarn,
    })
      .on('end', () => check(t))
      .end(data)
  })

  t.test('sync', t => {
    const cwd = t.testdir()
    new UnpackSync({
      cwd,
      onwarn,
    }).end(data)
    check(t)
  })

  t.test('async set md', t => {
    const cwd = t.testdir()
    new Unpack({
      cwd,
      onwarn,
      maxDepth: 64,
    })
      .on('end', () => check(t, 64))
      .end(data)
  })

  t.test('sync set md', t => {
    const cwd = t.testdir()
    new UnpackSync({
      cwd,
      onwarn,
      maxDepth: 64,
    }).end(data)
    check(t, 64)
  })
})

t.test('ignore self-referential hardlinks', async t => {
  const data = makeTar([
    {
      path: 'autolink',
      linkpath: './autolink',
      type: 'Link',
    },
  ])
  const check = (t, warnings) => {
    t.matchSnapshot(warnings)
    t.strictSame(readdirSync(t.testdirName), [], 'nothing extracted')
    t.end()
  }
  t.test('async', t => {
    const cwd = t.testdir({})
    const warnings = []
    const u = new Unpack({ cwd, onwarn: (_, m) => warnings.push(m) })
    u.on('end', () => check(t, warnings))
    u.end(data)
  })
  t.test('sync', t => {
    const cwd = t.testdir({})
    const warnings = []
    const u = new UnpackSync({
      cwd,
      onwarn: (_, m) => warnings.push(m),
    })
    u.end(data)
    check(t, warnings)
  })
})
