// give it a tarball and a path, and it'll dump the contents

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

  this._fst = fstream.Writer(opts)

  this.pause()
  var me = this
  this._fst.on("ready", function () {
    me.pipe(me._fst)
    me.resume()
  })

}

inherits(Extract, tar.Reader)
