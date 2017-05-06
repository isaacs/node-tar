const cwd = __dirname + '/cwd'
const rimraf = require('rimraf')
rimraf.sync(cwd)
require('mkdirp').sync(cwd)
process.on('exit', _ => rimraf.sync(cwd))
const path = require('path')
const file = process.argv[2] || path.resolve(__dirname, '../npm.tar')

const Unpack = require('../../lib/unpack.js')
const fs = require('fs')

const timer = require('../timer.js')()
const u = new Unpack({ cwd: cwd })
u.on('close', timer)
fs.createReadStream(file).pipe(u)
