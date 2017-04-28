'use strict'

// tar -c
const hlo = require('./high-level-opt.js')

const Pack = require('./pack.js')
const fs = require('fs')

const c = module.exports = (opt_, files, cb) => {
  if (typeof files === 'function')
    cb = files

  if (Array.isArray(opt_))
    files = opt_, opt_ = {}

  if (!files || !Array.isArray(files) || !files.length)
    throw new TypeError('no files or directories specified')

  const opt = hlo(opt_)

  if (opt.sync && typeof cb === 'function')
    throw new TypeError('callback not supported for sync tar functions')

  return opt.file && opt.sync ? createFileSync(opt, files)
    : opt.file ? createFile(opt, files, cb)
    : opt.sync ? createSync(opt, files)
    : create(opt, files, cb)
}

const createFileSync = (opt, files) => {
  const p = new Pack.Sync(opt)

  let threw = true
  try {
    const fd = fs.openSync(opt.file, 'w', opt.mode || 0o666)
    p.on('data', chunk => fs.writeSync(fd, chunk, 0, chunk.length))
    p.on('end', _ => fs.closeSync(fd))
    files.forEach(file => p.add(file))
    p.end()
    threw = false
  } finally {
    if (threw)
      try { fs.closeSync(fd) } catch (er) {}
  }
}

const createFile = (opt, files, cb) => {
  const p = new Pack(opt)
  const stream = fs.createWriteStream(opt.file, { mode: opt.mode || 0o666 })
  p.pipe(stream)

  const promise = new Promise((res, rej) => {
    stream.on('error', rej)
    stream.on('close', res)
    p.on('error', rej)
  })

  files.forEach(file => p.add(file))
  p.end()

  return cb ? promise.then(cb, cb) : promise
}

const createSync = (opt, files) => {
  const p = new Pack.Sync(opt)
  files.forEach(file => p.add(file))
  return p.end()
}

const create = (opt, files, cb) => {
  const p = new Pack(opt)
  files.forEach(file => p.add(file))
  return p.end()
}
