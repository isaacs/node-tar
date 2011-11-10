module.exports = EntryWriter

var tar = require("../tar.js")
  , TarHeader = require("./header.js")
  , Entry = require("./entry.js")
  , inherits = require("inherits")
  , BlockStream = require("block-stream")
  , ExtendedHeaderWriter
  , Stream = require("stream").Stream
  , EOF = {}

inherits(EntryWriter, Stream)

function EntryWriter (props) {
  var me = this

  if (!(me instanceof EntryWriter)) {
    console.error("not an entry writer!")
    var ctor = me.constructor
    while (ctor && ctor !== Object) {
      console.error("  " + ctor.name + " me is?" + (me instanceof ctor) +
                    " is EW?" + (ctor === EntryWriter))
      ctor = ctor.prototype.__proto__.constructor
    }
    return new EntryWriter(props)
  }

  Stream.apply(this)

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
    console.error("EW Stream end", me.props.path)
    me.emit("end")
    me.emit("close")
  })

  me.props = props
  me.path = props.path

  me._buffer = []

  process.nextTick(function () {
    console.error("\t\tcalling ew process")
    me._process()
  })
}

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

  return me._stream.write(c)
}

EntryWriter.prototype.end = function (c) {
  console.error("EW end")
  var me = this
  if (me._buffer && me._buffer.length || !me._ready) {
    if (c) me._buffer.push(c)
    me._buffer.push(EOF)
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
    console.error("\t\t\tnot ready, write props first")
    me._writeProps()
    me.emit("ready")
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

  if (me.props.needExtended && !me._extended) {
    console.error("need extended props for", me.props.path)
    return me._writeExtended()
  }

  me._stream.write(me._headerBlock)
  me._ready = true
}

EntryWriter.prototype._writeExtended = function () {
  var me = this
  if (!ExtendedHeaderWriter) {
    ExtendedHeaderWriter = require("./extended-header-writer.js")
  }
  me._extended = new ExtendedHeaderWriter(me.props)
  me._extended.on("data", function (c) {
    me._stream.write(c)
  })
  me._extended.on("end", function (c) {
    me._stream.flush()
    me._writeProps()
  })
}

EntryWriter.prototype.destroy = function () {}
