'use strict'
// give it a tarball and a path, and it'll dump the contents
const Unpack = require('./unpack.js')
const UnpackSync = Unpack.Sync

const parseArgs = (target, opt) => {
  if (target && typeof target === 'object')
    opt = target
  else if (!opt)
    opt = { path: target }
  else
    opt.path = target
  return opt
}

const extract = module.exports = (target, opt) => {
  return new Unpack(parseArgs(target, opt))
}

const extractSync = module.exports.sync = (target, opt) => {
  return new UnpackSync(parseArgs(target, opt))
}

const fs = require('fs')
const extractFile = module.exports.file = (file, target, opt, cb) => {
  if (typeof opt === 'function')
    cb = opt, opt = {}

  opt = parseArgs(target, opt)

  fs.stat(file, (er, stat) => {
    if (er)
      return cb(er)

    // do anything under 16MB as a single fast parse.
    const fastMaxSize = opt.fastMaxSize || 16*1024*1024
    const stream = extract(target, opt)

    stream.on('error', cb).on('finish', cb)

    if (stat.size > fastMaxSize)
      fs.createReadStream(file).on('error', cb).pipe(stream)
    else
      fs.readFile(file, (er, data) => {
        if (er)
          return cb(er)
        stream.end(data)
      })
  })
}

const maxReadSize = 2147483647
const extractFileSync = module.exports.fileSync = (file, target, opt) => {
  const stream = extractSync(target, opt)
  const stat = fs.statSync(file)

  if (stat.size < maxReadSize)
    return stream.end(fs.readFileSync(file))

  let pos = 0
  const readSize = 16*1024*1024
  const buf = Buffer.allocUnsafe(readSize)
  const fd = fs.openSync(file, 'r')
  while (pos < stat.size) {
    let bytesRead = fs.readSync(fd, buf, 0, readSize, pos)
    pos += bytesRead
    stream.write(buf.slice(0, bytesRead))
  }
  stream.end()
}
