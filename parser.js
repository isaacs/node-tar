module.exports = Parser
Parser.create = create
Parser.File = File

var tar = require("./tar")
  , Stream = require("stream").Stream
  , fs = require("fs")

function create (cb) {
  return new Parser(cb)
}

var s = 0
  , HEADER = s ++
  , BODY = s ++
  , PAD = s ++

function Parser (cb) {
  this.fields = tar.fields
  this.fieldSize = tar.fieldSize
  this.state = HEADER
  this.position = 0
  this.currentFile = null
  this._header = []
  this._headerPosition = 0
  this._bodyPosition = 0
  this.writable = true
  Stream.apply(this)
  if (cb) this.on("file", cb)
}

Parser.prototype = Object.create(Stream.prototype)

Parser.prototype.write = function (chunk) {
  switch (this.state) {
    case HEADER:
      // buffer up to 512 bytes in memory, and then
      // parse it, emit a "file" event, and stream the rest
      this._header.push(chunk)
      this._headerPosition += chunk.length
      if (this._headerPosition >= tar.headerSize) {
        return this._parseHeader()
      }
      return true
    case BODY:
      // stream it through until the end of the file is reached,
      // and then step over any \0 byte padding.
      var cl = chunk.length
        , bp = this._bodyPosition
        , np = cl + bp
        , s = this.currentFile.size
      if (np < s) {
        this._bodyPosition = np
        return this.currentFile.write(chunk)
      }
      var c = chunk.slice(0, (s - bp))
      this.currentFile.write(c)
      this._closeFile()
      return this.write(chunk.slice(s - bp))
    case PAD:
      for (var i = 0, l = chunk.length; i < l; i ++) {
        if (chunk[i] !== 0) {
          this.state = HEADER
          return this.write(chunk.slice(i))
        }
      }
  }
  return true
}

Parser.prototype.end = function (chunk) {
  if (chunk) this.write(chunk)
  if (this.currentFile) this._closeFile()
  this.emit("end")
  this.emit("close")
}

// at this point, we have at least 512 bytes of header chunks
Parser.prototype._parseHeader = function () {
  var hp = this._headerPosition
    , last = this._header.pop()
    , rem

  if (hp < 512) return this.emit("error", new Error(
    "Trying to parse header before finished"))

  if (hp > 512) {
    rem = last.slice(hp - 512)
    last = last.slice(0, hp - 512)
  }
  this._header.push(last)

  var fields = tar.fields
    , pos = 0
    , field = 0
    , fieldEnds = tar.fieldEnds
    , fieldSize = tar.fieldSize
    , set = {}
    , fpos = 0

  Object.keys(fieldSize).forEach(function (f) {
    set[ fields[f] ] = new Buffer(fieldSize[f])
  })

  this._header.forEach(function (chunk) {
    for (var i = 0, l = chunk.length; i < l; i ++, pos ++, fpos ++) {
      if (pos >= fieldEnds[field]) {
        field ++
        fpos = 0
      }
      // header is null-padded, so when the fields run out,
      // just finish.
      if (null === fields[field]) return
      set[fields[field]][fpos] = chunk[i]
    }
  })

  // TODO: If the filename is foo/bar/PaxHeader/baz.ext,
  // then read in the file's key=val pairs.
  // If there's a line that isn't key=val, or if a file
  // doesn't come along named foo/bar/baz.ext, then emit the
  // PaxHeader file.  Otherwise, attach the meta info to the file.
  // This enables custom extension as well as longer/non-ascii
  // filenames and so on.
  // For now, just do the dumb thing and create PaxHeader dirs.
  this.currentFile = new File(set)
  this.emit("file", this.currentFile)
}

Parser.prototype._closeFile = function () {
  if (!this.currentFile) return this.emit("error", new Error(
    "Trying to close without current file"))

  this._headerPosition = this._bodyPosition = 0
  this.currentFile.end()
  this.currentFile = null
  this.state = PAD
}


// file stuff

function strF (f) {
  return f.toString("ascii").split("\0").shift() || ""
}

function nF (f) {
  return parseInt(f.toString("ascii").replace(/\0+/g, "").trim(), 8) || 0
}

function bufferMatch (a, b) {
  if (a.length != b.length) return false
  for (var i = 0, l = a.length; i < l; i ++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function File (fields) {
  this._raw = fields
  this.name = strF(fields.NAME)
  this.mode = nF(fields.MODE)
  this.uid = nF(fields.UID)
  this.gid = nF(fields.GID)
  this.size = nF(fields.SIZE)
  this.mtime = new Date(nF(fields.MTIME))
  this.cksum = nF(fields.CKSUM)
  this.type = nF(fields.TYPE)
  this.linkname = strF(fields.LINKNAME)

  this.ustar = bufferMatch(fields.USTAR, tar.ustar)

  if (this.ustar) {
    this.ustarVersion = nF(fields.USTARVER)
    this.user = strF(fields.UNAME)
    this.group = strF(fields.GNAME)
    this.dev = { major: nF(fields.DEVMAJ)
               , minor: nF(fields.DEVMIN) }
    this.prefix = strF(fields.PREFIX)
  }

  this.writable = true
  this.readable = true
  Stream.apply(this)
}

File.prototype = Object.create(Stream.prototype)

File.types = { File: 0
             , HardLink: 1
             , SymbolicLink: 2
             , CharacterDevice: 3
             , BlockDevice: 4
             , Directory: 5
             , FIFO: 6
             , ContiguousFile: 7 }

Object.keys(File.types).forEach(function (t) {
  File.prototype["is"+t] = function () {
    return File.types[t] === this.type
  }
  File.types[ File.types[t] ] = File.types[t]
})

// contiguous files are treated as regular files for most purposes.
File.prototype.isFile = function () {
  return this.type === 0 || this.type === 7
}

File.prototype.write = function (c) {
  this.emit("data", c)
  return true
}

File.prototype.end = function (c) {
  if (c) this.write(c)
  this.emit("end")
  this.emit("close")
}

File.prototype.pause = function () { this.emit("pause") }

File.prototype.resume = function () { this.emit("resume") }
