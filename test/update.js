'use strict'
const Buffer = require('../lib/buffer.js')
const t = require('tap')
const u = require('../lib/update.js')
const path = require('path')
const fs = require('fs')
const mutateFS = require('mutate-fs')

const {resolve} = require('path')
const fixtures = path.resolve(__dirname, 'fixtures')
const tars = path.resolve(fixtures, 'tars')
const zlib = require('zlib')

const spawn = require('child_process').spawn

const data = fs.readFileSync(tars + '/body-byte-counts.tar')
const dataNoNulls = data.slice(0, data.length - 1024)
const fixtureDef = {
  'body-byte-counts.tar': data,
  'no-null-eof.tar': dataNoNulls,
  'truncated-head.tar': Buffer.concat([dataNoNulls, data.slice(0, 500)]),
  'truncated-body.tar': Buffer.concat([dataNoNulls, data.slice(0, 700)]),
  'zero.tar': Buffer.from(''),
  'empty.tar': Buffer.alloc(512),
  'compressed.tgz': zlib.gzipSync(data),
}

t.test('basic file add to archive (good or truncated)', t => {
  const check = (file, t) => {
    const c = spawn('tar', ['tf', file])
    const out = []
    c.stdout.on('data', chunk => out.push(chunk))
    c.on('close', (code, signal) => {
      t.equal(code, 0)
      t.equal(signal, null)
      const actual = Buffer.concat(out).toString().trim().split(/\r?\n/)
      t.same(actual, [
        '1024-bytes.txt',
        '512-bytes.txt',
        'one-byte.txt',
        'zero-byte.txt',
        path.basename(__filename)
      ])
      t.end()
    })
  }

  const files = [
    'body-byte-counts.tar',
    'no-null-eof.tar',
    'truncated-head.tar',
    'truncated-body.tar',
  ]
  const td = files.map(f => [f, fixtureDef[f]]).reduce((s, [k, v]) => {
    s[k] = v
    return s
  }, {})
  const fileList = [path.basename(__filename)]
  t.test('sync', t => {
    t.plan(files.length)
    const dir = t.testdir(td)
    for (const file of files) {
      t.test(file, t => {
        u({
          sync: true,
          file: resolve(dir, file),
          cwd: __dirname,
        }, fileList)
        check(resolve(dir, file), t)
      })
    }
  })

  t.test('async cb', t => {
    t.plan(files.length)
    const dir = t.testdir(td)
    for (const file of files) {
      t.test(file, t => {
        u({
          file: resolve(dir, file),
          cwd: __dirname,
        }, fileList, er => {
          if (er)
            throw er
          check(resolve(dir, file), t)
        })
      })
    }
  })

  t.test('async', t => {
    t.plan(files.length)
    const dir = t.testdir(td)
    for (const file of files) {
      t.test(file, t => {
        u({
          file: resolve(dir, file),
          cwd: __dirname,
        }, fileList).then(() => {
          check(resolve(dir, file), t)
        })
      })
    }
  })

  t.end()
})

t.test('add to empty archive', t => {
  const check = (file, t) => {
    const c = spawn('tar', ['tf', file])
    const out = []
    c.stdout.on('data', chunk => out.push(chunk))
    c.on('close', (code, signal) => {
      t.equal(code, 0)
      t.equal(signal, null)
      const actual = Buffer.concat(out).toString().trim().split(/\r?\n/)
      t.same(actual, [
        path.basename(__filename)
      ])
      t.end()
    })
  }

  const files = [
    'empty.tar',
    'zero.tar',
  ]
  const td = files.map(f => [f, fixtureDef[f]]).reduce((s, [k, v]) => {
    s[k] = v
    return s
  }, {})
  files.push('not-existing.tar')

  t.test('sync', t => {
    const dir = t.testdir(td)
    t.plan(files.length)
    for (const file of files) {
      t.test(file, t => {
        u({
          sync: true,
          file: resolve(dir, file),
          cwd: __dirname,
        }, [path.basename(__filename)])
        check(resolve(dir, file), t)
      })
    }
  })

  t.test('async cb', t => {
    const dir = t.testdir(td)
    t.plan(files.length)
    for (const file of files) {
      t.test(file, t => {
        u({
          file: resolve(dir, file),
          cwd: __dirname,
        }, [path.basename(__filename)], er => {
          if (er)
            throw er
          check(resolve(dir, file), t)
        })
      })
    }
  })

  t.test('async', async t => {
    const dir = t.testdir(td)
    t.plan(files.length)
    for (const file of files) {
      t.test(file, t => {
        u({
          file: resolve(dir, file),
          cwd: __dirname,
        }, [path.basename(__filename)]).then(() => {
          check(resolve(dir, file), t)
        })
      })
    }
  })

  t.end()
})

t.test('cannot append to gzipped archives', t => {
  const dir = t.testdir({
    'compressed.tgz': fixtureDef['compressed.tgz'],
  })
  const file = resolve(dir, 'compressed.tgz')

  const expect = new Error('cannot append to compressed archives')
  const expectT = new TypeError('cannot append to compressed archives')

  t.throws(_ => u({
    file,
    cwd: __dirname,
    gzip: true
  }, [path.basename(__filename)]), expectT)

  t.throws(_ => u({
    file,
    cwd: __dirname,
    sync: true
  }, [path.basename(__filename)]), expect)

  u({
    file,
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
  const dir = t.testdir({
    'body-byte-counts.tar': fixtureDef['body-byte-counts.tar'],
  })
  const file = resolve(dir, 'body-byte-counts.tar')
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('open', poop))
  t.throws(_ => u({ sync: true, file: file }, ['README.md']), poop)
  u({ file }, ['README.md'], er => {
    t.match(er, poop)
    t.end()
  })
})

t.test('broken fstat', t => {
  const td = {
    'body-byte-counts.tar': fixtureDef['body-byte-counts.tar'],
  }
  const poop = new Error('poop')
  t.test('sync', t => {
    const dir = t.testdir(td)
    const file = resolve(dir, 'body-byte-counts.tar')
    t.teardown(mutateFS.fail('fstat', poop))
    t.throws(_ => u({ sync: true, file }, ['README.md']), poop)
    t.end()
  })
  t.test('async', t => {
    const dir = t.testdir(td)
    const file = resolve(dir, 'body-byte-counts.tar')
    t.teardown(mutateFS.fail('fstat', poop))
    u({ file }, ['README.md'], async er => {
      t.match(er, poop)
      t.end()
    })
  })
  t.end()
})

t.test('broken read', t => {
  const dir = t.testdir({
    'body-byte-counts.tar': fixtureDef['body-byte-counts.tar'],
  })
  const file = resolve(dir, 'body-byte-counts.tar')
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('read', poop))
  t.throws(_ => u({ sync: true, file }, ['README.md']), poop)
  u({ file }, ['README.md'], er => {
    t.match(er, poop)
    t.end()
  })
})

t.test('do not add older file', t => {
  const dir = t.testdir({
    'body-byte-counts.tar': fixtureDef['body-byte-counts.tar'],
    '1024-bytes.txt': '.'.repeat(1024),
    foo: 'foo',
  })
  const file = resolve(dir, 'body-byte-counts.tar')

  const f = resolve(dir, '1024-bytes.txt')
  const oldDate = new Date('1997-04-10T16:57:47.000Z')
  fs.utimesSync(f, oldDate, oldDate)

  // file size should not change
  const expect = fixtureDef['body-byte-counts.tar'].length
  const check = t => {
    t.equal(fs.statSync(file).size, expect)
    t.end()
  }

  t.test('sync', t => {
    u({
      mtimeCache: new Map(),
      file,
      cwd: dir,
      sync: true,
      filter: path => path === '1024-bytes.txt',
    }, ['1024-bytes.txt', 'foo'])
    check(t)
  })

  t.test('async', t => {
    u({ file, cwd: dir }, ['1024-bytes.txt']).then(_ => check(t))
  })

  t.test('async cb', t => {
    u({ file, cwd: dir }, ['1024-bytes.txt'], er => {
      if (er)
        throw er
      check(t)
    })
  })

  t.end()
})

t.test('do add newer file', t => {
  const setup = t => {
    const dir = t.testdir({
      'body-byte-counts.tar': fixtureDef['body-byte-counts.tar'],
      '1024-bytes.txt': '.'.repeat(1024),
      foo: 'foo',
    })

    const f = resolve(dir, '1024-bytes.txt')
    const newDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
    fs.utimesSync(f, newDate, newDate)
    return dir
  }

  // a chunk for the header, then 2 for the body
  const expect = fixtureDef['body-byte-counts.tar'].length + 512 + 1024
  const check = (file, t) => {
    t.equal(fs.statSync(file).size, expect)
    t.end()
  }

  t.test('sync', t => {
    const dir = setup(t)
    const file = resolve(dir, 'body-byte-counts.tar')
    u({
      mtimeCache: new Map(),
      file,
      cwd: dir,
      sync: true,
      filter: path => path === '1024-bytes.txt',
    }, ['1024-bytes.txt', 'foo'])
    check(file, t)
  })

  t.test('async', t => {
    const dir = setup(t)
    const file = resolve(dir, 'body-byte-counts.tar')
    u({ file, cwd: dir }, ['1024-bytes.txt']).then(_ => check(file, t))
  })

  t.test('async cb', t => {
    const dir = setup(t)
    const file = resolve(dir, 'body-byte-counts.tar')
    u({ file, cwd: dir }, ['1024-bytes.txt'], er => {
      if (er)
        throw er
      check(file, t)
    })
  })

  t.end()
})
