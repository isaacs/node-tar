'use strict'
const t = require('tap')
const mkdirp = require('mkdirp')

// make our tests verify that windows link targets get turned into / paths
const fs = require('fs')
const {readlink, readlinkSync} = fs
fs.readlink = (path, cb) => {
  readlink(path, (er, path) => {
    if (er)
      return cb(er)
    else
      cb(null, path.replace(/\//g, '\\'))
  })
}
fs.readlinkSync = path => readlinkSync(path).replace(/\//g, '\\')

const ReadEntry = require('../lib/read-entry.js')
const makeTar = require('./make-tar.js')
const WriteEntry = require('../lib/write-entry.js')
const path = require('path')
const fixtures = path.resolve(__dirname, 'fixtures')
const files = path.resolve(fixtures, 'files')
const Header = require('../lib/header.js')
const mutateFS = require('mutate-fs')
process.env.USER = 'isaacs'
const chmodr = require('chmodr')
const Parser = require('../lib/parse.js')
const rimraf = require('rimraf')
const isWindows = process.platform === 'win32'

t.test('set up', t => {
  const one = fs.statSync(files + '/hardlink-1')
  const two = fs.statSync(files + '/hardlink-2')
  if (one.dev !== two.dev || one.ino !== two.ino) {
    fs.unlinkSync(files + '/hardlink-2')
    fs.linkSync(files + '/hardlink-1', files + '/hardlink-2')
  }
  chmodr.sync(files, 0o644)
  t.end()
})

t.test('100 byte filename', t => {
  // do this one twice, so we have it with and without cache
  let statCache = null
  let linkCache = null
  t.plan(2)

  const runTest = t => {
    const f = '100-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    const ws = new WriteEntry(f, {
      cwd: files,
      linkCache: linkCache,
      statCache: statCache,
    })

    let out = []
    ws.on('data', c => out.push(c))
    ws.on('end', _ => {
      out = Buffer.concat(out)
      t.match(ws, {
        header: {
          cksumValid: true,
          needPax: false,
          path: '100-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          mode: 0o644,
          size: 100,
          linkpath: null,
          uname: 'isaacs',
          gname: null,
          devmaj: 0,
          devmin: 0,
        },
      })

      const wss = new WriteEntry.Sync(f, {
        cwd: files,
        linkCache: linkCache,
        statCache: statCache,
      })
      linkCache = ws.linkCache
      statCache = ws.statCache

      t.equal(out.slice(512).toString('hex'),
        wss.read().slice(512).toString('hex'))

      t.equal(out.length, 1024)
      t.equal(out.slice(0, 100).toString(), f)
      const h = new Header(out.slice(0, 512))
      t.match(h, {
        cksumValid: true,
        needPax: false,
        path: '100-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        mode: 0o644,
        size: 100,
        linkpath: '',
        uname: 'isaacs',
        gname: '',
        devmaj: 0,
        devmin: 0,
      })

      t.equal(out.slice(512).toString('hex'),
        '6363636363636363636363636363636363636363636363636363636363636363' +
        '6363636363636363636363636363636363636363636363636363636363636363' +
        '6363636363636363636363636363636363636363636363636363636363636363' +
        '6363636300000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000')

      t.end()
    })
  }

  t.test('uncached', runTest)
  t.test('cached', runTest)
})

t.test('directory', t => {
  const ws = new WriteEntry('dir', {
    cwd: files,
  })
  let out = []
  ws.on('data', c => out.push(c))

  ws.on('end', _ => {
    out = Buffer.concat(out)
    t.match(ws.header, {
      cksumValid: true,
      needPax: false,
      path: 'dir/',
      mode: 0o755,
      size: 0,
      linkpath: null,
      uname: 'isaacs',
      gname: null,
      devmaj: 0,
      devmin: 0,
    })
    t.equal(out.length, 512)

    const wss = new WriteEntry.Sync('dir', { cwd: files })
    t.equal(wss.read().length, 512)
    t.match(wss.header, {
      cksumValid: true,
      needPax: false,
      path: 'dir/',
      mode: 0o755,
      size: 0,
      linkpath: null,
      uname: 'isaacs',
      gname: null,
      devmaj: 0,
      devmin: 0,
    })

    t.end()
  })
})

t.test('empty path for cwd', t => {
  const ws = new WriteEntry('')
  let out = []
  ws.on('data', c => out.push(c))

  ws.on('end', _ => {
    out = Buffer.concat(out)
    t.match(ws.header, {
      cksumValid: true,
      needPax: false,
      path: './',
      mode: fs.statSync('./').mode & 0o7777,
      size: 0,
      linkpath: null,
      uname: 'isaacs',
      gname: null,
      devmaj: 0,
      devmin: 0,
    })
    t.end()
  })
})

t.test('symlink', t => {
  const ws = new WriteEntry('symlink', { cwd: files })
  let out = []
  ws.on('data', c => out.push(c))
  const header = {
    cksumValid: true,
    needPax: false,
    path: 'symlink',
    size: 0,
    linkpath: 'hardlink-2',
    uname: 'isaacs',
    gname: null,
    devmaj: 0,
    devmin: 0,
  }

  const wss = new WriteEntry.Sync('symlink', { cwd: files })
  t.match(wss.header, header)

  ws.on('end', _ => {
    out = Buffer.concat(out)
    t.equal(out.length, 512)
    t.match(ws.header, header)
    t.end()
  })
})

t.test('zero-byte file', t => {
  const ws = new WriteEntry('files/zero-byte.txt', { cwd: fixtures })
  let out = []
  ws.on('data', c => out.push(c))

  ws.on('end', _ => {
    out = Buffer.concat(out)
    t.equal(out.length, 512)
    t.match(ws.header, {
      path: 'files/zero-byte.txt',
      cksumValid: true,
      needPax: false,
      mode: 0o644,
      size: 0,
      linkpath: null,
      uname: 'isaacs',
      gname: null,
      devmaj: 0,
      devmin: 0,
    })
    t.end()
  })
})

t.test('zero-byte file, but close fails', t => {
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('close', poop))

  const ws = new WriteEntry('files/1024-bytes.txt', { cwd: fixtures })

  ws.on('end', _ =>
    t.fail('should not get an end, because the close fails'))

  ws.on('error', er => {
    t.match(er, { message: 'poop' })
    t.end()
  })
  ws.resume()
})

t.test('hardlinks', t => {
  const wss = new WriteEntry.Sync('hardlink-1', {
    cwd: files,
  })

  const ws = new WriteEntry('files/hardlink-2', {
    cwd: fixtures,
    linkCache: wss.linkCache,
  })
  let out = []
  ws.on('data', c => out.push(c))

  ws.on('end', _ => {
    out = Buffer.concat(out)
    t.equal(out.length, 512)
    t.match(ws.header, {
      type: 'Link',
      path: 'files/hardlink-2',
      cksumValid: true,
      needPax: false,
      mode: 0o644,
      size: 0,
      linkpath: 'files/hardlink-1',
      uname: 'isaacs',
      gname: null,
      devmaj: 0,
      devmin: 0,
    })
    t.end()
  })
})

t.test('hardlinks far away', t => {
  const h1 = 'hardlink-1'
  const f = path.resolve(files, h1)
  const stat = fs.statSync(f)
  const linkCache = new Map([[stat.dev + ':' + stat.ino, '/a/b/c/d/e']])

  const ws = new WriteEntry('files/hardlink-2', {
    cwd: fixtures,
    linkCache: linkCache,
  })
  let out = []
  ws.on('data', c => out.push(c))

  ws.on('end', _ => {
    out = Buffer.concat(out)
    t.equal(out.length, 1024)
    t.match(ws.header, {
      path: 'files/hardlink-2',
      cksumValid: true,
      needPax: false,
      mode: 0o644,
      size: 26,
      linkpath: null,
      uname: 'isaacs',
      gname: null,
      devmaj: 0,
      devmin: 0,
    })
    t.end()
  })
})

t.test('really deep path', t => {
  const f = 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  const ws = new WriteEntry(f, { cwd: files })
  let out = []
  ws.on('data', c => out.push(c))

  ws.on('end', _ => {
    out = Buffer.concat(out)
    t.match(ws.header, {
      cksumValid: true,
      needPax: true,
      path: 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      mode: 0o644,
      size: 100,
      linkpath: null,
      uname: 'isaacs',
      gname: null,
      devmaj: 0,
      devmin: 0,
    })
    t.equal(out.length, 2048)
    t.end()
  })
})

t.test('no pax', t => {
  const f = 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  const ws = new WriteEntry(f, { cwd: files, noPax: true })
  let out = []
  ws.on('data', c => out.push(c))

  ws.on('end', _ => {
    out = Buffer.concat(out)
    t.match(ws.header, {
      cksumValid: true,
      needPax: true,
      path: 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      mode: 0o644,
      size: 100,
      linkpath: null,
      uname: 'isaacs',
      gname: null,
      devmaj: 0,
      devmin: 0,
    })
    t.equal(out.length, 1024)
    t.end()
  })
})

t.test('nonexistent file', t => {
  const f = path.resolve(files, 'does not exist')
  const ws = new WriteEntry('does not exist', { cwd: files })
  ws.on('error', er => {
    t.match(er, {
      message: 'ENOENT: no such file or directory, lstat \'' + f + '\'',
      code: 'ENOENT',
      path: f,
      syscall: 'lstat',
    })
    t.end()
  })
})

t.test('absolute path', t => {
  const absolute = path.resolve(files, '512-bytes.txt')
  const { root } = path.parse(absolute)
  const f = root + root + root + absolute
  const warn = root + root + root + root
  t.test('preservePaths=false strict=false', t => {
    const warnings = []
    const ws = new WriteEntry(f, {
      cwd: files,
      onwarn: (c, m, p) => warnings.push([c, m, p]),
    })
    let out = []
    ws.on('data', c => out.push(c))
    ws.on('end', _ => {
      out = Buffer.concat(out)
      t.equal(out.length, 1024)
      t.match(warnings, [[
        'TAR_ENTRY_INFO', `stripping ${warn} from absolute path`, { path: f },
      ]])

      t.match(ws.header, {
        cksumValid: true,
        needPax: false,
        path: f.replace(/^(\/|[a-z]:\\\\){4}/, ''),
        mode: 0o644,
        size: 512,
        linkpath: null,
        uname: 'isaacs',
        gname: null,
        devmaj: 0,
        devmin: 0,
      })
      t.end()
    })
  })

  t.test('preservePaths=true', t => {
    t.plan(2)
    // with preservePaths, strictness doens't matter
    ;[true, false].forEach(strict => {
      t.test('strict=' + strict, t => {
        const warnings = []
        const ws = new WriteEntry(f, {
          cwd: files,
          strict: strict,
          preservePaths: true,
          onwarn: (c, m, p) => warnings.push([c, m, p]),
        })
        let out = []
        ws.on('data', c => out.push(c))
        ws.on('end', _ => {
          out = Buffer.concat(out)
          t.equal(warnings.length, 0)

          t.match(ws.header, {
            cksumValid: true,
            needPax: false,
            path: f,
            mode: 0o644,
            size: 512,
            linkpath: null,
            uname: 'isaacs',
            gname: null,
            devmaj: 0,
            devmin: 0,
          })
          t.end()
        })
      })
    })
  })

  t.test('preservePaths=false strict=true', t => {
    t.throws(_ => {
      new WriteEntry(f, {
        strict: true,
        cwd: files,
      })
    }, { message: /stripping .* from absolute path/, path: f })
    t.end()
  })

  t.end()
})

t.throws(_ => new WriteEntry(null), new TypeError('path is required'))

t.test('no user environ, sets uname to empty string', t => {
  delete process.env.USER
  const ws = new WriteEntry('512-bytes.txt', { cwd: files })
  let out = []
  ws.on('data', c => out.push(c))
  ws.on('end', _ => {
    out = Buffer.concat(out)
    t.equal(out.length, 1024)
    t.match(ws.header, {
      cksumValid: true,
      needPax: false,
      path: '512-bytes.txt',
      mode: 0o644,
      size: 512,
      uname: '',
      linkpath: null,
      gname: null,
      devmaj: 0,
      devmin: 0,
    })
    t.end()
  })
})

t.test('an unsuppored type', {
  skip: isWindows && '/dev/random on windows',
}, t => {
  const ws = new WriteEntry('/dev/random', { preservePaths: true })
  ws.on('data', c => {
    throw new Error('should not get data from random')
  })
  ws.on('stat', stat => {
    t.match(stat, {
      dev: Number,
      mode: 0o020666,
      nlink: 1,
      rdev: Number,
      blksize: Number,
      ino: Number,
      size: 0,
      blocks: 0,
    })
    t.ok(stat.isCharacterDevice(), 'random is a character device')
  })
  ws.on('end', _ => {
    t.match(ws, { type: 'Unsupported', path: '/dev/random' })
    t.end()
  })
})

t.test('readlink fail', t => {
  const expect = {
    message: `EINVAL: invalid argument, readlink '${__filename}'`,
    code: 'EINVAL',
    syscall: 'readlink',
    path: __filename,
  }
  // pretend everything is a symbolic link, then read something that isn't
  t.teardown(mutateFS.statType('SymbolicLink'))
  t.throws(_ => new WriteEntry.Sync('write-entry.js', { cwd: __dirname }),
    expect)
  new WriteEntry('write-entry.js', { cwd: __dirname }).on('error', er => {
    t.match(er, expect)
    t.end()
  })
})

t.test('open fail', t => {
  t.teardown(mutateFS.fail('open', new Error('pwn')))
  t.throws(_ => new WriteEntry.Sync('write-entry.js', { cwd: __dirname }),
    { message: 'pwn' })
  new WriteEntry('write-entry.js', { cwd: __dirname }).on('error', er => {
    t.match(er, { message: 'pwn' })
    t.end()
  })
})

t.test('read fail', t => {
  const expect = {
    message: 'EISDIR: illegal operation on a directory, read',
    code: 'EISDIR',
    syscall: 'read',
  }
  // pretend everything is a symbolic link, then read something that isn't
  t.teardown(mutateFS.statType('File'))
  t.throws(_ => new WriteEntry.Sync('fixtures', {
    cwd: __dirname,
  }), expect)
  new WriteEntry('fixtures', { cwd: __dirname }).on('error', er => {
    t.match(er, expect)
    t.end()
  })
})

t.test('read invalid EOF', t => {
  t.teardown(mutateFS.mutate('read', (er, br) => [er, 0]))
  const expect = {
    message: 'encountered unexpected EOF',
    path: __filename,
    syscall: 'read',
    code: 'EOF',
  }
  t.throws(_ => new WriteEntry.Sync('write-entry.js', { cwd: __dirname }),
    expect)
  new WriteEntry('write-entry.js', { cwd: __dirname }).on('error', er => {
    t.match(er, expect)
    t.end()
  })
})

t.test('read overflow expectation', t => {
  t.teardown(mutateFS.statMutate((er, st) => {
    if (st)
      st.size = 3
  }))
  const f = '512-bytes.txt'
  const expect = {
    message: 'did not encounter expected EOF',
    path: path.resolve(files, f),
    syscall: 'read',
    code: 'EOF',
  }
  t.plan(2)
  t.throws(_ => new WriteEntry.Sync(f, { cwd: files, maxReadSize: 2 }), expect)
  new WriteEntry(f, { cwd: files, maxReadSize: 2 }).on('error', er => {
    t.match(er, expect)
  }).resume()
})

t.test('short reads', t => {
  t.teardown(mutateFS.zenoRead())
  const cases = {
    '1024-bytes.txt': new Array(1024).join('x') + '\n',
    '100-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': new Array(101).join('c'),
  }

  const maxReadSize = [null, 1024, 100, 111]

  Object.keys(cases).forEach(filename => {
    t.test(filename.split('byte').shift() + 'byte', t => {
      const contents = cases[filename]
      maxReadSize.forEach(mRS => {
        t.test('maxReadSize=' + mRS, t => {
          let out = []
          const ws = new WriteEntry(filename, {
            maxReadSize: mRS,
            cwd: files,
          })
          ws.on('data', c => out.push(c))
          ws.on('end', _ => {
            out = Buffer.concat(out)
            t.equal(out.length, 512 * Math.ceil(1 + contents.length / 512))
            t.equal(out.slice(512).toString().replace(/\0.*$/, ''), contents)
            const wss = new WriteEntry.Sync(filename, { cwd: files })
            const syncOut = wss.read()
            t.equal(syncOut.length, out.length)
            t.equal(syncOut.slice(512).toString(), out.slice(512).toString())
            t.end()
          })
        })
      })
      t.end()
    })
  })
  t.end()
})

t.test('win32 path conversion', {
  skip: isWindows && 'no need to test on windows',
}, t => {
  const ws = new WriteEntry('long-path\\r', {
    cwd: files,
    win32: true,
  })
  t.equal(ws.path, 'long-path/r')
  t.end()
})

t.test('win32 <|>? in paths', {
  skip: isWindows && 'do not create annoying junk on windows systems',
}, t => {
  const file = path.resolve(fixtures, '<|>?.txt')
  const uglyName = Buffer.from('ef80bcef81bcef80beef80bf2e747874', 'hex').toString()
  const ugly = path.resolve(fixtures, uglyName)
  t.teardown(_ => {
    rimraf.sync(file)
    rimraf.sync(ugly)
  })

  fs.writeFileSync(ugly, '<|>?')

  const wc = new WriteEntry(uglyName, {
    cwd: fixtures,
    win32: true,
  })

  const out = []
  wc.on('data', c => out.push(c))
  wc.on('end', _ => {
    const data = Buffer.concat(out).toString()
    t.equal(data.substr(0, 4), '<|>?')
    t.end()
  })

  t.equal(wc.path, '<|>?.txt')
  t.equal(wc.absolute, ugly)
})

t.test('uid doesnt match, dont set uname', t => {
  t.teardown(mutateFS.statMutate((er, st) => {
    if (st)
      st.uid -= 1
  }))
  const ws = new WriteEntry('long-path/r', {
    cwd: files,
  })
  t.notOk(ws.uname)
  t.end()
})

t.test('override absolute to some other file', t => {
  const ws = new WriteEntry('blerg', {
    absolute: files + '/one-byte.txt',
  })
  const out = []
  ws.on('data', c => out.push(c))
  ws.on('end', _ => {
    const data = Buffer.concat(out)
    t.equal(data.length, 1024)
    t.match(data.slice(512).toString(), /^a\0{511}$/)
    t.match(ws, {
      path: 'blerg',
      header: { size: 1 },
    })
    const wss = new WriteEntry.Sync('blerg', {
      absolute: files + '/one-byte.txt',
    })
    const sdata = wss.read()
    t.equal(sdata.length, 1024)
    t.match(sdata.slice(512).toString(), /^a\0{511}$/)
    t.match(wss, {
      path: 'blerg',
      header: { size: 1 },
    })
    t.end()
  })
})

t.test('portable entries, nothing platform-specific', t => {
  const om = 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt'
  const ws = new WriteEntry(om, {
    cwd: files,
    portable: true,
  })

  const pexpect = {
    atime: null,
    charset: null,
    comment: null,
    ctime: null,
    gid: null,
    gname: null,
    linkpath: null,
    path: 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
    size: 2,
    uid: null,
    uname: null,
    dev: null,
    ino: null,
    nlink: null,
  }

  const hexpect = {
    size: 2,
    ctime: null,
    atime: null,
    uid: null,
    uname: '',
    gid: null,
    gname: '',
  }

  const ps = new Parser()
  const wss = new WriteEntry.Sync(om, {
    cwd: files,
    portable: true,
  })
  ps.on('entry', entry => {
    t.match(entry.extended, pexpect)
    t.match(entry.header, hexpect)
  })
  ps.end(wss.read())

  const p = new Parser()
  ws.pipe(p)
  p.on('entry', entry => {
    t.match(entry.extended, pexpect)
    t.match(entry.header, hexpect)
    t.end()
  })
})

t.test('no mtime', t => {
  const om = 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt'
  const ws = new WriteEntry(om, {
    cwd: files,
    noMtime: true,
    portable: true,
  })

  const pexpect = {
    atime: null,
    mtime: null,
    charset: null,
    comment: null,
    ctime: null,
    gid: null,
    gname: null,
    linkpath: null,
    path: 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
    size: 2,
    uid: null,
    uname: null,
    dev: null,
    ino: null,
    nlink: null,
  }

  const hexpect = {
    size: 2,
    ctime: null,
    atime: null,
    mtime: null,
    uid: null,
    uname: '',
    gid: null,
    gname: '',
  }

  const ps = new Parser()
  const wss = new WriteEntry.Sync(om, {
    cwd: files,
    portable: true,
    noMtime: true,
  })
  ps.on('entry', entry => {
    t.match(entry.extended, pexpect)
    t.match(entry.header, hexpect)
  })
  ps.end(wss.read())

  const p = new Parser()
  ws.pipe(p)
  p.on('entry', entry => {
    t.match(entry.extended, pexpect)
    t.match(entry.header, hexpect)
    t.end()
  })
})

t.test('force mtime', t => {
  const om = 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt'
  const date = new Date('1979-07-01T19:10:00.000Z')
  const ws = new WriteEntry(om, {
    cwd: files,
    mtime: date,
    portable: true,
  })

  const pexpect = {
    atime: null,
    mtime: new Date('1979-07-01T19:10:00.000Z'),
    charset: null,
    comment: null,
    ctime: null,
    gid: null,
    gname: null,
    linkpath: null,
    path: 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
    size: 2,
    uid: null,
    uname: null,
    dev: null,
    ino: null,
    nlink: null,
  }

  const hexpect = {
    size: 2,
    ctime: null,
    atime: null,
    mtime: new Date('1979-07-01T19:10:00.000Z'),
    uid: null,
    uname: '',
    gid: null,
    gname: '',
  }

  const ps = new Parser()
  const wss = new WriteEntry.Sync(om, {
    cwd: files,
    portable: true,
    mtime: new Date('1979-07-01T19:10:00.000Z'),
  })
  ps.on('entry', entry => {
    t.match(entry.extended, pexpect)
    t.match(entry.header, hexpect)
  })
  ps.end(wss.read())

  const p = new Parser()
  ws.pipe(p)
  p.on('entry', entry => {
    t.match(entry.extended, pexpect)
    t.match(entry.header, hexpect)
    t.end()
  })
})

t.test('portable dir entries, no mtime', t => {
  const dir = 'long-path/'
  const ws = new WriteEntry(dir, {
    cwd: files,
    portable: true,
  })

  const hexpect = {
    path: 'long-path/',
    ctime: null,
    atime: null,
    uid: null,
    uname: '',
    gid: null,
    gname: '',
    mtime: null,
  }

  const ps = new Parser()
  const wss = new WriteEntry.Sync(dir, {
    cwd: files,
    portable: true,
  })
  ps.on('entry', entry => {
    t.match(entry.header, hexpect)
  })
  ps.end(wss.read())

  const p = new Parser()
  ws.pipe(p)
  p.on('entry', entry => {
    t.match(entry.header, hexpect)
    t.end()
  })
})

t.test('writing more data than is appropriate', t => {
  const path = t.testdir({
    file: 'hello',
  })
  const wss = new WriteEntry(`${path}/file`)
  wss.on('error', er => {
    t.match(er, {
      message: 'writing more data than expected',
    })
    t.end()
  })
  wss.on('stat', () => wss.write(Buffer.from('some more stuff')))
})

t.test('write entry from read entry', t => {
  const data = makeTar([
    {
      path: '$',
      type: 'File',
      size: 10,
      mode: 0o755,
      uid: 123,
      gid: 321,
      ctime: new Date('1979-07-01'),
      atime: new Date('1980-08-17'),
    },
    '$$$$$$$$$$',
    {
      path: 'blep',
      type: 'SymbolicLink',
      linkpath: 'xyz',
    },
    '',
    '',
  ])

  t.test('basic file', t => {
    const fileEntry = new ReadEntry(new Header(data))
    const wetFile = new WriteEntry.Tar(fileEntry)
    const out = []
    let wetFileEnded = false
    wetFile.on('data', c => out.push(c))
    wetFile.on('end', _ => wetFileEnded = true)
    fileEntry.write(data.slice(512, 550))
    fileEntry.write(data.slice(550, 1000))
    fileEntry.end(data.slice(1000, 1024))
    t.equal(wetFileEnded, true)
    const result = Buffer.concat(out)
    t.equal(result.length, 1024)
    t.equal(result.toString().replace(/\0.*$/, ''), '$')
    const body = result.slice(512).toString().replace(/\0*$/, '')
    t.equal(body, '$$$$$$$$$$')
    t.end()
  })

  t.test('basic file', t => {
    const data = makeTar([
      {
        path: '$',
        type: 'Directory',
        size: 0,
        mode: 0o755,
        uid: 123,
        gid: 321,
        ctime: new Date('1979-07-01'),
        atime: new Date('1980-08-17'),
        mtime: new Date('1997-06-21'),
      },
      '',
      '',
    ])
    const fileEntry = new ReadEntry(new Header(data))
    const wetFile = new WriteEntry.Tar(fileEntry, { portable: true })
    const out = []
    let wetFileEnded = false
    wetFile.on('data', c => out.push(c))
    wetFile.on('end', _ => wetFileEnded = true)
    fileEntry.end()
    t.equal(wetFileEnded, true)
    const result = Buffer.concat(out)
    t.match(new Header(result), { mtime: null })
    t.end()
  })

  t.test('with pax header', t => {
    const fileEntryPax = new ReadEntry(new Header(data))
    fileEntryPax.path = new Array(200).join('$')
    const wetPax = new WriteEntry.Tar(fileEntryPax)
    let wetPaxEnded = false
    const out = []
    wetPax.on('data', c => out.push(c))
    wetPax.on('end', _ => wetPaxEnded = true)
    fileEntryPax.write(data.slice(512, 550))
    fileEntryPax.write(data.slice(550, 1000))
    fileEntryPax.end(data.slice(1000, 1024))
    t.equal(wetPaxEnded, true)
    const result = Buffer.concat(out)
    t.equal(result.length, 2048)
    t.match(result.slice(1024, 1124).toString(), /^\$+\0?$/)
    const body = result.slice(1536).toString().replace(/\0*$/, '')
    t.match(new Header(result), { type: 'ExtendedHeader' })
    t.equal(body, '$$$$$$$$$$')
    t.end()
  })

  t.test('pax and portable', t => {
    const fileEntryPax = new ReadEntry(new Header(data))
    fileEntryPax.path = new Array(200).join('$')
    const wetPax = new WriteEntry.Tar(fileEntryPax, { portable: true })
    let wetPaxEnded = false
    const out = []
    wetPax.on('data', c => out.push(c))
    wetPax.on('end', _ => wetPaxEnded = true)
    fileEntryPax.write(data.slice(512, 550))
    fileEntryPax.write(data.slice(550, 1000))
    fileEntryPax.end(data.slice(1000, 1024))
    t.equal(wetPaxEnded, true)
    const result = Buffer.concat(out)
    t.equal(result.length, 2048)
    t.match(result.slice(1024, 1124).toString(), /^\$+\0?$/)
    t.match(new Header(result), { type: 'ExtendedHeader' })
    t.match(new Header(result.slice(1024)), {
      ctime: null,
      atime: null,
      uname: '',
      gname: '',
    })
    const body = result.slice(1536).toString().replace(/\0*$/, '')
    t.equal(body, '$$$$$$$$$$')
    t.end()
  })

  t.test('pax, portable, and noMtime', t => {
    const fileEntryPax = new ReadEntry(new Header(data))
    fileEntryPax.path = new Array(200).join('$')
    const wetPax = new WriteEntry.Tar(fileEntryPax, {
      noMtime: true,
      portable: true,
    })
    let wetPaxEnded = false
    const out = []
    wetPax.on('data', c => out.push(c))
    wetPax.on('end', _ => wetPaxEnded = true)
    fileEntryPax.write(data.slice(512, 550))
    fileEntryPax.write(data.slice(550, 1000))
    fileEntryPax.end(data.slice(1000, 1024))
    t.equal(wetPaxEnded, true)
    const result = Buffer.concat(out)
    t.equal(result.length, 2048)
    t.match(result.slice(1024, 1124).toString(), /^\$+\0?$/)
    t.match(new Header(result), { type: 'ExtendedHeader' })
    t.match(new Header(result.slice(1024)), {
      mtime: null,
      ctime: null,
      atime: null,
      uname: '',
      gname: '',
    })
    const body = result.slice(1536).toString().replace(/\0*$/, '')
    t.equal(body, '$$$$$$$$$$')
    t.end()
  })

  t.test('abs path', t => {
    const fileEntry = new ReadEntry(new Header(data))
    fileEntry.path = '/a/b/c'

    t.test('warn', t => {
      const warnings = []
      new WriteEntry.Tar(fileEntry, {
        onwarn: (code, msg, data) => warnings.push(code, msg, data),
      })
      t.match(warnings, ['TAR_ENTRY_INFO', 'stripping / from absolute path', {
        path: '/a/b/c',
      }])
      t.end()
    })

    t.test('preserve', t => {
      const warnings = []
      new WriteEntry.Tar(fileEntry, {
        onwarn: (code, msg, data) => warnings.push(code, msg, data),
        preservePaths: true,
      })
      t.same(warnings, [])
      t.end()
    })

    t.test('throw', t => {
      t.throws(_ => new WriteEntry.Tar(fileEntry, {
        strict: true,
      }))
      t.end()
    })
    t.end()
  })

  t.test('no block remain', t => {
    const readEntry = new ReadEntry(new Header({
      size: 512,
      type: 'File',
      path: 'x',
    }))
    const wet = new WriteEntry.Tar(readEntry)
    const out = []
    wet.on('data', c => out.push(c))
    let wetEnded = false
    wet.on('end', _ => wetEnded = true)
    t.equal(wetEnded, false)
    readEntry.end(Buffer.from(new Array(513).join('@')))
    t.equal(wetEnded, true)
    const res = Buffer.concat(out)
    t.equal(res.length, 1024)
    t.match(res.slice(512).toString(), /^@+$/)
    t.end()
  })

  t.test('write more than appropriate', t => {
    const readEntry = new ReadEntry(new Header({
      path: 'x',
      type: 'File',
      size: '1',
    }))
    const wet = new WriteEntry.Tar(readEntry)
    t.throws(_ => wet.write(Buffer.from(new Array(1024).join('x'))))
    t.end()
  })

  t.end()
})

// https://github.com/npm/node-tar/issues/284
t.test('prefix and hard links', t => {
  const dir = path.resolve(fixtures, 'writeentry-prefix-hardlinks')
  rimraf.sync(dir)
  t.teardown(_ => rimraf.sync(dir))
  mkdirp.sync(dir + '/in/z/b/c')
  fs.writeFileSync(dir + '/in/target', 'ddd')
  fs.linkSync(dir + '/in/target', dir + '/in/z/b/c/d')
  fs.linkSync(dir + '/in/target', dir + '/in/z/b/d')
  fs.linkSync(dir + '/in/target', dir + '/in/z/d')
  fs.linkSync(dir + '/in/target', dir + '/in/y')
  const long = 'y'.repeat(250)
  fs.linkSync(dir + '/in/target', dir + '/in/' + long)

  const expect = [
    {
      type: 'Directory',
      path: 'out/x/',
    },
    {
      type: 'File',
      size: 3,
      path: 'out/x/target',
    },
    'ddd\0',
    {
      path: 'out/x/y',
      type: 'Link',
      linkpath: 'out/x/target',
    },
    {
      path: 'PaxHeader/yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
      type: 'ExtendedHeader',
    },
    new RegExp('^266 path=out.x.' + long + '[\\w\\W]*linkpath=out.x.target'),
    {
      path: 'out/x/yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
      type: 'Link',
      linkpath: 'out/x/target',
    },
    {
      type: 'Directory',
      path: 'out/x/z/',
    },
    {
      type: 'Directory',
      path: 'out/x/z/b/',
    },
    {
      path: 'out/x/z/d',
      type: 'Link',
      linkpath: 'out/x/target',
    },
    {
      type: 'Directory',
      path: 'out/x/z/b/c/',
    },
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
  ]

  const check = (out, t) => {
    const data = Buffer.concat(out)
    expect.forEach((e, i) => {
      if (typeof e === 'string')
        t.equal(data.slice(i * 512, i * 512 + e.length).toString(), e)
      else if (e instanceof RegExp)
        t.match(data.slice(i * 512, (i + 1) * 512).toString(), e)
      else
        t.match(new Header(data.slice(i * 512, (i + 1) * 512)), e)
    })
  }

  const runTest = async (t, path, Class) => {
    const linkCache = new Map()
    const statCache = new Map()
    const opt = {
      cwd: dir + '/in',
      prefix: 'out/x',
      noDirRecurse: true,
      linkCache,
      statCache,
    }
    const out = []
    const entry = (path) => new Promise(resolve => {
      const p = new Class(path, opt)
      p.on('end', resolve)
      p.on('data', d => out.push(d))
    })

    await entry(path)
    if (path === '.')
      path = './'
    await entry(`${path}target`)
    await entry(`${path}y`)
    await entry(`${path}${long}`)
    await entry(`${path}z`)
    await entry(`${path}z/b`)
    await entry(`${path}z/d`)
    await entry(`${path}z/b/c`)
    await entry(`${path}z/b/d`)
    await entry(`${path}z/b/c/d`)
    check(out, t)
  }

  t.test('async', t => {
    t.test('.', t => runTest(t, '.', WriteEntry))
    return t.test('./', t => runTest(t, './', WriteEntry))
  })

  t.test('sync', t => {
    t.test('.', t => runTest(t, '.', WriteEntry.Sync))
    return t.test('./', t => runTest(t, './', WriteEntry.Sync))
  })

  t.end()
})

t.test('prefix and hard links from tar entries', t => {
  const long = 'y'.repeat(250)
  const expect = [
    {
      type: 'Directory',
      path: 'out/x/',
    },
    {
      type: 'File',
      size: 3,
      path: 'out/x/target',
    },
    'ddd\0',
    {
      path: 'out/x/y',
      type: 'Link',
      linkpath: 'out/x/target',
    },
    {
      path: 'PaxHeader/yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
      type: 'ExtendedHeader',
    },
    new RegExp('^266 path=out.x.' + long + '[\\w\\W]*linkpath=out.x.target'),
    {
      path: 'out/x/yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
      type: 'Link',
      linkpath: 'out/x/target',
    },
    {
      type: 'Directory',
      path: 'out/x/z/',
    },
    {
      type: 'Directory',
      path: 'out/x/z/b/',
    },
    {
      path: 'out/x/z/d',
      type: 'Link',
      linkpath: 'out/x/target',
    },
    {
      type: 'Directory',
      path: 'out/x/z/b/c/',
    },
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
  ]

  const data = makeTar([
    {
      type: 'Directory',
      path: './',
    },
    {
      type: 'File',
      size: 3,
      path: 'target',
    },
    'ddd\0',
    {
      path: 'y',
      type: 'Link',
      linkpath: 'target',
    },
    {
      path: 'PaxHeader/yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
      type: 'ExtendedHeader',
      size: ('260 path=' + long + '\n19 linkpath=target\n').length,
    },
    '260 path=' + long + '\n19 linkpath=target\n',
    {
      path: 'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
      type: 'Link',
      linkpath: 'target',
    },
    {
      type: 'Directory',
      path: 'z/',
    },
    {
      type: 'Directory',
      path: 'z/b/',
    },
    {
      path: 'z/d',
      type: 'Link',
      linkpath: 'target',
    },
    {
      type: 'Directory',
      path: 'z/b/c/',
    },
    {
      path: 'z/b/d',
      type: 'Link',
      linkpath: 'target',
    },
    {
      path: 'z/b/c/d',
      type: 'Link',
      linkpath: 'target',
    },
    '',
    '',
  ])

  const check = (out, t) => {
    const data = Buffer.concat(out)
    expect.forEach((e, i) => {
      if (typeof e === 'string')
        t.equal(data.slice(i * 512, i * 512 + e.length).toString(), e)
      else if (e instanceof RegExp)
        t.match(data.slice(i * 512, (i + 1) * 512).toString(), e)
      else
        t.match(new Header(data.slice(i * 512, (i + 1) * 512)), e)
    })
  }

  const runTest = async (t, path) => {
    const linkCache = new Map()
    const statCache = new Map()
    const opt = {
      prefix: 'out/x',
      noDirRecurse: true,
      linkCache,
      statCache,
    }
    const out = []
    const parser = new Parser({
      strict: true,
      onentry: readEntry => {
        const p = new WriteEntry.Tar(readEntry, opt)
        p.on('data', d => out.push(d))
      },
    })
    parser.on('end', () => check(out, t))
    parser.end(data)
  }

  t.test('.', t => runTest(t, '.'))
  t.test('./', t => runTest(t, './'))

  t.end()
})

t.test('hard links and no prefix', t => {
  const dir = path.resolve(fixtures, 'writeentry-prefix-hardlinks')
  t.teardown(_ => rimraf.sync(dir))
  mkdirp.sync(dir + '/in/z/b/c')
  fs.writeFileSync(dir + '/in/target', 'ddd')
  fs.linkSync(dir + '/in/target', dir + '/in/z/b/c/d')
  fs.linkSync(dir + '/in/target', dir + '/in/z/b/d')
  fs.linkSync(dir + '/in/target', dir + '/in/z/d')
  fs.linkSync(dir + '/in/target', dir + '/in/y')

  const expect = [
    {
      type: 'Directory',
      path: './',
    },
    {
      type: 'File',
      size: 3,
      path: 'target',
    },
    'ddd\0',
    {
      path: 'y',
      type: 'Link',
      linkpath: 'target',
    },
    {
      type: 'Directory',
      path: 'z/',
    },
    {
      type: 'Directory',
      path: 'z/b/',
    },
    {
      path: 'z/d',
      type: 'Link',
      linkpath: 'target',
    },
    {
      type: 'Directory',
      path: 'z/b/c/',
    },
    {
      path: 'z/b/d',
      type: 'Link',
      linkpath: 'target',
    },
    {
      path: 'z/b/c/d',
      type: 'Link',
      linkpath: 'target',
    },
  ]

  const check = (out, t) => {
    const data = Buffer.concat(out)
    expect.forEach((e, i) => {
      if (typeof e === 'string')
        t.equal(data.slice(i * 512, i * 512 + e.length).toString(), e)
      else
        t.match(new Header(data.slice(i * 512, (i + 1) * 512)), e)
    })
  }

  const runTest = async (t, path, Class) => {
    const linkCache = new Map()
    const statCache = new Map()
    const opt = {
      cwd: dir + '/in',
      linkCache,
      statCache,
    }
    const out = []
    const entry = (path) => new Promise(resolve => {
      const p = new Class(path, opt)
      p.on('end', resolve)
      p.on('data', d => out.push(d))
    })

    await entry(path)
    if (path === '.')
      path = './'
    await entry(`${path}target`)
    await entry(`${path}y`)
    await entry(`${path}z`)
    await entry(`${path}z/b`)
    await entry(`${path}z/d`)
    await entry(`${path}z/b/c`)
    await entry(`${path}z/b/d`)
    await entry(`${path}z/b/c/d`)
    check(out, t)
  }

  t.test('async', t => {
    t.test('.', t => runTest(t, '.', WriteEntry))
    return t.test('./', t => runTest(t, './', WriteEntry))
  })

  t.test('sync', t => {
    t.test('.', t => runTest(t, '.', WriteEntry.Sync))
    return t.test('./', t => runTest(t, './', WriteEntry.Sync))
  })

  t.end()
})

t.test('hard links from tar entries and no prefix', t => {
  const expect = [
    {
      type: 'Directory',
      path: './',
    },
    {
      type: 'File',
      size: 3,
      path: 'target',
    },
    'ddd\0',
    {
      path: 'y',
      type: 'Link',
      linkpath: 'target',
    },
    {
      type: 'Directory',
      path: 'z/',
    },
    {
      type: 'Directory',
      path: 'z/b/',
    },
    {
      path: 'z/d',
      type: 'Link',
      linkpath: 'target',
    },
    {
      type: 'Directory',
      path: 'z/b/c/',
    },
    {
      path: 'z/b/d',
      type: 'Link',
      linkpath: 'target',
    },
    {
      path: 'z/b/c/d',
      type: 'Link',
      linkpath: 'target',
    },
  ]

  const data = makeTar([
    {
      type: 'Directory',
      path: './',
    },
    {
      type: 'File',
      size: 3,
      path: 'target',
    },
    'ddd\0',
    {
      path: 'y',
      type: 'Link',
      linkpath: 'target',
    },
    {
      type: 'Directory',
      path: 'z/',
    },
    {
      type: 'Directory',
      path: 'z/b/',
    },
    {
      path: 'z/d',
      type: 'Link',
      linkpath: 'target',
    },
    {
      type: 'Directory',
      path: 'z/b/c/',
    },
    {
      path: 'z/b/d',
      type: 'Link',
      linkpath: 'target',
    },
    {
      path: 'z/b/c/d',
      type: 'Link',
      linkpath: 'target',
    },
  ])

  const check = (out, t) => {
    const data = Buffer.concat(out)
    expect.forEach((e, i) => {
      if (typeof e === 'string')
        t.equal(data.slice(i * 512, i * 512 + e.length).toString(), e)
      else if (e instanceof RegExp)
        t.match(data.slice(i * 512, (i + 1) * 512).toString(), e)
      else
        t.match(new Header(data.slice(i * 512, (i + 1) * 512)), e)
    })
  }

  const runTest = async (t, path) => {
    const linkCache = new Map()
    const statCache = new Map()
    const opt = {
      noDirRecurse: true,
      linkCache,
      statCache,
    }
    const out = []
    const parser = new Parser({
      onentry: readEntry => {
        const p = new WriteEntry.Tar(readEntry, opt)
        p.on('data', d => out.push(d))
      },
    })
    parser.on('end', () => check(out, t))
    parser.end(data)
  }

  t.test('.', t => runTest(t, '.'))
  t.test('./', t => runTest(t, './'))

  t.end()
})
