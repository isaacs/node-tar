import { Header, type HeaderData } from '../../src/header.js'
import type { Codec } from '../../src/next/codec.js'
import type { ParserOptions } from '../../src/next/options.js'
import { Parser } from '../../src/next/parser.js'
import type { EntryData } from '../../src/next/read-entry.js'

export const hdr = (h: HeaderData) => {
  const block = new Uint8Array(512)
  new Header({ mode: 0o644, size: 0, uid: 501, ...h }).encode(block)
  return block
}
export const cat = (...parts: Uint8Array[]) =>
  new Uint8Array(Buffer.concat(parts))
const pad = (data: Uint8Array) =>
  cat(data, new Uint8Array((512 - (data.length % 512)) % 512))
export const ent = (h: HeaderData, body: string | Uint8Array = '') => {
  const data = Buffer.from(body)
  return cat(hdr({ size: data.length, ...h }), pad(data))
}
export const file = (path: string, body: string | Uint8Array = '') =>
  ent({ path, type: 'File' }, body)
// One PAX record: "<length> <key>=<value>\n"
export const rec = (k: string, v: string | Uint8Array) => {
  const tail = cat(
    Buffer.from(` ${k}=`),
    Buffer.from(v),
    Buffer.from('\n'),
  )
  let n = tail.length + 1
  while (String(n).length + tail.length !== n) {
    n = String(n).length + tail.length
  }
  return cat(Buffer.from(String(n)), tail)
}
export const pax = (kv: [string, string | Uint8Array][], global = false) =>
  ent(
    {
      path: 'PaxHeader/p',
      type: global ? 'GlobalExtendedHeader' : 'ExtendedHeader',
    },
    cat(...kv.map(([k, v]) => rec(k, v))),
  )
export const longPath = (name: string) =>
  ent({ path: '././@LongLink', type: 'NextFileHasLongPath' }, name + '\0')
export const longLink = (name: string) =>
  ent(
    { path: '././@LongLink', type: 'NextFileHasLongLinkpath' },
    name + '\0',
  )
export const EOA = new Uint8Array(1024)

/** Split the data into chunks of `size` bytes. */
export const chunked = (data: Uint8Array, size: number) => {
  const out: Uint8Array[] = []
  for (let i = 0; i < data.length; i += size) {
    out.push(data.subarray(i, i + size))
  }
  return out
}

export type Found = { entry: EntryData; body: string; ended: boolean }
export type Warning = [code: string, message: string]

/**
 * Give the chunks to a parser one at a time, and read all the events
 * after each one.
 */
export const parse = (chunks: Uint8Array[], opt: ParserOptions = {}) => {
  const found: Found[] = []
  const ignored: EntryData[] = []
  const warnings: Warning[] = []
  let ends = 0
  const parser = new Parser({
    onwarn: (code, message) => warnings.push([code, message]),
    ...opt,
  })
  const decoder = new TextDecoder()
  const drain = () => {
    for (let ev; (ev = parser.next()); ) {
      const last = found[found.length - 1]
      if (ev.type === 'end') ends++
      else if (ev.type === 'entry') {
        if (ev.entry.ignore) ignored.push(ev.entry)
        else found.push({ entry: ev.entry, body: '', ended: false })
      } else if (!last || last.ended) {
        throw new Error('body event with no entry')
      } else if (ev.type === 'body') {
        last.body += decoder.decode(ev.data, { stream: true })
      } else last.ended = true
    }
  }
  for (const chunk of chunks) {
    parser.push(chunk)
    drain()
  }
  parser.end()
  drain()
  return {
    found,
    ignored,
    warnings,
    ends,
    parser,
    entries: found.map(f => f.entry),
    paths: found.map(f => f.entry.path),
  }
}

/** A chunk source that counts what the reader takes from it. */
export const countedSource = (chunks: Uint8Array[]) => {
  const state = { pulls: 0, returned: 0 }
  let i = 0
  const iterator = {
    next: async (): Promise<IteratorResult<Uint8Array, undefined>> => {
      state.pulls++
      const value = chunks[i++]
      return value ?
          { value, done: false }
        : { value: undefined, done: true }
    },
    return: async (): Promise<IteratorResult<Uint8Array, undefined>> => {
      state.returned++
      return { value: undefined, done: true }
    },
  }
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => iterator,
  }
  return { state, source }
}

const XOR_MAGIC = [0x58, 0x4f, 0x52, 0x21]
const xor = (data: Uint8Array) => data.map(b => b ^ 0x5a)

/** Compress for the `xorCodec`: a magic number, then each byte XOR 0x5a. */
export const xorCompress = (data: Uint8Array) =>
  cat(new Uint8Array(XOR_MAGIC), xor(data))

/** A made-up compression format, to test the `codecs` option. */
export const xorCodec: Codec = {
  name: 'xor',
  headLength: 4,
  detect: head => XOR_MAGIC.every((b, i) => head[i] === b),
  decompress: () => {
    let skip = XOR_MAGIC.length
    return new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        const n = Math.min(skip, chunk.length)
        skip -= n
        if (n < chunk.length) controller.enqueue(xor(chunk.subarray(n)))
      },
    })
  },
  compress: () =>
    new TransformStream<Uint8Array, Uint8Array>({
      start: controller => controller.enqueue(new Uint8Array(XOR_MAGIC)),
      transform: (chunk, controller) => controller.enqueue(xor(chunk)),
    }),
  decompressSync: (data, { maxOutputLength }) => {
    if (data.length - XOR_MAGIC.length > maxOutputLength) {
      throw new RangeError('xor: output too long')
    }
    return xor(data.subarray(XOR_MAGIC.length))
  },
  compressSync: xorCompress,
}
