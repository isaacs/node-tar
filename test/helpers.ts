import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve as nodeResolve } from 'node:path'
import { testdir as ubqTestdir } from 'ubqtest'
import { Header, type HeaderData } from '../src/header.js'
import type { Codec } from '../src/codec.js'
import type {
  ExtractFS,
  ExtractFSSync,
  TarFS,
  TarFSSync,
} from '../src/fs.js'
import type { WithAliases } from '../src/dealias.js'
import {
  extract as coreExtract,
  extractSync as coreExtractSync,
} from '../src/extract.js'
import type {
  ExtractOptions,
  ExtractOptionsSync,
  ParserOptions,
  UnpackOptions,
} from '../src/options.js'
import {
  Unpack as CoreUnpack,
  UnpackSync as CoreUnpackSync,
} from '../src/unpack.js'
import type { WarnData, WarnOptions } from '../src/warn.js'
import { Parser } from '../src/parser.js'
import type { EntryData } from '../src/read-entry.js'

// The runtime of the tests, for a test that one runtime cannot run.
export const isDeno = 'Deno' in globalThis
export const isWindows = process.platform === 'win32'

/**
 * The path with `/` separators on Windows. The core gives this form
 * of a path with the platform 'win32'.
 */
export const slash = (path: string) =>
  isWindows ? path.replaceAll('\\', '/') : path

/** `resolve` of `node:path`, with `/` separators on each system. */
export const resolve = (...parts: string[]) => slash(nodeResolve(...parts))

/**
 * The reason to skip a test that makes a symbolic link, or false. On
 * Windows, only a user with the privilege can make one.
 */
export const noSymlink = ((): string | false => {
  if (!isWindows) return false
  const dir = nodeFs.mkdtempSync(nodeResolve(tmpdir(), 'tar-symlink-'))
  try {
    nodeFs.symlinkSync('target', nodeResolve(dir, 'link'))
    return false
  } catch {
    return 'the user cannot make a symbolic link'
  } finally {
    nodeFs.rmSync(dir, { recursive: true, force: true })
  }
})()

/** The root of an absolute path of the system: `/`, or `C:/`. */
export const rootOf = (path: string) =>
  isWindows ? path.slice(0, 3) : '/'

/**
 * The mode that `lstat` gives for a file or a directory that was
 * made with `mode`. Windows keeps only the write permission.
 */
export const statMode = (mode: number) =>
  !isWindows ? mode
  : mode & 0o200 ? 0o666
  : 0o444

/**
 * The target that `readlink` gives for a symbolic link that was made
 * with `target`. Windows keeps a relative target with `\` separators.
 */
export const linkTarget = (target: string) =>
  isWindows ? target.replaceAll('/', '\\') : target

/** `testdir` of ubqtest. The path has `/` separators on each system. */
export const testdir = (files?: Parameters<typeof ubqTestdir>[0]) =>
  slash(ubqTestdir(files))

/**
 * The options, with the platform of the system when they set no
 * platform. The core has the platform 'posix' unless an option sets
 * it, and then a path such as `C:/dir` is not an absolute path.
 */
export const sys = <T extends object>(opt: T): T =>
  isWindows ? { platform: 'win32', ...opt } : opt

/** `extract` of the core, with the platform of the system. */
export const extract = (
  opt: WithAliases<ExtractOptions>,
  files?: string[],
) => coreExtract(sys(opt), files)

/** `extractSync` of the core, with the platform of the system. */
export const extractSync = (
  opt: WithAliases<ExtractOptionsSync>,
  files?: string[],
) => coreExtractSync(sys(opt), files)

/** `Unpack` of the core, with the platform of the system. */
export class Unpack extends CoreUnpack {
  constructor(opt: ExtractOptions) {
    super(sys(opt))
  }
}

/** `UnpackSync` of the core, with the platform of the system. */
export class UnpackSync extends CoreUnpackSync {
  constructor(opt: ExtractOptionsSync) {
    super(sys(opt))
  }
}

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

/** A hook returns this so that the real operation does not run. */
export const SKIP = Symbol('skip')

/** The operations that `hookFs` can change. */
export type FsOp =
  | 'open'
  | 'read'
  | 'write'
  | 'futimes'
  | 'fchown'
  | 'close'
  | 'stat'
  | 'lstat'
  | 'mkdir'
  | 'chmod'
  | 'chown'
  | 'lchown'
  | 'utimes'
  | 'lutimes'
  | 'rmdir'
  | 'unlink'
  | 'rename'
  | 'link'
  | 'symlink'
type PathOp = Exclude<
  FsOp,
  'open' | 'read' | 'write' | 'futimes' | 'fchown' | 'close'
>
type Fn = (...args: unknown[]) => unknown

/**
 * The fs modules of Node, with a hook before each operation. A hook
 * gets the arguments of the operation. It can throw, or return `SKIP`.
 * For an operation on an open file, the first argument is the path of
 * the file, and the `close` hook runs after the file is closed.
 *
 * `calls` has the name and the arguments of each operation.
 */
export const hookFs = (hooks: Partial<Record<FsOp, Fn>> = {}) => {
  const calls: unknown[][] = []
  const before = (op: FsOp, ...args: unknown[]) => {
    calls.push([op, ...args])
    return hooks[op]?.(...args) === SKIP
  }
  const a = <K extends PathOp>(op: K) =>
    (async (...args: unknown[]) =>
      before(op, ...args) ? undefined : (
        (nodeFsPromises[op] as Fn)(...args)
      )) as (typeof nodeFsPromises)[K]
  const s = <K extends PathOp>(op: K) =>
    ((...args: unknown[]) =>
      before(op, ...args) ? undefined : (
        (nodeFs[`${op}Sync`] as Fn)(...args)
      )) as (typeof nodeFs)[`${K}Sync`]

  const fs: ExtractFS & TarFS = {
    constants: nodeFs.constants,
    open: async (path: string, flags: string | number, mode?: number) => {
      before('open', path, flags, mode)
      const h = await nodeFsPromises.open(path, flags, mode)
      return {
        stat: () => h.stat(),
        read: async (buf, off, len, pos) => {
          before('read', path, buf, off, len, pos)
          return h.read(buf, off, len, pos)
        },
        write: async data => {
          if (!before('write', path, data)) await h.write(data)
        },
        utimes: async (atime, mtime) => {
          if (!before('futimes', path, atime, mtime)) {
            await h.utimes(atime, mtime)
          }
        },
        chown: async (uid, gid) => {
          if (!before('fchown', path, uid, gid)) await h.chown(uid, gid)
        },
        close: async () => {
          await h.close()
          before('close', path)
        },
      }
    },
    stat: a('stat'),
    lstat: a('lstat'),
    mkdir: a('mkdir'),
    chmod: a('chmod'),
    chown: a('chown'),
    lchown: a('lchown'),
    utimes: a('utimes'),
    lutimes: a('lutimes'),
    rmdir: a('rmdir'),
    unlink: a('unlink'),
    rename: a('rename'),
    link: a('link'),
    symlink: a('symlink'),
  }

  const paths = new Map<number, string>()
  const fsSync: ExtractFSSync & TarFSSync = {
    constants: nodeFs.constants,
    openSync: (path: string, flags: string | number, mode?: number) => {
      before('open', path, flags, mode)
      const fd = nodeFs.openSync(path, flags, mode)
      paths.set(fd, path)
      return fd
    },
    fstatSync: fd => nodeFs.fstatSync(fd),
    readSync: (fd, buf, off, len, pos) => {
      before('read', paths.get(fd), buf, off, len, pos)
      return nodeFs.readSync(fd, buf, off, len, pos)
    },
    writeSync: (fd, data) =>
      before('write', paths.get(fd), data) ? 0 : (
        nodeFs.writeSync(fd, data)
      ),
    futimesSync: (fd, atime, mtime) => {
      if (!before('futimes', paths.get(fd), atime, mtime)) {
        nodeFs.futimesSync(fd, atime, mtime)
      }
    },
    fchownSync: (fd, uid, gid) => {
      if (!before('fchown', paths.get(fd), uid, gid)) {
        nodeFs.fchownSync(fd, uid, gid)
      }
    },
    closeSync: fd => {
      nodeFs.closeSync(fd)
      before('close', paths.get(fd))
    },
    statSync: s('stat'),
    lstatSync: s('lstat'),
    mkdirSync: s('mkdir'),
    chmodSync: s('chmod'),
    chownSync: s('chown'),
    lchownSync: s('lchown'),
    utimesSync: s('utimes'),
    lutimesSync: s('lutimes'),
    rmdirSync: s('rmdir'),
    unlinkSync: s('unlink'),
    renameSync: s('rename'),
    linkSync: s('link'),
    symlinkSync: s('symlink'),
  }
  return { fs, fsSync, calls }
}

/** The options that `runExtract` passes on. */
export type RunExtractOptions = UnpackOptions &
  WarnOptions & {
    maxDecompressionRatio?: number
    codecs?: Codec[]
    jobs?: number
  }

/**
 * Extract the archive data with `extract` ('async') or `extractSync`
 * ('sync'). With `hooks`, the file system is the one of `hookFs`.
 * Returns each warning as [code, message, data], and the calls of
 * the hooked file system.
 */
export const runExtract = async (
  mode: 'async' | 'sync',
  opt: RunExtractOptions,
  input: Uint8Array | Uint8Array[],
  hooks?: Partial<Record<FsOp, Fn>>,
) => {
  const warnings: [code: string, message: string, data: WarnData][] = []
  const onwarn = (code: string, message: string, data: WarnData) => {
    warnings.push([code, message, data])
  }
  const { fs, fsSync, calls } =
    hooks ?
      hookFs(hooks)
    : { fs: nodeFsPromises, fsSync: nodeFs, calls: [] }
  if (mode === 'sync') extractSync({ onwarn, ...opt, fs: fsSync, input })
  else await extract({ onwarn, ...opt, fs, input })
  return { warnings, calls }
}
