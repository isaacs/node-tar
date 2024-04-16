// tar -r
import { WriteStream, WriteStreamSync } from '@isaacs/fs-minipass'
import { Minipass } from 'minipass'
import fs from 'node:fs'
import path from 'node:path'
import { Header } from './header.js'
import { list } from './list.js'
import {
  dealias,
  isFile,
  isSyncFile,
  TarOptionsFile,
  TarOptionsSyncFile,
  TarOptionsWithAliases,
  TarOptionsWithAliasesFile,
  TarOptionsWithAliasesSyncFile,
} from './options.js'
import { Pack, PackSync } from './pack.js'

// starting at the head of the file, read a Header
// If the checksum is invalid, that's our position to start writing
// If it is, jump forward by the specified size (round up to 512)
// and try again.
// Write the new Pack stream starting there.

export function replace(
  opt: TarOptionsWithAliasesSyncFile,
  files?: string[],
): void
export function replace(
  opt: TarOptionsWithAliasesFile,
  files?: string[],
  cb?: () => any,
): Promise<void>
export function replace(
  opt: TarOptionsWithAliasesFile,
  cb: () => any,
): Promise<void>
export function replace(
  opt_: TarOptionsWithAliases,
  files?: string[] | (() => any),
  cb?: () => any,
): void | Promise<void> {
  const opt = dealias(opt_)

  if (!isFile(opt)) {
    throw new TypeError('file is required')
  }

  if (
    opt.gzip ||
    opt.brotli ||
    opt.file.endsWith('.br') ||
    opt.file.endsWith('.tbr')
  ) {
    throw new TypeError('cannot append to compressed archives')
  }

  if (!files || !Array.isArray(files) || !files.length) {
    throw new TypeError('no files or directories specified')
  }

  files = Array.from(files)

  return isSyncFile(opt) ?
      replaceSync(opt, files)
    : replace_(opt, files, cb)
}

const replaceSync = (opt: TarOptionsSyncFile, files: string[]) => {
  const p = new PackSync(opt)

  let threw = true
  let fd
  let position

  try {
    try {
      fd = fs.openSync(opt.file, 'r+')
    } catch (er) {
      if ((er as NodeJS.ErrnoException)?.code === 'ENOENT') {
        fd = fs.openSync(opt.file, 'w+')
      } else {
        throw er
      }
    }

    const st = fs.fstatSync(fd)
    const headBuf = Buffer.alloc(512)

    POSITION: for (
      position = 0;
      position < st.size;
      position += 512
    ) {
      for (let bufPos = 0, bytes = 0; bufPos < 512; bufPos += bytes) {
        bytes = fs.readSync(
          fd,
          headBuf,
          bufPos,
          headBuf.length - bufPos,
          position + bufPos,
        )

        if (
          position === 0 &&
          headBuf[0] === 0x1f &&
          headBuf[1] === 0x8b
        ) {
          throw new Error('cannot append to compressed archives')
        }

        if (!bytes) {
          break POSITION
        }
      }

      const h = new Header(headBuf)
      if (!h.cksumValid) {
        break
      }
      const entryBlockSize = 512 * Math.ceil((h.size || 0) / 512)
      if (position + entryBlockSize + 512 > st.size) {
        break
      }
      // the 512 for the header we just parsed will be added as well
      // also jump ahead all the blocks for the body
      position += entryBlockSize
      if (opt.mtimeCache && h.mtime) {
        opt.mtimeCache.set(String(h.path), h.mtime)
      }
    }
    threw = false

    streamSync(opt, p, position, fd, files)
  } finally {
    if (threw) {
      try {
        fs.closeSync(fd as number)
      } catch (er) {}
    }
  }
}

const streamSync = (
  opt: TarOptionsSyncFile,
  p: Pack,
  position: number,
  fd: number,
  files: string[],
) => {
  const stream = new WriteStreamSync(opt.file, {
    fd: fd,
    start: position,
  })
  p.pipe(stream as unknown as Minipass.Writable)
  addFilesSync(p, files)
}

const replace_ = (
  opt: TarOptionsFile,
  files: string[],
  cb?: () => void,
): Promise<void> => {
  files = Array.from(files)
  const p = new Pack(opt)

  const getPos = (
    fd: number,
    size: number,
    cb_: (er?: null | Error, pos?: number) => void,
  ) => {
    const cb = (er?: Error | null, pos?: number) => {
      if (er) {
        fs.close(fd, _ => cb_(er))
      } else {
        cb_(null, pos)
      }
    }

    let position = 0
    if (size === 0) {
      return cb(null, 0)
    }

    let bufPos = 0
    const headBuf = Buffer.alloc(512)
    const onread = (er?: null | Error, bytes?: number): void => {
      if (er || typeof bytes === 'undefined') {
        return cb(er)
      }
      bufPos += bytes
      if (bufPos < 512 && bytes) {
        return fs.read(
          fd,
          headBuf,
          bufPos,
          headBuf.length - bufPos,
          position + bufPos,
          onread,
        )
      }

      if (
        position === 0 &&
        headBuf[0] === 0x1f &&
        headBuf[1] === 0x8b
      ) {
        return cb(new Error('cannot append to compressed archives'))
      }

      // truncated header
      if (bufPos < 512) {
        return cb(null, position)
      }

      const h = new Header(headBuf)
      if (!h.cksumValid) {
        return cb(null, position)
      }

      /* c8 ignore next */
      const entryBlockSize = 512 * Math.ceil((h.size ?? 0) / 512)
      if (position + entryBlockSize + 512 > size) {
        return cb(null, position)
      }

      position += entryBlockSize + 512
      if (position >= size) {
        return cb(null, position)
      }

      if (opt.mtimeCache && h.mtime) {
        opt.mtimeCache.set(String(h.path), h.mtime)
      }
      bufPos = 0
      fs.read(fd, headBuf, 0, 512, position, onread)
    }
    fs.read(fd, headBuf, 0, 512, position, onread)
  }

  const promise = new Promise<void>((resolve, reject) => {
    p.on('error', reject)
    let flag = 'r+'
    const onopen = (
      er?: NodeJS.ErrnoException | null,
      fd?: number,
    ) => {
      if (er && er.code === 'ENOENT' && flag === 'r+') {
        flag = 'w+'
        return fs.open(opt.file, flag, onopen)
      }

      if (er || !fd) {
        return reject(er)
      }

      fs.fstat(fd, (er, st) => {
        if (er) {
          return fs.close(fd, () => reject(er))
        }

        getPos(fd, st.size, (er, position) => {
          if (er) {
            return reject(er)
          }
          const stream = new WriteStream(opt.file, {
            fd: fd,
            start: position,
          })
          p.pipe(stream as unknown as Minipass.Writable)
          stream.on('error', reject)
          stream.on('close', resolve)
          addFilesAsync(p, files)
        })
      })
    }
    fs.open(opt.file, flag, onopen)
  })

  return cb ? promise.then(cb, cb) : promise
}

const addFilesSync = (p: Pack, files: string[]) => {
  files.forEach(file => {
    if (file.charAt(0) === '@') {
      list({
        file: path.resolve(p.cwd, file.slice(1)),
        sync: true,
        noResume: true,
        onentry: entry => p.add(entry),
      })
    } else {
      p.add(file)
    }
  })
  p.end()
}

const addFilesAsync = async (
  p: Pack,
  files: string[],
): Promise<void> => {
  for (let i = 0; i < files.length; i++) {
    const file = String(files[i])
    if (file.charAt(0) === '@') {
      await list({
        file: path.resolve(String(p.cwd), file.slice(1)),
        noResume: true,
        onentry: entry => p.add(entry),
      })
    } else {
      p.add(file)
    }
  }
  p.end()
}
