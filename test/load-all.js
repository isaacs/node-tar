'use strict'
// just load all the files so we can't cheat coverage by avoiding something
require('../')
const fs = require('fs')
const path = require('path')
const lib = path.resolve(__dirname, '../lib')
fs.readdirSync(lib)
  .filter(f => /\.js$/.test(f))
  .forEach(f => require('../lib/' + f))
require('tap').pass('all lib files loaded')
