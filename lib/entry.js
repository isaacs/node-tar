// A passthrough read/write stream that sets its properties
// based on a header, extendedHeader, and globalHeader
//
// Can be either a file system object of some sort, or
// a pax/ustar metadata entry.

module.exports = Entry

var TarHeader = require("./header.js")
  , tar = require("../tar")
  , assert = require("assert").ok
  , Stream = require("stream").Stream
  , inherits = require("inherits")

function Entry (header, extended, global) {
  Stream.call(this)
  this.readable = true
  this.writable = true

  this._needDrain = false
  this._paused = false
  this._processing = false
  this._ending = false
  this._ended = false
  this._remaining = 0
  this._queue = []
  this._index = 0
  this._queueLen = 0

  this._process = this._process.bind(this)

  this.props = {}
  this._header = header
  this._extended = extended || {}

  // globals can change throughout the course of
  // a file parse operation.  Freeze it at its current state.
  this._global = {}
  Object.keys(global || {}).forEach(function (g) {
    this._global[g] = global[g]
  })

  this._setProps()
}

inherits(Entry, Stream,
{ write: function (c) {
    if (this._ending) throw new Error("write() after end()")
    if (this._remaining === 0) {
      this.emit("error", new Error("invalid bytes past eof"))
    }

    // often we'll get a bunch of \0 at the end of the last write,
    // since chunks will always be 512 bytes when reading a tarball.
    if (c.length > this._remaining) {
      c = c.slice(0, this._remaining)
    }
    this._remaining -= c.length

    // put it on the stack.
    var ql = this._queueLen
    this._queue.push(c)
    this._queueLen ++

    this._process()

    // either paused, or buffered
    if (this._paused || ql > 0) {
      this._needDrain = true
      return false
    }

    return true
  }

, end: function (c) {
    if (c) this.write(c)
    this._ending = true
    this._process()
  }

, pause: function () {
    this._paused = true
  }

, resume: function () {
    if (this._ended) throw new Error("resume() after end()")
    this._paused = false
    this._process()
    return this._queueLen - this._index > 1
  }

  // This is bound to the instance
, _process: function () {
    if (this._paused || this._processing || this._ended) return

    // set this flag so that event handlers don't inadvertently
    // get multiple _process() calls scheduled.
    this._processing = true

    // have any data to emit?
    if (this._index < this._queueLen) {
      var chunk = this._queue[this._index ++]
      this.emit("data", chunk)
    }

    // check if we're drained
    if (this._index >= this._queueLen) {
      this._queue.length = this._queueLen = this._index = 0
      if (this._needDrain) {
        this._needDrain = false
        this.emit("drain")
      }
      if (this._ending) {
        this._ended = true
        this.emit("end")
      }
    }

    // if the queue gets too big, then pluck off whatever we can.
    // this should be fairly rare.
    var mql = this._maxQueueLen
    if (this._queueLen > mql && this._index > 0) {
      mql = Math.min(this._index, mql)
      this._index -= mql
      this._queueLen -= mql
      this._queue = this._queue.slice(mql)
    }

    this._processing = false
  }

, _setProps: function () {
    // props = extended->global->header->{}
    var header = this._header
      , extended = this._extended
      , global = this._global
      , props = this.props

    // first get the values from the normal header.
    var fields = tar.fields
    for (var f = 0; fields[f] !== null; f ++) {
      var field = fields[f]
        , val = header[field]
      if (typeof val !== "undefined") props[field] = val
    }

    // next, the global header for this file.
    // numeric values, etc, will have already been parsed.
    ;[global, extended].forEach(function (p) {
      Object.keys(p).forEach(function (f) {
        if (typeof p[f] !== "undefined") props[f] = p[f]
      })
    })

    // set date fields to be a proper date
    ;["mtime", "ctime", "atime"].forEach(function (p) {
      if (props.hasOwnProperty(p)) {
        props[p] = new Date(props[p] * 1000)
      }
    })

    // size is special, since it signals when the file needs to end.
    this._remaining = props.size
  }
})
