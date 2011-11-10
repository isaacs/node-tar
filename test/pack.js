var tap = require("tap")
  , tar = require("../tar.js")
  , pkg = require("../package.json")
  , Pack = tar.Pack
  , fstream = require("fstream")
  , Reader = fstream.Reader
  , Writer = fstream.Writer
  , path = require("path")
  , dir = path.resolve(__dirname, "fixtures")
  , target = path.resolve(__dirname, "pack.tar")

tap.test("make a tar", function (t) {
  // put the package.json in as a global header, for kicks.
  var reader = Reader({ path: dir
                      // , filter: function () {
                      //     return !this.path.match(/\.tar$/)
                      //   }
                      })
  var pack = Pack(pkg)
  var writer = Writer(target)

  t.ok(reader, "reader ok")
  t.ok(pack, "pack ok")
  t.ok(writer, "writer ok")

  reader.pipe(pack).pipe(writer)
  writer.on("close", function () {
    t.ok(true, "it finished!")
    t.end()
  })

})
