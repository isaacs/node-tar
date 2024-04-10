// tar -t
import * as fsm from '@isaacs/fs-minipass'
import fs from 'node:fs'
import { dirname, parse } from 'path'
import {
  dealias,
  isFile,
  isSyncFile,
  TarOptions,
  TarOptionsFile,
  TarOptionsSyncFile,
  TarOptionsWithAliases,
  TarOptionsWithAliasesFile,
  TarOptionsWithAliasesSync,
  TarOptionsWithAliasesSyncFile,
} from './options.js'
import { Parser } from './parse.js'
import { stripTrailingSlashes } from './strip-trailing-slashes.js'

export function list(
  opt: TarOptionsWithAliasesSyncFile,
  files?: string[],
): void
export function list(
  opt: TarOptionsWithAliasesSync,
  files?: string[],
): void
export function list(
  opt: TarOptionsWithAliasesFile,
  files?: string[],
  cb?: () => any,
): Promise<void>
export function list(
  opt: TarOptionsWithAliasesFile,
  cb: () => any,
): Promise<void>
export function list(
  opt: TarOptionsWithAliases,
  files?: string[],
): Parser
export function list(
  opt_: TarOptionsWithAliases,
  files?: string[] | (() => any),
  cb?: () => any,
): void | Promise<void> | Parser {
  if (typeof opt_ === 'function') {
    ;(cb = opt_), (files = undefined), (opt_ = {})
  } else if (Array.isArray(opt_)) {
    ;(files = opt_), (opt_ = {})
  }

  if (typeof files === 'function') {
    ;(cb = files), (files = undefined)
  }

  if (!files) {
    files = []
  } else {
    files = Array.from(files)
  }

  const opt = dealias(opt_)

  if (opt.sync && typeof cb === 'function') {
    throw new TypeError(
      'callback not supported for sync tar functions',
    )
  }

  if (!opt.file && typeof cb === 'function') {
    throw new TypeError('callback only supported with file option')
  }

  if (files.length) {
    filesFilter(opt, files)
  }

  if (!opt.noResume) {
    onentryFunction(opt)
  }

  return isSyncFile(opt)
    ? listFileSync(opt)
    : isFile(opt)
      ? listFile(opt, cb)
      : list_(opt)
}

const onentryFunction = (opt: TarOptions) => {
  const onentry = opt.onentry
  opt.onentry = onentry
    ? e => {
        onentry(e)
        e.resume()
      }
    : e => e.resume()
}

// construct a filter that limits the file entries listed
// include child entries if a dir is included
const filesFilter = (opt: TarOptions, files: string[]) => {
  const map = new Map<string, boolean>(
    files.map(f => [stripTrailingSlashes(f), true]),
  )
  const filter = opt.filter

  const mapHas = (file: string, r: string = ''): boolean => {
    const root = r || parse(file).root || '.'
    let ret: boolean
    if (file === root) ret = false
    else {
      const m = map.get(file)
      if (m !== undefined) {
        ret = m
      } else {
        ret = mapHas(dirname(file), root)
      }
    }

    map.set(file, ret)
    return ret
  }

  opt.filter = filter
    ? (file, entry) =>
        filter(file, entry) && mapHas(stripTrailingSlashes(file))
    : file => mapHas(stripTrailingSlashes(file))
}

const listFileSync = (opt: TarOptionsSyncFile) => {
  const p = list_(opt)
  const file = opt.file
  let fd
  try {
    const stat = fs.statSync(file)
    const readSize = opt.maxReadSize || 16 * 1024 * 1024
    if (stat.size < readSize) {
      p.end(fs.readFileSync(file))
    } else {
      let pos = 0
      const buf = Buffer.allocUnsafe(readSize)
      fd = fs.openSync(file, 'r')
      while (pos < stat.size) {
        const bytesRead = fs.readSync(fd, buf, 0, readSize, pos)
        pos += bytesRead
        p.write(buf.subarray(0, bytesRead))
      }
      p.end()
    }
  } finally {
    if (typeof fd === 'number') {
      try {
        fs.closeSync(fd)
        /* c8 ignore next */
      } catch (er) {}
    }
  }
}

const listFile = (opt: TarOptionsFile, cb?: () => void): Promise<void> => {
  const parse = new Parser(opt)
  const readSize = opt.maxReadSize || 16 * 1024 * 1024

  const file = opt.file
  const p = new Promise<void>((resolve, reject) => {
    parse.on('error', reject)
    parse.on('end', resolve)

    fs.stat(file, (er, stat) => {
      if (er) {
        reject(er)
      } else {
        const stream = new fsm.ReadStream(file, {
          readSize: readSize,
          size: stat.size,
        })
        stream.on('error', reject)
        stream.pipe(parse)
      }
    })
  })
  return cb ? p.then(cb, cb) : p
}

const list_ = (opt: TarOptions) => new Parser(opt)
