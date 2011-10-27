// just like the Entry class, but it buffers the contents
//
// XXX It would be good to set a maximum BufferEntry filesize,
// since it eats up memory.  In normal operation,
// these are only for long filenames or link names, which are
// rarely very big.

module.exports = BufferEntry

var inherits = require("inherits")
  , Entry = require("./entry.js")

function BufferEntry () {
  Entry.apply(this, arguments)
  this._buffer = new Buffer(this.props.size)
  this._offset = 0
}

// collect the bytes as they come in.
BufferEntry.prototype.write = function (c) {
  this._buffer.write(c, this._offset)
  this._offset += c.length
  Entry.prototype.write.call(this, c)
}

inherits(BufferEntry, Entry)
