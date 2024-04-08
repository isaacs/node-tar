// turn tar(1) style args like `C` into the more verbose things like `cwd`

import { type GzipOptions, type ZlibOptions } from 'minizlib'
import { type Stats } from 'node:fs'
import { type ReadEntry } from './read-entry.js'
import { type WarnData } from './warn-method.js'

const argmap = new Map<keyof TarOptionsWithAliases, keyof TarOptions>(
  [
    ['C', 'cwd'],
    ['f', 'file'],
    ['z', 'gzip'],
    ['P', 'preservePaths'],
    ['U', 'unlink'],
    ['strip-components', 'strip'],
    ['stripComponents', 'strip'],
    ['keep-newer', 'newer'],
    ['keepNewer', 'newer'],
    ['keep-newer-files', 'newer'],
    ['keepNewerFiles', 'newer'],
    ['k', 'keep'],
    ['keep-existing', 'keep'],
    ['keepExisting', 'keep'],
    ['m', 'noMtime'],
    ['no-mtime', 'noMtime'],
    ['p', 'preserveOwner'],
    ['L', 'follow'],
    ['h', 'follow'],
  ],
)

/**
 * The options that can be provided to tar commands.
 *
 * Note that some of these are only relevant for certain commands, since
 * they are specific to reading or writing.
 *
 * Aliases are provided in the {@link TarOptionsWithAliases} type.
 */
export interface TarOptions {
  /**
   * Perform all I/O operations synchronously. If the stream is ended
   * immediately, then it will be processed entirely synchronously.
   */
  sync?: boolean

  /**
   * The tar file to be read and/or written. When this is set, a stream
   * is not returned. Asynchronous commands will return a promise indicating
   * when the operation is completed, and synchronous commands will return
   * immediately.
   */
  file?: string

  /**
   * Treat warnings as crash-worthy errors. Defaults false.
   */
  strict?: boolean

  /**
   * The effective current working directory for this tar command
   */
  cwd?: string

  /**
   * When creating a tar archive, this can be used to compress it as well.
   * Set to `true` to use the default gzip options, or customize them as
   * needed.
   *
   * When reading, if this is unset, then the compression status will be
   * inferred from the archive data. This is generally best, unless you are
   * sure of the compression settings in use to create the archive, and want to
   * fail if the archive doesn't match expectations.
   */
  gzip?: boolean | GzipOptions

  /**
   * When creating archives, preserve absolute and `..` paths in the archive,
   * rather than sanitizing them under the cwd.
   *
   * When extracting, allow absolute paths, paths containing `..`, and
   * extracting through symbolic links. By default, the root `/` is stripped
   * from absolute paths (eg, turning `/x/y/z` into `x/y/z`), paths containing
   * `..` are not extracted, and any file whose location would be modified by a
   * symbolic link is not extracted.
   *
   * **WARNING** This is almost always unsafe, and must NEVER be used on
   * archives from untrusted sources, such as user input, and every entry must
   * be validated to ensure it is safe to write. Even if the input is not
   * malicious, mistakes can cause a lot of damage!
   */
  preservePaths?: boolean

  /**
   * When extracting, unlink files before creating them.  Without this option,
   * tar overwrites existing files, which preserves existing hardlinks. With
   * this option, existing hardlinks will be broken, as will any symlink that
   * would affect the location of an extracted file.
   */
  unlink?: boolean

  /**
   * When extracting, strip the specified number of path portions from the
   * entry path. For example, with `{strip: 2}`, the entry `a/b/c/d` would be
   * extracted to `{cwd}/c/d`.
   */
  strip?: number

  /**
   * When extracting, keep the existing file on disk if it's newer than the
   * file in the archive.
   */
  newer?: boolean

  /**
   * When extracting, do not overwrite existing files at all.
   */
  keep?: boolean

  /**
   * When extracting, do not set the `mtime` value for extracted entries to
   * match the `mtime` in the archive.
   *
   * When creating archives, do not store the `mtime` value in the entry. Note
   * that this prevents properly using other mtime-based features (such as
   * `tar.update` or the `newer` option) with the resulting archive.
   */
  noMtime?: boolean

  /**
   * Set the `uid` and `gid` of extracted entries to the `uid` and `gid` fields
   * in the archive. Defaults to true when run as root, and false otherwise.
   *
   * If false, then files and directories will be set with the owner and group
   * of the user running the process.  This is similar to `-p` in `tar(1)`, but
   * ACLs and other system-specific data is never unpacked in this
   * implementation, and modes are set by default already.
   */
  preserveOwner?: boolean

  /**
   * Pack the targets of symbolic links rather than the link itself.
   */
  follow?: boolean

  /**
   * Set to `true` or an object with settings for `zlib.BrotliCompress()` to
   * create a brotli-compressed archive
   */
  brotli?: boolean | ZlibOptions

  /**
   * A function that is called with `(path, stat)` when creating an archive, or
   * `(path, entry)` when unpacking. Return true to process the file/entry, or
   * false to exclude it.
   */
  filter?: (path: string, entry: Stats | ReadEntry) => boolean

  /**
   * A function that gets called for any warning encountered.
   *
   * Note: if `strict` is set, then the warning will throw, and this method
   * will not be called.
   */
  onwarn?: (code: string, message: string, data: WarnData) => any

  /**
   * When unpacking, force all created files and directories, and all
   * implicitly created directories, to be owned by the specified user id,
   * regardless of the `uid` field in the archive.
   *
   * Cannot be used along with `preserveOwner`. Requires also setting the `gid`
   * option.
   */
  uid?: number

  /**
   * When unpacking, force all created files and directories, and all
   * implicitly created directories, to be owned by the specified group id,
   * regardless of the `gid` field in the archive.
   *
   * Cannot be used along with `preserveOwner`. Requires also setting the `uid`
   * option.
   */
  gid?: number

  /**
   * When extracting, provide a function that takes an `entry` object, and
   * returns a stream, or any falsey value. If a stream is provided, then that
   * stream's data will be written instead of the contents of the archive
   * entry. If a falsey value is provided, then the entry is written to disk as
   * normal.
   *
   * To exclude items from extraction, use the `filter` option.
   *
   * Note that using an asynchronous stream type with the `transform` option
   * will cause undefined behavior in synchronous extractions.
   * [MiniPass](http://npm.im/minipass)-based streams are designed for this use
   * case.
   */
  transform?: (entry: ReadEntry) => any

  /**
   * The maximum depth of subfolders to extract into. This defaults to 1024.
   * Anything deeper than the limit will raise a warning and skip the entry.
   * Set to `Infinity` to remove the limitation.
   */
  maxDepth?: number

  /**
   * Do not call `chmod()` to ensure that extracted files match the entry's
   * mode field. This also suppresses the call to `process.umask()` to
   * determine the default umask value, since tar will extract with whatever
   * mode is provided, and let the process `umask` apply normally.
   */
  noChmod?: boolean

  /**
   * When parsing/listing archives, `entry` streams are by default resumed
   * (set into "flowing" mode) immediately after the call to `onentry()`.
   * Set to suppress this behavior.
   *
   * Note that when this is set, the stream will never complete until the
   * data is consumed somehow.
   */
  noResume?: boolean

  /**
   * When extracting or listing archives, this method will be called with
   * each entry that is not excluded by a `filter`.
   *
   * Important when listing archives synchronously from a file, because there
   * is otherwise no way to interact with the data!
   */
  onentry?: (entry: ReadEntry) => any

  /**
   * When creating archives, omit any metadata that is system-specific:
   * `ctime`, `atime`, `uid`, `gid`, `uname`, `gname`, `dev`, `ino`, and
   * `nlink`. Note that `mtime` is still included, because this is necessary
   * for other time-based operations such as `tar.update`. Additionally, `mode`
   * is set to a "reasonable default" for mose unix systems, based on an
   * effective `umask` of `0o22`.
   *
   * This also defaults the `portable` option in the gzip configs when creating
   * a compressed archive, in order to produce deterministic archives that are
   * not operating-system specific.
   */
  portable?: boolean

  /**
   * When creating archives, do not recursively archive the contents of
   * directories. By default, archiving a directory archives all of its
   * contents as well.
   */
  noDirRecurse?: boolean

  /**
   * Suppress Pax extended headers. Note that this means long paths and
   * linkpaths will be truncated, and large or negative numeric values may be
   * interpreted incorrectly.
   */
  noPax?: boolean

  /**
   * Set to a `Date` object to force a specific `mtime` value for everything
   * written to an archive.
   *
   * Overridden by `noMtime`.
   */
  mtime?: Date

  /**
   * A path portion to prefix onto the entries added to an archive.
   */
  prefix?: string

  /**
   * The mode to set on any created file archive, defaults to 0o666
   * masked by the process umask, often resulting in 0o644.
   */
  mode?: number

  //////////////////////////
  // internal options

  /**
   * A cache of mtime values, to avoid having to stat the same file repeatedly.
   * @internal
   */
  mtimeCache?: Map<string, Date>

  /**
   * maximum buffer size for `fs.read()` operations.
   *
   * @internal
   */
  maxReadSize?: number

  /**
   * Filter modes of entries being unpacked, like `process.umask()`
   *
   * @internal
   */
  umask?: number

  /**
   * default mode for directories
   *
   * @internal
   */
  dmode?: number

  /**
   * default mode for files
   *
   * @internal
   */
  fmode?: number

  /**
   * Map that tracks which directories already exist, for extraction
   *
   * @internal
   */
  dirCache?: Map<string, boolean>
  /**
   * maximum supported size of meta entries. Defaults to 1MB
   *
   * @internal
   */
  maxMetaEntrySize?: number

  /**
   * A Map object containing the device and inode value for any file whose
   * `nlink` value is greater than 1, to identify hard links when creating
   * archives.
   *
   * @internal
   */
  linkCache?: Map<LinkCacheKey, string>

  /**
   * A map object containing the results of `fs.readdir()` calls.
   *
   * @internal
   */
  readdirCache?: Map<string, string[]>

  /**
   * A cache of all `lstat` results, for use in creating archives.
   *
   * @internal
   */
  statCache?: Map<string, Stats>

  /**
   * Number of concurrent jobs to run when creating archives.
   *
   * Defaults to 4.
   *
   * @internal
   */
  jobs?: number

  /**
   * Automatically set to true on Windows systems.
   *
   * When unpacking, causes behavior where filenames containing `<|>?:`
   * characters are converted to windows-compatible escape sequences in the
   * created filesystem entries.
   *
   * When packing, causes behavior where paths replace `\` with `/`, and
   * filenames containing the windows-compatible escaped forms of `<|>?:` are
   * converted to actual `<|>?:` characters in the archive.
   *
   * @internal
   */
  win32?: boolean

  /**
   * For `WriteEntry` objects, the absolute path to the entry on the
   * filesystem. By default, this is `resolve(cwd, entry.path)`, but it can be
   * overridden explicitly.
   *
   * @internal
   */
  absolute?: string

  /**
   * Used with Parser stream interface, to attach and take over when the
   * stream is completely parsed. If this is set, then the prefinish,
   * finish, and end events will not fire, and are the responsibility of
   * the ondone method to emit properly.
   *
   * @internal
   */
  ondone?: () => void

  /**
   * Mostly for testing, but potentially useful in some cases.
   * Forcibly trigger a chown on every entry, no matter what.
   */
  forceChown?: boolean
}

export type TarOptionsSync = TarOptions & { sync: true }
export type TarOptionsFile = TarOptions & { file: string }
export type TarOptionsSyncFile = TarOptionsSync & TarOptionsFile

export type LinkCacheKey = `${number}:${number}`

export interface TarOptionsWithAliases extends TarOptions {
  C?: TarOptions['cwd']
  f?: TarOptions['file']
  z?: TarOptions['gzip']
  P?: TarOptions['preservePaths']
  U?: TarOptions['unlink']
  'strip-components'?: TarOptions['strip']
  stripComponents?: TarOptions['strip']
  'keep-newer'?: TarOptions['newer']
  keepNewer?: TarOptions['newer']
  'keep-newer-files'?: TarOptions['newer']
  keepNewerFiles?: TarOptions['newer']
  k?: TarOptions['keep']
  'keep-existing'?: TarOptions['keep']
  keepExisting?: TarOptions['keep']
  m?: TarOptions['noMtime']
  'no-mtime'?: TarOptions['noMtime']
  p?: TarOptions['preserveOwner']
  L?: TarOptions['follow']
  h?: TarOptions['follow']
}

export type TarOptionsWithAliasesSync = TarOptionsWithAliases & {
  sync: true
}
export type TarOptionsWithAliasesFile = TarOptionsWithAliases & {
  file: string
}
export type TarOptionsWithAliasesSyncFile =
  TarOptionsWithAliasesSync & TarOptionsWithAliasesFile

export const isSyncFile = (o: TarOptions): o is TarOptionsSyncFile =>
  !!o.sync && !!o.file
export const isSync = (o: TarOptions): o is TarOptionsSync =>
  !!o.sync
export const isFile = (o: TarOptions): o is TarOptionsFile =>
  !!o.file

const dealiasKey = (
  k: keyof TarOptionsWithAliases,
): keyof TarOptions => {
  const d = argmap.get(k)
  if (d) return d
  return k as keyof TarOptions
}

export const dealias = (
  opt: TarOptionsWithAliases = {},
): TarOptions => {
  if (!opt) return {}
  const result: Record<string, any> = {}
  for (const [key, v] of Object.entries(opt) as [
    keyof TarOptionsWithAliases,
    any,
  ][]) {
    // TS doesn't know that aliases are going to always be the same type
    const k = dealiasKey(key)
    result[k] = v
  }
  return result as TarOptions
}
