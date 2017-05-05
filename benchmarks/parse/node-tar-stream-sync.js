const tar = require('../..')
const path = require('path')
const file = process.argv[2] || path.resolve(__dirname, '../npm.tar')
const fs = require('fs')

const start = process.hrtime()
const p = tar.t({ sync: true })
p.on('end', _ => {
  const end = process.hrtime(start)
  console.error(end[0]*1e3 + end[1]/1e6)
})
p.end(fs.readFileSync(file))
