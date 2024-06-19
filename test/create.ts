import t, { Test } from 'tap'
import { c, list, Pack, PackSync } from '../dist/esm/index.js'
import fs from 'fs'
import path from 'path'
import { rimraf } from 'rimraf'
import { mkdirp } from 'mkdirp'
//@ts-ignore
import mutateFS from 'mutate-fs'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const isWindows = process.platform === 'win32'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, 'fixtures/create')
const tars = path.resolve(__dirname, 'fixtures/tars')

const readtar = (
  file: string,
  cb: (
    code: number | null,
    signal: null | NodeJS.Signals,
    output: string,
  ) => any,
) => {
  const child = spawn('tar', ['tf', file])
  const out: Buffer[] = []
  child.stdout.on('data', c => out.push(c))
  child.on('close', (code, signal) =>
    cb(code, signal, Buffer.concat(out).toString()),
  )
}

t.teardown(() => rimraf(dir))

t.before(async () => {
  await rimraf(dir)
  await mkdirp(dir)
})

t.test('no cb if sync or without file', t => {
  //@ts-expect-error
  t.throws(() => c({ sync: true }, ['asdf'], () => {}))
  //@ts-expect-error
  t.throws(() => c(() => {}))
  t.throws(() => c({}, () => {}))
  t.throws(() => c({}, ['asdf'], () => {}))
  t.end()
})

t.test('create file', t => {
  const files = [path.basename(__filename)]

  t.test('sync', t => {
    const file = path.resolve(dir, 'sync.tar')
    c(
      {
        file: file,
        cwd: __dirname,
        sync: true,
      },
      files,
    )
    readtar(file, (code, signal, list) => {
      t.equal(code, 0)
      t.equal(signal, null)
      t.equal(list.trim(), 'create.ts')
      t.end()
    })
  })

  t.test('async', t => {
    const file = path.resolve(dir, 'async.tar')
    c(
      {
        file: file,
        cwd: __dirname,
      },
      files,
      er => {
        if (er) {
          throw er
        }
        readtar(file, (code, signal, list) => {
          t.equal(code, 0)
          t.equal(signal, null)
          t.equal(list.trim(), 'create.ts')
          t.end()
        })
      },
    )
  })

  t.test('async promise only', t => {
    const file = path.resolve(dir, 'promise.tar')
    c(
      {
        file: file,
        cwd: __dirname,
      },
      files,
    ).then(() => {
      readtar(file, (code, signal, list) => {
        t.equal(code, 0)
        t.equal(signal, null)
        t.equal(list.trim(), 'create.ts')
        t.end()
      })
    })
  })

  t.test('with specific mode', t => {
    const mode = isWindows ? 0o666 : 0o740
    t.test('sync', t => {
      const file = path.resolve(dir, 'sync-mode.tar')
      c(
        {
          mode: mode,
          file: file,
          cwd: __dirname,
          sync: true,
        },
        files,
      )
      readtar(file, (code, signal, list) => {
        t.equal(code, 0)
        t.equal(signal, null)
        t.equal(list.trim(), 'create.ts')
        t.equal(fs.lstatSync(file).mode & 0o7777, mode)
        t.end()
      })
    })

    t.test('async', t => {
      const file = path.resolve(dir, 'async-mode.tar')
      c(
        {
          mode: mode,
          file: file,
          cwd: __dirname,
        },
        files,
        er => {
          if (er) {
            throw er
          }
          readtar(file, (code, signal, list) => {
            t.equal(code, 0)
            t.equal(signal, null)
            t.equal(list.trim(), 'create.ts')
            t.equal(fs.lstatSync(file).mode & 0o7777, mode)
            t.end()
          })
        },
      )
    })

    t.end()
  })
  t.end()
})

t.test('create', t => {
  const ps = c({ sync: true }, ['README.md'])
  t.equal(ps.sync, true)
  t.type(ps, PackSync)
  const p = c(['README.md'])
  //@ts-expect-error
  p.then
  //@ts-expect-error
  p.sync
  t.type(c(['README.md']), Pack)

  t.end()
})

t.test('open fails', t => {
  const poop = new Error('poop')
  const file = path.resolve(dir, 'throw-open.tar')
  t.teardown(mutateFS.statFail(poop))
  t.throws(() =>
    c(
      {
        file: file,
        sync: true,
        cwd: __dirname,
      },
      [path.basename(__filename)],
    ),
  )
  t.throws(() => fs.lstatSync(file))
  t.end()
})

t.test('gzipped tarball that makes some drain/resume stuff', t => {
  const cwd = path.dirname(__dirname)
  const out = path.resolve(dir, 'package.tgz')

  // don't include node_modules/.cache, since that gets written to
  // by nyc during tests, and can result in spurious errors.
  const entries = fs
    .readdirSync(`${cwd}/node_modules`)
    .filter(e => !/^[@.]/.test(e))
    .map(e => `node_modules/${e}`)

  const stream = c({ z: true, C: cwd }, entries)

  const outStream = fs.createWriteStream(out)
  outStream.on('drain', () => {
    stream.resume()
  })

  stream.pipe(outStream).on('finish', () => {
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

  const check = (t: Test) => {
    const expect = [
      'dir/',
      'Ω.txt',
      '🌟.txt',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
      'hardlink-1',
      'hardlink-2',
      'symlink',
    ]
    list({
      f: out,
      sync: true,
      onReadEntry: entry => {
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
      },
    })
    t.same(expect, [])
    t.end()
  }

  t.test('sync', t => {
    c(
      {
        f: out,
        cwd: tars,
        sync: true,
      },
      ['@dir.tar', '@utf8.tar', '@links.tar'],
    )
    check(t)
  })

  t.test('async', async t => {
    await c(
      {
        f: out,
        cwd: tars,
      },
      ['@dir.tar', '@utf8.tar', '@links.tar'],
    )
    check(t)
  })

  t.end()
})

t.test('must specify some files', t => {
  t.throws(() => c({}), 'no paths specified to add to archive')
  t.end()
})
