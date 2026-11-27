import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { assert, describe, test, testdir } from 'ubqtest'
import { createSync } from '../src/create.js'
import { dealias, type WithAliases } from '../src/dealias.js'
import { extractSync } from '../src/extract.js'
import type { ExtractFS, TarFS } from '../src/fs.js'
import * as core from '../src/index.js'
import { listSync } from '../src/list.js'
import * as node from '../src/node/index.js'
import { replaceSync } from '../src/replace.js'
import { updateSync } from '../src/update.js'

const run = dealias as (options: object) => Record<string, unknown>

describe('dealias', () => {
  test('each alias gives its option', () => {
    const table = {
      C: 'cwd',
      f: 'file',
      z: 'gzip',
      P: 'preservePaths',
      U: 'unlink',
      'strip-components': 'strip',
      stripComponents: 'strip',
      'keep-newer': 'newer',
      keepNewer: 'newer',
      'keep-newer-files': 'newer',
      keepNewerFiles: 'newer',
      k: 'keep',
      'keep-existing': 'keep',
      keepExisting: 'keep',
      m: 'noMtime',
      'no-mtime': 'noMtime',
      p: 'preserveOwner',
      L: 'follow',
      h: 'follow',
      onentry: 'onEntry',
      onReadEntry: 'onEntry',
    }
    for (const [alias, name] of Object.entries(table)) {
      const value = {}
      const opt = run({ [alias]: value, other: 1 })
      assert.deepEqual(Object.keys(opt).sort(), [name, 'other'].sort())
      assert.equal(opt[name], value)
    }
  })

  test('the result is a copy with no prototype', () => {
    const options = { C: 'dir', strict: true }
    const opt = run(options)
    assert.equal(Object.getPrototypeOf(opt), null)
    assert.deepEqual({ ...opt }, { cwd: 'dir', strict: true })
    assert.deepEqual(options, { C: 'dir', strict: true })
    // An inherited alias is not an option.
    assert.deepEqual({ ...run(Object.create({ C: 'dir' })) }, {})
  })

  test('an option that is set wins over its aliases', () => {
    assert.deepEqual(
      { ...run({ C: 'alias', cwd: 'name' }) },
      {
        cwd: 'name',
      },
    )
    assert.deepEqual(
      { ...run({ cwd: 'name', C: 'alias' }) },
      {
        cwd: 'name',
      },
    )
    assert.deepEqual({ ...run({ keep: false, k: true }) }, { keep: false })
    // An option with the value `undefined` is not set.
    assert.deepEqual(
      { ...run({ file: undefined, f: 'alias' }) },
      {
        file: 'alias',
      },
    )
    // An alias with the value `undefined` sets nothing.
    assert.deepEqual({ ...run({ f: undefined }) }, {})
    // The first alias in the table wins.
    assert.deepEqual({ ...run({ keepExisting: 1, k: 2 }) }, { keep: 2 })
    assert.deepEqual(
      { ...run({ k: undefined, keepExisting: 1 }) },
      {
        keep: 1,
      },
    )
  })

  test('noChmod', () => {
    assert.deepEqual({ ...run({ noChmod: false }) }, { chmod: true })
    assert.deepEqual({ ...run({ noChmod: true }) }, {})
    assert.deepEqual(
      { ...run({ noChmod: false, chmod: false }) },
      {
        chmod: false,
      },
    )
    assert.deepEqual(
      { ...run({ noChmod: true, chmod: true }) },
      {
        chmod: true,
      },
    )
  })

  test('the types of the aliases', () => {
    type Fits<T, V> = V extends T ? true : false
    type Base = { input: Uint8Array; fs: ExtractFS }
    type Extract = WithAliases<core.ExtractOptions>
    const results: [
      Fits<Extract, Base & { cwd: string }>,
      Fits<Extract, Base & { C: string; k: boolean; onentry: () => void }>,
      Fits<Extract, Base & { cwd: string; noChmod: boolean }>,
      // An alias has the type of its option.
      Fits<Extract, Base & { C: number }>,
      Fits<Extract, Base & { cwd: string; 'strip-components': string }>,
      // The core needs `cwd` or its alias.
      Fits<Extract, Base>,
      // With no `input`, it needs `file` or its alias.
      Fits<Extract, { C: string; f: string; fs: ExtractFS & TarFS }>,
      Fits<Extract, { C: string; fs: ExtractFS & TarFS }>,
      Fits<WithAliases<node.ExtractOptions>, { f: string }>,
      Fits<WithAliases<node.ExtractOptions>, { C: string }>,
      Fits<WithAliases<node.CreateOptions>, { z: { level: number } }>,
      Fits<WithAliases<node.CreateOptions>, { z: string }>,
    ] = [
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ]
    assert.equal(results.length, 12)
  })
})

// The commands take options of each type here. The test
// `the types of the aliases` checks the option types.
type Command = (options: object, files?: string[]) => unknown
type Point = { name: string; fs: object } & Record<
  'c' | 'x' | 't' | 'r' | 'u',
  Command
>
const points = [
  { name: 'core', fs: nodeFsPromises, ...core },
  {
    name: 'core, sync',
    fs: nodeFs,
    c: createSync,
    x: extractSync,
    t: listSync,
    r: replaceSync,
    u: updateSync,
  },
  { name: 'node', fs: nodeFsPromises, ...node },
  {
    name: 'node, sync',
    fs: nodeFs,
    c: node.createSync,
    x: node.extractSync,
    t: node.listSync,
    r: node.replaceSync,
    u: node.updateSync,
  },
] as Point[]

const tree = () =>
  testdir({ src: { 'a.txt': 'alpha', 'b.txt': 'beta' }, out: {} })
const paths = (file: string) => {
  const found: string[] = []
  node.listSync({ file, onEntry: entry => found.push(entry.path) })
  return found
}

describe('the commands take the aliases', () => {
  for (const { name, fs, c, x, t, r, u } of points) {
    test(`${name}: create`, async () => {
      const dir = tree()
      const f = dir + '/a.tgz'
      const codecs = node.zlibCodecs()
      await c({ fs, codecs, f, C: dir, z: { level: 1 } }, ['src/a.txt'])
      assert.deepEqual(
        [...nodeFs.readFileSync(f).subarray(0, 2)],
        [0x1f, 0x8b],
      )
      assert.deepEqual(paths(f), ['src/a.txt'])
    })

    test(`${name}: extract`, async () => {
      const dir = tree()
      const f = dir + '/a.tar'
      node.createSync({ file: f, cwd: dir }, ['src/a.txt'])
      const seen: string[] = []
      const onentry = (entry: core.EntryData) => seen.push(entry.path)
      const C = dir + '/out'
      await x({ fs, f, C, 'strip-components': 1, onentry })
      assert.equal(nodeFs.readFileSync(C + '/a.txt', 'utf8'), 'alpha')
      assert.equal(seen.length, 1)
      // `keepExisting` is `keep`: the file is not written again.
      nodeFs.writeFileSync(C + '/a.txt', 'changed')
      await x({ fs, f, C, stripComponents: 1, keepExisting: true })
      assert.equal(nodeFs.readFileSync(C + '/a.txt', 'utf8'), 'changed')
    })

    test(`${name}: list`, async () => {
      const dir = tree()
      const f = dir + '/a.tar'
      node.createSync({ file: f, cwd: dir }, ['src/a.txt', 'src/b.txt'])
      const seen: string[] = []
      const onReadEntry = (entry: core.EntryData) => seen.push(entry.path)
      await t({ fs, f, onReadEntry }, ['src/b.txt'])
      assert.deepEqual(seen, ['src/b.txt'])
    })

    test(`${name}: replace and update`, async () => {
      const dir = tree()
      const f = dir + '/a.tar'
      await r({ fs, f, C: dir }, ['src/a.txt'])
      assert.deepEqual(paths(f), ['src/a.txt'])
      // The file is not newer than its entry.
      await u({ fs, f, C: dir }, ['src/a.txt', 'src/b.txt'])
      assert.deepEqual(paths(f), ['src/a.txt', 'src/b.txt'])
      await assert.rejects(
        (async () => r({ fs, f, C: dir, z: true }, ['src/a.txt']))(),
        { message: 'cannot append to compressed archives' },
      )
    })
  }

  test('the results of create with the alias of file', async () => {
    const dir = tree()
    const f = dir + '/a.tar'
    const fs = nodeFsPromises
    const done: Promise<void> = core.c({ fs, f, C: dir }, ['src'])
    await done
    const stream: ReadableStream<Uint8Array> = node.c({ C: dir }, ['src'])
    await stream.cancel()
    const none: void = node.createSync({ f, C: dir, h: true }, ['src'])
    assert.equal(none, undefined)
    const chunks: Iterable<Uint8Array> = createSync(
      { fs: nodeFs, C: dir },
      ['src/a.txt'],
    )
    assert.equal([...chunks].length, 2)
    assert.deepEqual(paths(f), ['src/', 'src/a.txt', 'src/b.txt'])
  })
})
