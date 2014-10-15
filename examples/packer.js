var tar = require("../tar.js")
  , fstream = require("fstream")
  , fs = require("fs")

var dir_destination = fs.createWriteStream('dir.tar')


var on_error = function(err) {
  console.error('An error occurred:', err)
}

var on_end = function() {
  console.log('Packed!')
}

var packer = tar.Pack({ noProprietary: true })
  .on('error', on_error)
  .on('end', on_end);

// This must be a "directory"
fstream.Reader({ path: __dirname, type: "Directory" })
  .on('error', on_error)
  .pipe(packer)
  .pipe(dir_destination)
