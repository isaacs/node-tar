var tar = require("../tar.js")
  , fs = require("fs")


var on_error = function(err) {
  console.error('An error occurred:', err)
}

var on_end = function() {
  console.log('Extracted!')
}

var extractor = tar.Extract({path: __dirname + "/extract"})
  .on('error', on_error)
  .on('end', on_end);

fs.createReadStream(__dirname + "/../test/fixtures/c.tar")
  .on('error', on_error)
  .pipe(extractor);
