// tar -x
import * as fsm from '@isaacs/fs-minipass'
import fs from 'node:fs'
import { filesFilter } from './list.js'
import { makeCommand } from './make-command.js'
import { TarOptionsFile, TarOptionsSyncFile } from './options.js'
import { Unpack, UnpackSync } from './unpack.js'

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

const extractFile = (opt: TarOptionsFile, _?: string[]) => {
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
  return p
}

export const extract = makeCommand<Unpack, UnpackSync>(
  extractFileSync,
  extractFile,
  opt => new UnpackSync(opt),
  opt => new Unpack(opt),
  (opt, files) => {
    if (files?.length) filesFilter(opt, files)
  },
)
