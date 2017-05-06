const path = require('path')
const cwd = process.argv[2] || path.dirname(__dirname)
const file = '/tmp/benchmark.tar'
const fs = require('fs')
process.on('exit', _ => fs.unlinkSync(file))

const tar = require('../..')
const start = process.hrtime()
const c = tar.c({ cwd: cwd }, [''])
c.pipe(fs.createWriteStream(file)).on('close', _ => {
  const end = process.hrtime(start)
  const ms = Math.round(end[0]*1e6 + end[1]/1e3)/1e3
  const s = Math.round(end[0]*10 + end[1]/1e8)/10
  const ss = s <= 1 ? '' : ' (' + s + 's)'
  console.error('%d%s', ms, ss)
})
