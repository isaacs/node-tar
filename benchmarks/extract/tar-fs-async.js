const cwd = __dirname + '/cwd'
const rimraf = require('rimraf')
rimraf.sync(cwd)
require('mkdirp').sync(cwd)
process.on('exit', _ => rimraf.sync(cwd))
const path = require('path')
const file = process.argv[2] || path.resolve(__dirname, '../npm.tar')

const tar = require('tar-fs')
const fs = require('fs')
const start = process.hrtime()
const e = tar.extract(cwd)
process.on('exit', (code, signal) => {
  const end = process.hrtime(start)
  console.log(end[0]*1e3 + end[1]/1e6)
})
fs.createReadStream(file).pipe(e)
