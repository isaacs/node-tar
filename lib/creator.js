// a stream that outputs tar from entries getting added
// when a type="Directory" entry is added, listen to it
// for entries, and add those as well, removing the listener
// once it emits "end".  Close the dir entry itself immediately,
// since it'll always have zero size.

module.exports = Creator

var stream = require("stream")
  , Stream = stream.Stream
  , BlockStream = require("block-stream")
  , TarHeader = require("./header.js")
  , Entry = require("./entry.js")
  , BufferEntry = require("./buffer-entry.js")
  , ExtendedHeader = require("./extended-header.js")
  , assert = require("assert").ok
  , inherits = require("inherits")
  , fstream = require("fstream")

inherits(Creator, Stream)

function Creator (props) {
  var me = this
  if (!(me instanceof Creator)) return new Creator(props)

  // don't apply the fstream ctor
  // we just want it for the .pipe() method
  Stream.apply(me)

  me.writable = true
  me.readable = true

  me._buffer = []
}

Creator.prototype.add = function (entry) {
  var me = this
  collect(entry)
  me._buffer.push(entry)
  me._process()
}

Creator.prototype._process = function () {
  var me = this
  if (me._processing || me._currentEntry) return

  me._processing = true

  var entry = me._buffer.shift()

  // XXX Change the path to be relative to the root dir that was
  // added to the tarball.
  //
  // XXX The entry has been collected, so it needs to be piped
  // so that it can be released.

  // create a tar header out of the entry.props
  // if it's a dir, then listen to it for "child" events.
  var writer = me._currentEntry = new EntryWriter(entry.props)

  writer.on("data", function (c) {
    me.emit("data", c)
  })

  writer.on("close", function () {
    me._process()
  })
}
