import { constants } from 'node:buffer'
import type { Transform } from 'node:stream'
import * as nodeZlib from 'node:zlib'
import type { Codec, CodecStream } from '../codec.js'

/**
 * The functions of `node:zlib` that the codecs use. A runtime can
 * have no brotli functions or no zstd functions.
 */
export type ZlibModule = Pick<
  typeof nodeZlib,
  'createGzip' | 'createGunzip' | 'gzipSync' | 'gunzipSync'
> &
  Partial<
    Pick<
      typeof nodeZlib,
      | 'createBrotliCompress'
      | 'createBrotliDecompress'
      | 'brotliCompressSync'
      | 'brotliDecompressSync'
      | 'createZstdCompress'
      | 'createZstdDecompress'
      | 'zstdCompressSync'
      | 'zstdDecompressSync'
    >
  >

type Options = Record<string, unknown>

// The size of each chunk of decompressed output, and the size below
// which chunks of input to compress are put together.
const CHUNK = 64 * 1024

/**
 * Make the two web streams of a `node:zlib` stream, or of another
 * `Transform` stream of `node:stream`. The result fits the
 * `transform` option of `extract`.
 *
 * As with a `TransformStream`, a write is complete only when the
 * reader asks for more output than the stream has. The zlib stream
 * makes output only until its buffer is full. So the reader of an
 * archive can stop before more is decompressed.
 *
 * @param batch put small chunks of input together for one write.
 * Each write is a task for a thread.
 * @param first called with the first chunk of output
 */
export const zlibStream = (
  stream: Transform,
  batch: boolean = false,
  first?: (chunk: Uint8Array) => void,
): CodecStream => {
  let output!: ReadableStreamDefaultController<Uint8Array>
  let input!: WritableStreamDefaultController
  // True while the reader waits for output.
  let wanted = false
  // True when the zlib stream is closed.
  let done = false
  // settles the write or the close that waits for the zlib stream
  let settle: (() => void) | undefined
  // settles the write that waits for the reader
  let wake: (() => void) | undefined
  const held = batch ? new Uint8Array(CHUNK) : undefined
  let used = 0
  const write = (chunk: Uint8Array) =>
    new Promise<void>(res => {
      settle = res
      stream.write(chunk, () => res())
    })
  const flush = async (held: Uint8Array) => {
    if (used) await write(held.subarray(0, used))
    used = 0
  }
  // A write has no callback when the zlib stream fails or is
  // destroyed.
  const release = () => {
    done = true
    settle?.()
    wake?.()
  }
  const stop = () => {
    release()
    stream.destroy()
  }
  stream.pause()
  stream.on('data', (chunk: Uint8Array) => {
    first?.(chunk)
    first = undefined
    wanted = false
    stream.pause()
    output.enqueue(chunk)
  })
  // On Deno, a zlib stream that already has all its output emits
  // 'end' after it is destroyed. The output is then closed already.
  stream.on('end', () => {
    if (!done) output.close()
  })
  stream.on('error', er => {
    output.error(er)
    input.error(er)
    release()
  })
  stream.on('close', release)
  return {
    readable: new ReadableStream<Uint8Array>(
      {
        start: controller => {
          output = controller
        },
        pull: () => {
          wanted = true
          wake?.()
          stream.resume()
        },
        cancel: reason => {
          // Stop the source of the input also.
          input.error(reason)
          stop()
        },
      },
      { highWaterMark: 0 },
    ),
    writable: new WritableStream<Uint8Array>({
      start: controller => {
        input = controller
        // An abort does not wait for a write that waits.
        const { signal } = controller
        signal.addEventListener('abort', () => {
          output.error(signal.reason)
          stop()
        })
      },
      write: async chunk => {
        if (!held) await write(chunk)
        else {
          if (used + chunk.length > CHUNK) await flush(held)
          if (chunk.length > CHUNK) await write(chunk)
          else {
            held.set(chunk, used)
            used += chunk.length
          }
        }
        // As with a `TransformStream`, the write waits until the
        // reader wants output. Then a pipe from the source does not
        // start a write to a stream that the reader canceled.
        if (!wanted && !done) await new Promise<void>(res => (wake = res))
      },
      close: async () => {
        if (held) await flush(held)
        await new Promise<void>(res => {
          settle = res
          stream.end()
        })
      },
    }),
  }
}

// The option of the sync functions that limits the output. They
// refuse a number that is not in the range of a buffer length.
const limit = (max: number) =>
  max >= constants.MAX_LENGTH ?
    {}
  : { maxOutputLength: Math.max(1, Math.floor(max)) }

const make = (
  base: Pick<Codec, 'name' | 'headLength' | 'detect' | 'extensions'>,
  compress: (options?: Options) => Transform,
  decompress: (options: Options) => Transform,
  compressSync: (data: Uint8Array, options?: Options) => Uint8Array,
  decompressSync: (data: Uint8Array, options: Options) => Uint8Array,
): Codec => ({
  ...base,
  decompress: () => zlibStream(decompress({ chunkSize: CHUNK })),
  compress: options => zlibStream(compress(options), true),
  decompressSync: (data, { maxOutputLength }) => {
    try {
      return decompressSync(data, limit(maxOutputLength))
    } catch (er) {
      if ((er as { code?: string })?.code !== 'ERR_BUFFER_TOO_LARGE') {
        throw er
      }
      throw new Error(
        `max decompression ratio exceeded: the output is larger than ${maxOutputLength} bytes`,
      )
    }
  },
  compressSync,
})

// Byte 9 of a gzip stream names the system that made it. Set it to
// 255, "unknown", so that each system makes the same bytes.
const portable = (chunk: Uint8Array) => {
  chunk[9] = 255
}

/**
 * The codecs of a `node:zlib` module: gzip, then brotli and zstd if
 * the module has their functions.
 *
 * The value of a `gzip`, `brotli`, or `zstd` option of `create` goes
 * to the zlib function as its options. A gzip codec reads the tar
 * option `portable` in its options: it makes output that does not
 * name the system.
 *
 * A brotli archive has no magic number. The readers use the brotli
 * codec for a file with a name that ends in `.tar.br` or `.tbr`, if
 * the file does not start with a tar header.
 */
export const zlibCodecs = (z: ZlibModule = nodeZlib): Codec[] => {
  const {
    createBrotliCompress,
    createBrotliDecompress,
    brotliCompressSync,
    brotliDecompressSync,
    createZstdCompress,
    createZstdDecompress,
    zstdCompressSync,
    zstdDecompressSync,
  } = z
  const gzip = make(
    {
      name: 'gzip',
      headLength: 2,
      detect: head => head[0] === 0x1f && head[1] === 0x8b,
    },
    z.createGzip,
    z.createGunzip,
    z.gzipSync,
    z.gunzipSync,
  )
  const codecs: Codec[] = [
    {
      ...gzip,
      compress: ({ portable: p, ...options }: Options = {}) =>
        zlibStream(z.createGzip(options), true, p ? portable : undefined),
      compressSync: (data, { portable: p, ...options }: Options = {}) => {
        const out = z.gzipSync(data, options)
        if (p) portable(out)
        return out
      },
    },
  ]
  if (
    createBrotliCompress &&
    createBrotliDecompress &&
    brotliCompressSync &&
    brotliDecompressSync
  ) {
    codecs.push(
      make(
        {
          name: 'brotli',
          headLength: 0,
          detect: () => false,
          extensions: ['.tar.br', '.tbr'],
        },
        createBrotliCompress,
        createBrotliDecompress,
        brotliCompressSync,
        brotliDecompressSync,
      ),
    )
  }
  if (
    createZstdCompress &&
    createZstdDecompress &&
    zstdCompressSync &&
    zstdDecompressSync
  ) {
    codecs.push(
      make(
        {
          name: 'zstd',
          headLength: 4,
          detect: head =>
            head[0] === 0x28 &&
            head[1] === 0xb5 &&
            head[2] === 0x2f &&
            head[3] === 0xfd,
        },
        createZstdCompress,
        createZstdDecompress,
        zstdCompressSync,
        zstdDecompressSync,
      ),
    )
  }
  return codecs
}
