'use strict'
const t = require('tap')
const wc = require('../lib/winchars.js')

t.equal(wc.encode('<>'), '\uf03c\uf03e', 'encode')
t.equal(wc.decode(wc.encode('<>')), '<>', 'decode')
t.equal(wc.decode(wc.encode('\\|<>?:')), '\\|<>?:', 'all chars')
