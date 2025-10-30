import fs, { readFileSync, Stats } from 'fs'
//@ts-ignore
import mutateFS from 'mutate-fs'
import { dirname, resolve } from 'path'
import t, { Test } from 'tap'
import { fileURLToPath } from 'url'
import { list } from '../dist/esm/list.js'
import { Parser } from '../dist/esm/parse.js'
import { ReadEntry } from '../dist/esm/read-entry.js'
import { makeTar } from './fixtures/make-tar.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const lp = JSON.parse(
  readFileSync(__dirname + '/fixtures/parse/long-paths.json', 'utf8'),
) as (
  | ['meta', string]
  | ['entry', Record<string, any>]
  | ['nullBlock' | 'eof' | 'end']
)[]

t.test('basic', t => {
  const file = resolve(__dirname, 'fixtures/tars/long-paths.tar')
  const expect = (lp as any[])
    .filter(e => Array.isArray(e) && e[0] === 'entry')
    .map((e: ['entry', Record<string, any>]) => e[1].path as string)

  const check = (actual: string[], t: Test) => {
    t.same(actual, expect)
    return Promise.resolve(null)
  }

  ;[1000, undefined].forEach(maxReadSize => {
    t.test('file maxReadSize=' + maxReadSize, t => {
      t.test('sync', t => {
        const actual: string[] = []
        const onReadEntry = (entry: ReadEntry) =>
          actual.push(entry.path)
        list({
          file: file,
          sync: true,
          onReadEntry,
          maxReadSize,
        })
        return check(actual, t)
      })

      t.test('async promise', async t => {
        const actual: string[] = []
        const onReadEntry = (entry: ReadEntry) =>
          actual.push(entry.path)
        return await list({
          file,
          onReadEntry,
          maxReadSize,
        }).then(() => check(actual, t))
      })

      t.test('async cb', t => {
        const actual: string[] = []
        const onReadEntry = (entry: ReadEntry) =>
          actual.push(entry.path)
        list(
          {
            file: file,
            onReadEntry: onReadEntry,
            maxReadSize: maxReadSize,
          },
          (er?: Error) => {
            if (er) {
              throw er
            }
            check(actual, t)
            t.end()
          },
        )
      })
      t.end()
    })
  })

  t.test('stream', t => {
    t.test('sync', t => {
      const actual: string[] = []
      const onReadEntry = (entry: ReadEntry) =>
        actual.push(entry.path)
      const l = list({ sync: true, onReadEntry })
      l.end(fs.readFileSync(file))
      return check(actual, t)
    })

    t.test('async', t => {
      const actual: string[] = []
      const onReadEntry = (entry: ReadEntry) =>
        actual.push(entry.path)
      const l = list()
      l.on('entry', onReadEntry)
      l.on('end', _ => check(actual, t).then(_ => t.end()))
      fs.createReadStream(file).pipe(l)
    })
    t.end()
  })

  t.test('no onReadEntry function', () => list({ file: file }))

  t.test('limit to specific files', t => {
    const fileList = [
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t',
      '170-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc///',
    ]

    const expect = [
      '170-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
    ]

    t.test('no filter function', async t => {
      const check = () => t.same(actual, expect)
      const actual: string[] = []
      return list(
        {
          file: file,
          onReadEntry: entry => actual.push(entry.path),
        },
        fileList,
      ).then(check)
    })

    t.test('no filter function, stream', t => {
      const check = () => t.same(actual, expect)
      const actual: string[] = []
      const onReadEntry = (entry: ReadEntry) =>
        actual.push(entry.path)
      fs.createReadStream(file).pipe(
        list(fileList)
          .on('entry', onReadEntry)
          .on('end', _ => {
            check()
            t.end()
          }),
      )
    })

    t.test('filter function', async t => {
      const check = () => t.same(actual, expect.slice(0, 1))
      const actual: string[] = []
      return list(
        {
          file: file,
          filter: path => path === expect[0],
          onReadEntry: entry => actual.push(entry.path),
        },
        fileList,
      ).then(check)
    })

    return t.test('list is unmunged', t => {
      t.same(fileList, [
        'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t',
        '170-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc///',
      ])
      t.end()
    })
  })

  t.end()
})

t.test('bad args', t => {
  t.throws(
    () => list({ file: __filename, sync: true }, () => {}),
    new TypeError('callback not supported for sync tar functions'),
  )
  t.throws(
    () => list({}, () => {}),
    new TypeError('callback only supported with file option'),
  )
  t.end()
})

t.test('stat fails', t => {
  const poop = new Error('poop')
  t.teardown(mutateFS.statFail(poop))
  t.test('sync', t => {
    t.plan(1)
    t.throws(() => list({ file: __filename, sync: true }), poop)
  })
  t.test('cb', t => {
    t.plan(1)
    list({ file: __filename }, er => t.equal(er, poop))
  })
  t.test('promise', t => {
    t.plan(1)
    list({ file: __filename }).catch(er => t.equal(er, poop))
  })
  t.end()
})

t.test('read fail', t => {
  t.test('sync', t => {
    const poop = new Error('poop')
    t.teardown(mutateFS.fail('read', poop))
    t.plan(1)
    t.throws(
      () =>
        list({
          file: __filename,
          sync: true,
          maxReadSize: 10,
        }),
      poop,
    )
  })
  t.test('cb', t => {
    const poop = new Error('poop')
    t.teardown(mutateFS.fail('read', poop))
    t.plan(1)
    list({ file: __filename }, er => t.equal(er, poop))
  })
  t.test('promise', t => {
    const poop = new Error('poop')
    t.teardown(mutateFS.fail('read', poop))
    t.plan(1)
    list({ file: __filename }).catch(er => t.equal(er, poop))
  })
  t.end()
})

t.test('noResume option', t => {
  const file = resolve(__dirname, 'fixtures/tars/file.tar')
  t.test('sync', t => {
    let e!: ReadEntry
    list({
      file: file,
      onReadEntry: entry => {
        e = entry
        process.nextTick(() => {
          t.notOk(entry.flowing)
          entry.resume()
        })
      },
      sync: true,
      noResume: true,
    })
    t.ok(e)
    t.notOk(e.flowing)
    e.on('end', () => t.end())
  })

  t.test('async', t =>
    list({
      file: file,
      onReadEntry: entry => {
        process.nextTick(() => {
          t.notOk(entry.flowing)
          entry.resume()
        })
      },
      noResume: true,
    }),
  )

  t.end()
})

t.test('typechecks', t => {
  const p = list()
  //@ts-expect-error
  p.then
  t.type(p, Parser)
  t.end()
})

// GHSA-29xp-372q-xqph
t.test('reduce file size while synchronously reading', async t => {
  const data = makeTar([
    {
      type: 'File',
      path: 'a',
      size: 1,
    },
    'a',
    {
      type: 'File',
      path: 'b',
      size: 1,
    },
    'b',
    '',
    '',
  ])
  const dataLen = data.byteLength
  const truncLen = 512 * 2
  const truncData = data.subarray(0, truncLen)

  const setup = async (t: Test) => {
    const dir = t.testdir({ 'file.tar': data })
    const file = resolve(dir, 'file.tar')
    const { list } = await t.mockImport<
      typeof import('../src/list.js')
    >('../src/list.js', {
      'node:fs': t.createMock(fs, {
        fstatSync: (fd: number): Stats => {
          const st = fs.fstatSync(fd)
          // truncate the file before we have a chance to read
          fs.writeFileSync(file, truncData)
          return st
        },
      }),
    })

    return { file, list }
  }

  t.test(
    'gutcheck, reading normally reads the whole file',
    async t => {
      const dir = t.testdir({ 'file.tar': data })
      const file = resolve(dir, 'file.tar')
      const entries: string[] = []
      list({
        file,
        sync: true,
        maxReadSize: dataLen + 1,
        onReadEntry: e => entries.push(e.path),
      })
      t.strictSame(entries, ['a', 'b'])

      entries.length = 0
      list({
        file,
        sync: true,
        maxReadSize: dataLen - 1,
        onReadEntry: e => entries.push(e.path),
      })
      t.strictSame(entries, ['a', 'b'])
    },
  )

  t.test('read in one go', async t => {
    const { file, list } = await setup(t)
    const entries: string[] = []
    list({
      file,
      sync: true,
      maxReadSize: dataLen + 1,
      onReadEntry: e => entries.push(e.path),
    })
    t.strictSame(entries, ['a'])
  })

  t.test('read in parts', async t => {
    const { file, list } = await setup(t)
    const entries: string[] = []
    list({
      file,
      sync: true,
      maxReadSize: dataLen / 4,
      onReadEntry: e => entries.push(e.path),
    })
    t.strictSame(entries, ['a'])
  })
})
