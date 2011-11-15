var tap = require("tap")
  , tar = require("../tar.js")
  , pkg = require("../package.json")
  , Pack = tar.Pack
  , fstream = require("fstream")
  , Reader = fstream.Reader
  , Writer = fstream.Writer
  , path = require("path")
  , input = path.resolve(__dirname, "fixtures/")
  , target = path.resolve(__dirname, "tmp/pack.tar")

// process.on("uncaughtException", function (er) {
//   console.error(er.stack)
//   console.error(er)
//   process.exit(1)
// })

// first, make sure that the hardlinks are actually hardlinks, or this
// won't work.  Git has a way of replacing them with a copy.
var hard1 = path.resolve(__dirname, "fixtures/hardlink-1")
  , hard2 = path.resolve(__dirname, "fixtures/hardlink-2")
  , fs = require("fs")

try { fs.unlinkSync(hard2) } catch (e) {}
fs.linkSync(hard1, hard2)

tap.test("make a tar", { timeout: 1000 }, function (t) {
  // put the package.json in as a global header, for kicks.
  var reader = Reader({ path: input
                      , filter: function () {
                          return !this.path.match(/\.(tar|hex)$/)
                        }
                      })

  var pack = Pack({}) // Pack(pkg)
  var writer = Writer(target)

  t.ok(reader, "reader ok")
  t.ok(pack, "pack ok")
  t.ok(writer, "writer ok")

  pack.pipe(writer)

  var parse = tar.Parse()
  pack.on("data", function (c) {
    console.error("PACK DATA")
    parse.write(c)
  })
  pack.on("end", function () {
    console.error("PACK END")
    parse.end()
  })

  parse.on("*", function (ev, e) {
    console.error("      entry %s", ev, e.props)
  })


  reader.pipe(pack)
  // pack.add(reader)
  // pack.end()

  writer.on("close", function () {
    t.ok(true, "it finished!")
    t.end()
  })

})
