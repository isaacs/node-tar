const path = require('path')
const cwd = process.argv[2] || path.dirname(__dirname)
const file = '/tmp/benchmark.tar'
const fs = require('fs')
process.on('exit', _ => fs.unlinkSync(file))

const Reader = require('fstream').Reader
const Pack = require('tar').Pack
const timer = require('../timer.js')()
const d = new Reader({ path: cwd })
const p = new Pack()
const fstr = fs.createWriteStream(file)
d.pipe(p).pipe(fstr)
fstr.on('close', timer)
