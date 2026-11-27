import { assert, describe, test } from 'ubqtest'
import { Header } from '../src/header.js'
import { entriesSync } from '../src/entries.js'
import { ReadEntry } from '../src/read-entry.js'
import { WriteEntry, type WriteEntryData } from '../src/write-entry.js'
import { cat } from './helpers.js'

const data: Required<WriteEntryData> = {
  path: 'a/b.txt',
  type: 'File',
  mode: 0o640,
  uid: 501,
  gid: 20,
  uname: 'isaacs',
  gname: 'staff',
  size: 3,
  mtime: new Date('2016-04-01T19:00:00.000Z'),
  atime: new Date('2017-04-17T00:00:00.000Z'),
  ctime: new Date('2017-05-10T01:03:12.000Z'),
  linkpath: '',
  dev: 12,
  ino: 34,
  nlink: 1,
}

describe('constructor', () => {
  test('keeps each field of the data', () => {
    const entry = new WriteEntry(data, 'abc')
    assert.match(entry, data)
    assert.equal(entry.header, undefined)
    assert.equal(entry.absolute, undefined)
  })

  test('the default type is File, and the default size is 0', () => {
    const entry = new WriteEntry({ path: 'x' })
    assert.equal(entry.type, 'File')
    assert.equal(entry.size, 0)
    assert.equal(entry.body, undefined)
  })

  test('a string body is kept as UTF-8 bytes, and sets the size', () => {
    const entry = new WriteEntry({ path: 'x' }, 'Ω!')
    assert.deepEqual(entry.body, new Uint8Array([0xce, 0xa9, 0x21]))
    assert.equal(entry.size, 3)
  })

  test('a Uint8Array body and a Blob body set the size', () => {
    const bytes = new Uint8Array(7)
    const fromBytes = new WriteEntry({ path: 'x' }, bytes)
    assert.equal(fromBytes.body, bytes)
    assert.equal(fromBytes.size, 7)
    const blob = new Blob(['12345'])
    const fromBlob = new WriteEntry({ path: 'x' }, blob)
    assert.equal(fromBlob.body, blob)
    assert.equal(fromBlob.size, 5)
  })

  test('the size of the data wins, and a stream body gives no size', () => {
    assert.equal(new WriteEntry({ path: 'x', size: 9 }, 'abc').size, 9)
    const stream = new Blob(['abc']).stream()
    const entry = new WriteEntry({ path: 'x' }, stream)
    assert.equal(entry.size, 0)
    assert.equal(entry.body, stream)
  })

  test('a ReadEntry is the data', () => {
    const header = new Header({ ...data, linkpath: undefined })
    header.encode()
    const readEntry = new ReadEntry(header)
    const entry = new WriteEntry(readEntry)
    assert.match(entry, {
      ...data,
      linkpath: undefined,
      dev: undefined,
      ino: undefined,
      nlink: undefined,
    })
  })

  test('an unsupported type throws', () => {
    const readEntry = new ReadEntry(new Header({ path: 'x', size: 0 }))
    assert.equal(readEntry.type, 'Unsupported')
    assert.throws(() => new WriteEntry(readEntry), {
      message: 'writing entry that should be ignored',
    })
  })
})

describe('encode', () => {
  test('makes one header block, and sets header', () => {
    const entry = new WriteEntry(data, 'abc')
    const blocks = entry.encode()
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0]?.length, 512)
    assert(entry.header)
    assert.equal(entry.header.needPax, false)
    const { dev: _dev, ino: _ino, nlink: _nlink, ...fields } = data
    assert.match(new Header(blocks[0]), { ...fields, cksumValid: true })
  })

  test('writes into the block of the caller', () => {
    const block = new Uint8Array(1024)
    const blocks = new WriteEntry(data, 'abc').encode({}, block)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0], block)
    assert.match(new Header(block), { path: 'a/b.txt', cksumValid: true })
    assert.deepEqual(block.subarray(512), new Uint8Array(512))
  })

  test('a field that does not fit gets a PAX header', () => {
    const path = 'Ω/' + 'y'.repeat(200)
    const entry = new WriteEntry({ ...data, path }, 'abc')
    const blocks = entry.encode()
    assert.equal(blocks.length, 2)
    assert.equal(entry.header?.needPax, true)
    const pax = new Header(blocks[0])
    assert.equal(pax.type, 'ExtendedHeader')
    // Each field of the entry is in the PAX header.
    const body = Buffer.from(blocks[0] as Uint8Array)
      .subarray(512)
      .toString()
    for (const record of [
      ` path=${path}\n`,
      ' ctime=1494378192\n',
      ' atime=1492387200\n',
      ' SCHILY.dev=12\n',
      ' SCHILY.ino=34\n',
      ' SCHILY.nlink=1\n',
      ' gid=20\n',
      ' gname=staff\n',
      ' mtime=1459537200\n',
      ' size=3\n',
      ' uid=501\n',
      ' uname=isaacs\n',
    ]) {
      assert.contains(body, record)
    }
    // A reader gets the entry back.
    const [read] = [
      ...entriesSync(cat(...blocks, new Uint8Array(512 + 1024))),
    ]
    assert.match(read, { ...data, path })
  })

  test('noPax writes only the header', () => {
    const entry = new WriteEntry({ ...data, path: 'y'.repeat(200) })
    const blocks = entry.encode({ noPax: true })
    assert.equal(blocks.length, 1)
    assert.equal(entry.header?.needPax, true)
    // The name field has the first 99 characters.
    assert.equal(
      Buffer.from(blocks[0] as Uint8Array)
        .subarray(0, 100)
        .toString(),
      'y'.repeat(99) + '\0',
    )
  })

  describe('prefix', () => {
    for (const [prefix, path, expect] of [
      ['out/x', 'a', 'out/x/a'],
      ['out/x/', 'a', 'out/x/a'],
      ['out/x', './a', 'out/x/a'],
      ['out/x', '.', 'out/x/'],
      ['out/x', './', 'out/x/'],
      ['out/x', '.a', 'out/x/.a'],
      ['', './a', './a'],
    ] as const) {
      test(`${JSON.stringify(prefix)} and ${path}`, () => {
        const entry = new WriteEntry({ path })
        const [block] = entry.encode({ prefix })
        assert.equal(new Header(block).path, expect)
        assert.equal(entry.path, path)
      })
    }

    test('is put before the target of a hard link', () => {
      const entry = new WriteEntry({
        path: 'a',
        type: 'Link',
        linkpath: './b',
      })
      const [block] = entry.encode({ prefix: 'out' })
      assert.match(new Header(block), {
        type: 'Link',
        path: 'out/a',
        linkpath: 'out/b',
      })
      assert.equal(entry.linkpath, './b')
    })

    test('is not put before the target of a symbolic link', () => {
      const entry = new WriteEntry({
        path: 'a',
        type: 'SymbolicLink',
        linkpath: '../b',
      })
      const [block] = entry.encode({ prefix: 'out' })
      assert.match(new Header(block), { path: 'out/a', linkpath: '../b' })
    })

    test('a hard link with no target', () => {
      const entry = new WriteEntry({ path: 'a', type: 'Link' })
      const [block] = entry.encode({ prefix: 'out' })
      assert.match(new Header(block), { path: 'out/a', linkpath: '' })
    })

    test('is in the PAX header', () => {
      const long = 'y'.repeat(250)
      const entry = new WriteEntry({
        path: long,
        type: 'Link',
        linkpath: 'target',
      })
      const blocks = entry.encode({ prefix: 'out/x' })
      assert.equal(blocks.length, 2)
      const body = Buffer.from(blocks[0] as Uint8Array)
        .subarray(512)
        .toString()
      assert.contains(body, `266 path=out/x/${long}\n`)
      assert.contains(body, '25 linkpath=out/x/target\n')
    })
  })

  test('a type that does not exist throws', () => {
    const entry = new WriteEntry({ path: 'x' })
    entry.type = 'Bogus' as 'File'
    assert.throws(() => entry.encode(), TypeError)
  })

  test('a size that is not a safe integer throws', () => {
    const entry = new WriteEntry({ path: 'x', size: 2 ** 60 })
    assert.throws(() => entry.encode(), {
      message:
        'cannot encode number outside of javascript safe integer range',
    })
  })
})
