var tar = require("../tar.js")
  , fs = require("fs")

fs.createReadStream(__dirname + "/../test/fixtures/c.tar")
  .pipe(tar.Reader())
  .on("entry", function (e) {
    console.error("entry", e.props)
    e.on("data", function (c) {
      console.error("  >>>" + c.toString().replace(/\n/g, "\\n"))
    })
    e.on("end", function () {
      console.error("  <<<EOF")
    })
  })

