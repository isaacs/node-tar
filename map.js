const { basename } = require('path')

const map = test =>
  test === 'index.js' || test === 'map.js' ? test
  : test === 'unpack.js' ? ['lib/unpack.js', 'lib/mkdir.js']
  : test === 'load-all.js' ? []
  : `lib/${test}`

module.exports = test => map(basename(test))
