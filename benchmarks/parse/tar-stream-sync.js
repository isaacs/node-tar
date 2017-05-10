const tar = require('tar-stream')
const path = require('path')
const file = process.argv[2] || path.resolve(__dirname, '../npm.tar')
const fs = require('fs')
const data = fs.readFileSync(file)

const timer = require('../timer.js')()
const p = tar.extract()
p.on('entry', (entry, stream, callback) => {
  stream.on('end', callback)
  stream.resume()
})
p.on('finish', timer)
p.end(data)
