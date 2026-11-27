import type { Codec } from './codec.js'
import type { EntryData, ReadEntry, ReadEntrySync } from './read-entry.js'
import type { ExtractFS, ExtractFSSync, TarFS, TarFSSync } from './fs.js'
import type { WarnOptions } from './warn.js'
import type {
  CreateFS,
  CreateFSSync,
  CreateStats,
  ReplaceFS,
  ReplaceFSSync,
} from './fs.js'
import type { WriteEntry } from './write-entry.js'

/**
 * The value of an option that is a count, such as `jobs`: the
 * default if the option is not set or is 0, and a `TypeError` if the
 * value is not a positive integer or `Infinity`.
 */
export const countOption = (
  name: string,
  value: unknown,
  def: number,
): number => {
  if (value === undefined || value === null || value === 0) return def
  if (
    value === Infinity ||
    (Number.isInteger(value) && Number(value) > 0)
  ) {
    return value as number
  }
  throw new TypeError(`${name} must be a positive integer`)
}

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
  /**
   * The most bytes to read from the file at one time. Default, and
   * with 0, 16 MiB. A positive integer, or `Infinity`.
   */
  maxReadSize?: number
  /**
   * Called with each entry. A promise is awaited before the next
   * entry.
   */
  onEntry?: (entry: ReadEntry) => unknown
}

/** The options of `listSync`. Set `input`, or `file` and `fs`. */
export type ListOptionsSync = ReadOptionsSync & {
  input?: TarInputSync
  /** The path of the archive file. */
  file?: string
  fs?: TarFSSync
  /**
   * The most bytes to read from the file at one time. Default, and
   * with 0, 16 MiB. A positive integer, or `Infinity`.
   */
  maxReadSize?: number
  /** Called with each entry. */
  onEntry?: (entry: ReadEntrySync) => unknown
}

/**
 * The options of the extraction that are not about the archive data
 * or the file system functions.
 */
export type UnpackOptions = {
  /** The absolute path of the directory to extract into. */
  cwd: string
  /**
   * With `'win32'`: the path rules of Windows, the characters `<|>?:`
   * in a name are changed to private-use characters, a file is
   * renamed before it is removed, and one entry is extracted at a
   * time.
   */
  platform?: 'win32' | 'posix'
  /** Remove this number of leading parts from each path. */
  strip?: number
  /**
   * Permit absolute paths, `..` in paths, and extraction through
   * symbolic links. This is not safe with an archive that is not
   * trusted.
   */
  preservePaths?: boolean
  /**
   * Remove a file before the entry is written, in place of a write
   * into the existing file. Also remove a symbolic link in the path
   * to an entry.
   */
  unlink?: boolean
  /** Do not write over an existing file. */
  keep?: boolean
  /** Do not write over a file that is newer than the entry. */
  newer?: boolean
  /** Do not set the times of the entries. */
  noMtime?: boolean
  /**
   * Set the owner of each entry to the `uid` and `gid` in the
   * archive. Default: true if `processUid` is 0 and `uid` is not set.
   */
  preserveOwner?: boolean
  /** Set the owner of each entry to this user. Needs `gid`. */
  uid?: number
  /** Set the owner of each entry to this group. Needs `uid`. */
  gid?: number
  /** Set the owner of each entry, also when it is the process owner. */
  forceChown?: boolean
  /**
   * Set the mode of each directory with `chmod`, so that the umask of
   * the process does not change it.
   */
  chmod?: boolean
  /**
   * The umask of the process. Only used with `chmod`. Default 0o22.
   */
  processUmask?: number
  /** The user ID of the process. */
  processUid?: number
  /** The group ID of the process. */
  processGid?: number
  /** Sets the default of `dmode` and `fmode`. Default: `processUmask`. */
  umask?: number
  /** The mode of a directory that has no mode in the archive. */
  dmode?: number
  /** The mode of a file that has no mode in the archive. */
  fmode?: number
  /**
   * The most parts that a path or a link target can have. Default
   * 1024. `Infinity` removes the limit.
   */
  maxDepth?: number
}

/**
 * The options of `extract`. Set `input`, or `file`. With `file`, the
 * `fs` must also have the functions of `TarFS`.
 */
export type ExtractOptions = ReadOptions &
  UnpackOptions & {
    /**
     * The most bytes to read from the file at one time. Default, and
     * with 0, 16 MiB. A positive integer, or `Infinity`.
     */
    maxReadSize?: number
    /**
     * Called with each entry before it is extracted. A promise is
     * awaited before the entry is extracted.
     */
    onEntry?: (entry: ReadEntry) => unknown
    /**
     * Return a stream that changes the content of a file entry, or
     * `undefined` to write the content as it is.
     */
    transform?: (
      entry: ReadEntry,
    ) => TransformStream<Uint8Array, Uint8Array> | undefined
    /**
     * The most entries to extract at one time. Default, and with 0,
     * 16. A positive integer, or `Infinity`.
     */
    jobs?: number
  } & (
    | {
        /**
         * The archive data. A chunk must not change after the source
         * gives it.
         */
        input: TarInput
        /** The name of the archive, for warnings. */
        file?: string
        fs: ExtractFS
      }
    | {
        input?: undefined
        /** The path of the archive file. */
        file: string
        fs: ExtractFS & TarFS
      }
  )

/** The options of `extractSync`. Set `input`, or `file`. */
export type ExtractOptionsSync = ReadOptionsSync &
  UnpackOptions & {
    /**
     * The most bytes to read from the file at one time. Default, and
     * with 0, 16 MiB. A positive integer, or `Infinity`.
     */
    maxReadSize?: number
    /** Called with each entry before it is extracted. */
    onEntry?: (entry: ReadEntrySync) => unknown
    /**
     * Return a function that changes each chunk of the content of a
     * file entry, or `undefined` to write the content as it is.
     */
    transform?: (
      entry: ReadEntrySync,
    ) => ((chunk: Uint8Array) => Uint8Array) | undefined
  } & (
    | {
        input: TarInputSync
        /** The name of the archive, for warnings. */
        file?: string
        fs: ExtractFSSync
      }
    | {
        input?: undefined
        /** The path of the archive file. */
        file: string
        fs: ExtractFSSync & TarFSSync
      }
  )

/** The options that `Pack` and `PackSync` share. */
export type PackOptionsBase<E extends EntryData> = WarnOptions & {
  /**
   * The absolute path of the directory that the paths to add are
   * relative to. A pack needs it, and `fs`, to add a path.
   */
  cwd?: string
  /** A directory to put before the path of each entry. */
  prefix?: string
  /**
   * Leave out the data that is specific to one system: `uid`, `gid`,
   * `uname`, `gname`, `atime`, `ctime`, `dev`, `ino`, `nlink`, and
   * the `mtime` of a directory. Remove the write permission of the
   * group and of others.
   */
  portable?: boolean
  /** Write no PAX header for a field that does not fit the header. */
  noPax?: boolean
  /** Add the target of a symbolic link, not the link. */
  follow?: boolean
  /** Add a directory without the entries in it. */
  noDirRecurse?: boolean
  /** Write no `mtime`. */
  noMtime?: boolean
  /** The `mtime` of each entry. */
  mtime?: Date
  /** Keep a root at the start of a path, such as `/`. */
  preservePaths?: boolean
  /**
   * Called with each path and its `lstat` result (its `stat` result
   * with `follow`), and with each entry of another archive. If it
   * returns false, the path or the entry is not added.
   */
  filter?: (path: string, entry: CreateStats | E) => boolean
  /**
   * The most bytes to read from a file at one time. Default, and
   * with 0, 16 MiB. A positive integer, or `Infinity`. A larger file
   * is not read before the pack comes to it.
   */
  maxReadSize?: number
  /**
   * With `'win32'`, each `\` in a path is changed to `/`, and the
   * characters that `winchars` encodes are decoded.
   */
  platform?: 'win32' | 'posix'
  /** The user ID of the process. */
  processUid?: number
  /** The `uname` of each file that `processUid` owns. */
  processUname?: string
  /**
   * Called with each entry before its header is written. It can
   * change the fields of the entry.
   */
  onWriteEntry?: (entry: WriteEntry) => unknown
  /**
   * Compression formats, before the gzip support of the runtime. The
   * options `gzip`, `brotli`, and `zstd` select the first codec that
   * has that name.
   */
  codecs?: Codec[]
  /** Compress with the codec named `gzip`. */
  gzip?: boolean | Record<string, unknown>
  /** Compress with the codec named `brotli` in `codecs`. */
  brotli?: boolean | Record<string, unknown>
  /** Compress with the codec named `zstd` in `codecs`. */
  zstd?: boolean | Record<string, unknown>
  /**
   * Compress with this codec. It does not need to be in `codecs`.
   * With a pair, the second item is given to the `compress` function
   * of the codec.
   */
  compress?: Codec | [codec: Codec, options: Record<string, unknown>]
}

/** The options of `Pack`. */
export type PackOptions = PackOptionsBase<ReadEntry> & {
  fs?: CreateFS
  /**
   * The number of paths at the start of the queue that are read
   * before the pack writes them. Default, and with 0, 4. A positive
   * integer, or `Infinity`.
   */
  jobs?: number
}

/** The options of `PackSync`. */
export type PackOptionsSync = PackOptionsBase<ReadEntrySync> & {
  fs?: CreateFSSync
}

/**
 * The options of `create`. With `file`, the archive is written to
 * that path through `fs`.
 */
export type CreateOptions = PackOptions & {
  /** The mode of the archive file. Default 0o666. */
  mode?: number
}

/** The options of `createSync`. */
export type CreateOptionsSync = PackOptionsSync & {
  /** The mode of the archive file. Default 0o666. */
  mode?: number
}

/** The options of `replace` and `update`. */
export type ReplaceOptions = CreateOptions & {
  /** The path of the archive file. It is made if it does not exist. */
  file: string
  fs: ReplaceFS
  /**
   * Gets the path and the `mtime` of each entry that the archive
   * has. `update` adds a path only if it is newer than the `mtime`
   * here.
   */
  mtimeCache?: Map<string, Date>
}

/** The options of `replaceSync` and `updateSync`. */
export type ReplaceOptionsSync = CreateOptionsSync & {
  /** The path of the archive file. It is made if it does not exist. */
  file: string
  fs: ReplaceFSSync
  /**
   * Gets the path and the `mtime` of each entry that the archive
   * has. `updateSync` adds a path only if it is newer than the
   * `mtime` here.
   */
  mtimeCache?: Map<string, Date>
}
