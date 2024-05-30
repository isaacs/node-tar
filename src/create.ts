import { WriteStream, WriteStreamSync } from '@isaacs/fs-minipass'
import { Minipass } from 'minipass'
import path from 'node:path'
import { list } from './list.js'
import { makeCommand } from './make-command.js'
import {
  TarOptions,
  TarOptionsFile,
  TarOptionsSync,
  TarOptionsSyncFile,
} from './options.js'
import { Pack, PackSync } from './pack.js'

const createFileSync = (opt: TarOptionsSyncFile, files: string[]) => {
  const p = new PackSync(opt)
  const stream = new WriteStreamSync(opt.file, {
    mode: opt.mode || 0o666,
  })
  p.pipe(stream as unknown as Minipass.Writable)
  addFilesSync(p, files)
}

const createFile = (opt: TarOptionsFile, files: string[]) => {
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

  return promise
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

const createAsync = (opt: TarOptions, files: string[]) => {
  const p = new Pack(opt)
  addFilesAsync(p, files)
  return p
}

export const create = makeCommand(
  createFileSync,
  createFile,
  createSync,
  createAsync,
  (_opt, files) => {
    if (!files?.length) {
      throw new TypeError('no paths specified to add to archive')
    }
  },
)
