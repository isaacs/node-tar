'use strict'

process.umask(0o022)

const Unpack = require('../lib/unpack.js')
const UnpackSync = Unpack.Sync
const t = require('tap')

const Header = require('../lib/header.js')
const z = require('minizlib')
const fs = require('fs')
const path = require('path')
const fixtures = path.resolve(__dirname, 'fixtures')
const files = path.resolve(fixtures, 'files')
const tars = path.resolve(fixtures, 'tars')
const unpackdir = path.resolve(fixtures, 'unpack')
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const mutateFS = require('mutate-fs')

t.teardown(_ => rimraf.sync(unpackdir))

t.test('setup', t => {
  rimraf.sync(unpackdir)
  mkdirp.sync(unpackdir)
  t.end()
})

t.test('basic file unpack tests', t => {
  const basedir = path.resolve(unpackdir, 'basic')
  t.teardown(_ => rimraf.sync(basedir))

  const cases = {
    'emptypax.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'one-byte.txt': 'a'
    },
    'body-byte-counts.tar': {
      '1024-bytes.txt': new Array(1024).join('x') + '\n',
      '512-bytes.txt': new Array(512).join('x') + '\n',
      'one-byte.txt': 'a',
      'zero-byte.txt': ''
    },
    'utf8.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'Ω.txt': 'Ω',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω'
    },
    'file.tar': {
      'one-byte.txt': 'a'
    },
    'global-header.tar': {
      'one-byte.txt': 'a'
    },
    'long-pax.tar': {
      '120-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    },
    'long-paths.tar': {
      '100-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '120-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '170-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt': 'short\n',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω'
    }
  }

  const tarfiles = Object.keys(cases)
  t.plan(tarfiles.length)
  t.jobs = tarfiles.length

  tarfiles.forEach(tarfile => {
    t.test(tarfile, t => {
      const tf = path.resolve(tars, tarfile)
      const dir = path.resolve(basedir, tarfile)
      t.beforeEach(cb => {
        rimraf.sync(dir)
        mkdirp.sync(dir)
        cb()
      })

      const check = t => {
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
          const unpack = new Unpack({ cwd: dir, strict: true })
          fs.createReadStream(tf).pipe(unpack)
          unpack.on('close', _ => check(t))
        })
        t.test('loose', t => {
          const unpack = new Unpack({ cwd: dir })
          fs.createReadStream(tf).pipe(unpack)
          unpack.on('close', _ => check(t))
        })
      })

      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new UnpackSync({ cwd: dir })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
        t.test('loose', t => {
          const unpack = new UnpackSync({ cwd: dir })
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
  const cwd = process.cwd()
  t.equal(u.cwd, cwd)
  t.equal(us.cwd, cwd)
  t.end()
})

t.test('links!', t => {
  const dir = path.resolve(unpackdir, 'links')
  const data = fs.readFileSync(tars + '/links.tar')

  t.plan(2)
  t.beforeEach(cb => mkdirp(dir, cb))
  t.afterEach(cb => rimraf(dir, cb))

  const check = t => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    t.equal(hl1.dev, hl2.dev)
    t.equal(hl1.ino, hl2.ino)
    t.equal(hl1.nlink, 2)
    t.equal(hl2.nlink, 2)
    const sym = fs.lstatSync(dir + '/symlink')
    t.ok(sym.isSymbolicLink())
    t.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    t.end()
  }

  t.test('async', t => {
    const unpack = new Unpack({ cwd: dir })
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  t.test('sync', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })
})

t.test('links without cleanup (exercise clobbering code)', t => {
  const dir = path.resolve(unpackdir, 'links')
  const data = fs.readFileSync(tars + '/links.tar')

  t.plan(6)
  mkdirp.sync(dir)
  t.teardown(_ => rimraf.sync(dir))

  t.beforeEach(cb => {
    // clobber this junk
    try {
      mkdirp.sync(dir + '/hardlink-1')
      mkdirp.sync(dir + '/hardlink-2')
      fs.writeFileSync(dir + '/symlink', 'not a symlink')
    } catch (er) {}
    cb()
  })

  const check = t => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    t.equal(hl1.dev, hl2.dev)
    t.equal(hl1.ino, hl2.ino)
    t.equal(hl1.nlink, 2)
    t.equal(hl2.nlink, 2)
    const sym = fs.lstatSync(dir + '/symlink')
    t.ok(sym.isSymbolicLink())
    t.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    t.end()
  }

  t.test('async', t => {
    const unpack = new Unpack({ cwd: dir })
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  t.test('sync', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })

  t.test('async again', t => {
    const unpack = new Unpack({ cwd: dir })
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  t.test('sync again', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })

  t.test('async unlink', t => {
    const unpack = new Unpack({ cwd: dir, unlink: true })
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  t.test('sync unlink', t => {
    const unpack = new UnpackSync({ cwd: dir, unlink: true })
    unpack.end(data)
    check(t)
  })
})

t.test('nested dir dupe', t => {
  const dir = path.resolve(unpackdir, 'nested-dir')
  mkdirp.sync(dir + '/d/e/e/p')
  t.teardown(_ => rimraf.sync(dir))
  const expect = {
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt': 'short\n',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω'
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
  unpack.on('close', _ => check(t))
  zip.end(data)
})

t.test('symlink in dir path', t => {
  const dir = path.resolve(unpackdir, 'symlink-junk')

  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = Buffer.concat([
    new Header({
      path: 'd/i',
      type: 'Directory',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    new Header({
      path: 'd/i/r/dir',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    new Header({
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    'a',
    new Header({
      path: 'd/i/r/link',
      type: 'Link',
      linkpath: 'd/i/r/file',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    new Header({
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    new Header({
      path: 'd/i/r/symlink/x',
      type: 'File',
      size: 0,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    '',
    ''
  ].map(c => {
    if (typeof c === 'string') {
      const b = Buffer.alloc(512)
      b.write(c)
      return b
    } else {
      c.encode()
      return c.block
    }
  }))

  t.test('no clobbering', t => {
    const warnings = []
    const u = new Unpack({ cwd: dir, onwarn: (w,d) => warnings.push([w,d]) })
    u.on('close', _ => {
      t.equal(fs.lstatSync(dir + '/d/i').mode & 0o7777, 0o755)
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
      t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
      t.equal(warnings.length, 1)
      t.equal(warnings[0][0], 'Cannot extract through symbolic link')
      t.match(warnings[0][1], {
        name: 'SylinkError',
        path: dir + '/d/i/r/symlink/',
        symlink: dir + '/d/i/r/symlink'
      })
      t.end()
    })
    u.end(data)
  })

  t.test('no clobbering, sync', t => {
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d])
    })
    u.end(data)
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
    t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
    t.equal(warnings.length, 1)
    t.equal(warnings[0][0], 'Cannot extract through symbolic link')
    t.match(warnings[0][1], {
      name: 'SylinkError',
      path: dir + '/d/i/r/symlink/',
      symlink: dir + '/d/i/r/symlink'
    })
    t.end()
  })

  t.test('extract through symlink', t => {
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      preservePaths: true
    })
    u.on('close', _ => {
      t.same(warnings, [])
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
      t.ok(fs.lstatSync(dir + '/d/i/r/dir/x').isFile(), 'x thru link')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
      t.end()
    })
    u.end(data)
  })

  t.test('extract through symlink sync', t => {
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      preservePaths: true
    })
    u.end(data)
    t.same(warnings, [])
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
    t.ok(fs.lstatSync(dir + '/d/i/r/dir/x').isFile(), 'x thru link')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
    t.end()
  })

  t.test('clobber through symlink', t => {
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      unlink: true
    })
    u.on('close', _ => {
      t.same(warnings, [])
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.notok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'no link')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isDirectory(), 'sym is dir')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
      t.end()
    })
    u.end(data)
  })

  t.test('clobber through symlink with busted unlink', t => {
    const poop = new Error('poop')
    t.teardown(mutateFS.fail('unlink', poop))
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      unlink: true
    })
    u.on('close', _ => {
      t.same(warnings, [[ 'poop', poop ]])
      t.end()
    })
    u.end(data)
  })

  t.test('clobber through symlink sync', t => {
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      unlink: true
    })
    u.end(data)
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.notok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'no link')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isDirectory(), 'sym is dir')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
    t.end()
  })

  t.test('clobber dirs', t => {
    mkdirp.sync(dir + '/d/i/r/dir')
    mkdirp.sync(dir + '/d/i/r/file')
    mkdirp.sync(dir + '/d/i/r/link')
    mkdirp.sync(dir + '/d/i/r/symlink')
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w, d) => {
        warnings.push([w,d])
      }
    })
    u.on('close', _ => {
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
      t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
      t.equal(warnings.length, 1)
      t.equal(warnings[0][0], 'Cannot extract through symbolic link')
      t.match(warnings[0][1], {
        name: 'SylinkError',
        path: dir + '/d/i/r/symlink/',
        symlink: dir + '/d/i/r/symlink'
      })
      t.end()
    })
    u.end(data)
  })

  t.test('clobber dirs sync', t => {
    mkdirp.sync(dir + '/d/i/r/dir')
    mkdirp.sync(dir + '/d/i/r/file')
    mkdirp.sync(dir + '/d/i/r/link')
    mkdirp.sync(dir + '/d/i/r/symlink')
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => {
        warnings.push([w,d])
      }
    })
    u.end(data)
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
    t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
    t.equal(warnings.length, 1)
    t.equal(warnings[0][0], 'Cannot extract through symbolic link')
    t.match(warnings[0][1], {
      name: 'SylinkError',
      path: dir + '/d/i/r/symlink/',
      symlink: dir + '/d/i/r/symlink'
    })
    t.end()
  })

  t.end()
})

t.test('unsupported entries', t => {
  const dir = path.resolve(unpackdir, 'unsupported-entries')
  mkdirp.sync(dir)
  t.teardown(_ => rimraf.sync(dir))
  const unknown = new Header({ path: 'qux', type: 'File', size: 4 })
  unknown.type = 'Z'
  unknown.encode()
  const data = Buffer.concat([
    new Header({
      path: 'dev/random',
      type: 'CharacterDevice'
    }),
    new Header({
      path: 'dev/hd0',
      type: 'BlockDevice'
    }),
    new Header({
      path: 'dev/fifo0',
      type: 'FIFO'
    }),
    unknown,
    'asdf',
    '',
    ''
  ].map(c => {
    if (typeof c === 'string') {
      const b = Buffer.alloc(512)
      b.write(c)
      return b
    } else {
      c.encode()
      return c.block
    }
  }))

  t.test('basic, warns', t => {
    const warnings = []
    const u = new Unpack({ cwd: dir, onwarn: (w,d) => warnings.push([w,d]) })
    const expect = [
      ['unsupported entry type: CharacterDevice', { path: 'dev/random' }],
      ['unsupported entry type: BlockDevice', { path: 'dev/hd0' }],
      ['unsupported entry type: FIFO', { path: 'dev/fifo0' }]
    ]
    u.on('close', _ => {
      t.equal(fs.readdirSync(dir).length, 0)
      t.match(warnings, expect)
      t.end()
    })
    u.end(data)
  })

  t.test('strict, throws', t => {
    const warnings = []
    const errors = []
    const u = new Unpack({
      cwd: dir,
      strict: true,
      onwarn: (w,d) => warnings.push([w,d])
    })
    u.on('error', e => errors.push(e))
    u.on('close', _ => {
      t.equal(fs.readdirSync(dir).length, 0)
      t.same(warnings, [])
      t.match(errors, [
        {
          message: 'unsupported entry type: CharacterDevice',
          data: { path: 'dev/random' }
        },
        {
          message: 'unsupported entry type: BlockDevice',
          data: { path: 'dev/hd0' }
        },
        {
          message: 'unsupported entry type: FIFO',
          data: { path: 'dev/fifo0' }
        }
      ])
      t.end()
    })
    u.end(data)
  })

  t.end()
})


t.test('file in dir path', t => {
  const dir = path.resolve(unpackdir, 'file-junk')

  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = Buffer.concat([
    new Header({
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    'a',
    new Header({
      path: 'd/i/r/file/a/b/c',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    'b',
    '',
    ''
  ].map(c => {
    if (typeof c === 'string') {
      const b = Buffer.alloc(512)
      b.write(c)
      return b
    } else {
      c.encode()
      return c.block
    }
  }))

  t.test('fail because of file', t => {
    const check = t => {
      t.equal(fs.readFileSync(dir + '/d/i/r/file', 'utf8'), 'a')
      t.throws(_ => fs.statSync(dir + '/d/i/r/file/a/b/c'))
      t.end()
    }

    t.plan(2)

    t.test('async', t => {
      new Unpack({ cwd: dir }).on('close', _ => check(t)).end(data)
    })

    t.test('sync', t => {
      new UnpackSync({ cwd: dir }).end(data)
      check(t)
    })
  })

  t.test('clobber on through', t => {
    const check = t => {
      t.ok(fs.statSync(dir + '/d/i/r/file').isDirectory())
      t.equal(fs.readFileSync(dir + '/d/i/r/file/a/b/c', 'utf8'), 'b')
      t.end()
    }

    t.plan(2)

    t.test('async', t => {
      new Unpack({ cwd: dir, unlink: true }).on('close', _ => check(t)).end(data)
    })

    t.test('sync', t => {
      new UnpackSync({ cwd: dir, unlink: true }).end(data)
      check(t)
    })
  })

  t.end()
})

t.test('set umask option', t => {
  const dir = path.resolve(unpackdir, 'umask')
  mkdirp.sync(dir)
  t.tearDown(_ => rimraf.sync(dir))

  const data = Buffer.concat([
    new Header({
      path: 'd/i/r/dir',
      type: 'Directory',
      mode: 0o751
    }),
    '',
    ''
  ].map(c => {
    if (typeof c === 'string') {
      const b = Buffer.alloc(512)
      b.write(c)
      return b
    } else {
      c.encode()
      return c.block
    }
  }))
  new Unpack({
    umask: 0o027,
    cwd: dir
  }).on('close', _ => {
    t.equal(fs.statSync(dir + '/d/i/r').mode & 0o7777, 0o750)
    t.equal(fs.statSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.end()
  }).end(data)
})

t.test('absolute paths', t => {
  const dir = path.join(unpackdir, 'absolute-paths')
  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const absolute = path.resolve(dir, 'd/i/r/absolute')
  t.ok(path.isAbsolute(absolute))
  const parsed = path.parse(absolute)
  const relative = absolute.substr(parsed.root.length)
  t.notOk(path.isAbsolute(relative))

  const data = Buffer.concat([
    new Header({
      path: absolute,
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    'a',
    '',
    ''
  ].map(c => {
    if (typeof c === 'string') {
      const b = Buffer.alloc(512)
      b.write(c)
      return b
    } else {
      c.encode()
      return c.block
    }
  }))

  t.test('warn and correct', t => {
    const check = t => {
      t.same(warnings, [[
        'stripping / from absolute path',
        absolute
      ]])
      t.ok(fs.lstatSync(path.resolve(dir, relative)).isFile(), 'is file')
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.test('preserve absolute path', t => {
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
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.end()
})

t.test('.. paths', t => {
  const dir = path.join(unpackdir, 'dotted-paths')
  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const fmode = 0o755
  const dotted = 'a/b/c/../d'
  const resolved = path.resolve(dir, dotted)

  const data = Buffer.concat([
    new Header({
      path: dotted,
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    'd',
    '',
    ''
  ].map(c => {
    if (typeof c === 'string') {
      const b = Buffer.alloc(512)
      b.write(c)
      return b
    } else {
      c.encode()
      return c.block
    }
  }))

  t.test('warn and skip', t => {
    const check = t => {
      t.same(warnings, [[
        'path contains \'..\'',
        dotted
      ]])
      t.throws(_=>fs.lstatSync(resolved))
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        fmode: fmode,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        fmode: fmode,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.test('preserve dotted path', t => {
    const check = t => {
      t.same(warnings, [])
      t.ok(fs.lstatSync(resolved).isFile(), 'is file')
      t.equal(fs.lstatSync(resolved).mode & 0o777, fmode, 'mode is 0755')
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        fmode: fmode,
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        fmode: fmode,
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
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
  const unmutate = mutateFS.statFail(poop)
  const dir = path.join(unpackdir, 'stat-fail')
  t.teardown(_ => (unmutate(), rimraf.sync(dir)))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = Buffer.concat([
    new Header({
      path: 'd/i/r/file/',
      type: 'Directory',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    new Header({
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    new Header({
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    'a',
    new Header({
      path: 'd/i/r/link',
      type: 'Link',
      linkpath: 'd/i/r/file',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    new Header({
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    '',
    ''
  ].map(c => {
    if (typeof c === 'string') {
      const b = Buffer.alloc(512)
      b.write(c)
      return b
    } else {
      c.encode()
      return c.block
    }
  }))

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [
      ['poop', poop],
      ['poop', poop]
    ]
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t, expect)).end(data)
  })

  t.test('sync', t => {
    const expect = [
      [
        String,
        {
          code: 'EISDIR',
          path: path.resolve(dir, 'd/i/r/file'),
          syscall: 'open'
        }
      ],
      [
        String,
        {
          dest: path.resolve(dir, 'd/i/r/link'),
          path: path.resolve(dir, 'd/i/r/file'),
          syscall: 'link'
        }
      ]
    ]
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail symlink', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const unmutate = mutateFS.fail('symlink', poop)
  const dir = path.join(unpackdir, 'symlink-fail')
  t.teardown(_ => (unmutate(), rimraf.sync(dir)))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = Buffer.concat([
    new Header({
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    new Header({
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    '',
    ''
  ].map(c => {
    if (typeof c === 'string') {
      const b = Buffer.alloc(512)
      b.write(c)
      return b
    } else {
      c.encode()
      return c.block
    }
  }))

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [['poop', poop]]
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t, expect)).end(data)
  })

  t.test('sync', t => {
    const expect = [['poop', poop]]
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail chmod', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const unmutate = mutateFS.fail('chmod', poop)
  const dir = path.join(unpackdir, 'chmod-fail')
  t.teardown(_ => (unmutate(), rimraf.sync(dir)))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = Buffer.concat([
    new Header({
      path: 'd/i/r/dir/',
      type: 'Directory',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    new Header({
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    '',
    ''
  ].map(c => {
    if (typeof c === 'string') {
      const b = Buffer.alloc(512)
      b.write(c)
      return b
    } else {
      c.encode()
      return c.block
    }
  }))

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [['poop', poop]]
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t, expect)).end(data)
  })

  t.test('sync', t => {
    const expect = [['poop', poop]]
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail mkdir', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  let unmutate
  const dir = path.join(unpackdir, 'mkdir-fail')
  t.teardown(_ => rimraf.sync(dir))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    unmutate = mutateFS.fail('mkdir', poop)
    cb()
  })
  t.afterEach(cb => {
    unmutate()
    cb()
  })

  const data = Buffer.concat([
    new Header({
      path: 'dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    '',
    ''
  ].map(c => {
    if (typeof c === 'string') {
      const b = Buffer.alloc(512)
      b.write(c)
      return b
    } else {
      c.encode()
      return c.block
    }
  }))

  const expect = [ [
    'ENOENT: no such file or directory, lstat \'' +
    path.resolve(dir, 'dir') + '\'',
    {
      code: 'ENOENT',
      syscall: 'lstat',
      path: path.resolve(dir, 'dir')
    }
  ] ]

  const check = t => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('fail close', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const unmutate = mutateFS.fail('close', poop)
  const dir = path.join(unpackdir, 'close-fail')
  t.teardown(_ => (unmutate(), rimraf.sync(dir)))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = Buffer.concat([
    new Header({
      path: 'x',
      type: 'File',
      size: 1,
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    }),
    'x',
    '',
    ''
  ].map(c => {
    if (typeof c === 'string') {
      const b = Buffer.alloc(512)
      b.write(c)
      return b
    } else {
      c.encode()
      return c.block
    }
  }))

  const expect = [ [ 'poop', poop ] ]

  const check = t => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t)
  })

  t.end()
})
