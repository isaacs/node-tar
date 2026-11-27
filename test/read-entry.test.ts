import { assert, describe, test } from 'ubqtest'
import { Header } from '../src/header.js'
import {
  EntryData,
  ReadEntry,
  ReadEntrySync,
  type BodySource,
  type BodySourceSync,
} from '../src/read-entry.js'
import { Pax } from '../src/pax.js'

const time = new Date('2016-04-01T22:00Z')
const header = (h: ConstructorParameters<typeof Header>[0] = {}) => {
  const header = new Header({
    path: 'oof.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 100,
    mtime: time,
    ctime: time,
    atime: time,
    type: 'File',
    uname: 'isaacs',
    gname: 'staff',
    ...h,
  })
  header.encode()
  return header
}

describe('EntryData', () => {
  test('the fields of the header', () => {
    const h = header({ mode: 0o104755, devmaj: 3, devmin: 4 })
    const entry = new EntryData(h)
    assert.matchOnly(entry, {
      header: h,
      extended: undefined,
      globalExtended: undefined,
      type: 'File',
      path: 'oof.txt',
      mode: 0o4755,
      uid: 24561,
      gid: 20,
      uname: 'isaacs',
      gname: 'staff',
      size: 100,
      mtime: time,
      atime: time,
      ctime: time,
      linkpath: undefined,
      devmaj: 3,
      devmin: 4,
      dev: undefined,
      ino: undefined,
      nlink: undefined,
      absolute: undefined,
      ignore: false,
      invalid: false,
      unsupported: false,
    })
  })

  test('local PAX values win over global values and the header', () => {
    const later = new Date('2020-01-01T00:00Z')
    const ex = new Pax({ path: 'foo.txt', uid: 1, mtime: later, ino: 7 })
    const gex = new Pax(
      {
        path: 'global-path',
        linkpath: 'global-link',
        uid: 2,
        gid: 3,
        uname: 'u',
        gname: 'g',
        atime: later,
        ctime: later,
        mtime: time,
        dev: 4,
        ino: 5,
        nlink: 6,
        size: 9999,
      },
      true,
    )
    const entry = new EntryData(header(), ex, gex)
    assert.match(entry, {
      extended: ex,
      globalExtended: gex,
      path: 'foo.txt',
      linkpath: undefined,
      uid: 1,
      gid: 3,
      uname: 'u',
      gname: 'g',
      atime: later,
      ctime: later,
      mtime: later,
      dev: 4,
      ino: 7,
      nlink: 6,
      // The header has the size. The entry does not read it from PAX.
      size: 100,
    })
  })

  test('an extended linkpath', () => {
    const ex = new Pax({ linkpath: 'bar.txt', path: 'foo.txt' })
    const entry = new EntryData(
      header({ type: 'SymbolicLink', size: 0, linkpath: 'short' }),
      ex,
    )
    assert.match(entry, {
      type: 'SymbolicLink',
      path: 'foo.txt',
      linkpath: 'bar.txt',
      size: 0,
    })
  })

  test('win32 changes backslashes', () => {
    const h = header({ path: 'a\\b', type: 'Link', linkpath: 'c\\d' })
    assert.match(new EntryData(h), { path: 'a\\b', linkpath: 'c\\d' })
    assert.match(new EntryData(h, undefined, undefined, true), {
      path: 'a/b',
      linkpath: 'c/d',
    })
    const ex = new Pax({ path: 'e\\f', linkpath: 'g\\h' })
    assert.match(new EntryData(h, ex, undefined, true), {
      path: 'e/f',
      linkpath: 'g/h',
    })
  })

  test('a type that is not an object of the file system is ignored', () => {
    const h = header()
    assert(h.block)
    h.block[156] = '9'.charCodeAt(0)
    assert.match(new EntryData(new Header(h.block)), {
      type: 'Unsupported',
      ignore: true,
    })
    for (const type of ['SparseFile', 'ExtendedHeader'] as const) {
      assert.equal(new EntryData(header({ type })).ignore, true, type)
    }
    for (const type of ['Directory', 'GNUDumpDir', 'FIFO'] as const) {
      assert.equal(new EntryData(header({ type })).ignore, false, type)
    }
  })

  test('no size', () => {
    const h = new Header({ path: 'x', type: 'File' })
    assert.equal(h.size, undefined)
    assert.equal(new EntryData(h).size, 0)
  })

  test('no mode', () => {
    assert.equal(
      new EntryData(header({ mode: undefined })).mode,
      undefined,
    )
    assert.equal(new EntryData(header({ mode: 0 })).mode, 0)
  })

  test('a header with no path', () => {
    assert.throws(
      () => new EntryData(new Header({ size: 1, type: 'File' })),
      {
        message: 'no path provided for tar.ReadEntry',
      },
    )
  })
})

const bytes = (s: string) => new TextEncoder().encode(s)

// A body source that has the parts in memory. `undefined` in the
// list means that the source needs more input one time.
const memory = (parts: (Uint8Array | undefined)[]) => {
  const state = { fills: 0, reads: 0 }
  const source: BodySource = {
    readBody: () => {
      state.reads++
      return parts.length ? parts.shift() : null
    },
    fill: async () => {
      state.fills++
    },
  }
  return { state, source }
}
const entry = (parts: (Uint8Array | undefined)[]) => {
  const { state, source } = memory(parts)
  const e = new ReadEntry(header(), undefined, undefined, false, source)
  return { e, state }
}
// "héllo wörld", with a character that is in two parts.
const parts = () => {
  const all = bytes('héllo wörld')
  return [
    all.subarray(0, 2),
    undefined,
    all.subarray(2, 8),
    all.subarray(8),
  ]
}
const used = {
  name: 'TypeError',
  message: 'Body has already been consumed',
}

describe('ReadEntry', () => {
  test('has the metadata', () => {
    const { e } = entry([])
    assert(e instanceof EntryData)
    assert.match(e, { path: 'oof.txt', size: 100, bodyUsed: false })
  })

  test('bytes', async () => {
    const { e, state } = entry(parts())
    const p = e.bytes()
    assert.equal(e.bodyUsed, true)
    const data = await p
    assert.deepEqual(data, bytes('héllo wörld'))
    assert.equal(state.fills, 1)
  })

  test('bytes of one part is a copy', async () => {
    const part = bytes('abc')
    const { e } = entry([part])
    const data = await e.bytes()
    assert.deepEqual(data, part)
    assert.notEqual(data.buffer, part.buffer)
  })

  test('arrayBuffer', async () => {
    const { e } = entry(parts())
    const data = await e.arrayBuffer()
    assert(data instanceof ArrayBuffer)
    assert.deepEqual(new Uint8Array(data), bytes('héllo wörld'))
  })

  test('text', async () => {
    const { e } = entry(parts())
    assert.equal(await e.text(), 'héllo wörld')
  })

  test('blob', async () => {
    const { e } = entry(parts())
    const blob = await e.blob()
    assert(blob instanceof Blob)
    assert.equal(await blob.text(), 'héllo wörld')
  })

  test('body is a stream of the parts, with no copy', async () => {
    const list = parts()
    const { e, state } = entry([...list])
    const body = e.body
    assert(body instanceof ReadableStream)
    assert.equal(e.body, body)
    // Nothing is read before the consumer reads.
    await new Promise(res => setTimeout(res, 5))
    assert.equal(state.reads, 0)
    assert.equal(e.bodyUsed, false)
    const reader = body.getReader()
    const first = await reader.read()
    assert.equal(first.value, list[0])
    assert.equal(e.bodyUsed, true)
    assert.equal(state.reads, 1)
    assert.equal((await reader.read()).value, list[2])
    assert.equal((await reader.read()).value, list[3])
    assert.deepEqual(await reader.read(), { done: true, value: undefined })
    assert.equal(state.fills, 1)
  })

  test('no source: the body is empty', async () => {
    assert.deepEqual(await new ReadEntry(header()).bytes(), bytes(''))
    assert.equal(await new ReadEntry(header()).text(), '')
    const reader = new ReadEntry(header()).body.getReader()
    assert.equal((await reader.read()).done, true)
  })

  for (const first of ['bytes', 'arrayBuffer', 'text', 'blob'] as const) {
    test(`after ${first}, no other use`, async () => {
      const { e } = entry(parts())
      await e[first]()
      await assert.rejects(e.bytes(), used)
      await assert.rejects(e.arrayBuffer(), used)
      await assert.rejects(e.text(), used)
      await assert.rejects(e.blob(), used)
      await assert.rejects(e.body.getReader().read(), used)
    })
  }

  test('after a read of body, no other use', async () => {
    const { e } = entry(parts())
    const reader = e.body.getReader()
    await reader.read()
    await assert.rejects(e.bytes(), used)
    await assert.rejects(e.text(), used)
    await assert.rejects(e.blob(), used)
    await assert.rejects(e.arrayBuffer(), used)
    // The stream continues.
    assert.equal((await reader.read()).done, false)
  })

  test('an error of the source', async () => {
    const boom = new Error('boom')
    const source: BodySource = {
      readBody: () => {
        throw boom
      },
      fill: async () => {},
    }
    const make = () =>
      new ReadEntry(header(), undefined, undefined, false, source)
    assert.equal(await assert.rejects(make().bytes(), Error), boom)
    assert.equal(
      await assert.rejects(make().body.getReader().read(), Error),
      boom,
    )
  })
})

describe('ReadEntrySync', () => {
  const entrySync = (list: Uint8Array[]) => {
    const state = { reads: 0 }
    const source: BodySourceSync = {
      readBody: () => {
        state.reads++
        return list.shift() ?? null
      },
    }
    const e = new ReadEntrySync(
      header(),
      undefined,
      undefined,
      false,
      source,
    )
    return { e, state }
  }
  const partsSync = () => parts().filter(p => p !== undefined)

  test('has the metadata', () => {
    const { e } = entrySync([])
    assert(e instanceof EntryData)
    assert.match(e, { path: 'oof.txt', size: 100, bodyUsed: false })
  })

  test('bytes, arrayBuffer, text', () => {
    assert.deepEqual(
      entrySync(partsSync()).e.bytes(),
      bytes('héllo wörld'),
    )
    const buffer = entrySync(partsSync()).e.arrayBuffer()
    assert(buffer instanceof ArrayBuffer)
    assert.deepEqual(new Uint8Array(buffer), bytes('héllo wörld'))
    assert.equal(entrySync(partsSync()).e.text(), 'héllo wörld')
  })

  test('body is an iterator of the parts, with no copy', () => {
    const list = partsSync()
    const { e, state } = entrySync([...list])
    const body = e.body
    assert.equal(e.body, body)
    assert.equal(state.reads, 0)
    assert.equal(e.bodyUsed, false)
    assert.equal(body.next().value, list[0])
    assert.equal(e.bodyUsed, true)
    assert.equal(state.reads, 1)
    assert.deepEqual([...body], list.slice(1))
  })

  test('no source: the body is empty', () => {
    assert.deepEqual(new ReadEntrySync(header()).bytes(), bytes(''))
    assert.deepEqual([...new ReadEntrySync(header()).body], [])
  })

  for (const first of ['bytes', 'arrayBuffer', 'text'] as const) {
    test(`after ${first}, no other use`, () => {
      const { e } = entrySync(partsSync())
      e[first]()
      assert.equal(e.bodyUsed, true)
      assert.throws(() => e.bytes(), used)
      assert.throws(() => e.arrayBuffer(), used)
      assert.throws(() => e.text(), used)
      assert.throws(() => e.body.next(), used)
    })
  }

  test('after a read of body, no other use', () => {
    const { e } = entrySync(partsSync())
    const body = e.body
    body.next()
    assert.throws(() => e.bytes(), used)
    assert.throws(() => e.text(), used)
    assert.equal(body.next().done, false)
  })
})
