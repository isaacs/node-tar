const path = require('path')
const cwd = process.argv[2] || path.dirname(__dirname)
const file = '/tmp/benchmark.tar'
const fs = require('fs')
process.on('exit', _ => fs.unlinkSync(file))

const tar = require('../..')
const timer = require('../timer.js')()
const c = tar.c({ cwd: cwd, sync: true }, [''])
fs.writeFileSync(file, c.read())
timer()
