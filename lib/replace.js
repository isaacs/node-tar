'use strict'

// tar -r
const hlo = require('./high-level-opt.js')
const Pack = require('./pack.js')
const Parse = require('./parse.js')
const fs = require('fs')

// starting at the head of the file, read a Header
// If the checksum is invalid, that's our position to start writing
// If it is, jump forward by the specified size (round up to 512)
// and try again.
// Write the new Pack stream starting there.

const Header = require('./header.js')

const r = module.exports = (opt_, files, cb) => {
  const opt = hlo(opt_)

  if (!opt.file)
    throw new TypeError('file is required')

  if (opt.gzip)
    throw new TypeError('can only be called on uncompressed archives')

  if (!files || !Array.isArray(files) || !files.length)
    throw new TypeError('no files or directories specified')

  return opt.sync ? replaceSync(opt, files)
    : replace(opt, files, cb)
}


const replaceSync = (opt, files) => {
  const p = new Pack.Sync(opt)

  let threw = true
  let fd
  try {
    fd = fs.openSync(opt.file, 'r+')
    const st = fs.fstatSync(fd)
    const headBuf = Buffer.allocate(512)
    let position

    POSITION: for (position = 0; position < st.size; position += 512) {
      for (let bufPos = 0, bytes = 0; bufPos < 512; bufPos += bytes) {
        bytes = fs.readSync(
          fd, headBuf, bufPos, headBuf.length - bufPos, position + bufPos
        )
        if (!bytes)
          break POSITION
      }

      if (position === 0 && headBuf[0] === 0x1f && headBuf[1] === 0x8b)
        throw new Error('may only be used on uncompressed archives')

      let h = new Header(headBuf)
      if (!h.cksumValid)
        break
      let entryBlockSize = 512 * Math.ceil(h.size / 512)
      if (position + entryBlockSize + 512 > st.size)
        break
      // the 512 for the header we just parsed will be added as well
      // also jump ahead all the blocks for the body
      position += entryBlockSize
    }

    p.on('data', c => {
      fs.writeSync(fd, c, 0, c.length, position)
      position += c.length
    })
    p.on('end', _ => fs.closeSync(fd))

    files.forEach(file => p.add(file))
    p.end()
    threw = false
  } finally {
    if (threw)
      try { fs.closeSync(fd) } catch (er) {}
  }
}

const replace = (opt, files, cb) => {
  const p = new Pack(opt)

  const getPos = (fd, size, cb) => {
    let position = 0
    if (size === 0)
      return cb(null, 0)

    let bufPos = 0
    const headBuf = Buffer.allocate(512)
    const onread = (er, bytes) => {
      if (er)
        return cb(er)
      bufPos += bytes
      if (bufPos < 512)
        return fs.read(
          fd, headBuf, bufPos, headBuf.length - bufPos,
          position + bufPos, onread
        )

      if (position === 0 && headBuf[0] === 0x1f && headBuf[1] === 0x8b)
        return cb(new Error('may only be used on uncompressed archives'))

      const h = new Header(headBuf)
      if (!h.cksumValid)
        return cb(null, position)

      const entryBlockSize = 512 * Math.ceil(h.size / 512)
      if (position + entryBlockSize + 512 > st.size)
        return cb(null, position)

      position += entryBlockSize + 512
      if (position >= st.size)
        return cb(null, position)

      bufPos = 0
      fs.read(fd, headBuf, 0, 512, position)
    }
    fs.read(fd, headBuf, 0, 512, position)
  }

  const promise = new Promise((resolve, reject) => {
    p.on('error', reject)
    fs.open(opt.file, 'r+', (er, fd) => {
      if (er)
        return reject(er)
      fs.stat(fd, (er, st) => {
        if (er)
          return reject(er)
        getPos(fd, st.size, (er, position) => {
          if (er)
            return reject(er)
          const stream = fs.createWriteStream(opt.file, {
            fd: fd,
            flags: 'r+',
            start: position
          })
          p.pipe(stream)
          stream.on('error', reject)
          stream.on('close', resolve)
          files.forEach(file => p.add(file))
          p.end()
        })
      })
    })
  })
  return cb ? promise.then(cb, cb) : promise
}
