const path = require('path')
const cwd = process.argv[2] || path.dirname(__dirname)
const file = '/tmp/benchmark.tar'
const fs = require('fs')
process.on('exit', _ => fs.unlinkSync(file))

const tar = require('tar-fs')
const timer = require('../timer.js')()
const p = tar.pack(cwd)
p.pipe(fs.createWriteStream(file)).on('close', timer)
