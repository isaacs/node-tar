const path = require('path')
const cwd = process.argv[2] || path.dirname(__dirname)
const file = '/tmp/benchmark.tar'
const fs = require('fs')
process.on('exit', _ => fs.unlinkSync(file))

const start = process.hrtime()
const tar = require('tar-fs')
const p = tar.pack(cwd)
p.pipe(fs.createWriteStream(file)).on('close', _ => {
  const end = process.hrtime(start)
  console.log(end[0]*1e3 + end[1]/1e6)
})
