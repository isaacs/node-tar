const t = require('tap')
const WriteEntry = require('../lib/write-entry.js')
const fs = require('fs')
const path = require('path')
const fixtures = path.resolve(__dirname, 'fixtures')
const files = path.resolve(fixtures, 'files')
const Header = require('../lib/header.js')

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
      statCache: statCache
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
          mode: 0o100644,
          size: 100,
          linkpath: null,
          ustar: null,
          ustarver: null,
          gname: null,
          devmaj: null,
          devmin: null,
          ustarPrefix: null,
          xstarPrefix: null,
          prefixTerminator: null
        }
      })

      const wss = new WriteEntry.Sync(f, {
        cwd: files,
        linkCache: linkCache,
        statCache: statCache
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
        mode: 0o100644,
        size: 100,
        linkpath: '',
        ustar: 'ustar',
        ustarver: '00',
        gname: '',
        devmaj: 0,
        devmin: 0,
        ustarPrefix: '',
        xstarPrefix: '',
        prefixTerminator: ''
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
    cwd: files
  })
  let out = []
  ws.on('data', c => out.push(c))

  ws.on('end', _ => {
    out = Buffer.concat(out)
    t.match(ws.header, {
      cksumValid: true,
      needPax: false,
      path: 'dir/',
      mode: 0o40755,
      size: 0,
      linkpath: null,
      ustar: null,
      ustarver: null,
      gname: null,
      devmaj: null,
      devmin: null,
      ustarPrefix: null,
      xstarPrefix: null,
      prefixTerminator: null
    })
    t.equal(out.length, 512)

    const wss = new WriteEntry.Sync('dir', { cwd: files })
    t.equal(wss.read().length, 512)
    t.match(wss.header, {
      cksumValid: true,
      needPax: false,
      path: 'dir/',
      mode: 0o40755,
      size: 0,
      linkpath: null,
      ustar: null,
      ustarver: null,
      gname: null,
      devmaj: null,
      devmin: null,
      ustarPrefix: null,
      xstarPrefix: null,
      prefixTerminator: null
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
      mode: 0o40755,
      size: 0,
      linkpath: null,
      ustar: null,
      ustarver: null,
      gname: null,
      devmaj: null,
      devmin: null,
      ustarPrefix: null,
      xstarPrefix: null,
      prefixTerminator: null
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
    mode: 0o120755,
    size: 0,
    linkpath: 'hardlink-2',
    ustar: null,
    ustarver: null,
    gname: null,
    devmaj: null,
    devmin: null,
    ustarPrefix: null,
    xstarPrefix: null,
    prefixTerminator: null
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
      mode: 0o100644,
      size: 0,
      linkpath: null,
      ustar: null,
      ustarver: null,
      gname: null,
      devmaj: null,
      devmin: null,
      ustarPrefix: null,
      xstarPrefix: null,
      prefixTerminator: null
    })
    t.end()
  })
})

t.test('hardlinks', t => {
  const h1 = 'hardlink-1'
  const h2 = 'hardlink-2'
  const f = path.resolve(files, h1)

  const wss = new WriteEntry.Sync('hardlink-1', {
    cwd: files
  })

  const ws = new WriteEntry('files/hardlink-2', {
    cwd: fixtures,
    linkCache: wss.linkCache
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
      mode: 0o100644,
      size: 0,
      linkpath: 'files/hardlink-1',
      ustar: null,
      ustarver: null,
      gname: null,
      devmaj: null,
      devmin: null,
      ustarPrefix: null,
      xstarPrefix: null,
      prefixTerminator: null
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
    linkCache: linkCache
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
      mode: 0o100644,
      size: 26,
      linkpath: null,
      ustar: null,
      ustarver: null,
      gname: null,
      devmaj: null,
      devmin: null,
      ustarPrefix: null,
      xstarPrefix: null,
      prefixTerminator: null
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
      mode: 33188,
      size: 100,
      linkpath: null,
      ustar: null,
      ustarver: null,
      gname: null,
      devmaj: null,
      devmin: null,
      ustarPrefix: null,
      xstarPrefix: null,
      prefixTerminator: null
    })
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
      syscall: 'lstat'
    })
    t.end()
  })
})

t.test('absolute path', t => {
  const f = path.resolve(files, '512-bytes.txt')
  t.test('preservePaths=false strict=false', t => {
    const warnings = []
    const ws = new WriteEntry(f, {
      cwd: files,
      onwarn: (m, p) => warnings.push([m, p])
    })
    let out = []
    ws.on('data', c => out.push(c))
    ws.on('end', _ => {
      out = Buffer.concat(out)
      t.match(warnings, [[
        /stripping .* from absolute path/, f
      ]])

      t.match(ws.header, {
        cksumValid: true,
        needPax: false,
        path: f.replace(/^(\/|[a-z]:\\\\)/, ''),
        mode: 33188,
        size: 512,
        linkpath: null,
        ustar: null,
        ustarver: null,
        gname: null,
        devmaj: null,
        devmin: null,
        ustarPrefix: null,
        xstarPrefix: null,
        prefixTerminator: null
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
          onwarn: (m, p) => warnings.push([m, p])
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
            mode: 33188,
            size: 512,
            linkpath: null,
            ustar: null,
            ustarver: null,
            gname: null,
            devmaj: null,
            devmin: null,
            ustarPrefix: null,
            xstarPrefix: null,
            prefixTerminator: null
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
        cwd: files
      })
    }, { message: /stripping .* from absolute path/, data: f })
    t.end()
  })

  t.end()
})

t.throws(_ => new WriteEntry(null), new TypeError('path is required'))
