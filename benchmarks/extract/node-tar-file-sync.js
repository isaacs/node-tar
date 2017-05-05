const cwd = __dirname + '/cwd'
const rimraf = require('rimraf')
rimraf.sync(cwd)
require('mkdirp').sync(cwd)
process.on('exit', _ => rimraf.sync(cwd))
const path = require('path')
const file = process.argv[2] || path.resolve(__dirname, '../npm.tar')

const tar = require('../..')
const start = process.hrtime()
tar.x({
  file: file,
  sync: true,
  cwd: cwd
})

const end = process.hrtime(start)
console.error(end[0]*1e3 + end[1]/1e6)
