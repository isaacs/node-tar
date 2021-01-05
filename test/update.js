'use strict'
const t = require('tap')
const u = require('../lib/update.js')
const path = require('path')
const fs = require('fs')
const mkdirp = require('mkdirp')
const rimraf = require('rimraf')
const mutateFS = require('mutate-fs')

const fixtures = path.resolve(__dirname, 'fixtures')
const dir = path.resolve(fixtures, 'update')
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
      t.end()
    })
  }

  ;[file,
    fileNoNulls,
    fileTruncHead,
    fileTruncBody,
  ].forEach(file => {
    t.test(path.basename(file), t => {
      const fileList = [path.basename(__filename)]
      t.test('sync', t => {
        u({
          sync: true,
          file: file,
          cwd: __dirname,
        }, fileList)
        check(file, t)
      })

      t.test('async cb', t => {
        u({
          file: file,
          cwd: __dirname,
        }, fileList, er => {
          if (er)
            throw er
          check(file, t)
        })
      })

      t.test('async promise', t => {
        u({
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
      const fileList = [path.basename(__filename)]
      t.test('sync', t => {
        u({
          sync: true,
          file: file,
          cwd: __dirname,
        }, fileList)
        check(file, t)
      })

      t.test('async cb', t => {
        u({
          file: file,
          cwd: __dirname,
        }, fileList, er => {
          if (er)
            throw er
          check(file, t)
        })
      })

      t.test('async promise', t => {
        u({
          file: file,
          cwd: __dirname,
        }, fileList).then(_ => check(file, t))
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

  t.throws(_ => u({
    file: fileCompressed,
    cwd: __dirname,
    gzip: true,
  }, [path.basename(__filename)]), expectT)

  t.throws(_ => u({
    file: fileCompressed,
    cwd: __dirname,
    sync: true,
  }, [path.basename(__filename)]), expect)

  u({
    file: fileCompressed,
    cwd: __dirname,
  }, [path.basename(__filename)], er => {
    t.match(er, expect)
    t.end()
  })
})

t.test('other throws', t => {
  t.throws(_ => u({}, ['asdf']), new TypeError('file is required'))
  t.throws(_ => u({file: 'asdf'}, []),
    new TypeError('no files or directories specified'))
  t.end()
})

t.test('broken open', t => {
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('open', poop))
  t.throws(_ => u({ sync: true, file: file }, ['README.md']), poop)
  u({ file: file }, ['README.md'], er => {
    t.match(er, poop)
    t.end()
  })
})

t.test('broken fstat', t => {
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('fstat', poop))
  t.throws(_ => u({ sync: true, file: file }, ['README.md']), poop)
  u({ file: file }, ['README.md'], er => {
    t.match(er, poop)
    t.end()
  })
})

t.test('broken read', t => {
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('read', poop))
  t.throws(_ => u({ sync: true, file: file }, ['README.md']), poop)
  u({ file: file }, ['README.md'], er => {
    t.match(er, poop)
    t.end()
  })
})

t.test('do not add older file', t => {
  reset()

  const f = dir + '/1024-bytes.txt'
  fs.writeFileSync(f, new Array(1025).join('.'))
  const oldDate = new Date('1997-04-10T16:57:47.000Z')
  fs.utimesSync(f, oldDate, oldDate)

  const check = t => {
    t.equal(fs.statSync(file).size, 5120)
    t.end()
  }

  t.test('sync', t => {
    u({ file: file, cwd: dir, sync: true }, ['1024-bytes.txt'])
    check(t)
  })

  t.test('async', t => {
    u({ file: file, cwd: dir }, ['1024-bytes.txt']).then(_ => check(t))
  })

  t.end()
})

t.test('do add newer file', t => {
  t.beforeEach(cb => {
    reset()
    const f = dir + '/1024-bytes.txt'
    fs.writeFileSync(f, new Array(1025).join('.'))
    const newDate = new Date('2017-05-01T22:06:43.736Z')
    fs.utimesSync(f, newDate, newDate)
    cb()
  })

  const check = t => {
    t.equal(fs.statSync(file).size, 6656)
    t.end()
  }

  t.test('sync', t => {
    u({
      mtimeCache: new Map(),
      file: file,
      cwd: dir,
      sync: true,
      filter: path => path === '1024-bytes.txt',
    }, ['1024-bytes.txt', 'compressed.tgz'])
    check(t)
  })

  t.test('async', t => {
    u({ file: file, cwd: dir }, ['1024-bytes.txt']).then(_ => check(t))
  })

  t.end()
})
