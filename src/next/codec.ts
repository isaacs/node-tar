/** The two ends of a stream that changes data, as a `TransformStream`. */
export type CodecStream = {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
}

/**
 * One compression format. Pass codecs in the `codecs` option to add
 * a format, or to replace the gzip support of the runtime.
 *
 * The readers use the first codec for which `detect` returns true.
 * If there is none, and the archive has a file name, and the input
 * does not start with a tar header, they use the first codec that
 * has an ending of the file name in `extensions`.
 *
 * The readers enforce `maxDecompressionRatio` for each codec.
 */
export type Codec = {
  name: string
  /** The number of bytes that `detect` needs. */
  headLength: number
  /**
   * True if the input is in this format. `head` is the start of the
   * input: `headLength` bytes or more, or all of a shorter input.
   */
  detect(head: Uint8Array): boolean
  /**
   * File name endings, such as `.tar.br`, for a format that `detect`
   * cannot identify.
   */
  extensions?: string[]
  /** Make a stream that decompresses. */
  decompress(): CodecStream
  /** Make a stream that compresses. */
  compress?(options?: Record<string, unknown>): CodecStream
  /**
   * Decompress all of `data`. The sync readers need it. It must throw
   * before it makes more than `limit.maxOutputLength` bytes. That
   * number is `Infinity` when the caller sets no ratio limit.
   */
  decompressSync?(
    data: Uint8Array,
    limit: { maxOutputLength: number },
  ): Uint8Array
  /** Compress all of `data`. */
  compressSync?(
    data: Uint8Array,
    options?: Record<string, unknown>,
  ): Uint8Array
}

/**
 * Gzip with the `DecompressionStream` and `CompressionStream` of the
 * runtime. The async readers always have it, after `opt.codecs`.
 * The option `portable` of `compress` makes output that does not
 * name the system.
 */
export const gzip: Codec = {
  name: 'gzip',
  headLength: 2,
  detect: head => head[0] === 0x1f && head[1] === 0x8b,
  decompress: () => new DecompressionStream('gzip') as CodecStream,
  compress: options => {
    const stream = new CompressionStream('gzip') as CodecStream
    if (!options?.portable) return stream
    // Byte 9 of a gzip stream names the system that made it. Set it
    // to 255, "unknown", so that each system makes the same bytes.
    let pos = 0
    return {
      writable: stream.writable,
      readable: stream.readable.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform: (chunk, controller) => {
            if (pos <= 9 && pos + chunk.length > 9) chunk[9 - pos] = 255
            pos += chunk.length
            controller.enqueue(chunk)
          },
        }),
      ),
    }
  },
}
