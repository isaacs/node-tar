
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
  , inherits = require("inherits")

inherits(Reader, Stream)

function Reader () {
  var me = this
  if (!(me instanceof Reader)) return new Reader()
  Stream.apply(me)


  me.writable = true
  me._block = new BlockStream(512)

  me._block.on("error", function (e) {
    me.emit("error", e)
  })

  me._block.on("data", function (c) {
    me._process(c)
  })

  me._block.on("end", function () {
    me.end()
  })
}

Reader.prototype.write = function (c) {
  return this._block.write(c)
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
    entry.write(c)
    if (entry._remaining === 0) {
      entry.end()
      this._entry = null
    }
  } else {
    // either zeroes or a header
    var zero = true
    for (var i = 0; i < 256 && zero; i ++) {
      zero = c[i] === 0
    }

    if (zero) {
      if (this._eofStarted) {
        this._ended = true
      } else {
        this._eofStarted = true
      }
    } else {
      // might have been random block of zeroes between two
      // entries.  I'll allow it.
      this._eofStarted = false
      this._startEntry(c)
    }

  }
}

// take a header chunk, start the right kind of entry.
Reader.prototype._startEntry = function (c) {
  var header = new TarHeader(c)
    , self = this
    , entry
    , ev
    , EntryType
    , onend

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
      // These ones consumers are typically most interested in.
      EntryType = Entry
      ev = "entry"
      break

    case "GlobalExtendedHeader":
      // extended headers that apply to the rest of the tarball
      EntryType = ExtendedHeader
      onend = function () {
        Object.keys(entry.fields).forEach(function (k) {
          self._global[k] = entry.fields[k]
        })
      }
      ev = "extendedHeader"
      break

    case "ExtendedHeader":
    case "OldExtendedHeader":
      // extended headers that apply to the next entry
      EntryType = ExtendedHeader
      onend = function () {
        self._extended = entry.fields
      }
      ev = "extendedHeader"
      break

    case "NextFileHasLongLinkName":
      // set linkname=<contents> in extended header
      EntryType = BufferEntry
      onend = function () {
        self._extended = { linkname: entry.body }
      }
      ev = "longLinkName"
      break

    case "NextFileHasLongName":
    case "OldGnuLongName":
      // set name=<contents> in file-extended header
      EntryType = BufferEntry
      onend = function () {
        self._extended = { name: entry.body }
      }
      ev = "longName"
      break

    default:
      // all the rest we skip, but still set the _entry
      // member, so that we can skip over their data appropriately.
      // emit an event to say that this is an ignored entry type?
      EntryType = Entry
      ev = "ignoredEntry"
      break
  }

  entry = new EntryType(header, this._extended, this._global)
  onend && entry.on("end", onend)
  this._entry = entry
  this.emit(ev, entry)

  // extendedHeader only applies to one entry, so once we start
  // an entry, it's over.
  this._extended = null

  // Zero-byte entry.  End immediately.
  if (entry.props.size === 0) entry.end()
}
