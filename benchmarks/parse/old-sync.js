const Parse = require('tar').Parse
const path = require('path')
const file = process.argv[2] || path.resolve(__dirname, '../npm.tar')
const fs = require('fs')
const data = fs.readFileSync(file)

const timer = require('../timer.js')()
const p = new Parse()
p.on('entry', entry => entry.resume())
p.on('end', timer)
p.end(data)
