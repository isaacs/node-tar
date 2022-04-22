'use strict'

const isWindows = process.platform === 'win32'
const t = require('tap')
const c = require('../lib/create.js')
const list = require('../lib/list.js')
const fs = require('fs')
const path = require('path')
const dir = path.resolve(__dirname, 'fixtures/create')
const tars = path.resolve(__dirname, 'fixtures/tars')
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const spawn = require('child_process').spawn
const Pack = require('../lib/pack.js')
const mutateFS = require('mutate-fs')
const { promisify } = require('util')

const readtar = (file, cb) => {
  const child = spawn('tar', ['tf', file])
  const out = []
  child.stdout.on('data', c => out.push(c))
  child.on('close', (code, signal) =>
    cb(code, signal, Buffer.concat(out).toString()))
}

t.teardown(() => new Promise(resolve => rimraf(dir, resolve)))

t.before(async () => {
  await promisify(rimraf)(dir)
  await mkdirp(dir)
})

t.test('no cb if sync or without file', t => {
  t.throws(_ => c({ sync: true }, ['asdf'], _ => _))
  t.throws(_ => c(_ => _))
  t.throws(_ => c({}, _ => _))
  t.throws(_ => c({}, ['asdf'], _ => _))
  t.end()
})

t.test('create file', t => {
  const files = [path.basename(__filename)]

  t.test('sync', t => {
    const file = path.resolve(dir, 'sync.tar')
    c({
      file: file,
      cwd: __dirname,
      sync: true,
    }, files)
    readtar(file, (code, signal, list) => {
      t.equal(code, 0)
      t.equal(signal, null)
      t.equal(list.trim(), 'create.js')
      t.end()
    })
  })

  t.test('async', t => {
    const file = path.resolve(dir, 'async.tar')
    c({
      file: file,
      cwd: __dirname,
    }, files, er => {
      if (er) {
        throw er
      }
      readtar(file, (code, signal, list) => {
        t.equal(code, 0)
        t.equal(signal, null)
        t.equal(list.trim(), 'create.js')
        t.end()
      })
    })
  })

  t.test('async promise only', t => {
    const file = path.resolve(dir, 'promise.tar')
    c({
      file: file,
      cwd: __dirname,
    }, files).then(_ => {
      readtar(file, (code, signal, list) => {
        t.equal(code, 0)
        t.equal(signal, null)
        t.equal(list.trim(), 'create.js')
        t.end()
      })
    })
  })

  t.test('with specific mode', t => {
    const mode = isWindows ? 0o666 : 0o740
    t.test('sync', t => {
      const file = path.resolve(dir, 'sync-mode.tar')
      c({
        mode: mode,
        file: file,
        cwd: __dirname,
        sync: true,
      }, files)
      readtar(file, (code, signal, list) => {
        t.equal(code, 0)
        t.equal(signal, null)
        t.equal(list.trim(), 'create.js')
        t.equal(fs.lstatSync(file).mode & 0o7777, mode)
        t.end()
      })
    })

    t.test('async', t => {
      const file = path.resolve(dir, 'async-mode.tar')
      c({
        mode: mode,
        file: file,
        cwd: __dirname,
      }, files, er => {
        if (er) {
          throw er
        }
        readtar(file, (code, signal, list) => {
          t.equal(code, 0)
          t.equal(signal, null)
          t.equal(list.trim(), 'create.js')
          t.equal(fs.lstatSync(file).mode & 0o7777, mode)
          t.end()
        })
      })
    })

    t.end()
  })
  t.end()
})

t.test('create', t => {
  t.type(c({ sync: true }, ['README.md']), Pack.Sync)
  t.type(c(['README.md']), Pack)
  t.end()
})

t.test('open fails', t => {
  const poop = new Error('poop')
  const file = path.resolve(dir, 'throw-open.tar')
  t.teardown(mutateFS.statFail(poop))
  t.throws(_ => c({
    file: file,
    sync: true,
    cwd: __dirname,
  }, [path.basename(__filename)]))
  t.throws(_ => fs.lstatSync(file))
  t.end()
})

t.test('gzipped tarball that makes some drain/resume stuff', t => {
  const cwd = path.dirname(__dirname)
  const out = path.resolve(dir, 'package.tgz')

  // don't include node_modules/.cache, since that gets written to
  // by nyc during tests, and can result in spurious errors.
  const entries = fs.readdirSync(`${cwd}/node_modules`)
    .filter(e => !/^\./.test(e))
    .map(e => `node_modules/${e}`)

  c({ z: true, C: cwd }, entries)
    .pipe(fs.createWriteStream(out))
    .on('finish', _ => {
      const child = spawn('tar', ['tf', out], {
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      child.stderr.on('data', c => {
        t.fail(c + '')
      })
      child.on('close', (code, signal) => {
        t.equal(code, 0)
        t.equal(signal, null)
        t.end()
      })
    })
})

t.test('create tarball out of another tarball', t => {
  const out = path.resolve(dir, 'out.tar')

  const check = t => {
    const expect = [
      'dir/',
      'Ω.txt',
      '🌟.txt',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
      'hardlink-1',
      'hardlink-2',
      'symlink',
    ]
    list({ f: out,
      sync: true,
      onentry: entry => {
        if (entry.path === 'hardlink-2') {
          t.equal(entry.type, 'Link')
        } else if (entry.path === 'symlink') {
          t.equal(entry.type, 'SymbolicLink')
        } else if (entry.path === 'dir/') {
          t.equal(entry.type, 'Directory')
        } else {
          t.equal(entry.type, 'File')
        }
        t.equal(entry.path, expect.shift())
      } })
    t.same(expect, [])
    t.end()
  }

  t.test('sync', t => {
    c({
      f: out,
      cwd: tars,
      sync: true,
    }, ['@dir.tar', '@utf8.tar', '@links.tar'])
    check(t)
  })

  t.test('async', t => {
    c({
      f: out,
      cwd: tars,
    }, ['@dir.tar', '@utf8.tar', '@links.tar'], _ => check(t))
  })

  t.end()
})
