// a stream that outputs tar bytes from entries getting added
// Pipe to a fstream.FileWriter or fs.WriteStream
//
// when a type="Directory" entry is added, listen to it
// for entries, and add those as well, removing the listener
// once it emits "end".  Close the dir entry itself immediately,
// since it'll always have zero size.

module.exports = Pack

var stream = require("stream")
  , Stream = stream.Stream
  , BlockStream = require("block-stream")
  , TarHeader = require("./header.js")
  , EntryWriter = require("./entry-writer.js")
  , GlobalHeaderWriter = require("./global-header-writer.js")
  , assert = require("assert").ok
  , inherits = require("inherits")
  , fstream = require("fstream")
  , collect = fstream.collect
  , path = require("path")
  , eof

inherits(Pack, Stream)

function Pack (props) {
  var me = this
  if (!(me instanceof Pack)) return new Pack(props)

  // don't apply the fstream ctor
  // we just want it for the .pipe() method
  Stream.apply(me)

  me.writable = true
  me.readable = true
  me._needDrain = false
  me._currentEntry = null
  me._buffer = []

  if (props) me.addGlobal(props)

  // handle piping any fstream reader, even files and such
  // me.on("pipe", function (src) {
  //   me.add(src)
  // })
}

Pack.prototype.addGlobal = function (props) {
  var me = this
  var g = me._currentEntry = new GlobalHeaderWriter(props)

  g.on("data", function (c) {
    console.error("global data")
    me.emit("data", c)
  })

  g.on("end", function () {
    console.error("global end")
    me._currentEntry = null
    me._process()
  })
  console.error("Pack added g.end listener")
}

Pack.prototype.pause = function () {
  var me = this
  if (me._currentEntry) me._currentEntry.pause()
  me._paused = true
}

Pack.prototype.resume = function () {
  var me = this
  if (me._currentEntry) me._currentEntry.resume()
  me._paused = false
  me._process()
}

Pack.prototype.add = function (entry) {
  console.error("TP add ", entry.path)
  if (this._ended) this.emit("error", new Error("add after end"))

  var me = this
  collect(entry)
  me._buffer.push(entry)
  me._process()
  me._needDrain = me._buffer.length > 0
  return !me._needDrain
}

// no-op.  use .add(entry)
Pack.prototype.write = function () {}
Pack.prototype.destroy = function () {}

Pack.prototype.end = function () {
  console.error("TP End")

  if (this._ended) return

  if (!eof) {
    eof = new Buffer(1024)
    for (var i = 0; i < 1024; i ++) eof[i] = 0
  }
  this._buffer.push(eof)
  this._process()
}

Pack.prototype._process = function () {
  console.error("Pack process, currentEntry?", !!this._currentEntry)
  var me = this

  if (me._currentEntry || me._paused) return

  var entry = me._buffer.shift()

  if (!entry) {
    console.error("Pack drain")
    if (me._needDrain) me.emit("drain")
    return true
  }

  if (entry === eof) {
    this.emit("data", eof)
    this.emit("end")
    this.emit("close")
    return
  }

  // Change the path to be relative to the root dir that was
  // added to the tarball.
  var root = path.dirname((entry.root || entry).path)
  var wprops = {}
  Object.keys(entry.props).forEach(function (k) {
    wprops[k] = entry.props[k]
  })
  wprops.path = path.relative(root, entry.path)
  console.error(root, wprops.path)
  // throw "break"

  // pack a tar header out of the entry.props
  // if it's a dir, then listen to it for "child" events.
  var writer = me._currentEntry = new EntryWriter(wprops)

  console.error("Pack Writer", writer)

  writer.on("data", function (c) {
    me.emit("data", c)
  })

  writer.on("close", function () {
    console.error("Pack Writer close")
    me._currentEntry = null
    me._process()
  })

  writer.once("ready", function () {
    console.error("Pack writer ready", writer.path)
    // The entry has been collected, so it needs to be piped
    // so that it can be released.
    if (entry.type === "Directory") {
      // dir entries should actually be clipped off, and their entries
      // added separately.
      console.error("pipe dir to writer", entry.path)
      writer.end()
      entry.pipe(me, { end: false })
    } else {
      console.error("pipe entry to writer", entry.path)
      entry.pipe(writer)
    }
    entry.resume()
  })

  return me._buffer.length === 0
}

var seen = {}
