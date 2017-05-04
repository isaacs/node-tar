const tar = require('../..')
const path = require('path')
const file = process.argv[2] || path.resolve(__dirname, '../npm.tar')

const start = process.hrtime()
tar.t({
  file: file
}).then(_ => {
  const end = process.hrtime(start)
  console.error(end[0]*1e3 + end[1]/1e6)
})
