const cwd = __dirname + '/cwd'
const rimraf = require('rimraf')
rimraf.sync(cwd)
require('mkdirp').sync(cwd)
process.on('exit', _ => rimraf.sync(cwd))
const path = require('path')
const file = process.argv[2] || path.resolve(__dirname, '../npm.tar')

const fs = require('fs')
const tar = require('tar-fs')
const data = fs.readFileSync(file)

const timer = require('../timer.js')()
const e = tar.extract(cwd)
process.on('exit', timer)
e.end(data)
