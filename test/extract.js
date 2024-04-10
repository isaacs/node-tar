import t from 'tap'
import nock from 'nock'
import { extract as x } from '../dist/esm/extract.js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import { mkdirp } from 'mkdirp'
import { rimraf } from 'rimraf'
import { pipeline as PL } from 'stream'
import { Unpack, UnpackSync } from '../dist/esm/unpack.js'
const pipeline = promisify(PL)
import http from 'http'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const extractdir = path.resolve(__dirname, 'fixtures/extract')
const tars = path.resolve(__dirname, 'fixtures/tars')
import mutateFS from 'mutate-fs'

const tnock = (t, host, opts) => {
  nock.disableNetConnect()
  const server = nock(host, opts)
  t.teardown(function () {
    nock.enableNetConnect()
    server.done()
  })
  return server
}

t.teardown(() => rimraf(extractdir))

t.test('basic extracting', t => {
  const file = path.resolve(tars, 'utf8.tar')
  const dir = path.resolve(extractdir, 'basic')

  t.beforeEach(async () => {
    await rimraf(dir)
    await mkdirp(dir)
  })

  const check = async t => {
    fs.lstatSync(dir + '/Ω.txt')
    fs.lstatSync(dir + '/🌟.txt')
    t.throws(() =>
      fs.lstatSync(
        dir +
          '/long-path/r/e/a/l/l/y/-/d/e/e/p/-' +
          '/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
      ),
    )

    await rimraf(dir)
  }

  const files = ['🌟.txt', 'Ω.txt']
  t.test('sync', t => {
    x({ file: file, sync: true, C: dir }, files)
    return check(t)
  })

  t.test('async promisey', async t => {
    await x({ file: file, cwd: dir }, files)
    return check(t)
  })

  t.test('async cb', async t => {
    await x({ file: file, cwd: dir }, files, er => {
      if (er) {
        throw er
      }
      return check(t)
    })
  })

  t.end()
})

t.test('ensure an open stream is not prematurely closed', t => {
  t.plan(1)

  const file = path.resolve(tars, 'long-paths.tar')
  const dir = t.testdir({})

  t.beforeEach(async () => {
    await rimraf(dir)
    await mkdirp(dir)
  })

  const check = async t => {
    t.ok(fs.lstatSync(dir + '/long-path'))
    await rimraf(dir)
    t.end()
  }

  t.test('async promisey', async t => {
    const stream = fs.createReadStream(file, {
      highWaterMark: 1,
    })
    await pipeline(stream, x({ cwd: dir }))
    return check(t)
  })

  t.end()
})

t.test('ensure an open stream is not prematuraly closed http', t => {
  t.plan(1)

  const file = path.resolve(tars, 'long-paths.tar')
  const dir = path.resolve(extractdir, 'basic-with-stream-http')

  t.beforeEach(async () => {
    await rimraf(dir)
    await mkdirp(dir)
  })

  const check = async t => {
    t.ok(fs.lstatSync(dir + '/long-path'))
    await rimraf(dir)
    t.end()
  }

  t.test('async promisey', t => {
    tnock(t, 'http://codeload.github.com/')
      .get('/npm/node-tar/tar.gz/main')
      .delay(250)
      .reply(200, () => fs.createReadStream(file))

    http.get(
      'http://codeload.github.com/npm/node-tar/tar.gz/main',
      async stream => {
        await pipeline(stream, x({ cwd: dir }))
        return check(t)
      },
    )
  })

  t.end()
})

t.test('file list and filter', t => {
  const file = path.resolve(tars, 'utf8.tar')
  const dir = path.resolve(extractdir, 'filter')

  t.beforeEach(async () => {
    await rimraf(dir)
    await mkdirp(dir)
  })

  const check = async t => {
    fs.lstatSync(dir + '/Ω.txt')
    t.throws(() => fs.lstatSync(dir + '/🌟.txt'))
    t.throws(() =>
      fs.lstatSync(
        dir +
          '/long-path/r/e/a/l/l/y/-/d/e/e/p/-' +
          '/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
      ),
    )

    await rimraf(dir)
  }

  const filter = path => path === 'Ω.txt'

  t.test('sync', t => {
    x({ filter: filter, file: file, sync: true, C: dir }, [
      '🌟.txt',
      'Ω.txt',
    ])
    return check(t)
  })

  t.test('async promisey', async t => {
    await x({ filter: filter, file: file, cwd: dir }, [
      '🌟.txt',
      'Ω.txt',
    ])
    check(t)
  })

  t.test('async cb', t => {
    return x(
      { filter: filter, file: file, cwd: dir },
      ['🌟.txt', 'Ω.txt'],
      er => {
        if (er) {
          throw er
        }
        return check(t)
      },
    )
  })

  t.end()
})

t.test('no file list', t => {
  const file = path.resolve(tars, 'body-byte-counts.tar')
  const dir = path.resolve(extractdir, 'no-list')

  t.beforeEach(async () => {
    await rimraf(dir)
    await mkdirp(dir)
  })

  const check = async t => {
    t.equal(
      fs.lstatSync(path.resolve(dir, '1024-bytes.txt')).size,
      1024,
    )
    t.equal(
      fs.lstatSync(path.resolve(dir, '512-bytes.txt')).size,
      512,
    )
    t.equal(fs.lstatSync(path.resolve(dir, 'one-byte.txt')).size, 1)
    t.equal(fs.lstatSync(path.resolve(dir, 'zero-byte.txt')).size, 0)
    await rimraf(dir)
  }

  t.test('sync', t => {
    x({ file: file, sync: true, C: dir })
    return check(t)
  })

  t.test('async promisey', async t => {
    await x({ file: file, cwd: dir })
    return check(t)
  })

  t.test('async cb', t => {
    return x({ file: file, cwd: dir }, er => {
      if (er) {
        throw er
      }
      return check(t)
    })
  })

  t.end()
})

t.test('read in itty bits', t => {
  const maxReadSize = 1000
  const file = path.resolve(tars, 'body-byte-counts.tar')
  const dir = path.resolve(extractdir, 'no-list')

  t.beforeEach(async () => {
    await rimraf(dir)
    await mkdirp(dir)
  })

  const check = async t => {
    t.equal(
      fs.lstatSync(path.resolve(dir, '1024-bytes.txt')).size,
      1024,
    )
    t.equal(
      fs.lstatSync(path.resolve(dir, '512-bytes.txt')).size,
      512,
    )
    t.equal(fs.lstatSync(path.resolve(dir, 'one-byte.txt')).size, 1)
    t.equal(fs.lstatSync(path.resolve(dir, 'zero-byte.txt')).size, 0)
    await rimraf(dir)
  }

  t.test('sync', t => {
    x({ file: file, sync: true, C: dir, maxReadSize: maxReadSize })
    return check(t)
  })

  t.test('async promisey', async t => {
    await x({ file: file, cwd: dir, maxReadSize: maxReadSize })
    return check(t)
  })

  t.test('async cb', t => {
    return x(
      { file: file, cwd: dir, maxReadSize: maxReadSize },
      er => {
        if (er) {
          throw er
        }
        return check(t)
      },
    )
  })

  t.end()
})

t.test('bad calls', t => {
  t.throws(() => x(() => {}))
  t.throws(() => x({ sync: true }, () => {}))
  t.throws(() => x({ sync: true }, [], () => {}))
  t.end()
})

t.test('no file', t => {
  t.type(x(), Unpack)
  t.type(x(['asdf']), Unpack)
  t.type(x({ sync: true }), UnpackSync)
  t.end()
})

t.test('nonexistent', t => {
  t.throws(() => x({ sync: true, file: 'does not exist' }))
  x({ file: 'does not exist' }).catch(() => t.end())
})

t.test('read fail', t => {
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('read', poop))

  t.throws(
    () => x({ maxReadSize: 10, sync: true, file: __filename }),
    poop,
  )
  t.end()
})

t.test('sync gzip error edge case test', async t => {
  const file = path.resolve(__dirname, 'fixtures/sync-gzip-fail.tgz')
  const dir = path.resolve(__dirname, 'sync-gzip-fail')
  const cwd = process.cwd()
  await mkdirp(dir + '/x')
  process.chdir(dir)
  t.teardown(async () => {
    process.chdir(cwd)
    await rimraf(dir)
  })

  x({
    sync: true,
    file: file,
    onwarn: (c, m, er) => {
      throw er
    },
  })

  t.same(fs.readdirSync(dir + '/x').sort(), [
    '1',
    '10',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
  ])

  t.end()
})

t.test('brotli', async t => {
  const file = path.resolve(__dirname, 'fixtures/example.tbr')
  const dir = path.resolve(__dirname, 'brotli')

  t.beforeEach(async () => {
    await mkdirp(dir)
  })

  t.afterEach(async () => {
    await rimraf(dir)
  })

  t.test('fails if unknown file extension', async t => {
    const filename = path.resolve(__dirname, 'brotli/example.unknown')
    const f = fs.openSync(filename, 'a')
    fs.closeSync(f)

    const expect = new Error(
      'TAR_BAD_ARCHIVE: Unrecognized archive format',
    )

    t.throws(() => x({ sync: true, file: filename }), expect)
  })

  t.test('succeeds based on file extension', t => {
    x({ sync: true, file: file, C: dir })

    t.same(fs.readdirSync(dir + '/x').sort(), [
      '1',
      '10',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ])
    t.end()
  })

  t.test('succeeds when passed explicit option', t => {
    x({ sync: true, file: file, C: dir, brotli: true })

    t.same(fs.readdirSync(dir + '/x').sort(), [
      '1',
      '10',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ])
    t.end()
  })
})

t.test('verify long linkname is not a problem', async t => {
  // See: https://github.com/isaacs/node-tar/issues/312
  const file = path.resolve(__dirname, 'fixtures/long-linkname.tar')
  t.test('sync', t => {
    x({ sync: true, strict: true, file, C: t.testdir({}) })
    t.ok(fs.lstatSync(t.testdirName + '/test').isSymbolicLink())
    t.end()
  })
  t.test('async', async t => {
    await x({ file, C: t.testdir({}), strict: true })
    t.ok(fs.lstatSync(t.testdirName + '/test').isSymbolicLink())
  })
})
