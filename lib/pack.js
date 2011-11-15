// pipe in an fstream, and it'll make a tarball.
// key-value pair argument is global extended header props.

module.exports = Pack

var EntryWriter = require("./entry-writer.js")
  , Stream = require("stream").Stream
  , path = require("path")
  , inherits = require("inherits")
  , GlobalHeaderWriter = require("./global-header-writer.js")
  , collect = require("fstream").collect
  , eof = new Buffer(1024)

for (var i = 0; i < 1024; i ++) eof[i] = 0

inherits(Pack, Stream)

function Pack (props) {
  console.error("-- p ctor")
  var me = this
  if (!(me instanceof Pack)) return new Pack(props)

  if (props) {
    me._global = props
  }

  me.readable = true
  me.writable = true
  me._buffer = []
  console.error("-- -- set current to null in ctor")
  me._currentEntry = null
  me._processing = false

  me._pipeRoot = null
  me.on("pipe", function (src) {
    if (src.root === me._pipeRoot) return
    me._pipeRoot = src
    src.on("end", function () {
      me._pipeRoot = null
    })
    me.add(src)
  })
}

Pack.prototype.addGlobal = function (props) {
  console.error("-- p addGlobal")
  if (this._didGlobal) return
  this._didGlobal = true

  var me = this
  GlobalHeaderWriter(props)
    .on("data", function (c) {
      console.error("-- -- data", c.toString().split('\0').join("."))
      me.emit("data", c)
    })
    .end()
}

Pack.prototype.add = function (stream) {
  if (this._global && !this._didGlobal) this.addGlobal(this._global)

  console.error("-- p add", stream.path,
               new Error("trace").stack.split('\n').join("\n-- p add "))

  if (this._ended) return this.emit("error", new Error("add after end"))

  collect(stream)
  this._buffer.push(stream)
  this._process()
  this._needDrain = this._buffer.length > 0
  return !this._needDrain
}

Pack.prototype.pause = function () {
  console.error("-- p pause", new Error("trace").stack)
  this._paused = true
  if (this._currentEntry) this._currentEntry.pause()
  this.emit("pause")
}

Pack.prototype.resume = function () {
  console.error("-- p resume")
  this._paused = false
  if (this._currentEntry) this._currentEntry.resume()
  this.emit("resume")
  this._process()
}

Pack.prototype.end = function () {
  console.error("-- p end", new Error("trace").stack)
  this._ended = true
  this._buffer.push(eof)
  this._process()
}

Pack.prototype._process = function () {
  console.error("-- p process")
  var me = this
  if (me._paused || me._processing) {
    console.error("-- -- paused=%j processing=%j", me._paused, me._processing)
    console.error("-- -- current=", me._currentEntry && me._currentEntry.path)
    return
  }

  var entry = me._buffer.shift()

  if (!entry) {
    console.error("-- -- pack done with entries")
    if (me._needDrain) {
      console.error("-- -- pack drain")
      me.emit("drain")
    }
    return
  }

  me._processing = true

  if (entry === eof) {
    console.error("-- -- pack eof")
    me.emit("data", eof)
    me.emit("end")
    me.emit("close")
    return
  }

  console.error("-- -- entry=%s", entry.path)
  console.error("-- -- remaining=%j", this._buffer.map(function (e) {
    return e.path || "<<EOF>>"
  }))

  // Change the path to be relative to the root dir that was
  // added to the tarball.
  //
  // XXX This should be more like how -C works, so you can
  // explicitly set a root dir.

  var root = path.dirname((entry.root || entry).path)
  var wprops = {}
  Object.keys(entry.props).forEach(function (k) {
    wprops[k] = entry.props[k]
  })
  wprops.path = path.relative(root, entry.path)

  if (entry.type === "Directory") {
    wprops.path += "/"
  }

  console.error("-- -- set current to new writer", wprops.path)
  var writer = me._currentEntry = EntryWriter(wprops)

  writer.parent = me

  writer.on("end", function () {
    console.error("-- -- writer end", writer.path)
  })

  writer.on("data", function (c) {
    me.emit("data", c)
  })

  writer.on("header", function () {
    Buffer.prototype.toJSON = function () {
      return this.toString().split(/\0/).join(".")
    }
    console.error("-- -- writer header %j", writer.props,
                  writer.props.block.toString())
    if (writer.props.size === 0) nextEntry()
  })
  writer.on("close", nextEntry)

  var ended = false
  function nextEntry () {
    if (ended) return
    ended = true

    console.error("-- -- writer close", writer.path)
    console.error("-- -- set current to null", wprops.path)
    me._currentEntry = null
    me._processing = false
    me._process()
  }

  writer.on("error", function (er) {
    console.error("-- -- writer error", writer.path)
    me.emit("error", er)
  })

  // if it's the root, then there's no need to add its entries,
  // or data, since they'll be added directly.
  if (entry === me._pipeRoot) {
    writer.add = null
  }

  entry.pipe(writer)
}

Pack.prototype.destroy = function () {}
Pack.prototype.write = function () {}
