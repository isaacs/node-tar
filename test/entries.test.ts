import fs from 'node:fs'
import { resolve } from 'node:path'
import zlib from 'node:zlib'
import { assert, describe, test } from 'ubqtest'
import type { Codec } from '../src/codec.js'
import {
  entries,
  entriesSync,
  EntryCursor,
  TarReader,
  TarReaderSync,
} from '../src/entries.js'
import type {
  ReadOptions,
  ReadOptionsSync,
  TarInput,
  TarInputSync,
} from '../src/options.js'
import { Parser } from '../src/parser.js'
import { ReadEntry, ReadEntrySync } from '../src/read-entry.js'
import {
  cat,
  chunked,
  countedSource,
  ent,
  EOA,
  file,
  hdr,
  longPath,
  pax,
  xorCodec,
  xorCompress,
  type Warning,
} from './helpers.js'

const big = 'b'.repeat(2000)
const tar = cat(
  file('a.txt', 'alpha'),
  ent({ path: 'dir/', type: 'Directory' }),
  file('dir/big', big),
  longPath('long/' + 'n'.repeat(150)),
  file('short', 'λ long'),
  pax([['path', 'paxed']]),
  ent({ path: 'l', type: 'SymbolicLink', linkpath: 'a.txt' }),
  EOA,
)
const expect = [
  ['a.txt', 'File', 'alpha'],
  ['dir/', 'Directory', ''],
  ['dir/big', 'File', big],
  ['long/' + 'n'.repeat(150), 'File', 'λ long'],
  ['paxed', 'SymbolicLink', ''],
]
const notCurrent = {
  name: 'TypeError',
  message: 'The body of an entry cannot be read after a later entry',
}

const readAll = async (input: TarInput, opt?: ReadOptions) => {
  const found: string[][] = []
  for await (const entry of entries(input, opt)) {
    assert(entry instanceof ReadEntry)
    found.push([entry.path, entry.type, await entry.text()])
  }
  return found
}
const readAllSync = (input: TarInputSync, opt?: ReadOptionsSync) => {
  const found: string[][] = []
  for (const entry of entriesSync(input, opt)) {
    assert(entry instanceof ReadEntrySync)
    found.push([entry.path, entry.type, entry.text()])
  }
  return found
}
async function* generate(chunks: Uint8Array[]) {
  yield* chunks
}
const stream = (chunks: Uint8Array[]) => {
  const state = { canceled: false }
  let i = 0
  const readable = new ReadableStream<Uint8Array>({
    pull: controller => {
      const chunk = chunks[i++]
      if (chunk) controller.enqueue(chunk)
      else controller.close()
    },
    cancel: () => {
      state.canceled = true
    },
  })
  return { readable, state }
}

describe('async input', () => {
  for (const [name, input] of [
    ['Uint8Array', () => tar],
    ['Buffer', () => Buffer.from(tar)],
    ['ArrayBuffer', () => tar.slice().buffer],
    ['Blob', () => new Blob([tar])],
    ['ReadableStream', () => stream(chunked(tar, 700)).readable],
    ['async iterable', () => generate(chunked(tar, 1000))],
    [
      'async iterable, one byte at a time',
      () => generate(chunked(tar, 1)),
    ],
    ['iterable', () => chunked(tar, 512)],
    ['empty chunks', () => [new Uint8Array(0), tar, new Uint8Array(0)]],
    ['gzip', () => zlib.gzipSync(tar)],
    ['gzip Blob', () => new Blob([zlib.gzipSync(tar)])],
    [
      'gzip, one byte at a time',
      () => generate(chunked(zlib.gzipSync(tar), 1)),
    ],
    ['gzip iterable', () => chunked(zlib.gzipSync(tar), 100)],
  ] as [string, () => TarInput][]) {
    test(name, async () => {
      assert.deepEqual(await readAll(input()), expect)
    })
  }

  test('a file stream of Node', async () => {
    const path = resolve(import.meta.dirname, './fixtures/tars/utf8.tar')
    const paths: string[] = []
    for await (const entry of entries(fs.createReadStream(path))) {
      paths.push(entry.path)
    }
    assert.deepEqual(paths, [
      'Ω.txt',
      '🌟.txt',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt',
    ])
  })

  test('no data', async () => {
    const warnings: Warning[] = []
    const onwarn = (code: string, message: string) =>
      warnings.push([code, message])
    assert.deepEqual(await readAll([], { onwarn }), [])
    assert.deepEqual(await readAll(new Uint8Array(0), { onwarn }), [])
    const unrecognized: Warning = [
      'TAR_BAD_ARCHIVE',
      'Unrecognized archive format',
    ]
    assert.deepEqual(warnings, [unrecognized, unrecognized])
  })
})

describe('sync input', () => {
  for (const [name, input] of [
    ['Uint8Array', () => tar],
    ['ArrayBuffer', () => tar.slice().buffer],
    ['iterable', () => chunked(tar, 700)],
    ['iterable, one byte at a time', () => chunked(tar, 1)],
    ['empty chunks', () => [new Uint8Array(0), tar, new Uint8Array(0)]],
  ] as [string, () => TarInputSync][]) {
    test(name, () => {
      assert.deepEqual(readAllSync(input()), expect)
    })
  }

  test('no data', () => {
    const warnings: string[] = []
    const onwarn = (_: string, message: string) => warnings.push(message)
    assert.deepEqual(readAllSync([], { onwarn }), [])
    assert.deepEqual(warnings, ['Unrecognized archive format'])
  })
})

describe('options', () => {
  const opt = (warnings: Warning[]) => ({
    filter: (path: string, entry: { type: string }) =>
      entry.type === 'File' && path !== 'a.txt',
    onwarn: (code: string, message: string) =>
      warnings.push([code, message]),
    platform: 'win32' as const,
    maxMetaEntrySize: 100,
  })
  const data = cat(tar.subarray(0, tar.length - 1024), file('w\\x'))
  const expect = [
    ['dir/big', 'File', big],
    ['short', 'File', 'λ long'],
    ['w/x', 'File', ''],
  ]
  // The last entry has no end marker after it, and that is valid.
  test('async', async () => {
    const warnings: Warning[] = []
    assert.deepEqual(await readAll(data, opt(warnings)), expect)
    assert.deepEqual(warnings, [])
  })
  test('sync', () => {
    const warnings: Warning[] = []
    assert.deepEqual(readAllSync(data, opt(warnings)), expect)
    assert.deepEqual(warnings, [])
  })

  const bad = cat(file('a'), file('b').fill(1, 0, 1), file('c'), EOA)
  const warning: Warning = ['TAR_ENTRY_INVALID', 'checksum failure']
  test('a warning, async', async () => {
    const warnings: Warning[] = []
    const found = await readAll(bad, opt(warnings))
    assert.deepEqual(found, [
      ['a', 'File', ''],
      ['c', 'File', ''],
    ])
    assert.deepEqual(warnings, [warning])
  })
  test('a warning, sync', () => {
    const warnings: Warning[] = []
    assert.equal(readAllSync(bad, opt(warnings)).length, 2)
    assert.deepEqual(warnings, [warning])
  })
  test('strict, async: the error ends the iteration', async () => {
    const { source, state } = countedSource(chunked(bad, 512))
    const it = entries(source, { strict: true, file: 'bad.tar' })
    assert.match(await it.next(), { value: { path: 'a' } })
    await assert.rejects(it.next(), {
      message: 'TAR_ENTRY_INVALID: checksum failure',
      tarCode: 'TAR_ENTRY_INVALID',
      file: 'bad.tar',
    })
    assert.equal(state.returned, 1)
    assert.deepEqual(await it.next(), { value: undefined, done: true })
    assert.equal(state.pulls, 2)
  })
  test('strict, sync: the error ends the iteration', () => {
    let returned = 0
    function* source() {
      try {
        yield* chunked(bad, 512)
      } finally {
        returned++
      }
    }
    const it = entriesSync(source(), { strict: true })
    assert.match(it.next(), { value: { path: 'a' } })
    assert.throws(() => it.next(), {
      message: 'TAR_ENTRY_INVALID: checksum failure',
    })
    assert.equal(returned, 1)
    assert.deepEqual(it.next(), { value: undefined, done: true })
  })
})

describe('body, async', () => {
  test('each way to read a body', async () => {
    const it = entries(tar)
    const a = (await it.next()).value
    assert(a)
    assert.deepEqual(await a.bytes(), new Uint8Array(Buffer.from('alpha')))
    const dir = (await it.next()).value
    assert(dir)
    assert.equal((await dir.arrayBuffer()).byteLength, 0)
    const bigEntry = (await it.next()).value
    assert(bigEntry)
    const parts: Uint8Array[] = []
    for await (const part of bigEntry.body) parts.push(part)
    assert.equal(Buffer.concat(parts).toString(), big)
    // The parts are views into the input.
    assert(parts.every(p => p.buffer === tar.buffer))
    const long = (await it.next()).value
    assert(long)
    assert.equal(await (await long.blob()).text(), 'λ long')
    await it.next()
    assert.deepEqual(await it.next(), { value: undefined, done: true })
  })

  test('a body that is not read is skipped', async () => {
    const paths: string[] = []
    for await (const entry of entries(generate(chunked(tar, 100)))) {
      paths.push(entry.path)
    }
    assert.deepEqual(paths, paths)
  })

  test('the rest of a body that is read in part is skipped', async () => {
    const it = entries(generate(chunked(tar, 600)))
    await it.next()
    await it.next()
    const bigEntry = (await it.next()).value
    assert(bigEntry)
    const reader = bigEntry.body.getReader()
    const first = await reader.read()
    assert.equal(first.value?.length, 352)
    const next = (await it.next()).value
    assert(next)
    assert.equal(await next.text(), 'λ long')
    await assert.rejects(reader.read(), notCurrent)
  })

  test('no read of a body after the next entry', async () => {
    const it = entries(tar)
    const a = (await it.next()).value
    assert(a)
    const body = a.body
    const dir = (await it.next()).value
    assert(dir)
    assert.equal(a.bodyUsed, false)
    await assert.rejects(body.getReader().read(), notCurrent)
    // An entry with no body is at its end when the iterator gives it.
    assert.equal(await dir.text(), '')
    await assert.rejects(dir.text(), /already been consumed/)
    const bigEntry = (await it.next()).value
    assert(bigEntry)
    await it.next()
    await assert.rejects(bigEntry.bytes(), notCurrent)
    await assert.rejects(bigEntry.text(), /already been consumed/)
  })

  test('no read of a body after its end, or after return', async () => {
    const it = entries(tar)
    const a = (await it.next()).value
    assert(a)
    const body = a.body
    assert.equal(await a.text(), 'alpha')
    await assert.rejects(body.getReader().read(), /already been consumed/)
    await it.next()
    const bigEntry = (await it.next()).value
    assert(bigEntry)
    assert.deepEqual(await it.return?.(), { value: undefined, done: true })
    await assert.rejects(bigEntry.bytes(), notCurrent)
    assert.deepEqual(await it.next(), { value: undefined, done: true })
  })

  test('a body read that waits for input when the next entry is read', async () => {
    const it = entries(generate(chunked(tar, 600)))
    await it.next()
    await it.next()
    const bigEntry = (await it.next()).value
    assert(bigEntry)
    const reader = bigEntry.body.getReader()
    await reader.read()
    const [read, next] = await Promise.allSettled([
      reader.read(),
      it.next(),
    ])
    assert.match(read, { status: 'rejected', reason: notCurrent })
    assert.match(next, {
      status: 'fulfilled',
      value: { value: { path: 'long/' + 'n'.repeat(150) } },
    })
  })

  test('a truncated body', async () => {
    const warnings: string[] = []
    const cut = tar.subarray(0, 2600)
    const found = await readAll(generate(chunked(cut, 512)), {
      onwarn: (_, message) => warnings.push(message),
    })
    assert.deepEqual(found, [
      ...expect.slice(0, 2),
      ['dir/big', 'File', big.slice(0, 552)],
    ])
    assert.deepEqual(warnings, [
      'Truncated input (needed 1536 more bytes, only 40 available)',
    ])
  })

  test('strict: an error in a body read', async () => {
    const it = entries(tar.subarray(0, 2600), { strict: true })
    await it.next()
    await it.next()
    const bigEntry = (await it.next()).value
    assert(bigEntry)
    await assert.rejects(bigEntry.bytes(), { tarCode: 'TAR_BAD_ARCHIVE' })
  })
})

describe('body, sync', () => {
  test('each way to read a body', () => {
    const it = entriesSync(tar)
    const a = it.next().value
    assert(a)
    assert.deepEqual(a.bytes(), new Uint8Array(Buffer.from('alpha')))
    const dir = it.next().value
    assert(dir)
    assert.equal(dir.arrayBuffer().byteLength, 0)
    const bigEntry = it.next().value
    assert(bigEntry)
    const parts = [...bigEntry.body]
    assert.equal(Buffer.concat(parts).toString(), big)
    assert(parts.every(p => p.buffer === tar.buffer))
    const long = it.next().value
    assert(long)
    assert.equal(long.text(), 'λ long')
  })

  test('a body in many chunks', () => {
    const it = entriesSync(chunked(tar, 100))
    it.next()
    it.next()
    const bigEntry = it.next().value
    assert(bigEntry)
    const parts = [...bigEntry.body]
    assert.equal(parts.length, 21)
    assert.equal(Buffer.concat(parts).toString(), big)
  })

  test('a body that is not read is skipped', () => {
    const paths = [...entriesSync(chunked(tar, 100))].map(e => e.path)
    assert.deepEqual(paths, paths)
  })

  test('no read of a body after the next entry, or after return', () => {
    const it = entriesSync(chunked(tar, 600))
    const a = it.next().value
    assert(a)
    it.next()
    const bigEntry = it.next().value
    assert(bigEntry)
    assert.throws(() => a.bytes(), notCurrent)
    const body = bigEntry.body
    assert.equal(body.next().value?.length, 352)
    assert.deepEqual(it.return?.(), { value: undefined, done: true })
    assert.throws(() => body.next(), notCurrent)
    assert.deepEqual(it.next(), { value: undefined, done: true })
  })

  test('a truncated body', () => {
    const warnings: string[] = []
    const found = readAllSync(chunked(tar.subarray(0, 2600), 512), {
      onwarn: (_, message) => warnings.push(message),
    })
    assert.deepEqual(found[2], ['dir/big', 'File', big.slice(0, 552)])
    assert.deepEqual(warnings, [
      'Truncated input (needed 1536 more bytes, only 40 available)',
    ])
  })
})

describe('backpressure', () => {
  const data = cat(file('one', 'x'.repeat(2000)), file('two', 'y'), EOA)
  const tick = () => new Promise(res => setTimeout(res, 5))

  test('input is read only when the consumer asks', async () => {
    const { source, state } = countedSource(chunked(data, 512))
    const it = entries(source)
    await tick()
    assert.equal(state.pulls, 0)
    const one = (await it.next()).value
    assert(one)
    await tick()
    assert.equal(state.pulls, 1)
    const reader = one.body.getReader()
    await tick()
    assert.equal(state.pulls, 1)
    assert.equal((await reader.read()).value?.length, 512)
    await tick()
    assert.equal(state.pulls, 2)
    assert.equal((await reader.read()).value?.length, 512)
    await tick()
    assert.equal(state.pulls, 3)
    // The rest of the body is 2 chunks, then the header of the next.
    const two = (await it.next()).value
    assert(two)
    await tick()
    assert.equal(state.pulls, 6)
    assert.equal(await two.text(), 'y')
    assert.equal(state.pulls, 7)
    assert.equal(state.returned, 0)
    // The first chunk of the end marker is the end.
    assert.equal((await it.next()).done, true)
    assert.equal(state.pulls, 8)
    assert.equal(state.returned, 1)
  })

  test('a break releases the input', async () => {
    const { source, state } = countedSource(chunked(data, 512))
    for await (const entry of entries(source)) {
      assert.equal(entry.path, 'one')
      break
    }
    assert.deepEqual(state, { pulls: 1, returned: 1 })
  })

  test('return before the first read', async () => {
    const { source, state } = countedSource(chunked(data, 512))
    const it = entries(source)
    assert.deepEqual(await it.return?.(), { value: undefined, done: true })
    assert.deepEqual(await it.return?.(), { value: undefined, done: true })
    assert.deepEqual(state, { pulls: 0, returned: 1 })
    assert.equal(it[Symbol.asyncIterator](), it)
  })

  test('a break cancels a stream', async () => {
    const { readable, state } = stream(chunked(data, 512))
    for await (const _ of entries(readable)) break
    assert.equal(state.canceled, true)
  })

  test('the input is not read after the end of the archive', async () => {
    const more = cat(data, file('after'), new Uint8Array(4096))
    const { source, state } = countedSource(chunked(more, 512))
    assert.equal((await readAll(source)).length, 2)
    assert.deepEqual(state, { pulls: 8, returned: 1 })
  })

  test('an error of the input', async () => {
    const boom = new Error('boom')
    async function* source() {
      yield data.subarray(0, 1024)
      throw boom
    }
    const it = entries(source())
    const one = (await it.next()).value
    assert(one)
    assert.equal(await assert.rejects(it.next(), Error), boom)
    assert.deepEqual(await it.next(), { value: undefined, done: true })
  })

  test('sync: input is read only when the consumer asks', () => {
    let pulls = 0
    let returned = 0
    function* source() {
      try {
        for (const chunk of chunked(data, 512)) {
          pulls++
          yield chunk
        }
      } finally {
        returned++
      }
    }
    const it = entriesSync(source())
    assert.equal(pulls, 0)
    const one = it.next().value
    assert(one)
    assert.equal(pulls, 1)
    const body = one.body
    assert.equal(body.next().value?.length, 512)
    assert.equal(pulls, 2)
    const two = it.next().value
    assert(two)
    assert.equal(pulls, 6)
    assert.equal(returned, 0)
    assert.equal(it.next().done, true)
    assert.equal(returned, 1)
    assert.equal(it[Symbol.iterator](), it)
  })

  test('sync: a break releases the input', () => {
    let returned = 0
    function* source() {
      try {
        yield* chunked(data, 512)
      } finally {
        returned++
      }
    }
    for (const entry of entriesSync(source())) {
      assert.equal(entry.path, 'one')
      break
    }
    assert.equal(returned, 1)
  })
})

describe('poll and fill', () => {
  test('entries that are in memory need no promise', async () => {
    const reader = new TarReader(tar)
    assert.equal(reader.poll(), undefined)
    await reader.fill()
    const paths: string[] = []
    for (let entry; (entry = reader.poll()); ) paths.push(entry.path)
    assert.deepEqual(paths, paths)
    // The parser found the end marker.
    assert.equal(reader.poll(), null)
    assert.equal(reader.parser.position, tar.length - 1024)
    await reader.return()
    assert.equal(reader.poll(), null)
  })

  test('two calls of fill at one time read one chunk', async () => {
    const { source, state } = countedSource(chunked(tar, 512))
    const reader = new TarReader(source)
    const a = reader.fill()
    assert.equal(reader.fill(), a)
    await a
    assert.equal(state.pulls, 1)
    assert.match(reader.poll(), { path: 'a.txt' })
    assert.notEqual(reader.fill(), a)
  })

  test('the sync reader has the parser', () => {
    const reader = new TarReaderSync(tar)
    assert.equal([...reader].length, 5)
    assert.equal(reader.parser.position, tar.length - 1024)
  })

  test('EntryCursor', () => {
    const parser = new Parser()
    const cursor = new EntryCursor(parser)
    assert.equal(cursor.parser, parser)
    assert.equal(cursor.entry(), undefined)
    parser.push(cat(file('a', 'abc'), file('b', 'def').subarray(0, 512)))
    const a = cursor.entry()
    assert(a)
    assert.equal(cursor.current, a)
    assert.deepEqual(cursor.body(a), new Uint8Array(Buffer.from('abc')))
    assert.equal(cursor.body(a), null)
    assert.equal(cursor.current, undefined)
    assert.throws(() => cursor.body(a), notCurrent)
    const b = cursor.entry()
    assert(b)
    assert.equal(cursor.body(b), undefined)
    parser.end()
    assert.equal(cursor.body(b), null)
    assert.equal(cursor.entry(), null)
  })
})

describe('decompression', () => {
  const abort = { tarCode: 'TAR_ABORT', recoverable: false }
  const gunzip: Codec = {
    name: 'node-gzip',
    headLength: 2,
    detect: head => head[0] === 0x1f && head[1] === 0x8b,
    decompress: () => new DecompressionStream('gzip') as TransformStream,
    decompressSync: (data, limit) => zlib.gunzipSync(data, limit),
  }
  const tgz = zlib.gzipSync(tar)

  test('truncated gzip data is an error', async () => {
    const chunks = chunked(tgz.subarray(0, Math.floor(tgz.length / 2)), 50)
    const { source, state } = countedSource(chunks)
    const er = await assert.rejects(readAll(source, { file: 'x.tgz' }), {
      ...abort,
      file: 'x.tgz',
    })
    assert(er instanceof Error)
    // All the input was read.
    assert.greaterThan(state.pulls, chunks.length)
  })

  test('damaged gzip data is an error', async () => {
    const bad = new Uint8Array(tgz)
    bad.fill(0xff, 20, 40)
    await assert.rejects(readAll(bad), abort)
  })

  test('sync: gzip needs a codec', () => {
    assert.throws(() => readAllSync(tgz, { file: 'x.tgz' }), {
      ...abort,
      message: 'the gzip codec has no decompressSync function',
      file: 'x.tgz',
    })
  })

  test('sync: gzip with a codec', () => {
    assert.deepEqual(readAllSync(tgz, { codecs: [gunzip] }), expect)
    assert.deepEqual(
      readAllSync(chunked(tgz, 1), { codecs: [gunzip] }),
      expect,
    )
  })

  test('sync: damaged gzip data is an error', () => {
    const bad = new Uint8Array(tgz)
    bad.fill(0xff, 20, 40)
    assert.throws(() => readAllSync(bad, { codecs: [gunzip] }), abort)
  })

  describe('max decompression ratio', () => {
    const size = 8 * 1024 * 1024
    const bomb = zlib.gzipSync(
      cat(
        hdr({ path: 'bomb', size, type: 'File' }),
        new Uint8Array(size),
        EOA,
      ),
    )
    const count = async (input: TarInput, opt?: ReadOptions) => {
      let bytes = 0
      for await (const entry of entries(input, opt)) {
        for await (const part of entry.body) bytes += part.length
      }
      return bytes
    }
    const exceeded = {
      ...abort,
      message: /^max decompression ratio exceeded: \d+\.\d\d > /,
    }

    test('the default limit is 1000', async () => {
      let bytes = 0
      const er = await assert.rejects(
        (async () => {
          for await (const entry of entries(bomb)) {
            for await (const part of entry.body) bytes += part.length
          }
        })(),
        exceeded,
      )
      assert.match(er, { message: / > 1000$/ })
      assert.lessThan(bytes, size)
    })

    test('the input is not read after the limit is passed', async () => {
      const chunks = chunked(xorCompress(tar), 100)
      const { source, state } = countedSource(chunks)
      await assert.rejects(
        count(source, { codecs: [xorCodec], maxDecompressionRatio: 0.5 }),
        exceeded,
      )
      assert.lessThan(state.pulls, chunks.length / 2)
      await assert.eventually(() => state.returned, 1)
    })

    test('a lower limit', async () => {
      await assert.rejects(
        count(zlib.gzipSync(tar), { maxDecompressionRatio: 2 }),
        {
          ...abort,
          message: /^max decompression ratio exceeded: \d+\.\d\d > 2$/,
        },
      )
      // A limit of 0 is a limit.
      await assert.rejects(
        count(zlib.gzipSync(tar), { maxDecompressionRatio: 0 }),
        {
          message: / > 0$/,
        },
      )
    })

    test('no limit', async () => {
      assert.equal(
        await count(bomb, { maxDecompressionRatio: Infinity }),
        size,
      )
    })

    test('sync: the codec gets the limit', () => {
      const limits: number[] = []
      const codec: Codec = {
        ...gunzip,
        decompressSync: (data, limit) => {
          limits.push(limit.maxOutputLength)
          // node:zlib refuses Infinity.
          return zlib.gunzipSync(
            data,
            limit.maxOutputLength === Infinity ? {} : limit,
          )
        },
      }
      const er = assert.throws(
        () => readAllSync(bomb, { codecs: [codec] }),
        abort,
      )
      assert.match<unknown>(er, { code: 'ERR_BUFFER_TOO_LARGE' })
      assert.deepEqual(limits, [bomb.length * 1000])
      limits.length = 0
      const found = readAllSync(bomb, {
        codecs: [codec],
        maxDecompressionRatio: Infinity,
      })
      assert.equal(found[0]?.[2]?.length, size)
      assert.deepEqual(limits, [Infinity])
    })

    test('sync: the reader checks a codec that has no check', () => {
      const codec: Codec = {
        ...gunzip,
        decompressSync: data => zlib.gunzipSync(data),
      }
      assert.throws(() => readAllSync(bomb, { codecs: [codec] }), exceeded)
    })
  })
})

describe('codecs', () => {
  const xtar = xorCompress(tar)

  test('a codec of the caller, async', async () => {
    assert.deepEqual(await readAll(xtar, { codecs: [xorCodec] }), expect)
    assert.deepEqual(
      await readAll(generate(chunked(xtar, 1)), { codecs: [xorCodec] }),
      expect,
    )
  })

  test('a codec of the caller, sync', () => {
    assert.deepEqual(readAllSync(xtar, { codecs: [xorCodec] }), expect)
    assert.deepEqual(
      readAllSync(chunked(xtar, 3), { codecs: [xorCodec] }),
      expect,
    )
  })

  test('the ratio limit applies to a codec of the caller', async () => {
    const opt = { codecs: [xorCodec], maxDecompressionRatio: 0.5 }
    await assert.rejects(readAll(xtar, opt), {
      tarCode: 'TAR_ABORT',
      message: /^max decompression ratio exceeded: 1\.00 > 0\.5$/,
    })
    assert.throws(() => readAllSync(xtar, opt), {
      tarCode: 'TAR_ABORT',
      message: 'xor: output too long',
    })
  })

  test('with no codec for it, the data is not a tar archive', async () => {
    const warnings: string[] = []
    const onwarn = (_: string, message: string) => warnings.push(message)
    assert.deepEqual(await readAll(xtar, { onwarn }), [])
    assert.equal(warnings.pop(), 'Unrecognized archive format')
    assert.deepEqual(readAllSync(xtar, { onwarn }), [])
    assert.equal(warnings.pop(), 'Unrecognized archive format')
  })

  test('the codecs of the caller come before gzip', async () => {
    const seen: string[] = []
    const first: Codec = {
      ...xorCodec,
      name: 'first',
      detect: () => !seen.push('first'),
    }
    const second: Codec = {
      name: 'second',
      headLength: 2,
      detect: head => !!seen.push('second') && head[0] === 0x1f,
      decompress: () => new DecompressionStream('gzip') as TransformStream,
    }
    const found = await readAll(zlib.gzipSync(tar), {
      codecs: [first, second],
    })
    assert.deepEqual(found, expect)
    assert.deepEqual(seen, ['first', 'second'])
  })

  test('detect gets headLength bytes, or 512 if that is more', async () => {
    const lengths: number[] = []
    const codec = (headLength: number): Codec => ({
      ...xorCodec,
      headLength,
      detect: head => !lengths.push(head.length),
    })
    await readAll(generate(chunked(tar, 100)), { codecs: [codec(1)] })
    readAllSync(chunked(tar, 100), { codecs: [codec(1)] })
    await readAll(generate(chunked(tar, 100)), { codecs: [codec(650)] })
    readAllSync(chunked(tar, 100), { codecs: [codec(650)] })
    // All of an input that is shorter.
    await readAll(file('a').subarray(0, 300), { codecs: [codec(1)] })
    assert.deepEqual(lengths, [600, 600, 700, 700, 300])
  })

  describe('a codec that is found by the file name', () => {
    const named: Codec = {
      ...xorCodec,
      name: 'named',
      detect: () => false,
      extensions: ['.tar.xor', '.txr'],
    }
    const codecs = [{ ...named, extensions: ['.other'] }, named]

    for (const name of ['a.tar.xor', 'dir/a.txr']) {
      test(`${name}: data that is not tar is decompressed`, async () => {
        const opt = { codecs, file: name }
        assert.deepEqual(await readAll(xtar, opt), expect)
        assert.deepEqual(readAllSync(xtar, opt), expect)
        // Also an input of less than one block.
        const small = xorCompress(file('a').subarray(0, 100))
        assert.deepEqual(await readAll(small, { ...opt, onwarn() {} }), [])
      })

      test(`${name}: data that is tar is not decompressed`, async () => {
        const opt = { codecs, file: name }
        assert.deepEqual(await readAll(tar, opt), expect)
        assert.deepEqual(readAllSync(tar, opt), expect)
        const empty = await readAll(EOA, { ...opt, onwarn() {} })
        assert.deepEqual(empty, [])
      })

      test(`${name}: gzip data is found by its magic number`, async () => {
        const found = await readAll(zlib.gzipSync(tar), {
          codecs,
          file: name,
        })
        assert.deepEqual(found, expect)
      })
    }

    test('a different file name, or no file name', async () => {
      const onwarn = () => {}
      for (const file of ['a.tar', undefined]) {
        assert.deepEqual(await readAll(xtar, { codecs, file, onwarn }), [])
      }
    })

    test('a header block that throws is not tar', async () => {
      const block = xorCompress(tar).slice(4)
      // An invalid base-256 number in the mode field.
      block.set([0x81, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 100)
      const raw = { ...named, decompress: () => new TransformStream() }
      const found = await readAll(block, {
        codecs: [raw],
        file: 'a.txr',
        onwarn() {},
      })
      assert.deepEqual(found, [])
    })
  })
})
