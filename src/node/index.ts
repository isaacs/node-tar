// The entry point for Node.js, and for each runtime that has the
// `node:` modules. It has all that the core entry point has. Each
// command gets defaults for the options that the core cannot know:
// the file system, the working directory, the platform, the user of
// the process, and the codecs of `node:zlib`. It adds the sync
// commands.

import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BrotliOptions, ZlibOptions, ZstdOptions } from 'node:zlib'
import type { Codec } from '../codec.js'
import * as core from '../index.js'
import { createSync as coreCreateSync } from '../create.js'
import { entriesSync as coreEntriesSync } from '../entries.js'
import { extractSync as coreExtractSync } from '../extract.js'
import { listSync as coreListSync } from '../list.js'
import type { PackInput, PackInputSync } from '../pack.js'
import type { ReadEntry, ReadEntrySync } from '../read-entry.js'
import { replaceSync as coreReplaceSync } from '../replace.js'
import { ownOptions } from '../unpack.js'
import { updateSync as coreUpdateSync } from '../update.js'
import { zlibCodecs } from './codecs.js'

export * from '../index.js'
export { TarReaderSync } from '../entries.js'
export { PackSync } from '../pack.js'
export { ReadEntrySync } from '../read-entry.js'
export { UnpackSync } from '../unpack.js'
export { zlibCodecs, zlibStream, type ZlibModule } from './codecs.js'

const fs: core.TarFS & core.ExtractFS & core.ReplaceFS = nodeFsPromises
const fsSync: core.TarFSSync & core.ExtractFSSync & core.ReplaceFSSync =
  nodeFs
const platform = process.platform === 'win32' ? 'win32' : 'posix'
const codecs = zlibCodecs()

// Each member of the option type, with `fs` and `cwd` optional.
type Loose<T> =
  T extends unknown ?
    Omit<T, 'fs' | 'cwd'> &
      Partial<Pick<T, Extract<keyof T, 'fs' | 'cwd'>>>
  : never

// The compression options, with the option types of `node:zlib`.
type Zip = {
  /** Compress with gzip. An object is the options of `zlib.createGzip`. */
  gzip?: boolean | ZlibOptions
  /**
   * Compress with brotli. An object is the options of
   * `zlib.createBrotliCompress`.
   */
  brotli?: boolean | BrotliOptions
  /**
   * Compress with zstd. An object is the options of
   * `zlib.createZstdCompress`.
   */
  zstd?: boolean | ZstdOptions
}
type Packing<T> = Omit<Loose<T>, keyof Zip> & Zip

/** The options of `entries`. */
export type ReadOptions = core.ReadOptions
/** The options of `entriesSync`. */
export type ReadOptionsSync = core.ReadOptionsSync
/** The options of `list`. Set `input` or `file`. */
export type ListOptions = Loose<core.ListOptions>
/** The options of `listSync`. Set `input` or `file`. */
export type ListOptionsSync = Loose<core.ListOptionsSync>
/** The options of `extract`. The default of `cwd` is `process.cwd()`. */
export type ExtractOptions = Loose<core.ExtractOptions>
/** The options of `extractSync`. */
export type ExtractOptionsSync = Loose<core.ExtractOptionsSync>
/** The options of `create`. The default of `cwd` is `process.cwd()`. */
export type CreateOptions = Packing<core.CreateOptions>
/** The options of `createSync`. */
export type CreateOptionsSync = Packing<core.CreateOptionsSync>
/** The options of `replace` and `update`. */
export type ReplaceOptions = Packing<core.ReplaceOptions>
/** The options of `replaceSync` and `updateSync`. */
export type ReplaceOptionsSync = Packing<core.ReplaceOptionsSync>

// The options that get a default.
type Defaults = {
  fs?: unknown
  cwd?: string
  platform?: 'win32' | 'posix'
  chmod?: boolean
  processUid?: number
  processGid?: number
  processUname?: string
  processUmask?: number
  codecs?: Codec[]
}

// A copy of the options, with a default for each option that is not
// set. `T` is the option type of the core command.
const fill = <T>(options: Defaults, fs: unknown, paths: boolean): T => {
  const opt = ownOptions(options)
  opt.fs ??= fs
  opt.platform ??= platform
  opt.codecs = [...(opt.codecs ?? []), ...codecs]
  // A command that reads an archive, and writes no file, does not
  // need the working directory or the user.
  if (paths) {
    // `resolve` adds `process.cwd()` to a relative path.
    opt.cwd = resolve(opt.cwd ?? '')
    opt.processUid ??= process.getuid?.()
    opt.processGid ??= process.getgid?.()
    opt.processUname ??= process.env.USER
    if (opt.chmod) opt.processUmask ??= process.umask()
  }
  return opt as T
}

/**
 * Read the entries of an archive. Gzip, brotli, and zstd input is
 * decompressed, if the runtime has the format.
 */
export const entries = (
  input: core.TarInput,
  opt: ReadOptions = {},
): AsyncIterableIterator<ReadEntry, undefined> =>
  core.entries(input, fill(opt, fs, false))

/** The sync form of `entries`. */
export const entriesSync = (
  input: core.TarInputSync,
  opt: ReadOptionsSync = {},
): IterableIterator<ReadEntrySync, undefined> =>
  coreEntriesSync(input, fill(opt, fsSync, false))

/**
 * Call `opt.onEntry` with each entry of an archive. If `files` is
 * set, only with the entries that it lists, and the entries in the
 * directories that it lists.
 */
export const list = (opt: ListOptions, files?: string[]): Promise<void> =>
  core.list(fill(opt, fs, false), files)

/** The sync form of `list`. */
export const listSync = (opt: ListOptionsSync, files?: string[]): void =>
  coreListSync(fill(opt, fsSync, false), files)

/**
 * Extract the entries of an archive into the directory `opt.cwd`.
 * If `files` is set, only the entries that it lists, and the entries
 * in the directories that it lists.
 */
export const extract = (
  opt: ExtractOptions,
  files?: string[],
): Promise<void> => core.extract(fill(opt, fs, true), files)

/** The sync form of `extract`. */
export const extractSync = (
  opt: ExtractOptionsSync,
  files?: string[],
): void => coreExtractSync(fill(opt, fsSync, true), files)

/**
 * Make an archive of the files. With `opt.file`, the archive is
 * written to that path. With no `opt.file`, the result is a stream
 * of the bytes of the archive.
 */
export function create(
  opt: CreateOptions & { file: string },
  files: PackInput[],
): Promise<void>
export function create(
  opt: CreateOptions & { file?: undefined },
  files: PackInput[],
): ReadableStream<Uint8Array>
export function create(
  opt: CreateOptions,
  files: PackInput[],
): Promise<void> | ReadableStream<Uint8Array>
export function create(
  opt: CreateOptions,
  files: PackInput[],
): Promise<void> | ReadableStream<Uint8Array> {
  return core.create(fill(opt, fs, true), files)
}

/**
 * The sync form of `create`. With no `opt.file`, the result is an
 * iterator of the bytes of the archive.
 */
export function createSync(
  opt: CreateOptionsSync & { file: string },
  files: PackInputSync[],
): void
export function createSync(
  opt: CreateOptionsSync & { file?: undefined },
  files: PackInputSync[],
): IterableIterator<Uint8Array, undefined>
export function createSync(
  opt: CreateOptionsSync,
  files: PackInputSync[],
): void | IterableIterator<Uint8Array, undefined>
export function createSync(
  opt: CreateOptionsSync,
  files: PackInputSync[],
): void | IterableIterator<Uint8Array, undefined> {
  return coreCreateSync(fill(opt, fsSync, true), files)
}

/** Add the files to the end of an archive file that is not compressed. */
export const replace = (
  opt: ReplaceOptions,
  files: PackInput[],
): Promise<void> => core.replace(fill(opt, fs, true), files)

/** The sync form of `replace`. */
export const replaceSync = (
  opt: ReplaceOptionsSync,
  files: PackInputSync[],
): void => coreReplaceSync(fill(opt, fsSync, true), files)

/**
 * The same as `replace`, but a file is added only if it is not older
 * than the last entry of the archive that has its path.
 */
export const update = (
  opt: ReplaceOptions,
  files: PackInput[],
): Promise<void> => core.update(fill(opt, fs, true), files)

/** The sync form of `update`. */
export const updateSync = (
  opt: ReplaceOptionsSync,
  files: PackInputSync[],
): void => coreUpdateSync(fill(opt, fsSync, true), files)

export { create as c, extract as x, list as t, replace as r, update as u }
