// tar -x
import * as fsm from '@isaacs/fs-minipass'
import fs from 'node:fs'
import { dirname, parse } from 'node:path'
import {
  dealias,
  isFile,
  isSync,
  isSyncFile,
  TarOptions,
  TarOptionsFile,
  TarOptionsSync,
  TarOptionsSyncFile,
  TarOptionsWithAliases,
  TarOptionsWithAliasesFile,
  TarOptionsWithAliasesSync,
  TarOptionsWithAliasesSyncFile,
} from './options.js'
import { stripTrailingSlashes } from './strip-trailing-slashes.js'
import { Unpack, UnpackSync } from './unpack.js'

export function extract(
  opt: TarOptionsWithAliasesSyncFile,
  files?: string[],
): void
export function extract(
  opt: TarOptionsWithAliasesSync,
  files?: string[],
): void
export function extract(
  opt: TarOptionsWithAliasesFile,
  files?: string[],
  cb?: () => any,
): Promise<void>
export function extract(
  opt: TarOptionsWithAliasesFile,
  cb: () => any,
): Promise<void>
export function extract(
  opt: TarOptionsWithAliases,
  files?: string[],
): Unpack
export function extract(
  opt_: TarOptionsWithAliases,
  files?: string[] | (() => any),
  cb?: () => any,
): void | Promise<void> | Unpack {
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

  return (
    isSyncFile(opt) ? extractFileSync(opt)
    : isFile(opt) ? extractFile(opt, cb)
    : isSync(opt) ? extractSync(opt)
    : extract_(opt)
  )
}

// construct a filter that limits the file entries listed
// include child entries if a dir is included
const filesFilter = (opt: TarOptions, files: string[]) => {
  const map = new Map(files.map(f => [stripTrailingSlashes(f), true]))
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

  opt.filter =
    filter ?
      (file, entry) =>
        filter(file, entry) && mapHas(stripTrailingSlashes(file))
    : file => mapHas(stripTrailingSlashes(file))
}

const extractFileSync = (opt: TarOptionsSyncFile) => {
  const u = new UnpackSync(opt)

  const file = opt.file
  const stat = fs.statSync(file)
  // This trades a zero-byte read() syscall for a stat
  // However, it will usually result in less memory allocation
  const readSize = opt.maxReadSize || 16 * 1024 * 1024
  const stream = new fsm.ReadStreamSync(file, {
    readSize: readSize,
    size: stat.size,
  })
  stream.pipe(u)
}

const extractFile = (opt: TarOptionsFile, cb?: () => void) => {
  const u = new Unpack(opt)
  const readSize = opt.maxReadSize || 16 * 1024 * 1024

  const file = opt.file
  const p = new Promise<void>((resolve, reject) => {
    u.on('error', reject)
    u.on('close', resolve)

    // This trades a zero-byte read() syscall for a stat
    // However, it will usually result in less memory allocation
    fs.stat(file, (er, stat) => {
      if (er) {
        reject(er)
      } else {
        const stream = new fsm.ReadStream(file, {
          readSize: readSize,
          size: stat.size,
        })
        stream.on('error', reject)
        stream.pipe(u)
      }
    })
  })
  return cb ? p.then(cb, cb) : p
}

const extractSync = (opt: TarOptionsSync) => new UnpackSync(opt)

const extract_ = (opt: TarOptions) => new Unpack(opt)
