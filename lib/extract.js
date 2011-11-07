// give it a tarball and a path, and it'll dump the contents

// process.on("uncaughtException", function (er) {
//   console.error("uncaught", er.stack, er)
//   console.error("errno", global.errno)
//   for (var i in global) console.error(i)
//   throw er
// })

module.exports = Extract

var tar = require("../tar.js")
  , fstream = require("fstream")
  , inherits = require("inherits")

function Extract (opts) {
  if (!(this instanceof Extract)) return new Extract(opts)
  tar.Reader.apply(this)

  // have to dump into a directory
  opts.type = "Directory"
  opts.Directory = true
  opts.path = opts.path || path.resolve("node-tar-extract")

  console.error("opts=", opts)

  this._fst = fstream.Writer(opts)

  this._stream.on("data", function (c) {
    console.error("\t\t\t", c.length)
  })

  this.pause()
  this._stream.pause()
  var me = this
  this._fst.on("ready", function () {
    console.error("stat", this.type, this.path)
    console.error(me.pipe.toString())
    me.pipe(me._fst)
    me.resume()
  })

  this.on("end", function () {
    console.error("ending")
  })
  this.on("entry", function (e) {
    console.error("entry", e.type, e.path)
  })

  this._fst.on("entry", function (e) {
    console.error("writing entry", e.type, e.path)
  })

  this._fst.on("error", function (e) {
    console.error("error", e.stack, e.code)
  })

  this.on("error", function (e) {
    console.error("my error", e.stack, e.code)
  })

}

inherits(Extract, tar.Reader)
