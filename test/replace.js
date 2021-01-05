'use strict'
const t = require('tap')
const r = require('../lib/replace.js')
const path = require('path')
const fs = require('fs')
const mkdirp = require('mkdirp')
const rimraf = require('rimraf')
const mutateFS = require('mutate-fs')
const list = require('../lib/list.js')

const fixtures = path.resolve(__dirname, 'fixtures')
const dir = path.resolve(fixtures, 'replace')
const tars = path.resolve(fixtures, 'tars')
const file = dir + '/body-byte-counts.tar'
const fileNoNulls = dir + '/no-null-eof.tar'
const fileTruncHead = dir + '/truncated-head.tar'
const fileTruncBody = dir + '/truncated-body.tar'
const fileNonExistent = dir + '/does-not-exist.tar'
const fileZeroByte = dir + '/zero.tar'
const fileEmpty = dir + '/empty.tar'
const fileCompressed = dir + '/compressed.tgz'
const zlib = require('zlib')

const spawn = require('child_process').spawn

t.teardown(_ => rimraf.sync(dir))

const reset = cb => {
  rimraf.sync(dir)
  mkdirp.sync(dir)
  const data = fs.readFileSync(tars + '/body-byte-counts.tar')
  fs.writeFileSync(file, data)

  const dataNoNulls = data.slice(0, data.length - 1024)
  fs.writeFileSync(fileNoNulls, dataNoNulls)

  const dataTruncHead = Buffer.concat([dataNoNulls, data.slice(0, 500)])
  fs.writeFileSync(fileTruncHead, dataTruncHead)

  const dataTruncBody = Buffer.concat([dataNoNulls, data.slice(0, 700)])
  fs.writeFileSync(fileTruncBody, dataTruncBody)

  fs.writeFileSync(fileZeroByte, '')
  fs.writeFileSync(fileEmpty, Buffer.alloc(1024))

  fs.writeFileSync(fileCompressed, zlib.gzipSync(data))

  if (cb)
    cb()
}

t.test('setup', t => {
  reset(t.end)
})

t.test('basic file add to archive (good or truncated)', t => {
  t.beforeEach(reset)

  const check = (file, t) => {
    const c = spawn('tar', ['tf', file], { stdio: [0, 'pipe', 2] })
    const out = []
    c.stdout.on('data', chunk => out.push(chunk))
    c.on('close', (code, signal) => {
      t.equal(code, 0)
      t.equal(signal, null)
      const actual = Buffer.concat(out).toString().trim().split('\n')
      t.same(actual, [
        '1024-bytes.txt',
        '512-bytes.txt',
        'one-byte.txt',
        'zero-byte.txt',
        path.basename(__filename),
      ])
      t.end()
    })
  }

  ;[file,
    fileNoNulls,
    fileTruncHead,
    fileTruncBody,
  ].forEach(file => {
    const fileList = [path.basename(__filename)]
    t.test(path.basename(file), t => {
      t.test('sync', t => {
        r({
          sync: true,
          file: file,
          cwd: __dirname,
        }, fileList)
        check(file, t)
      })

      t.test('async cb', t => {
        r({
          file: file,
          cwd: __dirname,
        }, fileList, er => {
          if (er)
            throw er
          check(file, t)
        })
      })

      t.test('async promise', t => {
        r({
          file: file,
          cwd: __dirname,
        }, fileList).then(_ => check(file, t))
      })

      t.end()
    })
  })

  t.end()
})

t.test('add to empty archive', t => {
  t.beforeEach(reset)

  const check = (file, t) => {
    const c = spawn('tar', ['tf', file])
    const out = []
    c.stdout.on('data', chunk => out.push(chunk))
    c.on('close', (code, signal) => {
      t.equal(code, 0)
      t.equal(signal, null)
      const actual = Buffer.concat(out).toString().trim().split('\n')
      t.same(actual, [
        path.basename(__filename),
      ])
      t.end()
    })
  }

  ;[fileNonExistent,
    fileEmpty,
    fileZeroByte,
  ].forEach(file => {
    t.test(path.basename(file), t => {
      t.test('sync', t => {
        r({
          sync: true,
          file: file,
          cwd: __dirname,
        }, [path.basename(__filename)])
        check(file, t)
      })

      t.test('async cb', t => {
        r({
          file: file,
          cwd: __dirname,
        }, [path.basename(__filename)], er => {
          if (er)
            throw er
          check(file, t)
        })
      })

      t.test('async promise', t => {
        r({
          file: file,
          cwd: __dirname,
        }, [path.basename(__filename)]).then(_ => check(file, t))
      })

      t.end()
    })
  })

  t.end()
})

t.test('cannot append to gzipped archives', t => {
  reset()

  const expect = new Error('cannot append to compressed archives')
  const expectT = new TypeError('cannot append to compressed archives')

  t.throws(_ => r({
    file: fileCompressed,
    cwd: __dirname,
    gzip: true,
  }, [path.basename(__filename)]), expectT)

  t.throws(_ => r({
    file: fileCompressed,
    cwd: __dirname,
    sync: true,
  }, [path.basename(__filename)]), expect)

  r({
    file: fileCompressed,
    cwd: __dirname,
  }, [path.basename(__filename)], er => {
    t.match(er, expect)
    t.end()
  })
})

t.test('other throws', t => {
  t.throws(_ => r({}, ['asdf']), new TypeError('file is required'))
  t.throws(_ => r({file: 'asdf'}, []),
    new TypeError('no files or directories specified'))
  t.end()
})

t.test('broken open', t => {
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('open', poop))
  t.throws(_ => r({ sync: true, file: file }, ['README.md']), poop)
  r({ file: file }, ['README.md'], er => {
    t.match(er, poop)
    t.end()
  })
})

t.test('broken fstat', t => {
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('fstat', poop))
  t.throws(_ => r({ sync: true, file: file }, ['README.md']), poop)
  r({ file: file }, ['README.md'], er => {
    t.match(er, poop)
    t.end()
  })
})

t.test('broken read', t => {
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('read', poop))
  t.throws(_ => r({ sync: true, file: file }, ['README.md']), poop)
  r({ file: file }, ['README.md'], er => {
    t.match(er, poop)
    t.end()
  })
})

t.test('mtime cache', t => {
  t.beforeEach(reset)

  let mtimeCache

  const check = (file, t) => {
    const c = spawn('tar', ['tf', file])
    const out = []
    c.stdout.on('data', chunk => out.push(chunk))
    c.on('close', (code, signal) => {
      t.equal(code, 0)
      t.equal(signal, null)
      const actual = Buffer.concat(out).toString().trim().split('\n')
      t.same(actual, [
        '1024-bytes.txt',
        '512-bytes.txt',
        'one-byte.txt',
        'zero-byte.txt',
        path.basename(__filename),
      ])
      const mtc = {}
      mtimeCache.forEach((v, k) => mtc[k] = mtimeCache.get(k).toISOString())
      t.same(mtc, {
        '1024-bytes.txt': '2017-04-10T16:57:47.000Z',
        '512-bytes.txt': '2017-04-10T17:08:55.000Z',
        'one-byte.txt': '2017-04-10T16:58:20.000Z',
        'zero-byte.txt': '2017-04-10T17:08:01.000Z',
      })
      t.end()
    })
  }

  t.test('sync', t => {
    r({
      sync: true,
      file: file,
      cwd: __dirname,
      mtimeCache: mtimeCache = new Map(),
    }, [path.basename(__filename)])
    check(file, t)
  })

  t.test('async cb', t => {
    r({
      file: file,
      cwd: __dirname,
      mtimeCache: mtimeCache = new Map(),
    }, [path.basename(__filename)], er => {
      if (er)
        throw er
      check(file, t)
    })
  })

  t.test('async promise', t => {
    r({
      file: file,
      cwd: __dirname,
      mtimeCache: mtimeCache = new Map(),
    }, [path.basename(__filename)]).then(_ => check(file, t))
  })

  t.end()
})

t.test('create tarball out of another tarball', t => {
  const out = path.resolve(dir, 'out.tar')

  t.beforeEach(cb => {
    fs.writeFile(out, fs.readFileSync(path.resolve(tars, 'dir.tar')), cb)
  })

  const check = t => {
    const expect = [
      'dir/',
      'Ω.txt',
      '🌟.txt',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
    ]
    list({ f: out,
      sync: true,
      onentry: entry => {
        t.equal(entry.path, expect.shift())
      }})
    t.same(expect, [])
    t.end()
  }

  t.test('sync', t => {
    r({
      f: out,
      cwd: tars,
      sync: true,
    }, ['@utf8.tar'])
    check(t)
  })

  t.test('async', t => {
    r({
      f: out,
      cwd: tars,
    }, ['@utf8.tar'], _ => check(t))
  })

  t.end()
})
