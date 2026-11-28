import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { resolve } from 'node:path'
import zlib from 'node:zlib'
import { assert, describe, stub, test } from 'ubqtest'
import { gzip as webGzip, type Codec } from '../src/codec.js'
import { entries, entriesSync } from '../src/entries.js'
import { list, listSync } from '../src/list.js'
import {
  zlibCodecs,
  codecStream,
  type ZlibModule,
} from '../src/server/codecs.js'
import type { ReadOptions } from '../src/options.js'
import { fixtures } from './create-helpers.js'
import {
  cat,
  chunked,
  countedSource,
  EOA,
  file,
  hdr,
  isDeno,
} from './helpers.js'

const codecs = zlibCodecs()
const named = (name: string, list: Codec[] = codecs) => {
  const codec = list.find(c => c.name === name)
  assert(codec, `no codec named ${name}`)
  return codec
}

// Text that does not compress much.
const big = Array.from({ length: 40_000 }, (_, i) =>
  ((i * 2654435761) >>> 0).toString(36),
).join(' ')
const tar = cat(file('a.txt', 'alpha'), file('b.txt', big), EOA)
const expect = [
  ['a.txt', 'alpha'],
  ['b.txt', big],
]

const readAll = async (
  input: Uint8Array | Uint8Array[],
  opt?: ReadOptions,
) => {
  const found: string[][] = []
  for await (const entry of entries(input, opt)) {
    found.push([entry.path, await entry.text()])
  }
  return found
}

// Compress the chunks with the stream of the codec.
const compress = async (
  codec: Codec,
  chunks: Uint8Array[],
  options?: Record<string, unknown>,
) => {
  assert(codec.compress)
  const { readable, writable } = codec.compress(options)
  const writer = writable.getWriter()
  const written = (async () => {
    for (const chunk of chunks) await writer.write(chunk)
    await writer.close()
  })()
  const parts: Uint8Array[] = []
  for (const reader = readable.getReader(); ; ) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  await written
  return cat(...parts)
}

describe('the list of codecs', () => {
  test('this runtime has gzip, brotli, and zstd', () => {
    assert.deepEqual(
      codecs.map(c => c.name),
      ['gzip', 'brotli', 'zstd'],
    )
  })

  test('a runtime with no zstd', () => {
    const z: ZlibModule = { ...zlib, createZstdDecompress: undefined }
    assert.deepEqual(
      zlibCodecs(z).map(c => c.name),
      ['gzip', 'brotli'],
    )
  })

  test('a runtime with no brotli', () => {
    const z: ZlibModule = { ...zlib, brotliCompressSync: undefined }
    assert.deepEqual(
      zlibCodecs(z).map(c => c.name),
      ['gzip', 'zstd'],
    )
  })

  test('a runtime with gzip only', () => {
    const { createGzip, createGunzip, gzipSync, gunzipSync } = zlib
    const only = zlibCodecs({
      createGzip,
      createGunzip,
      gzipSync,
      gunzipSync,
    })
    assert.deepEqual(
      only.map(c => c.name),
      ['gzip'],
    )
  })

  test('detection', () => {
    const gz = named('gzip')
    assert.equal(gz.headLength, 2)
    assert.equal(gz.detect(zlib.gzipSync(tar)), true)
    assert.equal(gz.detect(tar), false)
    assert.equal(gz.extensions, undefined)

    const zstd = named('zstd')
    assert.equal(zstd.headLength, 4)
    assert.equal(zstd.detect(zlib.zstdCompressSync(tar)), true)
    assert.equal(zstd.detect(new Uint8Array([0x28, 0xb5, 0x2f])), false)
    assert.equal(zstd.detect(tar), false)

    // Brotli has no magic number.
    const brotli = named('brotli')
    assert.equal(brotli.detect(zlib.brotliCompressSync(tar)), false)
    assert.deepEqual(brotli.extensions, ['.tar.br', '.tbr'])
  })
})

describe('compress, then read the archive', () => {
  const inputs: [string, Uint8Array[]][] = [
    ['one chunk', [tar]],
    ['small chunks', chunked(tar, 1000)],
    // The small chunks are more than one batch.
    ['small chunks and a large chunk', [...chunked(tar, 30_000), tar]],
    ['no chunks', []],
  ]
  for (const codec of codecs) {
    // The file name selects brotli.
    const opt = { codecs, file: 'archive.tbr' }
    for (const [name, chunks] of inputs) {
      test(`${codec.name}, stream, ${name}`, async () => {
        const data = await compress(codec, chunks)
        const plain = cat(...chunks)
        if (plain.length) assert.lessThan(data.length, plain.length)
        assert.deepEqual(
          await readAll(chunked(data, 100), opt),
          chunks.length ? expect : [],
        )
      })
    }

    test(`${codec.name}, sync`, () => {
      assert(codec.compressSync)
      const data = codec.compressSync(tar)
      assert.lessThan(data.length, tar.length)
      const found: string[][] = []
      for (const entry of entriesSync(chunked(data, 100), opt)) {
        found.push([entry.path, entry.text()])
      }
      assert.deepEqual(found, expect)
    })

    test(`${codec.name}, the output of zlib`, async () => {
      const unzip = {
        gzip: zlib.gunzipSync,
        brotli: zlib.brotliDecompressSync,
        zstd: zlib.zstdDecompressSync,
      }[codec.name]
      assert(unzip && codec.compressSync)
      for (const [name, chunks] of inputs) {
        const data = await compress(codec, chunks)
        assert.deepEqual(new Uint8Array(unzip(data)), cat(...chunks), name)
      }
      assert.deepEqual(new Uint8Array(unzip(codec.compressSync(tar))), tar)
    })
  }
})

describe('the options of zlib', () => {
  test('gzip level', async () => {
    const gz = named('gzip')
    assert(gz.compressSync)
    const stored = await compress(gz, [tar], { level: 0 })
    assert.greaterThan(stored.length, tar.length)
    assert.deepEqual(new Uint8Array(zlib.gunzipSync(stored)), tar)
    assert.greaterThan(
      gz.compressSync(tar, { level: 0 }).length,
      tar.length,
    )
  })

  test('brotli and zstd params', async () => {
    const noise = new Uint8Array(100_000).map((_, i) => (i * i) % 251)
    const cases: [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ][] = [
      [
        'brotli',
        { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 0 } },
        { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } },
      ],
      [
        'zstd',
        { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } },
        { params: { [zlib.constants.ZSTD_c_checksumFlag]: 0 } },
      ],
    ]
    for (const [name, low, high] of cases) {
      const codec = named(name)
      assert(codec.compressSync)
      const [a, b] = [
        await compress(codec, [noise], low),
        await compress(codec, [noise], high),
      ]
      assert.greaterThan(a.length, b.length, name)
      assert.greaterThan(
        codec.compressSync(noise, low).length,
        codec.compressSync(noise, high).length,
        name,
      )
    }
  })
})

describe('portable gzip', () => {
  const gz = named('gzip')
  // What minizlib does: byte 9, the system, is 255 "unknown".
  const expectPortable = (() => {
    const out = zlib.gzipSync(tar)
    out[9] = 255
    return new Uint8Array(out)
  })()

  test('stream', async () => {
    const data = await compress(gz, chunked(tar, 1000), { portable: true })
    assert.deepEqual(data, expectPortable)
    const plain = await compress(gz, chunked(tar, 1000))
    assert.deepEqual(plain, new Uint8Array(zlib.gzipSync(tar)))
    assert.notEqual(plain[9], 255)
  })

  test('sync', () => {
    assert(gz.compressSync)
    assert.deepEqual(
      new Uint8Array(gz.compressSync(tar, { portable: true })),
      expectPortable,
    )
    assert.notEqual(gz.compressSync(tar, { portable: false })[9], 255)
  })

  test('with other options', async () => {
    const opt = { portable: true, level: 1 }
    const expect = zlib.gzipSync(tar, { level: 1 })
    expect[9] = 255
    assert(gz.compressSync)
    // On Bun and Deno, a zlib stream at level 1 does not make the
    // bytes of gzipSync. Compare with a zlib stream that gets the
    // same calls.
    const stream = zlib.createGzip({ level: 1 })
    const parts: Uint8Array[] = []
    stream.on('data', (part: Uint8Array) => parts.push(part))
    stream.write(tar)
    stream.end()
    await new Promise(res => stream.on('end', res))
    const expectStream = cat(...parts)
    expectStream[9] = 255
    assert.deepEqual(await compress(gz, [tar], opt), expectStream)
    assert.deepEqual(
      new Uint8Array(gz.compressSync(tar, opt)),
      new Uint8Array(expect),
    )
  })
})

describe('the format of a file', () => {
  const oneToTen = Array.from({ length: 10 }, (_, i) => `x/${i + 1}`)
  const tbr = nodeFs.readFileSync(resolve(fixtures, 'example.tbr'))
  const tzst = nodeFs.readFileSync(resolve(fixtures, 'example.tzst'))
  const plain = new Uint8Array(zlib.brotliDecompressSync(tbr))

  const listed = async (
    input: Uint8Array | Uint8Array[],
    file: string | undefined,
  ) => {
    const found: string[] = []
    const warnings: string[] = []
    const sync: string[] = []
    await list({
      input,
      file,
      codecs,
      onEntry: entry => found.push(entry.path),
      onwarn: (_, message) => warnings.push(message),
    })
    listSync({
      input,
      file,
      codecs,
      onEntry: entry => sync.push(entry.path),
      onwarn: () => {},
    })
    assert.deepEqual(sync, found)
    return { found: found.filter(p => !p.endsWith('/')).sort(), warnings }
  }
  const ok = { found: [...oneToTen].sort(), warnings: [] }

  test('the fixture files', async () => {
    for (const name of ['example.tbr', 'example.tzst']) {
      const file = resolve(fixtures, name)
      const found: string[] = []
      await list({
        file,
        fs: nodeFsPromises,
        codecs,
        onEntry: entry => found.push(entry.path),
      })
      const sync: string[] = []
      listSync({
        file,
        fs: nodeFs,
        codecs,
        onEntry: entry => sync.push(entry.path),
      })
      assert.deepEqual(sync, found)
      assert.deepEqual(
        found.filter(p => !p.endsWith('/')).sort(),
        ok.found,
      )
    }
  })

  test('brotli by the file name', async () => {
    assert.deepEqual(await listed(tbr, 'example.tbr'), ok)
    assert.deepEqual(await listed(tbr, 'example.tar.br'), ok)
    assert.deepEqual(await listed(chunked(tbr, 1), 'example.tbr'), ok)
  })

  test('brotli with a different file name is not read', async () => {
    for (const name of ['example.unknown', undefined]) {
      assert.deepEqual(await listed(tbr, name), {
        found: [],
        warnings: ['Unrecognized archive format'],
      })
    }
  })

  test('brotli data of less than one block', async () => {
    const small = new Uint8Array(
      zlib.brotliCompressSync(cat(file('a.txt', 'alpha'), EOA)),
    )
    assert.lessThan(small.length, 512)
    const found = await readAll(small, { codecs, file: 'a.tbr' })
    assert.deepEqual(found, [['a.txt', 'alpha']])
  })

  test('a tar file with a brotli file name', async () => {
    assert.deepEqual(await listed(plain, 'example.tbr'), ok)
    assert.deepEqual(await listed(chunked(plain, 1), 'example.tar.br'), ok)
  })

  test('a gzip file with a brotli file name', async () => {
    const gz = new Uint8Array(zlib.gzipSync(plain))
    assert.deepEqual(await listed(gz, 'example.tbr'), ok)
  })

  test('zstd by its magic number', async () => {
    assert.deepEqual(await listed(tzst, 'example.tzst'), ok)
    assert.deepEqual(await listed(tzst, 'example.unknown'), ok)
    assert.deepEqual(await listed(tzst, undefined), ok)
    assert.deepEqual(await listed(chunked(tzst, 1), undefined), ok)
    // The magic number wins over the file name.
    assert.deepEqual(await listed(tzst, 'example.tbr'), ok)
  })
})

describe('the ratio limit stops the decompression early', () => {
  const size = 16 * 1024 * 1024
  const bomb = cat(
    hdr({ path: 'bomb', size, type: 'File' }),
    new Uint8Array(size),
    EOA,
  )
  const max = 10
  // The zlib stream can have one buffer of output that the reader
  // did not take, and the chunk that it makes now.
  const slack = 4 * 64 * 1024
  const exceeded = {
    tarCode: 'TAR_ABORT',
    message: /^max decompression ratio exceeded: \d+\.\d\d > 10$/,
  }

  const consume = async (input: Uint8Array, opt: ReadOptions) => {
    let seen = 0
    for await (const entry of entries(input, opt)) {
      for await (const part of entry.body) seen += part.length
    }
    return seen
  }

  // A zlib module that counts the bytes that each decompression
  // stream makes.
  const counting = (
    name:
      | 'createGunzip'
      | 'createBrotliDecompress'
      | 'createZstdDecompress',
  ) => {
    const count = { produced: 0 }
    const z: ZlibModule = {
      ...zlib,
      [name]: (options: zlib.ZlibOptions) => {
        const stream = zlib[name](options as zlib.ZstdOptions)
        const push = stream.push
        stream.push = (chunk: Uint8Array | null, ...rest: []) => {
          count.produced += chunk?.length ?? 0
          return push.call(stream, chunk, ...rest)
        }
        return stream
      },
    }
    return { count, codecs: zlibCodecs(z) }
  }

  const cases = [
    ['gzip', 'createGunzip', zlib.gzipSync(bomb)],
    ['brotli', 'createBrotliDecompress', zlib.brotliCompressSync(bomb)],
    ['zstd', 'createZstdDecompress', zlib.zstdCompressSync(bomb)],
  ] as const
  for (const [name, fn, data] of cases) {
    test(`node:zlib ${name}`, async () => {
      const { count, codecs } = counting(fn)
      const allowed = data.length * max
      assert.lessThan(allowed, size / 20)
      await assert.rejects(
        consume(data, {
          codecs,
          file: 'bomb.tbr',
          maxDecompressionRatio: max,
        }),
        exceeded,
      )
      assert.greaterThan(count.produced, allowed)
      assert.lessThanOrEqual(count.produced, allowed + slack)
      assert.lessThan(count.produced, size / 20)

      // With no limit, all of it is decompressed.
      count.produced = 0
      assert.equal(
        await consume(data, {
          codecs,
          file: 'bomb.tbr',
          maxDecompressionRatio: Infinity,
        }),
        size,
      )
      assert.equal(count.produced, bomb.length)
    })
  }

  test('the gzip codec of the web streams', async ({ skip }) => {
    // Deno's DecompressionStream makes all the output of a chunk of
    // input as one chunk. The reader gets all of it before the limit
    // can stop the stream.
    if (isDeno) skip('the DecompressionStream of Deno makes one chunk')
    const data = zlib.gzipSync(bomb)
    const allowed = data.length * max
    // The bytes that come out of the decompression stream.
    let out = 0
    const codec: Codec = {
      ...webGzip,
      decompress: () => {
        const { readable, writable } = webGzip.decompress()
        return {
          writable,
          readable: readable.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform: (chunk, controller) => {
                out += chunk.length
                controller.enqueue(chunk)
              },
            }),
          ),
        }
      },
    }
    // Node makes its DecompressionStream from a zlib.Gunzip. Count
    // the bytes that it makes inside. On a runtime that does not use
    // this class, the count stays 0.
    let produced = 0
    const proto = zlib.Gunzip.prototype
    const push = proto.push
    stub(proto, 'push', function (
      this: zlib.Gunzip,
      chunk: Uint8Array | null,
      ...rest: []
    ) {
      produced += chunk?.length ?? 0
      return push.call(this, chunk, ...rest)
    } as typeof push)
    await assert.rejects(
      consume(data, { codecs: [codec], maxDecompressionRatio: max }),
      exceeded,
    )
    assert.greaterThan(out, allowed)
    assert.lessThanOrEqual(out, allowed + slack)
    assert.lessThanOrEqual(produced, allowed + slack)
  })

  describe('sync', () => {
    for (const codec of codecs) {
      test(codec.name, () => {
        assert(codec.compressSync && codec.decompressSync)
        const data = codec.compressSync(bomb)
        const { decompressSync } = codec
        assert.throws(
          () =>
            decompressSync(data, { maxOutputLength: data.length * max }),
          {
            name: 'Error',
            message: `max decompression ratio exceeded: the output is larger than ${data.length * max} bytes`,
          },
        )
        // A limit that zlib refuses as a number: less than 1, not an
        // integer, or more than the largest buffer.
        for (const maxOutputLength of [0, 0.5, 1.5]) {
          assert.throws(() => decompressSync(data, { maxOutputLength }), {
            message: /^max decompression ratio exceeded: /,
          })
        }
        for (const maxOutputLength of [Infinity, 2 ** 60, bomb.length]) {
          assert.equal(
            decompressSync(data, { maxOutputLength }).length,
            bomb.length,
          )
        }
        // The reader makes it an error of the archive.
        assert.throws(
          () => [
            ...entriesSync(data, {
              codecs,
              file: 'bomb.tbr',
              maxDecompressionRatio: max,
            }),
          ],
          {
            tarCode: 'TAR_ABORT',
            message: /^max decompression ratio exceeded: /,
          },
        )
      })

      test(`${codec.name}: damaged data is the error of zlib`, t => {
        // Deno's brotliDecompressSync returns no bytes for damaged
        // data, and does not throw.
        if (isDeno && codec.name === 'brotli') {
          t.skip('brotliDecompressSync of Deno does not throw')
        }
        assert(codec.compressSync && codec.decompressSync)
        const data = codec.compressSync(tar)
        data.fill(0xff, 8, 30)
        const { decompressSync } = codec
        const er = assert.throws(
          () => decompressSync(data, { maxOutputLength: Infinity }),
          Error,
        )
        assert.notContains(er.message, 'ratio')
      })
    }
  })
})

describe('the end of a zlib stream', () => {
  const data = new Uint8Array(
    zlib.gzipSync(
      cat(file('a.txt', 'alpha'), file('b.txt', big), file('c', 'c'), EOA),
      { level: 0 },
    ),
  )

  for (const codec of codecs) {
    test(`${codec.name}: damaged data is an error`, async () => {
      assert(codec.compressSync)
      const bad = codec.compressSync(tar)
      bad.fill(0xff, 8, 30)
      const { source, state } = countedSource(chunked(bad, 1000))
      const er = await assert.rejects(
        (async () => {
          for await (const entry of entries(source, {
            codecs,
            file: 'a.tbr',
          })) {
            await entry.text()
          }
        })(),
        { tarCode: 'TAR_ABORT' },
      )
      assert.notContains(er.message, 'ratio')
      await assert.eventually(() => state.returned, 1)
    })
  }

  test('a reader that stops early releases the input', async () => {
    const chunks = chunked(data, 1000)
    const { source, state } = countedSource(chunks)
    const found: string[] = []
    for await (const entry of entries(source, { codecs })) {
      found.push(entry.path)
      break
    }
    assert.deepEqual(found, ['a.txt'])
    await assert.eventually(() => state.returned, 1)
    assert.lessThan(state.pulls, chunks.length)
  })

  test('cancel while a write waits for the reader', async () => {
    const stream = zlib.createGunzip()
    const { readable, writable } = codecStream(stream)
    const writer = writable.getWriter()
    // This write is complete only when its output is read.
    const written = writer.write(zlib.gzipSync(new Uint8Array(1 << 22)))
    const reader = readable.getReader()
    const first = await reader.read()
    assert(first.value?.length)
    const reason = new Error('stop')
    await reader.cancel(reason)
    // The write does not wait for ever.
    await written.catch(() => {})
    assert.equal(stream.destroyed, true)
    assert.equal(await assert.rejects(writer.closed, Error), reason)
  })

  test("an 'end' event after the reader canceled", async () => {
    // Deno emits 'end' after destroy() for a stream that has all its
    // output.
    const stream = zlib.createGunzip()
    const { readable } = codecStream(stream)
    await readable.cancel(new Error('stop'))
    assert.equal(stream.destroyed, true)
    // A listener that throws makes emit() throw.
    assert.equal(stream.emit('end'), true)
  })

  test('abort of the writable side', async () => {
    const stream = zlib.createGzip()
    const { readable, writable } = codecStream(stream)
    const reason = new Error('give up')
    const writer = writable.getWriter()
    // This write waits for a reader.
    const written = writer.write(new Uint8Array(10))
    await writer.abort(reason)
    await assert.rejects(written, Error)
    assert.equal(stream.destroyed, true)
    const er = await assert.rejects(readable.getReader().read(), Error)
    assert.equal(er, reason)
  })
})
