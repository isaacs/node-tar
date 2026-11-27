// A changed `Object.prototype` must not set an option, or a field of
// the data of a warning.
import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { assert, cleanup, describe, test } from 'ubqtest'
import { entries, entriesSync } from '../src/entries.js'
import { list, listSync } from '../src/list.js'
import { Parser } from '../src/parser.js'
import { warn } from '../src/warn.js'
import { WriteEntry } from '../src/write-entry.js'
import {
  collect,
  create,
  createSync,
  Pack,
  PackSync,
  read,
} from './create-helpers.js'
import {
  cat,
  ent,
  EOA,
  extract,
  extractSync,
  file,
  hdr,
  longLink,
  longPath,
  parse,
  testdir,
} from './helpers.js'

/**
 * Set the values on `Object.prototype`. The result removes them. The
 * end of the test removes them also.
 */
const pollute = (values: Record<string, unknown>) => {
  const proto = Object.prototype as unknown as Record<string, unknown>
  const restore = () => {
    for (const key of Object.keys(values)) delete proto[key]
  }
  cleanup(restore)
  Object.assign(proto, values)
  return restore
}

// A block with a bad checksum, between two entries.
const bad = hdr({ path: 'bad', type: 'File' })
bad[0] = 0x78
const damaged = cat(longPath('dir\\name'), file('f'), bad, file('g'), EOA)
const truncated = cat(file('a', 'a'), hdr({ path: 'b', size: 2000 }))

describe('the data of a warning', () => {
  test('recoverable: true does not make a truncated archive recoverable', async () => {
    const cwd = testdir({})
    const expect = { message: /^TAR_BAD_ARCHIVE: Truncated input/ }
    const restore = pollute({ recoverable: true })
    const async = await assert.rejects(
      extract({ cwd, fs: nodeFsPromises, input: truncated }),
      expect,
    )
    const sync = assert.throws(
      () => extractSync({ cwd, fs: nodeFs, input: truncated }),
      expect,
    )
    restore()
    assert.match<unknown>(async, { recoverable: false })
    assert.match<unknown>(sync, { recoverable: false })
  })

  test('recoverable: false does not make a warning an error', async () => {
    const warnings: string[] = []
    const onwarn = (_: string, message: string) => warnings.push(message)
    const restore = pollute({ recoverable: false })
    warn({ onwarn }, 'TAR_X', 'direct')
    await list({ input: damaged, onwarn })
    listSync({ input: damaged, onwarn })
    restore()
    assert.deepEqual(warnings, [
      'direct',
      'checksum failure',
      'checksum failure',
    ])
  })
})

describe('the options of the readers', () => {
  const values = { strict: true, platform: 'win32', maxMetaEntrySize: 1 }
  const expect = ['dir\\name', 'g']

  test('list and listSync', async () => {
    const found: string[] = []
    const onEntry = (entry: { path: string }) => found.push(entry.path)
    const restore = pollute(values)
    await list({ input: damaged, onEntry })
    listSync({ input: damaged, onEntry })
    restore()
    assert.deepEqual(found, [...expect, ...expect])
  })

  test('entries and entriesSync', async () => {
    const found: string[] = []
    const restore = pollute({ ...values, maxDecompressionRatio: 0 })
    for await (const entry of entries(damaged)) found.push(entry.path)
    for await (const entry of entries(damaged, {})) found.push(entry.path)
    for (const entry of entriesSync(damaged)) found.push(entry.path)
    for (const entry of entriesSync(damaged, {})) found.push(entry.path)
    restore()
    assert.deepEqual(found, [...expect, ...expect, ...expect, ...expect])
  })

  test('Parser', () => {
    const restore = pollute(values)
    const defaults = new Parser()
    const { paths } = parse([damaged], { onwarn: undefined })
    restore()
    assert.equal(defaults.maxMetaEntrySize, 1024 * 1024)
    assert.deepEqual(paths, expect)
  })

  test('a GNU long name header does not get a name of the prototype', () => {
    const link = ent({ path: 'l', type: 'SymbolicLink', linkpath: 'hdr' })
    const restore = pollute({ path: 'evil', linkpath: 'evil' })
    const withLink = parse([longLink('to'), link, EOA]).entries
    const withPath = parse([longPath('from'), link, EOA]).entries
    restore()
    assert.match(withLink, [{ path: 'l', linkpath: 'to' }])
    assert.match(withPath, [{ path: 'from', linkpath: 'hdr' }])
  })
})

describe('the options of extract', () => {
  for (const mode of ['async', 'sync']) {
    test(`strict, keep, and newer: ${mode}`, async () => {
      const cwd = testdir({ f: 'old' })
      const input = cat(file('f', 'new'), bad, file('g', 'g'), EOA)
      const warnings: string[] = []
      const onwarn = (_: string, message: string) => warnings.push(message)
      const restore = pollute({ strict: true, keep: true, newer: true })
      if (mode === 'sync') {
        extractSync({ cwd, fs: nodeFs, input, onwarn })
      } else await extract({ cwd, fs: nodeFsPromises, input, onwarn })
      restore()
      assert.deepEqual(warnings, ['checksum failure'])
      assert.equal(nodeFs.readFileSync(cwd + '/f', 'utf8'), 'new')
      assert.equal(nodeFs.readFileSync(cwd + '/g', 'utf8'), 'g')
    })
  }
})

describe('the options of create', () => {
  const mtime = new Date('2020-01-02T03:04:05.000Z')
  const values = {
    strict: true,
    portable: true,
    noMtime: true,
    preservePaths: true,
    prefix: 'evil',
    gzip: true,
  }
  const entry = () =>
    new WriteEntry({ path: '/abs/x', mtime, uid: 7 }, 'x')
  const expect = [{ entry: { path: 'abs/x', mtime, uid: 7 }, body: 'x' }]

  test('create and createSync', async () => {
    const restore = pollute(values)
    const async = await collect(create({}, [entry()]))
    const sync = await collect(createSync({}, [entry()]))
    restore()
    assert.match(read(async), expect)
    assert.match(read(sync), expect)
  })

  test('Pack and PackSync', async () => {
    const restore = pollute({ ...values, jobs: -1, maxReadSize: -1 })
    const async = await collect(new Pack().add(entry()).end())
    const sync = await collect(new PackSync({}).add(entry()))
    restore()
    assert.match(read(async), expect)
    assert.match(read(sync), expect)
  })

  test('WriteEntry.encode', () => {
    const restore = pollute({ prefix: 'evil', noPax: true })
    const long = new WriteEntry({ path: 'p'.repeat(200) })
    const blocks = [long.encode(), long.encode({})]
    restore()
    // A PAX header, and then the header of the entry.
    assert.deepEqual(
      blocks.map(b => b.length),
      [2, 2],
    )
    assert.equal(long.header?.path, 'p'.repeat(200))
  })
})
