import { assert, describe, test } from 'ubqtest'
import { gzip, type Codec } from '../../src/next/codec.js'
import { entries, entriesSync } from '../../src/next/entries.js'
import { cat, chunked, EOA, file, xorCodec } from './helpers.js'

const tar = cat(
  file('a.txt', 'alpha'),
  file('b.txt', 'b'.repeat(3000)),
  EOA,
)
const expect = [
  ['a.txt', 'alpha'],
  ['b.txt', 'b'.repeat(3000)],
]

// Compress the chunks with the stream of the codec.
const compress = async (codec: Codec, chunks: Uint8Array[]) => {
  assert(codec.compress)
  const { readable, writable } = codec.compress()
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

describe('the gzip codec', () => {
  test('detects gzip data', () => {
    assert.equal(gzip.name, 'gzip')
    assert.equal(gzip.headLength, 2)
    assert.equal(gzip.detect(new Uint8Array([0x1f, 0x8b, 8])), true)
    assert.equal(gzip.detect(new Uint8Array([0x1f])), false)
    assert.equal(gzip.detect(tar), false)
  })

  test('compress, then read the archive', async () => {
    const data = await compress(gzip, chunked(tar, 1000))
    assert.equal(gzip.detect(data), true)
    assert.lessThan(data.length, tar.length)
    const found: string[][] = []
    for await (const entry of entries(data)) {
      found.push([entry.path, await entry.text()])
    }
    assert.deepEqual(found, expect)
  })
})

describe('a codec of the caller', () => {
  test('async', async () => {
    const data = await compress(xorCodec, chunked(tar, 1000))
    assert.equal(xorCodec.detect(data), true)
    const found: string[][] = []
    for await (const entry of entries(chunked(data, 700), {
      codecs: [xorCodec],
    })) {
      found.push([entry.path, await entry.text()])
    }
    assert.deepEqual(found, expect)
  })

  test('sync', () => {
    assert(xorCodec.compressSync)
    const data = xorCodec.compressSync(tar)
    const found: string[][] = []
    for (const entry of entriesSync(chunked(data, 700), {
      codecs: [xorCodec],
    })) {
      found.push([entry.path, entry.text()])
    }
    assert.deepEqual(found, expect)
  })
})
