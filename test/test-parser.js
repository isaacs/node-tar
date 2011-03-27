var p = require("../tar").createParser()
  , fs = require("fs")
  , tar = require("../tar")

p.on("file", function (file) {
  console.error(file)
  Object.keys(file._raw).forEach(function (f) {
    console.log(f, file._raw[f].length)
  })
  file.on("data", function (c) {
    console.error("data", c)
  })
  file.on("end", function () {
    console.error("end", file.name)
  })
})


var s = fs.createReadStream(__dirname + "/tar-files/foo.tar")
s.on("end", function () { console.error("stream end") })
s.on("close", function () { console.error("stream close") })
s.pipe(p)
