// give it a tarball and a path, and it'll dump the contents

module.exports = Extract

var tar = require("../tar.js")
  , fstream = require("fstream")
  , inherits = require("inherits")
  , path = require("path")

function Extract (opts) {
  if (!(this instanceof Extract)) return new Extract(opts)
  tar.Reader.apply(this)

  // have to dump into a directory
  opts.type = "Directory"
  opts.Directory = true

  if (typeof opts !== "object") {
    opts = { path: opts }
  }

  // better to drop in cwd? seems more standard.
  opts.path = opts.path || path.resolve("node-tar-extract")
  opts.type = "Directory"
  opts.Directory = true

  this._fst = fstream.Writer(opts)

  this.pause()
  var me = this
  this._fst.on("ready", function () {
    me.pipe(me._fst, { end: false })
    me.resume()
  })

  this._fst.on("end", function () {
    console.error("\nEEEE Extract End", me._fst.path)
  })

  this._fst.on("close", function () {
    console.error("\nEEEE Extract End", me._fst.path)
    me.emit("end")
    me.emit("close")
  })
}

inherits(Extract, tar.Reader)

Extract.prototype._streamEnd = function () {
  var me = this
  if (!me._ended) me.error("unexpected eof")
  me._fst.end()
  // my .end() is coming later.
}
