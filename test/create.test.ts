import { spawn } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import { assert, describe, mockImport, test, testdir } from 'ubqtest'
import { c, list, Pack, PackSync } from '../src/index.js'

const isWindows = process.platform === 'win32'
const __filename = import.meta.filename
const __dirname = import.meta.dirname
const tars = path.resolve(__dirname, 'fixtures/tars')
const self = path.basename(__filename)

// Run the system tar command to list an archive.
const readtar = async (file: string) => {
  const child = spawn('tar', ['tf', file])
  const out: Buffer[] = []
  const err: Buffer[] = []
  child.stdout.on('data', c => out.push(c))
  child.stderr.on('data', c => err.push(c))
  const [code, signal] = await new Promise<
    [number | null, NodeJS.Signals | null]
  >(res => child.on('close', (code, signal) => res([code, signal])))
  return {
    code,
    signal,
    list: Buffer.concat(out).toString(),
    stderr: Buffer.concat(err).toString(),
  }
}

test('no cb if sync or without file', () => {
  //@ts-expect-error
  assert.throws(() => c({ sync: true }, ['asdf'], () => {}), {
    name: 'TypeError',
    message: 'callback not supported for sync tar functions',
  })
  //@ts-expect-error
  assert.throws(() => c(() => {}), {
    name: 'TypeError',
    message: 'no paths specified to add to archive',
  })
  assert.throws(() => c({}, () => {}), {
    name: 'TypeError',
    message: 'no paths specified to add to archive',
  })
  assert.throws(() => c({}, ['asdf'], () => {}), {
    name: 'TypeError',
    message: 'callback only supported with file option',
  })
})

describe('create file', () => {
  const mode = isWindows ? 0o666 : 0o740

  // The ways to call create() with a file. Each one resolves when the
  // archive is complete.
  const cases: [
    name: string,
    run: (file: string, mode?: number) => Promise<void>,
  ][] = [
    [
      'sync',
      async (file, mode) =>
        c({ mode, file, cwd: __dirname, sync: true }, [self]),
    ],
    [
      'async',
      (file, mode) =>
        new Promise<void>((res, rej) =>
          c({ mode, file, cwd: __dirname }, [self], er =>
            er ? rej(er) : res(),
          ),
        ),
    ],
  ]

  const check = async (file: string) => {
    const { code, signal, list } = await readtar(file)
    assert.equal(code, 0)
    assert.equal(signal, null)
    assert.equal(list.trim(), self)
  }

  for (const [name, run] of cases) {
    test(name, async () => {
      const file = path.resolve(testdir(), 'out.tar')
      await run(file)
      await check(file)
    })

    test(`with specific mode ${name}`, async () => {
      const file = path.resolve(testdir(), 'out.tar')
      await run(file, mode)
      await check(file)
      assert.equal(fs.lstatSync(file).mode & 0o7777, mode)
    })
  }

  test('async promise only', async () => {
    const file = path.resolve(testdir(), 'out.tar')
    await c({ file, cwd: __dirname }, [self])
    await check(file)
  })
})

test('create', () => {
  const ps = c({ sync: true }, ['README.md'])
  assert.equal(ps.sync, true)
  assert(ps instanceof PackSync)
  const p = c(['README.md'])
  //@ts-expect-error
  p.then
  p.sync
  assert(c(['README.md']) instanceof Pack)
})

test('open fails', async () => {
  const poop = new Error('poop')
  const file = path.resolve(testdir(), 'throw-open.tar')
  const syncFail = () => {
    throw poop
  }
  const mocked = {
    ...fs,
    openSync: syncFail,
    statSync: syncFail,
    lstatSync: syncFail,
    fstatSync: syncFail,
  }
  // The file streams of @isaacs/fs-minipass open the output file.
  const fsm = await mockImport(
    () => import('@isaacs/fs-minipass'),
    [
      [
        () => import('node:fs'),
        { ...mocked, default: mocked } as unknown as typeof fs,
      ],
    ],
  )
  const { create } = await mockImport(
    () => import('../src/create.js'),
    [[() => import('@isaacs/fs-minipass'), fsm]],
  )
  const er = assert.throws(
    () => create({ file, sync: true, cwd: __dirname }, [self]),
    Error,
  )
  assert.equal(er, poop)
  assert.throws(() => fs.lstatSync(file), { code: 'ENOENT' })
})

test(
  'gzipped tarball that makes some drain/resume stuff',
  { timeout: 120_000 },
  async () => {
    const cwd = path.dirname(__dirname)
    const out = path.resolve(testdir(), 'package.tgz')

    // Do not include node_modules/.cache and other dot folders. Tools
    // write to them while the tests run.
    const entries = fs
      .readdirSync(`${cwd}/node_modules`)
      .filter(e => !/^[@.]/.test(e))
      .map(e => `node_modules/${e}`)

    const stream = c({ z: true, C: cwd }, entries)

    const outStream = fs.createWriteStream(out)
    outStream.on('drain', () => {
      stream.resume()
    })

    await new Promise<void>((res, rej) => {
      stream.on('error', rej)
      stream.pipe(outStream).on('error', rej).on('finish', res)
    })
    assert.matchOnly(await readtar(out), {
      code: 0,
      signal: null,
      list: /^node_modules\//,
      stderr: '',
    })
  },
)

describe('create tarball out of another tarball', () => {
  const files = ['@dir.tar', '@utf8.tar', '@links.tar']

  const check = (out: string) => {
    const actual: [path: string, type: string][] = []
    list({
      f: out,
      sync: true,
      onReadEntry: entry => actual.push([entry.path, entry.type]),
    })
    assert.deepEqual(actual, [
      ['dir/', 'Directory'],
      ['Ω.txt', 'File'],
      ['🌟.txt', 'File'],
      [
        'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
        'File',
      ],
      ['hardlink-1', 'File'],
      ['hardlink-2', 'Link'],
      ['symlink', 'SymbolicLink'],
    ])
  }

  test('sync', () => {
    const out = path.resolve(testdir(), 'out.tar')
    c({ f: out, cwd: tars, sync: true }, files)
    check(out)
  })

  test('async', async () => {
    const out = path.resolve(testdir(), 'out.tar')
    await c({ f: out, cwd: tars }, files)
    check(out)
  })
})

test('must specify some files', () => {
  assert.throws(() => c({}), {
    name: 'TypeError',
    message: 'no paths specified to add to archive',
  })
})

describe('error from @ file entry should be catchable', () => {
  test('async with file option', async () => {
    const file = path.resolve(testdir(), 'at-error-file.tar')
    await assert.rejects(
      c({ file, cwd: __dirname }, ['@nonexistent.tar']),
      { code: 'ENOENT' },
    )
  })

  test('async without file option', async () => {
    const stream = c({ cwd: __dirname }, ['@nonexistent.tar'])
    const er = await new Promise<unknown>(res => {
      stream.on('error', res)
      stream.resume()
    })
    assert.match(er, { code: 'ENOENT' })
  })
})

test('transform a filename', async () => {
  const cwd = testdir({
    'README.md': 'hello, world',
  })
  const data = await c(
    {
      cwd,
      onWriteEntry: entry => {
        entry.path = 'bloorg.md'
      },
      sync: true,
    },
    ['README.md'],
  ).concat()
  assert.equal(
    data.subarray(0, 'bloorg.md'.length).toString(),
    'bloorg.md',
  )
})
