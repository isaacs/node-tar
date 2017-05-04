const tar = require('tar-stream')
const path = require('path')
const file = process.argv[2] || path.resolve(__dirname, '../npm.tar')
const fs = require('fs')

let slices = 0
Buffer.prototype.slice = (original => function () {
  slices ++
  return original.apply(this, arguments)
})(Buffer.prototype.slice)

const start = process.hrtime()
const p = tar.extract()
p.on('entry', (entry, stream, callback) => {
  stream.on('end', callback)
  stream.resume()
})
p.on('data', _ => _)
process.on('exit', (code, signal) => {
  const end = process.hrtime(start)
  console.log(end[0]*1e3 + end[1]/1e6)
  console.log(slices)
})
fs.createReadStream(file).pipe(p)
