// Helpers for the tests of WriteEntry, Pack, and create.
import { chmodrSync } from 'chmodr'
import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { resolve } from 'node:path'
import { Header } from '../../src/header.js'
import { entries, entriesSync } from '../../src/next/entries.js'
import type {
  CreateFileHandle,
  CreateFS,
  CreateFSSync,
  CreateStats,
} from '../../src/next/fs.js'
import type { PackOptionsBase } from '../../src/next/options.js'
import { Pack, PackSync } from '../../src/next/pack.js'
import type {
  EntryData,
  ReadEntry,
  ReadEntrySync,
} from '../../src/next/read-entry.js'
import type { WriteEntry } from '../../src/next/write-entry.js'

export const fixtures = resolve(import.meta.dirname, '../fixtures')
export const files = resolve(fixtures, 'files')
export const tars = resolve(fixtures, 'tars')

export const ctime = new Date('2017-05-10T01:03:12.000Z')
export const atime = new Date('2017-04-17T00:00:00.000Z')
export const mtime = new Date('2016-04-01T19:00:00.000Z')

export const uid = process.getuid?.() ?? 0
export const isWindows = process.platform === 'win32'
export const fileMode = isWindows ? 0o666 : 0o644
export const dirMode = isWindows ? 0o777 : 0o755

// Git does not keep hard links. Make the link again if it is gone,
// and set the modes that the tests expect.
{
  const one = nodeFs.statSync(files + '/hardlink-1')
  const two = nodeFs.statSync(files + '/hardlink-2')
  if (one.dev !== two.dev || one.ino !== two.ino) {
    nodeFs.rmSync(files + '/hardlink-2', { force: true })
    nodeFs.linkSync(files + '/hardlink-1', files + '/hardlink-2')
  }
  chmodrSync(files, 0o644)
}

/** Give the stats the same times in each run. */
export const pin = <T extends CreateStats>(stat: T): T =>
  Object.assign(stat, { atime, ctime, mtime })

/** `node:fs/promises`, with the times of each `lstat` and `stat` pinned. */
export const fs: CreateFS = {
  ...nodeFsPromises,
  lstat: async path => pin(await nodeFsPromises.lstat(path)),
  stat: async path => pin(await nodeFsPromises.stat(path)),
}

/** `node:fs`, with the times of each `lstatSync` and `statSync` pinned. */
export const fsSync: CreateFSSync = {
  ...nodeFs,
  lstatSync: path => pin(nodeFs.lstatSync(path)),
  statSync: path => pin(nodeFs.statSync(path)),
}

/** The filter of a test that runs in each mode. */
export type Filter = (
  path: string,
  entry: CreateStats | EntryData,
) => boolean

/** The options of a test that runs in each mode. */
export type Options = Omit<
  PackOptionsBase<ReadEntry | ReadEntrySync>,
  'filter'
> & { filter?: Filter; jobs?: number }

/** Replacements for functions of the two file systems. */
export type Over = {
  async?: Partial<CreateFS>
  sync?: Partial<CreateFSSync>
}

/** All the chunks of a stream or of an iterator, in one buffer. */
export const collect = async (
  source:
    | ReadableStream<Uint8Array>
    | AsyncIterable<Uint8Array>
    | Iterable<Uint8Array>,
): Promise<Buffer> => {
  const parts: Uint8Array[] = []
  if (source instanceof ReadableStream) {
    for (const reader = source.getReader(); ; ) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }
  } else for await (const part of source) parts.push(part)
  return Buffer.concat(parts)
}

const defaults = { processUid: uid, processUname: 'isaacs' }

export const pack = (opt: Options, over: Partial<CreateFS> = {}) =>
  new Pack({ ...defaults, fs: { ...fs, ...over }, ...opt })

export const packSync = (opt: Options, over: Partial<CreateFSSync> = {}) =>
  new PackSync({ ...defaults, fs: { ...fsSync, ...over }, ...opt })

/** What a test adds to a pack in each mode. */
export type Item = string | WriteEntry

/** One way to make an archive: with `Pack`, or with `PackSync`. */
export type Mode = {
  name: 'async' | 'sync'
  /** Pack the items, and give all the bytes of the archive. */
  run(opt: Options, items: Item[], over?: Over): Promise<Buffer>
  /**
   * Pack the entries of each archive in `tars`, and give all the
   * bytes of the new archive.
   */
  repack(opt: Options, ...tars: Uint8Array[]): Promise<Buffer>
}

export const modes: Mode[] = [
  {
    name: 'async',
    run: async (opt, items, over) => {
      const p = pack(opt, over?.async)
      for (const item of items) p.add(item)
      return collect(p.end())
    },
    repack: async (opt, ...tars) => {
      const p = pack(opt)
      for (const tar of tars) p.add(entries(tar))
      return collect(p.end())
    },
  },
  {
    name: 'sync',
    run: async (opt, items, over) => {
      const p = packSync(opt, over?.sync)
      for (const item of items) p.add(item)
      return collect(p.end())
    },
    repack: async (opt, ...tars) => {
      const p = packSync(opt)
      for (const tar of tars) p.add(entriesSync(tar))
      return collect(p.end())
    },
  },
]

/**
 * A replacement for one function of each file system, such as `open`
 * and `openSync`, that fails.
 */
export const failing = (name: keyof CreateFS, error: Error): Over => ({
  async: { [name]: () => Promise.reject(error) },
  sync: {
    [name + 'Sync']: () => {
      throw error
    },
  },
})

/** The header of the 512 byte block at this offset. */
export const headerAt = (data: Uint8Array, offset: number = 0) =>
  new Header(data, offset)

/**
 * The type and path of each header in the archive. A file entry also
 * has the start of its body.
 */
export const listBlocks = (data: Buffer) => {
  const list: (string | string[])[] = []
  for (let i = 0; i < data.length; i += 512) {
    const slice = data.subarray(i, i + 512)
    const h = new Header(slice)
    const last = list[list.length - 1]
    if (h.nullBlock) list.push('null block')
    else if (h.cksumValid) list.push([h.type, String(h.path)])
    else if (Array.isArray(last) && last[0] === 'File') {
      last.push(slice.toString().replace(/\0.*$/, ''))
    }
  }
  return list
}

/** The entries of an archive: metadata, and the body as text. */
export const read = (data: Uint8Array) => {
  const found: { entry: ReadEntrySync; body: string }[] = []
  for (const entry of entriesSync(data)) {
    found.push({ entry, body: entry.text() })
  }
  return found
}

/** The paths of the entries of an archive. */
export const paths = (data: Uint8Array) =>
  [...entriesSync(data)].map(entry => entry.path)

/**
 * File systems that count the files that are open, and that record
 * each call.
 */
export const tracked = (over: Over = {}) => {
  const open = new Set<unknown>()
  const calls: string[] = []
  const base = { ...fs, ...over.async }
  const baseSync = { ...fsSync, ...over.sync }
  const note =
    <A extends [string, ...unknown[]], R>(
      name: string,
      fn: (...a: A) => R,
    ) =>
    (...a: A): R => {
      calls.push(`${name} ${a[0]}`)
      return fn(...a)
    }
  const async: CreateFS = {
    lstat: note('lstat', base.lstat),
    stat: note('stat', base.stat),
    readdir: note('readdir', base.readdir),
    readlink: note('readlink', base.readlink),
    open: async (path, flags, mode) => {
      calls.push(`open ${path}`)
      const handle = await base.open(path, flags, mode)
      open.add(handle)
      const wrapped: CreateFileHandle = {
        read: (...a) => handle.read(...a),
        write: (...a) => handle.write(...a),
        stat: () => handle.stat(),
        close: () => {
          open.delete(handle)
          return handle.close()
        },
      }
      return wrapped
    },
  }
  const sync: CreateFSSync = {
    ...baseSync,
    lstatSync: note('lstat', baseSync.lstatSync),
    statSync: note('stat', baseSync.statSync),
    readdirSync: note('readdir', baseSync.readdirSync),
    readlinkSync: note('readlink', baseSync.readlinkSync),
    openSync: (path, flags, mode) => {
      calls.push(`open ${path}`)
      const fd = baseSync.openSync(path, flags, mode)
      open.add(fd)
      return fd
    },
    closeSync: fd => {
      open.delete(fd)
      baseSync.closeSync(fd)
    },
  }
  return { open, calls, over: { async, sync } }
}
