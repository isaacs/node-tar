import type { Codec } from './codec.js'
import type { EntryData, ReadEntry, ReadEntrySync } from './read-entry.js'
import type { TarFS, TarFSSync } from './fs.js'
import type { WarnOptions } from './warn.js'

/** The options of a `Parser`. */
export type ParserOptions<E extends EntryData = EntryData> =
  WarnOptions & {
    /**
     * Called with each entry that is an object of the file system.
     * If it returns false, the entry is ignored.
     */
    filter?: (path: string, entry: E) => boolean
    /**
     * The largest PAX or GNU long name entry to read, in bytes. A
     * larger one is skipped. Default 1 MiB.
     */
    maxMetaEntrySize?: number
    /** With `'win32'`, each `\` in a path is changed to `/`. */
    platform?: 'win32' | 'posix'
  }

/** The options of the readers. */
export type ReadOptions<E extends EntryData = ReadEntry> =
  ParserOptions<E> & {
    /**
     * Stop with an error when the decompressed size is more than this
     * many times the compressed size. Default 1000.
     */
    maxDecompressionRatio?: number
    /**
     * Compression formats, tried in order before the gzip support of
     * the runtime.
     */
    codecs?: Codec[]
  }

/** The options of `entriesSync`. */
export type ReadOptionsSync = ReadOptions<ReadEntrySync>

/** The archive data that `entries` reads. */
export type TarInput =
  | Uint8Array
  | ArrayBuffer
  | Blob
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>
  | Iterable<Uint8Array>

/** The archive data that `entriesSync` reads. */
export type TarInputSync = Uint8Array | ArrayBuffer | Iterable<Uint8Array>

/** The options of `list`. Set `input`, or `file` and `fs`. */
export type ListOptions = ReadOptions & {
  input?: TarInput
  /** The path of the archive file. */
  file?: string
  fs?: TarFS
  /** The most bytes to read from the file at one time. Default 16 MiB. */
  maxReadSize?: number
  /** Called with each entry. A promise is awaited before the next entry. */
  onEntry?: (entry: ReadEntry) => unknown
}

/** The options of `listSync`. Set `input`, or `file` and `fs`. */
export type ListOptionsSync = ReadOptionsSync & {
  input?: TarInputSync
  /** The path of the archive file. */
  file?: string
  fs?: TarFSSync
  /** The most bytes to read from the file at one time. Default 16 MiB. */
  maxReadSize?: number
  /** Called with each entry. */
  onEntry?: (entry: ReadEntrySync) => unknown
}
