var tap = require("tap")
  , tar = require("../tar.js")
  , pkg = require("../package.json")
  , Pack = tar.Pack
  , fstream = require("fstream")
  , Reader = fstream.Reader
  , Writer = fstream.Writer
  , path = require("path")
  , input = path.resolve(__dirname, "fixtures/omega.txt")
  , target = path.resolve(__dirname, "tmp/pack.tar")

process.on("uncaughtException", function (er) {
  console.error(er.stack)
  console.error(er)
})

tap.test("make a tar", function (t) {
  // put the package.json in as a global header, for kicks.
  var reader = Reader(input)
  var pack = Pack(pkg)
  var writer = Writer(target)

  t.ok(reader, "reader ok")
  t.ok(pack, "pack ok")
  t.ok(writer, "writer ok")

  pack.pipe(writer)

  var parse = tar.Parse()
  pack.on("data", parse.write.bind(parse))
  pack.on("end", parse.end.bind(parse))
  parse.on("*", function (ev, e) {
    console.error("      entry %s", ev, e.props)
  })


  // reader.pipe(pack)
  pack.add(reader)
  pack.end()

  writer.on("close", function () {
    t.ok(true, "it finished!")
    t.end()
  })

})
