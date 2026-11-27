// The file system functions that this package calls. `node:fs/promises`
// fits `TarFS`, and `node:fs` fits `TarFSSync`.

import type { OpenConstants } from './write-flag.js'

/** The subset of a `node:fs/promises` `FileHandle` that the code uses. */
export type TarFileHandle = {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>
  stat(): Promise<{ size: number }>
  close(): Promise<void>
}

/** The subset of `node:fs/promises` that the code uses. */
export type TarFS = {
  open(path: string, flags: string): Promise<TarFileHandle>
}

/** The subset of `node:fs` that the sync code uses. */
export type TarFSSync = {
  openSync(path: string, flags: string): number
  fstatSync(fd: number): { size: number }
  readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): number
  closeSync(fd: number): void
}

/** The subset of the `Stats` of `lstat` that the extraction uses. */
export type ExtractStats = {
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
  nlink: number
  mode: number
  mtime: Date
}

/** The subset of a `FileHandle` that the extraction uses. */
export type ExtractFileHandle = {
  write(data: Uint8Array): Promise<unknown>
  utimes(atime: Date, mtime: Date): Promise<void>
  chown(uid: number, gid: number): Promise<void>
  close(): Promise<void>
}

/**
 * The subset of `node:fs/promises` that the extraction uses. To read
 * the archive from a file, it also uses `TarFS`.
 */
export type ExtractFS = {
  /** Without it, the flag of `open` is `'w'`. */
  constants?: OpenConstants
  open(
    path: string,
    flags: string | number,
    mode: number,
  ): Promise<ExtractFileHandle>
  stat(path: string): Promise<{ isDirectory(): boolean }>
  lstat(path: string): Promise<ExtractStats>
  mkdir(
    path: string,
    options: { mode: number; recursive?: boolean },
  ): Promise<string | undefined>
  chmod(path: string, mode: number): Promise<void>
  chown(path: string, uid: number, gid: number): Promise<void>
  lchown(path: string, uid: number, gid: number): Promise<void>
  utimes(path: string, atime: Date, mtime: Date): Promise<void>
  lutimes(path: string, atime: Date, mtime: Date): Promise<void>
  rmdir(path: string): Promise<void>
  unlink(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  link(target: string, path: string): Promise<void>
  symlink(target: string, path: string): Promise<void>
}

/**
 * The subset of `node:fs` that the sync extraction uses. To read the
 * archive from a file, it also uses `TarFSSync`.
 */
export type ExtractFSSync = {
  /** Without it, the flag of `openSync` is `'w'`. */
  constants?: OpenConstants
  openSync(path: string, flags: string | number, mode: number): number
  writeSync(fd: number, data: Uint8Array): number
  futimesSync(fd: number, atime: Date, mtime: Date): void
  fchownSync(fd: number, uid: number, gid: number): void
  closeSync(fd: number): void
  statSync(path: string): { isDirectory(): boolean }
  lstatSync(path: string): ExtractStats
  mkdirSync(
    path: string,
    options: { mode: number; recursive?: boolean },
  ): string | undefined
  chmodSync(path: string, mode: number): void
  chownSync(path: string, uid: number, gid: number): void
  lchownSync(path: string, uid: number, gid: number): void
  utimesSync(path: string, atime: Date, mtime: Date): void
  lutimesSync(path: string, atime: Date, mtime: Date): void
  rmdirSync(path: string): void
  unlinkSync(path: string): void
  renameSync(from: string, to: string): void
  linkSync(target: string, path: string): void
  symlinkSync(target: string, path: string): void
}

/** The subset of the `Stats` of `lstat` that the creation uses. */
export type CreateStats = {
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
  dev: number
  ino: number
  nlink: number
  mode: number
  uid: number
  gid: number
  size: number
  mtime: Date
  atime: Date
  ctime: Date
}

/** The subset of a `FileHandle` that the creation uses. */
export type CreateFileHandle = {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>
  write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesWritten: number }>
  stat(): Promise<{ size: number; dev: number; ino: number }>
  close(): Promise<void>
}

/**
 * The subset of `node:fs/promises` that the creation uses. It also
 * fits `TarFS`, which reads an `@archive` operand.
 */
export type CreateFS = {
  open(
    path: string,
    flags: string,
    mode?: number,
  ): Promise<CreateFileHandle>
  lstat(path: string): Promise<CreateStats>
  stat(path: string): Promise<CreateStats>
  readdir(path: string): Promise<string[]>
  readlink(path: string): Promise<string>
}

/**
 * The subset of `node:fs` that the sync creation uses. It also fits
 * `TarFSSync`, which reads an `@archive` operand.
 */
export type CreateFSSync = {
  openSync(path: string, flags: string, mode?: number): number
  fstatSync(fd: number): { size: number; dev: number; ino: number }
  readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): number
  writeSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): number
  closeSync(fd: number): void
  lstatSync(path: string): CreateStats
  statSync(path: string): CreateStats
  readdirSync(path: string): string[]
  readlinkSync(path: string): string
}

/**
 * The subset of `node:fs/promises` that `replace` and `update` use:
 * `open` with the flags `'r+'`, `'w+'`, and `'r'`, the functions of a
 * file handle, and the functions that read the files to add.
 */
export type ReplaceFS = CreateFS

/** The subset of `node:fs` that `replaceSync` and `updateSync` use. */
export type ReplaceFSSync = CreateFSSync
