'use strict'

// tar -c

const Pack = require('./pack.js')

const create = module.exports = (opt) => {
  return new Pack(opt)
}

const createSync = module.exports.sync = (opt) => {
  return new Pack.Sync(opt)
}

const fs = require('fs')
const createFile = module.exports.file = (file, opt, cb) => {
  if (typeof opt === 'function')
    cb = opt, opt = {}

  const pack = new Pack(opt)
  fs.open(file, 'w', (er, fd) => {
    if (er) {
      pack.abort()
      return fs.close(fd, _ => cb(er))
    }
    pack.on('end', _ => fs.close(fd, cb))
    pack.on('data', chunk => {
      pack.pause()
      fs.write(fd, chunk, _ => pack.resume())
    })
  })

  return pack
}

const createFileSync = module.exports.fileSync = (file, opt) => {
  const pack = new Pack.Sync(opt)
  let threw = true
  let fd
  try {
    fd = fs.openSync(file, 'w')
    threw = false
  } finally {
    if (threw) {
      try { fs.closeSync(fd) } catch (er) {}
      pack.abort()
    }
  }
  pack.on('end', _ => fs.closeSync(fd))
  pack.on('data', chunk => fs.writeSync(fd, chunk))
  return pack
}
