const t = require('tap')
const normalize = require('../lib/normalize-unicode.js')

// café
const cafe1 = Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9]).toString()

// cafe with a `
const cafe2 = Buffer.from([0x63, 0x61, 0x66, 0x65, 0xcc, 0x81]).toString()

t.equal(normalize(cafe1), normalize(cafe2), 'matching unicodes')
t.equal(normalize(cafe1), normalize(cafe2), 'cached')
t.equal(normalize('foo'), 'foo', 'non-unicdoe string')
