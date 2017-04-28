'use strict'

const t = require('tap')
const c = require('../lib/create.js')
const fs = require('fs')
const path = require('path')
const dir = path.resolve(__dirname, 'fixtures/create')
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const spawn = require('child_process').spawn
const Pack = require('../lib/pack.js')
const mutateFS = require('mutate-fs')

const readtar = (file, cb) => {
  const child = spawn('tar', ['tf', file])
  const out = []
  child.stdout.on('data', c => out.push(c))
  child.on('close', (code, signal) =>
    cb(code, signal, Buffer.concat(out).toString()))
}

// t.teardown(_ => rimraf.sync(dir))

t.test('setup', t => {
  rimraf.sync(dir)
  mkdirp.sync(dir)
  t.end()
})

t.test('no cb on sync functions', t => {
  t.throws(_ => c({ sync: true }, ['asdf'], function () {}))
  t.throws(_ => c(function () {}))
  t.throws(_ => c({}, function () {}))
  t.end()
})

t.test('create file', t => {
  t.test('sync', t => {
    const file = path.resolve(dir, 'sync.tar')
    c({
      file: file,
      cwd: __dirname,
      sync: true
    }, [path.basename(__filename)])
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
      cwd: __dirname
    }, [path.basename(__filename)], er => {
      if (er)
        throw er
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
      cwd: __dirname
    }, [path.basename(__filename)]).then(_ => {
      readtar(file, (code, signal, list) => {
        t.equal(code, 0)
        t.equal(signal, null)
        t.equal(list.trim(), 'create.js')
        t.end()
      })
    })
  })

  t.test('with specific mode', t => {
    const mode = 0o740
    t.test('sync', t => {
      const file = path.resolve(dir, 'sync-mode.tar')
      c({
        mode: mode,
        file: file,
        cwd: __dirname,
        sync: true
      }, [path.basename(__filename)])
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
        cwd: __dirname
      }, [path.basename(__filename)], er => {
        if (er)
          throw er
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
  t.isa(c({ sync: true }, ['create.js']), Pack.Sync)
  t.isa(c(['create.js']), Pack)
  t.end()
})

t.test('open fails', t => {
  const poop = new Error('poop')
  const file = path.resolve(dir, 'throw-open.tar')
  t.tearDown(mutateFS.statFail(poop))
  t.throws(_ => c({
    file: file,
    sync: true,
    cwd: __dirname
  }, [ path.basename(__filename) ]))
  t.throws(_ => fs.lstatSync(file))
  t.end()
})
