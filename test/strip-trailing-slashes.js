const t = require('tap')
const stripSlash = require('../lib/strip-trailing-slashes.js')
const short = '///a///b///c///'
const long = short.repeat(10) + '/'.repeat(1000000)

t.equal(stripSlash('no slash'), 'no slash')
t.equal(stripSlash(short), '///a///b///c')
t.equal(stripSlash(long), short.repeat(9) + '///a///b///c')
