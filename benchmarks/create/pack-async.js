const path = require('path')
const cwd = process.argv[2] || path.dirname(__dirname)
const file = '/tmp/benchmark.tar'
const fs = require('fs')
process.on('exit', _ => fs.unlinkSync(file))

const Pack = require('../../lib/pack.js')
const timer = require('../timer.js')()
const p = new Pack({ cwd: cwd })
p.add('').end()
p.pipe(fs.createWriteStream(file)).on('finish', timer)
