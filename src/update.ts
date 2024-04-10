// tar -u

import {
  dealias,
  isFile,
  type TarOptionsWithAliases,
} from './options.js'

import { replace as r } from './replace.js'

// just call tar.r with the filter and mtimeCache

export const update = (
  opt_: TarOptionsWithAliases,
  files: string[],
  cb?: (er?: Error) => any,
) => {
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
  mtimeFilter(opt)

  return r(opt, files, cb)
}

const mtimeFilter = (opt: TarOptionsWithAliases) => {
  const filter = opt.filter

  if (!opt.mtimeCache) {
    opt.mtimeCache = new Map()
  }

  opt.filter = filter
    ? (path, stat) =>
        filter(path, stat) &&
        !(
          /* c8 ignore start */
          (opt.mtimeCache?.get(path) ?? stat.mtime ?? 0) >
          (stat.mtime ?? 0)
          /* c8 ignore stop */
        )
    : (path, stat) =>
        !(
          /* c8 ignore start */
          (opt.mtimeCache?.get(path) ?? stat.mtime ?? 0) >
          (stat.mtime ?? 0)
          /* c8 ignore stop */
        )
}
