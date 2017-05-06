const path = require('path')
const cwd = process.argv[2] || path.dirname(__dirname)
const file = '/tmp/benchmark.tar'
const fs = require('fs')
process.on('exit', _ => fs.unlinkSync(file))

const Reader = require('fstream').Reader
const Pack = require('tar').Pack
const start = process.hrtime()
const d = new Reader({ path: cwd })
const p = new Pack()
const fstr = fs.createWriteStream(file)
d.pipe(p).pipe(fstr)
fstr.on('close', _ => {
  const end = process.hrtime(start)
  const ms = Math.round(end[0]*1e6 + end[1]/1e3)/1e3
  const s = Math.round(end[0]*10 + end[1]/1e8)/10
  const ss = s <= 1 ? '' : ' (' + s + 's)'
  console.error('%d%s', ms, ss)
})
