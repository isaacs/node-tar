// not much to test here, just 2 maps.
const t = require('tap')
const types = require('../lib/types.js')
t.equal(types.name.get('0'), 'File')
t.equal(types.code.get('File'), '0')
