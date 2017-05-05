const path = require('path')
const cwd = process.argv[2] || path.dirname(__dirname)
const file = '/tmp/benchmark.tar'
const fs = require('fs')
process.on('exit', _ => fs.unlinkSync(file))

const Pack = require('../../lib/pack.js')
const start = process.hrtime()
const p = new Pack({ cwd: cwd })
p.add('').end()
p.pipe(fs.createWriteStream(file)).on('finish', _ => {
  const end = process.hrtime(start)
  console.error(end[0]*1e3 + end[1]/1e6)
})
