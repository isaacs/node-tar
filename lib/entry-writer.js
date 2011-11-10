module.exports = EntryWriter

var tar = require("../tar.js")
  , TarHeader = require("./header.js")
  , Entry = require("./entry.js")
  , inherits = require("inherits")
  , BlockStream = require("block-stream")
  , Stream = require("stream").Stream
  , EOF = {}

function EntryWriter (props) {
  Stream.apply(this)

  var me = this
  me.writable = true
  me.readable = true

  me._stream = new BlockStream(512)

  me._stream.on("data", function (c) {
    me.emit("data", c)
  })

  me._stream.on("drain", function () {
    me.emit("drain")
    me._process()
  })

  me._stream.on("end", function () {
    me.emit("end")
    me.emit("close")
  })

  me.props = props
  me.path = props.path

  me._process()
  me._buffer = []

  process.nextTick(function () {
    me._process()
  })
}

inherits(EntryWriter, Stream)

EntryWriter.prototype.write = function (c) {
  var me = this
  if (me._ended) {
    me.error("write after end")
    return false
  }
  if (me._buffer.length || !me._ready) {
    me._buffer.push(c)
    me._process()
    return false
  }

  if (c === EOF) return me._stream.end()
  return me._stream.write(c)
}

EntryWriter.prototype.end = function (c) {
  var me = this
  if (me._buffer.length || !me._ready) {
    if (c) me._buffer.push(c)
    me.push(EOF)
    me._process()
    return
  }

  if (c) me.write(c)
  me._stream.end()
}

EntryWriter.prototype.pause = function () {
  var me = this
  me._paused = true
  me._stream.pause()
}

EntryWriter.prototype.resume = function () {
  var me = this
  me._paused = false
  me._stream.resume()
  me._process()
}

EntryWriter.prototype._process = function () {
  var me = this
  if (me._processing || me._paused) return
  if (!me._ready) {
    me._writeProps()
  }

  me._processing = true
  var buf = me._buffer
  me._buffer = []
  me._buffer.forEach(function (c) {
    if (c === EOF) me.end()
    else me.write(c)
  })
  me._processing = false

  if (me._buffer.length) return me._process()
}

EntryWriter.prototype._writeProps = function () {
  var me = this

  me._headerBlock = TarHeader.encode(me.props)

  if (me.props.needExtended) {
    return me._writeExtended()
  }

  me._stream.write(me._headerBlock)
  me._ready = true
}

EntryWriter.prototype._writeExtended = function () {
  var me = this
  me._extended = new ExtendedEntry(me.props)
  me._extended.on("data", function (c) {
    me._stream.write(c)
  })
  me._extended.on("end", function (c) {
    me._stream.flush()
    me._writeProps()
  })
}
