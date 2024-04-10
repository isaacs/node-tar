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

import { WriteStream, WriteStreamSync } from '@isaacs/fs-minipass'
import { Minipass } from 'minipass'
import path from 'node:path'
import { list } from './list.js'
import { Pack, PackSync } from './pack.js'

export function create(
  opt: TarOptionsWithAliasesSyncFile,
  files?: string[],
): void
export function create(
  opt: TarOptionsWithAliasesSync,
  files?: string[],
): void
export function create(
  opt: TarOptionsWithAliasesFile,
  files?: string[],
  cb?: () => any,
): Promise<void>
export function create(
  opt: TarOptionsWithAliasesFile,
  cb: () => any,
): Promise<void>
export function create(
  opt: TarOptionsWithAliases,
  files?: string[],
): Pack
export function create(
  opt_: TarOptionsWithAliases,
  files?: string[] | (() => any),
  cb?: () => any,
): void | Promise<void> | Pack {
  if (typeof files === 'function') {
    cb = files
  }

  if (Array.isArray(opt_)) {
    ;(files = opt_), (opt_ = {})
  }

  if (!files || !Array.isArray(files) || !files.length) {
    throw new TypeError('no files or directories specified')
  }

  files = Array.from(files)

  const opt = dealias(opt_)

  if (opt.sync && typeof cb === 'function') {
    throw new TypeError(
      'callback not supported for sync tar functions',
    )
  }

  if (!opt.file && typeof cb === 'function') {
    throw new TypeError('callback only supported with file option')
  }

  return isSyncFile(opt)
    ? createFileSync(opt, files)
    : isFile(opt)
      ? createFile(opt, files, cb)
      : isSync(opt)
        ? createSync(opt, files)
        : create_(opt, files)
}

const createFileSync = (opt: TarOptionsSyncFile, files: string[]) => {
  const p = new PackSync(opt)
  const stream = new WriteStreamSync(opt.file, {
    mode: opt.mode || 0o666,
  })
  p.pipe(stream as unknown as Minipass.Writable)
  addFilesSync(p, files)
}

const createFile = (
  opt: TarOptionsFile,
  files: string[],
  cb?: () => any,
) => {
  const p = new Pack(opt)
  const stream = new WriteStream(opt.file, {
    mode: opt.mode || 0o666,
  })
  p.pipe(stream as unknown as Minipass.Writable)

  const promise = new Promise<void>((res, rej) => {
    stream.on('error', rej)
    stream.on('close', res)
    p.on('error', rej)
  })

  addFilesAsync(p, files)

  return cb ? promise.then(cb, cb) : promise
}

const addFilesSync = (p: PackSync, files: string[]) => {
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
        onentry: entry => {
          p.add(entry)
        },
      })
    } else {
      p.add(file)
    }
  }
  p.end()
}

const createSync = (opt: TarOptionsSync, files: string[]) => {
  const p = new PackSync(opt)
  addFilesSync(p, files)
  return p
}

const create_ = (opt: TarOptions, files: string[]) => {
  const p = new Pack(opt)
  addFilesAsync(p, files)
  return p
}
