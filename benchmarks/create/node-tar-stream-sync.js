const path = require('path')
const cwd = process.argv[2] || path.dirname(__dirname)
const file = '/tmp/benchmark.tar'
const fs = require('fs')
process.on('exit', _ => fs.unlinkSync(file))

const tar = require('../..')
const start = process.hrtime()
const c = tar.c({ cwd: cwd, sync: true }, [''])
fs.writeFileSync(file, c.read())
const end = process.hrtime(start)
console.error(end[0]*1e3 + end[1]/1e6)
