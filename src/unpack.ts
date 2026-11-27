import { SymlinkError } from './symlink-error.js'
import type { EntryTypeName } from './types.js'
import * as wc from './winchars.js'
import { TarReader, TarReaderSync } from './entries.js'
import type { ExtractFS, ExtractFSSync, ExtractStats } from './fs.js'
import { mkdir, mkdirSync, type MkdirOptions } from './mkdir.js'
import {
  countOption,
  ownOptions,
  type ExtractOptions,
  type ExtractOptionsSync,
  type ReadOptions,
  type TarInput,
  type TarInputSync,
  type UnpackOptions,
} from './options.js'
import { PathReservations } from './path-reservations.js'
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from './path.js'
import type { EntryData, ReadEntry, ReadEntrySync } from './read-entry.js'
import { stripAbsolutePath } from './strip-absolute-path.js'
import { warn, type WarnData } from './warn.js'
import {
  win32Dirname,
  win32IsAbsolute,
  win32Resolve,
  win32Root,
} from './win32-path.js'
import { writeFlags, type OpenConstants } from './write-flag.js'

const DEFAULT_MAX_DEPTH = 1024
// Longer than any path that a supported platform can create.
const MAX_PATH_LENGTH = 32768
const DEFAULT_JOBS = 16

const fileTypes = new Set<EntryTypeName>([
  'File',
  'OldFile',
  'ContiguousFile',
])
const dirTypes = new Set<EntryTypeName>(['Directory', 'GNUDumpDir'])
const linkTypes = new Set<EntryTypeName>(['Link', 'SymbolicLink'])

// The first of the values that is an unsigned 32-bit integer, or the
// last value.
const uint32 = (
  a: number | undefined,
  b: number | undefined,
  c: number | undefined,
) =>
  a !== undefined ? a
  : b !== undefined && b === b >>> 0 ? b
  : c

/** The options that `UnpackBase` reads. */
export type UnpackBaseOptions<E extends EntryData> = ReadOptions<E> &
  UnpackOptions & { fs: { constants?: OpenConstants } }

/**
 * The parts of the extraction that do not use the file system: the
 * options, the checks of each entry, and the warnings. `Unpack` and
 * `UnpackSync` add the file system work.
 */
export class UnpackBase<
  E extends EntryData,
  O extends UnpackBaseOptions<E> = UnpackBaseOptions<E>,
> {
  /** The options, with no prototype. */
  opt: O
  /** The absolute path of the extraction directory. */
  cwd: string
  win32: boolean
  strip: number
  maxDepth: number
  preservePaths: boolean
  unlink: boolean
  keep: boolean
  newer: boolean
  noMtime: boolean
  chmod: boolean
  uid?: number
  gid?: number
  preserveOwner: boolean
  forceChown: boolean
  processUid?: number
  processGid?: number
  processUmask: number
  umask: number
  dmode: number
  fmode: number
  /** Gives the `open` flag for a new file of a given size. */
  writeFlag: (size: number) => string | number
  /** Resolve a path from an absolute path. */
  resolve: (base: string, path: string) => string
  /** The parent directory of an absolute path. */
  dirname: (path: string) => string
  /** Set when an error stops the extraction. */
  fatal?: { error: unknown }

  constructor(options: O) {
    const opt = (this.opt = ownOptions(options))
    const win32 = (this.win32 = opt.platform === 'win32')
    this.resolve = win32 ? win32Resolve : resolve
    this.dirname = win32 ? win32Dirname : dirname

    if (typeof opt.cwd !== 'string') {
      throw new TypeError('cwd is required')
    }
    const cwd = win32 ? opt.cwd.replaceAll('\\', '/') : opt.cwd
    if (!(win32 ? win32IsAbsolute : isAbsolute)(cwd)) {
      throw new TypeError('cwd must be an absolute path')
    }
    this.cwd = this.resolve(cwd, '')

    if (typeof opt.uid === 'number' || typeof opt.gid === 'number') {
      // need both or neither
      if (typeof opt.uid !== 'number' || typeof opt.gid !== 'number') {
        throw new TypeError('cannot set owner without number uid and gid')
      }
      // A value that is not valid must not fall back to the owner
      // in the archive.
      if (opt.uid !== opt.uid >>> 0 || opt.gid !== opt.gid >>> 0) {
        throw new TypeError('uid and gid must be unsigned 32-bit integers')
      }
      if (opt.preserveOwner) {
        throw new TypeError(
          'cannot preserve owner in archive and also set owner explicitly',
        )
      }
      this.uid = opt.uid
      this.gid = opt.gid
    }
    this.processUid = opt.processUid
    this.processGid = opt.processGid
    this.preserveOwner =
      opt.preserveOwner === undefined && typeof opt.uid !== 'number' ?
        opt.processUid === 0
      : !!opt.preserveOwner
    this.forceChown = opt.forceChown === true

    this.maxDepth =
      typeof opt.maxDepth === 'number' ? opt.maxDepth : DEFAULT_MAX_DEPTH
    this.strip = Number(opt.strip) || 0
    this.preservePaths = !!opt.preservePaths
    this.unlink = !!opt.unlink
    this.keep = !!opt.keep
    this.newer = !!opt.newer
    this.noMtime = !!opt.noMtime
    this.chmod = !!opt.chmod

    // Without chmod, the umask of the process is not needed.
    this.processUmask =
      !this.chmod ? 0
      : typeof opt.processUmask === 'number' ? opt.processUmask
      : 0o22
    this.umask =
      typeof opt.umask === 'number' ? opt.umask : this.processUmask
    this.dmode = opt.dmode || 0o777 & ~this.umask
    this.fmode = opt.fmode || 0o666 & ~this.umask

    this.writeFlag = writeFlags(opt.fs.constants, win32)
  }

  /**
   * Report a problem to `onwarn`, or throw it if `strict` is set. A
   * damaged archive is always an error here, because the extraction
   * cannot be complete.
   */
  warn(code: string, message: string | Error, data: WarnData = {}): void {
    if (code === 'TAR_BAD_ARCHIVE' || code === 'TAR_ABORT') {
      data.recoverable = false
    }
    data.cwd = this.cwd
    warn(this.opt, code, message, data)
  }

  /** The options for the reader. Its warnings go to `warn()`. */
  readerOptions(): ReadOptions<E> {
    return ownOptions<ReadOptions<E>>(this.opt, {
      strict: false,
      onwarn: (code, message, data) =>
        data instanceof Error ?
          this.warn(code, data)
        : this.warn(code, message, data),
    })
  }

  /**
   * Report the failure of one entry as a `TAR_ENTRY_ERROR` warning.
   * Throws the error if it stops the extraction: the extraction
   * directory is not usable, the archive cannot be read, or `strict`
   * is set.
   */
  entryError(er: unknown, entry: E): void {
    if (this.fatal?.error === er || (er as Error)?.name === 'CwdError') {
      throw er
    }
    this.warn('TAR_ENTRY_ERROR', er as Error, { entry })
  }

  /** Record the error that stops the extraction. Returns it. */
  fail(error: unknown): unknown {
    this.fatal ??= { error }
    return error
  }

  // Remove the root of an absolute path, and refuse a path that can
  // leave the extraction directory. False if the entry is refused.
  #stripAbsolutePath(entry: E, field: 'path' | 'linkpath'): boolean {
    const p = entry[field]
    if (!p || this.preservePaths) return true

    const [root, stripped] = stripAbsolutePath(p)
    const parts = stripped.replaceAll('\\', '/').split('/')

    if (parts.includes('..')) {
      // A path, and the target of a hard link, cannot have '..' at
      // all. The target of a symbolic link is relative to the
      // directory of the link, so '../sibling/file' can be valid.
      if (field === 'path' || entry.type === 'Link') {
        this.warn('TAR_ENTRY_ERROR', `${field} contains '..'`, {
          entry,
          [field]: p,
        })
        return false
      }
      // A '..' is only safe at the start of the target. Any named
      // part before it can be a symlink, and then the '..' goes to
      // the parent of the target of that symlink.
      const firstName = parts.findIndex(
        part => part !== '..' && part !== '.' && part !== '',
      )
      if (firstName !== -1 && parts.includes('..', firstName)) {
        this.warn(
          'TAR_ENTRY_ERROR',
          `${field} contains '..' after a path portion`,
          { entry, [field]: p },
        )
        return false
      }
      // Normalize the path, so that the directory is the one where
      // the link is created. The path 'x/.' creates the link 'x'.
      const entryDir = dirname(normalize(entry.path))
      const resolved = normalize(join(entryDir, parts.join('/')))
      if (resolved.startsWith('../') || resolved === '..') {
        this.warn(
          'TAR_ENTRY_ERROR',
          `${field} escapes extraction directory`,
          { entry, [field]: p },
        )
        return false
      }
    }

    if (root) {
      ;(entry as EntryData)[field] = stripped
      this.warn(
        'TAR_ENTRY_INFO',
        `stripping ${root} from absolute ${field}`,
        { entry, [field]: p },
      )
    }
    return true
  }

  /**
   * Check the entry, with no use of the file system. Set its
   * `absolute` path, and change its `path`, `linkpath`, and `mode` to
   * the values to extract. False if the entry must not be extracted.
   */
  check(entry: E): boolean {
    const p = entry.path
    const parts = p.split('/')

    if (this.strip) {
      if (parts.length < this.strip) return false
      if (entry.type === 'Link') {
        const linkparts = String(entry.linkpath).split('/')
        if (linkparts.length < this.strip) return false
        entry.linkpath = linkparts.slice(this.strip).join('/')
      }
      parts.splice(0, this.strip)
      // No part of the path is left, as for the top directory of a
      // package. The entry must not change the extraction directory.
      if (parts.every(part => part === '')) return false
      entry.path = parts.join('/')
    }

    const { maxDepth } = this
    if (isFinite(maxDepth) && parts.length > maxDepth) {
      this.warn('TAR_ENTRY_ERROR', 'path excessively deep', {
        entry,
        path: p,
        depth: parts.length,
        maxDepth,
      })
      return false
    }
    // The path reservations do work for each parent directory of the
    // path and of the linkpath.
    const { linkpath } = entry
    if (
      linkpath &&
      isFinite(maxDepth) &&
      linkpath.split('/').length > maxDepth
    ) {
      this.warn('TAR_ENTRY_ERROR', 'linkpath excessively deep', {
        entry,
        path: p,
        linkpath,
        maxDepth,
      })
      return false
    }
    for (const field of ['path', 'linkpath'] as const) {
      const { length } = entry[field] ?? ''
      if (length > MAX_PATH_LENGTH) {
        this.warn('TAR_ENTRY_ERROR', `${field} excessively long`, {
          entry,
          path: p,
          length,
          maxLength: MAX_PATH_LENGTH,
        })
        return false
      }
    }

    if (
      !this.#stripAbsolutePath(entry, 'path') ||
      !this.#stripAbsolutePath(entry, 'linkpath')
    ) {
      return false
    }

    const { cwd } = this
    let absolute = this.resolve(cwd, entry.path)

    // The checks above refuse a path that leaves the extraction
    // directory. This check is defense in depth.
    if (
      !this.preservePaths &&
      absolute !== cwd &&
      // A root, such as `/` or `c:/`, ends with a slash.
      !absolute.startsWith(cwd.endsWith('/') ? cwd : cwd + '/')
    ) {
      this.warn('TAR_ENTRY_ERROR', 'path escaped extraction target', {
        entry,
        path: entry.path,
        resolvedPath: absolute,
        cwd,
      })
      return false
    }

    // An archive can set properties of the extraction directory, but
    // it cannot replace it with a different kind of thing.
    if (absolute === cwd && !dirTypes.has(entry.type)) return false

    // Do not change the ':' of a drive letter.
    if (this.win32) {
      const aRoot = win32Root(absolute)
      absolute = aRoot + wc.encode(absolute.slice(aRoot.length))
      const pRoot = win32Root(entry.path)
      entry.path = pRoot + wc.encode(entry.path.slice(pRoot.length))
    }
    entry.absolute = absolute

    // Never set the setuid, setgid, or sticky bit from an archive.
    if (typeof entry.mode === 'number') entry.mode &= 0o777

    if (dirTypes.has(entry.type)) {
      if (entry.mode) entry.mode |= 0o700
    } else if (!fileTypes.has(entry.type) && !linkTypes.has(entry.type)) {
      // A device or a FIFO is never made.
      entry.unsupported = true
      this.warn(
        'TAR_ENTRY_UNSUPPORTED',
        `unsupported entry type: ${entry.type}`,
        { entry },
      )
      return false
    }
    return true
  }

  /**
   * The paths that the entry must have for itself while it is made.
   * A link also reserves its target, so that an entry that makes the
   * target, and an entry that goes through the link, do not run at
   * the same time as the link.
   */
  reservedPaths(entry: E): string[] {
    const { path, linkpath } = entry
    if (!linkpath) return [path]
    // The target of a symlink is relative to the directory of the
    // link. The target of a hard link is relative to the cwd.
    return [
      path,
      entry.type === 'SymbolicLink' && !isAbsolute(linkpath) ?
        join(dirname(path), linkpath)
      : linkpath,
    ]
  }

  /** The options to make a directory with a mode. */
  mkdirOptions(mode: number): MkdirOptions {
    return {
      uid: this.uid,
      gid: this.gid,
      processUid: this.processUid,
      processGid: this.processGid,
      umask: this.processUmask,
      preserve: this.preservePaths,
      unlink: this.unlink,
      cwd: this.cwd,
      mode,
    }
  }

  /**
   * The owner to set on the entry, if it needs one: with
   * `preserveOwner`, when the owner in the archive is not the process
   * owner, and with `uid` and `gid`, when they are not the process
   * owner.
   */
  owner(entry: E): { uid: number; gid: number } | undefined {
    const doChown =
      this.forceChown ||
      (this.preserveOwner &&
        ((typeof entry.uid === 'number' &&
          entry.uid !== this.processUid) ||
          (typeof entry.gid === 'number' &&
            entry.gid !== this.processGid))) ||
      (typeof this.uid === 'number' && this.uid !== this.processUid) ||
      (typeof this.gid === 'number' && this.gid !== this.processGid)
    const uid = uint32(this.uid, entry.uid, this.processUid)
    const gid = uint32(this.gid, entry.gid, this.processGid)
    return doChown && typeof uid === 'number' && typeof gid === 'number' ?
        { uid, gid }
      : undefined
  }

  /** The times to set on the entry, if it needs them. */
  times(entry: E): { atime: Date; mtime: Date } | undefined {
    return entry.mtime && !this.noMtime ?
        { atime: entry.atime || new Date(), mtime: entry.mtime }
      : undefined
  }

  /** True if the object on disk at the path of the entry must stay. */
  skip(entry: E, st: ExtractStats): boolean {
    return (
      this.keep || (this.newer && st.mtime > (entry.mtime ?? st.mtime))
    )
  }

  /**
   * True if the entry can be written into the file that is on disk.
   * A file with more than one link is not used, because the write
   * would change the other links. Windows does not report a useful
   * link count.
   */
  isReusable(entry: E, st: ExtractStats): boolean {
    return (
      entry.type === 'File' &&
      !this.unlink &&
      st.isFile() &&
      st.nlink <= 1 &&
      !this.win32
    )
  }

  /**
   * The parts of the path from the extraction directory to the
   * target of a link entry. None of them can be a symbolic link.
   */
  linkParts(entry: E, absolute: string): string[] {
    const linkpath = String(entry.linkpath)
    return entry.type === 'Link' ?
        linkpath.split('/')
      : relative(
          this.cwd,
          this.resolve(this.dirname(absolute), linkpath),
        ).split('/')
  }

  /** The error for a link target that goes through a symbolic link. */
  symlinkError(symlink: string, parts: string[]): SymlinkError {
    return new SymlinkError(
      symlink,
      this.resolve(this.cwd, parts.join('/')),
    )
  }
}

// Unlinks on Windows are not atomic. A file that is made at the path
// of a file that was just removed can be removed with it. So rename
// the file first, and then remove it under the new name.
const deleteName = (path: string) =>
  path +
  '.DELETE.' +
  Array.from(crypto.getRandomValues(new Uint8Array(16)), b =>
    b.toString(16).padStart(2, '0'),
  ).join('')

/**
 * Extracts the entries of an archive with async file system
 * functions.
 *
 * Several entries are extracted at one time. Entries that use the
 * same path, or a path and a directory above it, are extracted in
 * the order of the archive.
 */
export class Unpack extends UnpackBase<ReadEntry, ExtractOptions> {
  #fs: ExtractFS
  #reservations: PathReservations
  #jobs: number
  // the number of entries that are in work
  #active: number = 0
  #wake?: () => void
  #checkedCwd: boolean = false
  #cwdCheck?: Promise<void>

  constructor(opt: ExtractOptions) {
    super(opt)
    this.#fs = this.opt.fs
    this.#reservations = new PathReservations(this.win32)
    this.#jobs = countOption('jobs', this.opt.jobs, DEFAULT_JOBS)
  }

  /**
   * Extract the archive. The promise settles when all the file
   * system work is done. It rejects with the first error that stops
   * the extraction.
   */
  async extract(input: TarInput): Promise<void> {
    const reader = new TarReader(input, this.readerOptions())
    const { onEntry } = this.opt
    const stream = !!this.opt.transform
    try {
      while (!this.fatal) {
        const entry = reader.poll()
        if (entry === null) break
        if (entry === undefined) {
          await reader.fill()
          continue
        }
        if (onEntry) await onEntry(entry)
        // The caller took the content, so there is nothing to write.
        if (entry.bodyUsed) continue
        if (!this.check(entry)) continue

        // A file whose content is all in memory is written while the
        // next entries are read. Other files are written as their
        // content arrives.
        const body: Uint8Array[] = []
        let inMemory = !stream
        if (inMemory && fileTypes.has(entry.type)) {
          for (;;) {
            const part = reader.readBody(entry)
            if (part === null) break
            if (part === undefined) {
              inMemory = false
              break
            }
            body.push(part)
          }
        }
        const work = this.#start(
          entry,
          body,
          inMemory ? undefined : reader,
        )
        if (!inMemory) await work
        while (this.#active >= this.#jobs) await this.#idle()
      }
    } catch (er) {
      this.fail(er)
    }
    await reader.return().catch(er => this.fail(er))
    while (this.#active > 0) await this.#idle()
    if (this.fatal) {
      const { error } = this.fatal
      if (error && typeof error === 'object' && 'tarCode' in error) {
        Object.assign(error, { cwd: this.cwd })
      }
      throw error
    }
  }

  // Resolves when an entry that is in work is done.
  #idle(): Promise<void> {
    return new Promise<void>(res => {
      this.#wake = res
    })
  }

  // Extract the entry when its paths are free. The promise never
  // rejects: a failure is a warning, or it sets `fatal`.
  #start(
    entry: ReadEntry,
    body: Uint8Array[],
    reader: TarReader | undefined,
  ): Promise<void> {
    this.#active++
    return this.#reservations.reserve(
      this.reservedPaths(entry),
      async () => {
        try {
          if (!this.fatal) await this.#extract(entry, body, reader)
        } catch (er) {
          try {
            this.entryError(er, entry)
          } catch (fatal) {
            this.fail(fatal)
          }
        }
        this.#active--
        this.#wake?.()
      },
    )
  }

  #mkdir(dir: string, mode: number): Promise<void> {
    return mkdir(this.#fs, dir, this.mkdirOptions(mode))
  }

  // The extraction directory must exist. Entries that start at the
  // same time share one check.
  #checkCwd(): Promise<void> {
    return (this.#cwdCheck ??= this.#mkdir(this.cwd, this.dmode).then(
      () => {
        this.#checkedCwd = true
      },
      er => {
        this.#cwdCheck = undefined
        throw er
      },
    ))
  }

  async #extract(
    entry: ReadEntry,
    body: Uint8Array[],
    reader: TarReader | undefined,
  ): Promise<void> {
    const fs = this.#fs
    const absolute = entry.absolute as string
    const { cwd } = this
    if (!this.#checkedCwd) await this.#checkCwd()
    if (absolute !== cwd) {
      const parent = this.dirname(absolute)
      if (parent !== cwd) await this.#mkdir(parent, this.dmode)
    }

    // Remove what is at the path, if the entry cannot use it.
    const st = await fs.lstat(absolute).catch(() => undefined)
    if (st && this.skip(entry, st)) return
    if (st && !this.isReusable(entry, st)) {
      if (st.isDirectory() && dirTypes.has(entry.type)) {
        if (
          this.chmod &&
          entry.mode &&
          (st.mode & 0o7777) !== entry.mode
        ) {
          await fs.chmod(absolute, entry.mode)
        }
      } else if (absolute !== cwd) {
        if (st.isDirectory()) await fs.rmdir(absolute)
        else await this.#unlink(absolute)
      }
    }

    if (fileTypes.has(entry.type)) {
      return this.#file(entry, absolute, body, reader)
    }
    if (dirTypes.has(entry.type)) return this.#directory(entry, absolute)
    await this.#ensureNoSymlink(this.linkParts(entry, absolute))
    const linkpath = String(entry.linkpath)
    if (entry.type === 'Link') {
      await fs.link(this.resolve(cwd, linkpath), absolute)
    } else {
      await fs.symlink(linkpath, absolute)
    }
  }

  async #unlink(path: string): Promise<void> {
    const fs = this.#fs
    if (!this.win32) return fs.unlink(path)
    const name = deleteName(path)
    await fs.rename(path, name)
    await fs.unlink(name)
  }

  async #ensureNoSymlink(parts: string[]): Promise<void> {
    if (this.preservePaths) return
    let t = this.cwd
    for (const p of parts) {
      t = this.resolve(t, p)
      const st = await this.#fs.lstat(t).catch(() => undefined)
      if (!st) return
      if (st.isSymbolicLink()) throw this.symlinkError(t, parts)
    }
  }

  async #directory(entry: ReadEntry, absolute: string): Promise<void> {
    const fs = this.#fs
    await this.#mkdir(absolute, entry.mode ?? this.dmode)
    // These do not follow a symbolic link that replaced the
    // directory. A failure is not an error of the entry.
    const times = this.times(entry)
    if (times) {
      await fs.lutimes(absolute, times.atime, times.mtime).catch(() => {})
    }
    const owner = this.owner(entry)
    if (owner) {
      await fs.lchown(absolute, owner.uid, owner.gid).catch(() => {})
    }
  }

  async #file(
    entry: ReadEntry,
    absolute: string,
    body: Uint8Array[],
    reader: TarReader | undefined,
  ): Promise<void> {
    const fs = this.#fs
    const handle = await fs.open(
      absolute,
      this.writeFlag(entry.size),
      entry.mode ?? this.fmode,
    )
    try {
      if (reader) await this.#pipe(entry, body, reader, handle)
      else for (const part of body) await handle.write(part)

      // Use the open file, so that a symbolic link that replaced the
      // path is not followed. If that fails, use the path.
      const times = this.times(entry)
      if (times) {
        const { atime, mtime } = times
        await handle.utimes(atime, mtime).catch(async er => {
          await fs.utimes(absolute, atime, mtime).catch(() => {
            throw er
          })
        })
      }
      const owner = this.owner(entry)
      if (owner) {
        const { uid, gid } = owner
        await handle.chown(uid, gid).catch(async er => {
          await fs.chown(absolute, uid, gid).catch(() => {
            throw er
          })
        })
      }
    } catch (er) {
      await handle.close().catch(() => {})
      throw er
    }
    await handle.close()
  }

  // Write the content of the entry as it arrives, through the
  // transform stream if there is one.
  async #pipe(
    entry: ReadEntry,
    body: Uint8Array[],
    reader: TarReader,
    handle: { write(data: Uint8Array): Promise<unknown> },
  ): Promise<void> {
    let i = 0
    const next = async (): Promise<Uint8Array | null> => {
      if (i < body.length) return body[i++] as Uint8Array
      try {
        for (;;) {
          const part = reader.readBody(entry)
          if (part !== undefined) return part
          await reader.fill()
        }
      } catch (er) {
        // The archive cannot be read.
        throw this.fail(er)
      }
    }

    const tx = this.opt.transform?.(entry)
    if (!tx) {
      // Write one part while the next part is read.
      let writing: Promise<void> | undefined
      let failed: { error: unknown } | undefined
      try {
        for (let part; (part = await next()); ) {
          await writing
          if (failed) break
          writing = handle.write(part).then(
            () => {},
            error => {
              failed = { error }
            },
          )
        }
      } finally {
        await writing
      }
      if (failed) throw failed.error
      return
    }

    const writer = tx.writable.getWriter()
    const out = tx.readable.getReader()
    let failed: { error: unknown } | undefined
    // Stop the two streams. A read that waits gets the end of the
    // stream, and a write that waits fails.
    const stop = async (error: unknown) => {
      failed ??= { error }
      await out.cancel(error).catch(() => {})
      await writer.abort(error).catch(() => {})
    }
    const feed = (async () => {
      try {
        for (let part; (part = await next()); ) await writer.write(part)
        await writer.close()
      } catch (er) {
        await stop(er)
      }
    })()
    try {
      for (;;) {
        const { done, value } = await out.read()
        if (done) break
        await handle.write(value)
      }
    } catch (er) {
      await stop(er)
    }
    // The feed reads the archive, so it must end before the next
    // entry is read.
    await feed
    if (failed) throw failed.error
  }
}

/**
 * Extracts the entries of an archive with sync file system
 * functions, one entry at a time.
 */
export class UnpackSync extends UnpackBase<
  ReadEntrySync,
  ExtractOptionsSync
> {
  #fs: ExtractFSSync
  #checkedCwd: boolean = false

  constructor(opt: ExtractOptionsSync) {
    super(opt)
    this.#fs = this.opt.fs
  }

  /** Extract the archive. Throws the first error that stops it. */
  extract(input: TarInputSync): void {
    const reader = new TarReaderSync(input, this.readerOptions())
    const { onEntry } = this.opt
    try {
      for (const entry of reader) {
        onEntry?.(entry)
        if (entry.bodyUsed) continue
        if (!this.check(entry)) continue
        try {
          this.#extract(entry, reader)
        } catch (er) {
          this.entryError(er, entry)
        }
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'tarCode' in error) {
        Object.assign(error, { cwd: this.cwd })
      }
      throw error
    }
  }

  #mkdir(dir: string, mode: number): void {
    mkdirSync(this.#fs, dir, this.mkdirOptions(mode))
  }

  #extract(entry: ReadEntrySync, reader: TarReaderSync): void {
    const fs = this.#fs
    const absolute = entry.absolute as string
    const { cwd } = this
    if (!this.#checkedCwd) {
      this.#mkdir(cwd, this.dmode)
      this.#checkedCwd = true
    }
    if (absolute !== cwd) {
      const parent = this.dirname(absolute)
      if (parent !== cwd) this.#mkdir(parent, this.dmode)
    }

    // Remove what is at the path, if the entry cannot use it.
    let st: ExtractStats | undefined
    try {
      st = fs.lstatSync(absolute)
    } catch {}
    if (st && this.skip(entry, st)) return
    if (st && !this.isReusable(entry, st)) {
      if (st.isDirectory() && dirTypes.has(entry.type)) {
        if (
          this.chmod &&
          entry.mode &&
          (st.mode & 0o7777) !== entry.mode
        ) {
          fs.chmodSync(absolute, entry.mode)
        }
      } else if (absolute !== cwd) {
        if (st.isDirectory()) fs.rmdirSync(absolute)
        else this.#unlink(absolute)
      }
    }

    if (fileTypes.has(entry.type)) {
      return this.#file(entry, absolute, reader)
    }
    if (dirTypes.has(entry.type)) return this.#directory(entry, absolute)
    this.#ensureNoSymlink(this.linkParts(entry, absolute))
    const linkpath = String(entry.linkpath)
    if (entry.type === 'Link') {
      fs.linkSync(this.resolve(cwd, linkpath), absolute)
    } else {
      fs.symlinkSync(linkpath, absolute)
    }
  }

  #unlink(path: string): void {
    const fs = this.#fs
    if (!this.win32) return fs.unlinkSync(path)
    const name = deleteName(path)
    fs.renameSync(path, name)
    fs.unlinkSync(name)
  }

  #ensureNoSymlink(parts: string[]): void {
    if (this.preservePaths) return
    let t = this.cwd
    for (const p of parts) {
      t = this.resolve(t, p)
      let st: ExtractStats
      try {
        st = this.#fs.lstatSync(t)
      } catch {
        return
      }
      if (st.isSymbolicLink()) throw this.symlinkError(t, parts)
    }
  }

  #directory(entry: ReadEntrySync, absolute: string): void {
    const fs = this.#fs
    this.#mkdir(absolute, entry.mode ?? this.dmode)
    // These do not follow a symbolic link that replaced the
    // directory. A failure is not an error of the entry.
    const times = this.times(entry)
    if (times) {
      try {
        fs.lutimesSync(absolute, times.atime, times.mtime)
      } catch {}
    }
    const owner = this.owner(entry)
    if (owner) {
      try {
        fs.lchownSync(absolute, owner.uid, owner.gid)
      } catch {}
    }
  }

  #file(
    entry: ReadEntrySync,
    absolute: string,
    reader: TarReaderSync,
  ): void {
    const fs = this.#fs
    const fd = fs.openSync(
      absolute,
      this.writeFlag(entry.size),
      entry.mode ?? this.fmode,
    )
    try {
      const tx = this.opt.transform?.(entry)
      for (;;) {
        let part: Uint8Array | null
        try {
          part = reader.readBody(entry)
        } catch (er) {
          // The archive cannot be read.
          throw this.fail(er)
        }
        if (!part) break
        fs.writeSync(fd, tx ? tx(part) : part)
      }

      // Use the open file, so that a symbolic link that replaced the
      // path is not followed. If that fails, use the path.
      const times = this.times(entry)
      if (times) {
        const { atime, mtime } = times
        try {
          fs.futimesSync(fd, atime, mtime)
        } catch (er) {
          try {
            fs.utimesSync(absolute, atime, mtime)
          } catch {
            throw er
          }
        }
      }
      const owner = this.owner(entry)
      if (owner) {
        const { uid, gid } = owner
        try {
          fs.fchownSync(fd, uid, gid)
        } catch (er) {
          try {
            fs.chownSync(absolute, uid, gid)
          } catch {
            throw er
          }
        }
      }
    } catch (er) {
      // Close the file one time, and do not use the descriptor again:
      // the system can give its number to a different file.
      try {
        fs.closeSync(fd)
      } catch {}
      throw er
    }
    fs.closeSync(fd)
  }
}
