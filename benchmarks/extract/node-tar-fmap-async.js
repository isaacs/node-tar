const cwd = __dirname + '/cwd'
const rimraf = require('rimraf')
rimraf.sync(cwd)
require('mkdirp').sync(cwd)
process.on('exit', _ => rimraf.sync(cwd))
const path = require('path')
const file = process.argv[2] || path.resolve(__dirname, '../npm.tar')
const fs = require('fs')
const { O_CREAT, O_TRUNC, O_WRONLY, UV_FS_O_FILEMAP } = fs.constants

const tar = require('../..')
const timer = require('../timer.js')()
tar.x({
  fflag: (UV_FS_O_FILEMAP | O_TRUNC | O_CREAT | O_WRONLY),
  file: file,
  cwd: cwd
}).then(timer)
