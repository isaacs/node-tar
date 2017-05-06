const tar = require('../..')
const path = require('path')
const file = process.argv[2] || path.resolve(__dirname, '../npm.tar')

const timer = require('../timer.js')()
tar.t({
  file: file
}).then(timer)
