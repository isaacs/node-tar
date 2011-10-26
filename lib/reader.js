
// A writable stream.
// It emits "file" events, which provide a readable stream that has
// header info attached.

module.exports = Reader.create = Reader

var stream = require("stream")
  , Stream = stream.Stream
  , BlockStream = require("block-stream")
  , tar = require("../tar.js")
  , TarHeader = require("./header.js")
  , Entry = require("./entry.js")
  , BufferEntry = require("./buffer-entry.js")
  , ExtendedHeader = require("./extended-header.js")
  , assert = require("assert").ok

function Reader () {
  if (!(this instanceof Reader)) return new Reader()
  Stream.apply(this)

  this.writable = true
  this._block = new BlockStream(512)

  this._block.on("error", function (e) {
    this.emit("error", e)
  })

  this._block.on("data", function (c) {
    this._process(c)
  })

  this._block.on("end", function () {
    this._end()
  })
}

Reader.prototype.write = function (c) {
  this._block.write(c)
}

Reader.prototype.end = function (c) {
  this._block.end(c)
}

Reader.prototype._process = function (c) {
  assert(c && c.length === 512, "block size should be 512")

  if (this._ended) {
    this.emit("error", new Error("data after tar EOF marker"))
  }

  // one of three cases.
  // 1. A new header
  // 2. A part of a file/extended header
  // 3. One of two EOF null blocks

  if (this._entry) {

    var entry = this._entry
    if (entry._remaining < 512) {
      c = c.slice(0, entry._remaining)
      entry._remaining = 0
    } else {
      entry._remaining -= 512
    }

    if (entry._remaining === 0) {
      entry.end(c)
    } else {
      entry.write(c)
    }

  } else {

    // either zeroes or a header
    var zero = false
    for (var i = 0; i < 256 && !zero; i ++) {
      zero = c[i] === 0
    }

    if (zero) {
      if (this._eofStarted) {
        this._ended = true
      } else {
        this._eofStarted = true
      }
    } else {
      // might have been random block of zeroes in the middle
      // of the entry.  I'll allow it.
      this._eofStarted = false
      this._startEntry(c)
    }

  }
}

// take a header chunk, start the right kind of entry.
Reader.prototype._startEntry (c) {
  var header = new TarHeader(c)
    , self = this

  switch (tar.types[header.type]) {
    case "File":
    case "OldFile":
    case "Link":
    case "SymbolicLink":
    case "CharacterDevice":
    case "BlockDevice":
    case "Directory":
    case "FIFO":
    case "ContiguousFile":
    case "GNUDumpDir":
      // start a file.
      // pass in any extended headers
      // These ones we emit "file" events for.
      var entry = new Entry(header, this._extended, this._global)
      this._entry = entry
      entry.on("end", function () {
        self._entry = null
      })
      this.emit("entry", entry)
      break

    case "GlobalExtendedHeader":
      // extended headers that apply to the rest of the tarball
      var entry = new ExtendedHeader(header, this._extended, this._global)
      this._entry = entry
      entry.on("end", function () {
        Object.keys(entry.fields).forEach(function (k) {
          self._global[k] = entry.fields[k]
        })
        self._entry = null
      })
      this.emit("extendedHeader", entry)
      break

    case "ExtendedHeader":
    case "OldExtendedHeader":
      // extended headers that apply to the next entry
      var entry = new ExtendedHeader(header, this._extended, this._global)
      this._entry = entry
      entry.on("end", function () {
        self._extended = entry.fields
        self._entry = null
      })
      this.emit("extendedHeader", entry)
      break

    case "NextFileHasLongLinkName":
      // set linkname=<contents> in extended header
      var entry = new BufferEntry(header, this._extended, this._global)
      this._entry = entry
      entry.on("end", function () {
        self._extended = { linkname: entry.body }
        self._entry = null
      })
      this.emit("longLinkName", entry)
      break

    case "NextFileHasLongName":
    case "OldGnuLongName":
      // set name=<contents> in file-extended header
      var entry = new BufferEntry(header, this._extended, this._global)
      this._entry = entry
      entry.on("end", function () {
        self._extended = { name: entry.body }
        self._entry = null
      })
      this.emit("longName", entry)
      break

    default:
      // all the rest we skip, but still set the _entry
      // member, so that we can skip over their data appropriately.
      // emit an event to say that this is an ignored entry type?
      var entry = new Entry(header, this._extended, this._global)
      this._entry = entry
      entry.on("end", function () {
        self._entry = null
      })
      self.emit("ignoredEntry", entry)
      break
  }

  // extendedHeader only applies to one entry, so once we start
  // an entry, it's over.
  this._extended = null
}
