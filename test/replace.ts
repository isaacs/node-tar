import t, { Test } from 'tap'
import { replace as r } from '../dist/esm/replace.js'
import path, { dirname, resolve } from 'path'
import fs from 'fs'
//@ts-ignore
import mutateFS from 'mutate-fs'
import { list } from '../dist/esm/list.js'
import { fileURLToPath } from 'url'
import zlib from 'zlib'
import { spawn } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixtures = path.resolve(__dirname, 'fixtures')
const tars = path.resolve(fixtures, 'tars')

const data = fs.readFileSync(tars + '/body-byte-counts.tar')
const dataNoNulls = data.subarray(0, data.length - 1024)
const fixtureDef = {
  'body-byte-counts.tar': data,
  'no-null-eof.tar': dataNoNulls,
  'truncated-head.tar': Buffer.concat([
    dataNoNulls,
    data.subarray(0, 500),
  ]),
  'truncated-body.tar': Buffer.concat([
    dataNoNulls,
    data.subarray(0, 700),
  ]),
  'zero.tar': Buffer.from(''),
  'empty.tar': Buffer.alloc(512),
  'compressed.tgz': zlib.gzipSync(data),
  'compressed.tbr': zlib.brotliCompressSync(data),
  'compressed.tzst': zlib.zstdCompressSync(data),
}

t.test('basic file add to archive (good or truncated)', t => {
  const check = (file: string, t: Test) => {
    const c = spawn('tar', ['tf', file], { stdio: [0, 'pipe', 2] })
    const out: Buffer[] = []
    c.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    c.on('close', (code, signal) => {
      t.equal(code, 0)
      t.equal(signal, null)
      const actual = Buffer.concat(out)
        .toString()
        .trim()
        .split(/\r?\n/)
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

  const files: (keyof typeof fixtureDef)[] = [
    'body-byte-counts.tar',
    'no-null-eof.tar',
    'truncated-head.tar',
    'truncated-body.tar',
  ]
  const td = Object.fromEntries(files.map(f => [f, fixtureDef[f]]))
  const fileList = [path.basename(__filename)]
  t.test('sync', t => {
    t.plan(files.length)
    const dir = t.testdir(td)
    for (const file of files) {
      t.test(file, t => {
        r(
          {
            sync: true,
            file: resolve(dir, file),
            cwd: __dirname,
          },
          fileList,
        )
        check(resolve(dir, file), t)
      })
    }
  })

  t.test('async cb', t => {
    t.plan(files.length)
    const dir = t.testdir(td)
    for (const file of files) {
      t.test(file, t => {
        r(
          {
            file: resolve(dir, file),
            cwd: __dirname,
          },
          fileList,
          er => {
            if (er) {
              throw er
            }
            check(resolve(dir, file), t)
          },
        )
      })
    }
  })

  t.test('async', t => {
    t.plan(files.length)
    const dir = t.testdir(td)
    for (const file of files) {
      t.test(file, t => {
        r(
          {
            file: resolve(dir, file),
            cwd: __dirname,
          },
          fileList,
        ).then(() => {
          check(resolve(dir, file), t)
        })
      })
    }
  })

  t.end()
})

t.test('add to empty archive', t => {
  const check = (file: string, t: Test) => {
    const c = spawn('tar', ['tf', file])
    const out: Buffer[] = []
    c.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    c.on('close', (code, signal) => {
      t.equal(code, 0)
      t.equal(signal, null)
      const actual = Buffer.concat(out).toString().trim().split('\n')
      t.same(actual, [path.basename(__filename)])
      t.end()
    })
  }

  const files: (keyof typeof fixtureDef)[] = ['empty.tar', 'zero.tar']
  const td = Object.fromEntries(files.map(f => [f, fixtureDef[f]]))
  //@ts-ignore
  files.push('not-existing.tar')

  t.test('sync', t => {
    const dir = t.testdir(td)
    t.plan(files.length)
    for (const file of files) {
      t.test(file, t => {
        r(
          {
            sync: true,
            file: resolve(dir, file),
            cwd: __dirname,
          },
          [path.basename(__filename)],
        )
        check(resolve(dir, file), t)
      })
    }
  })

  t.test('async cb', t => {
    const dir = t.testdir(td)
    t.plan(files.length)
    for (const file of files) {
      t.test(file, t => {
        r(
          {
            file: resolve(dir, file),
            cwd: __dirname,
          },
          [path.basename(__filename)],
          er => {
            if (er) {
              throw er
            }
            check(resolve(dir, file), t)
          },
        )
      })
    }
  })

  t.test('async', async t => {
    const dir = t.testdir(td)
    t.plan(files.length)
    for (const file of files) {
      t.test(file, t => {
        r(
          {
            file: resolve(dir, file),
            cwd: __dirname,
          },
          [path.basename(__filename)],
        ).then(() => {
          check(resolve(dir, file), t)
        })
      })
    }
  })

  t.end()
})

t.test('cannot append to gzipped archives', async t => {
  const dir = t.testdir({
    'compressed.tgz': fixtureDef['compressed.tgz'],
  })
  const file = resolve(dir, 'compressed.tgz')

  const expect = new Error('cannot append to compressed archives')
  const expectT = new TypeError(
    'cannot append to compressed archives',
  )

  t.throws(
    () =>
      r(
        {
          file,
          cwd: __dirname,
          gzip: true,
        },
        [path.basename(__filename)],
      ),
    expectT,
  )

  t.throws(
    () =>
      r(
        {
          file,
          cwd: __dirname,
          sync: true,
        },
        [path.basename(__filename)],
      ),
    expect,
  )

  return r(
    {
      file,
      cwd: __dirname,
    },
    [path.basename(__filename)],
    er => t.match(er, expect),
  )
})

t.test('cannot append to brotli compressed archives', async t => {
  const dir = t.testdir({
    'compressed.tbr': fixtureDef['compressed.tbr'],
  })
  const file = resolve(dir, 'compressed.tbr')

  const expect = new Error('cannot append to compressed archives')
  const expectT = new TypeError(
    'cannot append to compressed archives',
  )

  t.throws(
    () =>
      r(
        {
          file,
          cwd: __dirname,
          brotli: true,
        },
        [path.basename(__filename)],
      ),
    expectT,
  )

  t.throws(
    () =>
      r(
        {
          file,
          cwd: __dirname,
          sync: true,
        },
        [path.basename(__filename)],
      ),
    expect,
  )

  t.end()
})

t.test('cannot append to zstd compressed archives', async t => {
  const dir = t.testdir({
    'compressed.tbr': fixtureDef['compressed.tzst'],
  })
  const file = resolve(dir, 'compressed.tzst')

  const expect = new Error('cannot append to compressed archives')
  const expectT = new TypeError(
    'cannot append to compressed archives',
  )

  t.throws(
    () =>
      r(
        {
          file,
          cwd: __dirname,
          zstd: true,
        },
        [path.basename(__filename)],
      ),
    expectT,
  )

  t.end()
})

t.test('other throws', t => {
  t.throws(() => r({}, ['asdf']), new TypeError('file is required'))
  t.throws(
    () => r({ file: 'asdf' }, []),
    new TypeError('no paths specified to add/replace'),
  )
  t.end()
})

t.test('broken open', t => {
  const dir = t.testdir({
    'body-byte-counts.tar': fixtureDef['body-byte-counts.tar'],
  })
  const file = resolve(dir, 'body-byte-counts.tar')
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('open', poop))
  t.throws(() => r({ sync: true, file }, ['README.md']), poop)
  r({ file }, ['README.md'], er => {
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
    t.throws(() => r({ sync: true, file }, ['README.md']), poop)
    t.end()
  })
  t.test('async', t => {
    const dir = t.testdir(td)
    const file = resolve(dir, 'body-byte-counts.tar')
    t.teardown(mutateFS.fail('fstat', poop))
    r({ file }, ['README.md'], async er => {
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
  t.throws(() => r({ sync: true, file }, ['README.md']), poop)
  r({ file }, ['README.md'], er => {
    t.match(er, poop)
    t.end()
  })
})

t.test('mtime cache', async t => {
  const td = {
    'body-byte-counts.tar': fixtureDef['body-byte-counts.tar'],
  }

  let mtimeCache: Map<string, Date>

  const check = (file: string, t: Test) => {
    const c = spawn('tar', ['tf', file])
    const out: Buffer[] = []
    c.stdout.on('data', chunk => out.push(chunk))
    c.on('close', (code, signal) => {
      t.equal(code, 0)
      t.equal(signal, null)
      const actual = Buffer.concat(out)
        .toString()
        .trim()
        .split(/\r?\n/)
      t.same(actual, [
        '1024-bytes.txt',
        '512-bytes.txt',
        'one-byte.txt',
        'zero-byte.txt',
        path.basename(__filename),
      ])
      const mtc: Record<string, string> = {}
      mtimeCache.forEach(
        (_v, k) => (mtc[k] = mtimeCache.get(k)!.toISOString()),
      )
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
    const dir = t.testdir(td)
    const file = resolve(dir, 'body-byte-counts.tar')
    r(
      {
        sync: true,
        file,
        cwd: __dirname,
        mtimeCache: (mtimeCache = new Map()),
      },
      [path.basename(__filename)],
    )
    check(file, t)
  })

  t.test('async cb', t => {
    const dir = t.testdir(td)
    const file = resolve(dir, 'body-byte-counts.tar')
    r(
      {
        file,
        cwd: __dirname,
        mtimeCache: (mtimeCache = new Map()),
      },
      [path.basename(__filename)],
      er => {
        if (er) {
          throw er
        }
        check(file, t)
      },
    )
  })

  t.test('async promise', t => {
    const dir = t.testdir(td)
    const file = resolve(dir, 'body-byte-counts.tar')
    r(
      {
        file,
        cwd: __dirname,
        mtimeCache: (mtimeCache = new Map()),
      },
      [path.basename(__filename)],
    ).then(_ => check(file, t))
  })

  t.end()
})

t.test('create tarball out of another tarball', t => {
  const td = {
    'out.tar': fs.readFileSync(path.resolve(tars, 'dir.tar')),
  }

  const check = (out: string, t: Test) => {
    const expect = [
      'dir/',
      'Ω.txt',
      '🌟.txt',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
    ]
    list({
      f: out,
      sync: true,
      onReadEntry: entry => {
        t.equal(entry.path, expect.shift())
      },
    })
    t.same(expect, [])
    t.end()
  }

  t.test('sync', t => {
    const dir = t.testdir(td)
    const out = resolve(dir, 'out.tar')
    r(
      {
        f: out,
        cwd: tars,
        sync: true,
      },
      ['@utf8.tar'],
    )
    check(out, t)
  })

  t.test('async cb', t => {
    const dir = t.testdir(td)
    const out = resolve(dir, 'out.tar')
    r(
      {
        f: out,
        cwd: tars,
      },
      ['@utf8.tar'],
      er => {
        if (er) {
          throw er
        }
        check(out, t)
      },
    )
  })

  t.test('async', t => {
    const dir = t.testdir(td)
    const out = resolve(dir, 'out.tar')
    r(
      {
        f: out,
        cwd: tars,
      },
      ['@utf8.tar'],
    ).then(() => check(out, t))
  })

  t.end()
})
