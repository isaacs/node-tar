const Parse = require('tar').Parse
const path = require('path')
const file = process.argv[2] || path.resolve(__dirname, '../npm.tar')
const fs = require('fs')

const timer = require('../timer.js')()
const p = new Parse()
p.on('entry', entry => entry.resume())
p.on('end', timer)
fs.createReadStream(file).pipe(p)
