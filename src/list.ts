// tar -t
import * as fsm from '@isaacs/fs-minipass'
import fs from 'node:fs'
import { dirname, parse } from 'path'
import { makeCommand } from './make-command.js'
import {
  TarOptions,
  TarOptionsFile,
  TarOptionsSyncFile,
} from './options.js'
import { Parser } from './parse.js'
import { stripTrailingSlashes } from './strip-trailing-slashes.js'

const onReadEntryFunction = (opt: TarOptions) => {
  const onReadEntry = opt.onReadEntry
  opt.onReadEntry =
    onReadEntry ?
      e => {
        onReadEntry(e)
        e.resume()
      }
    : e => e.resume()
}

// construct a filter that limits the file entries listed
// include child entries if a dir is included
export const filesFilter = (opt: TarOptions, files: string[]) => {
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

  opt.filter =
    filter ?
      (file, entry) =>
        filter(file, entry) && mapHas(stripTrailingSlashes(file))
    : file => mapHas(stripTrailingSlashes(file))
}

const listFileSync = (opt: TarOptionsSyncFile) => {
  const p = new Parser(opt)
  const file = opt.file
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const stat: fs.Stats = fs.fstatSync(fd)
    const readSize: number = opt.maxReadSize || 16 * 1024 * 1024
    if (stat.size < readSize) {
      const buf = Buffer.allocUnsafe(stat.size)
      const read = fs.readSync(fd, buf, 0, stat.size, 0)
      p.end(read === buf.byteLength ? buf : buf.subarray(0, read))
    } else {
      let pos = 0
      const buf = Buffer.allocUnsafe(readSize)
      while (pos < stat.size) {
        const bytesRead = fs.readSync(fd, buf, 0, readSize, pos)
        if (bytesRead === 0) break
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

const listFile = (
  opt: TarOptionsFile,
  _files: string[],
): Promise<void> => {
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
  return p
}

export const list = makeCommand(
  listFileSync,
  listFile,
  opt => new Parser(opt) as Parser & { sync: true },
  opt => new Parser(opt),
  (opt, files) => {
    if (files?.length) filesFilter(opt, files)
    if (!opt.noResume) onReadEntryFunction(opt)
  },
)
