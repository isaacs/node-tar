'use strict'
const t = require('tap')
const mf = require('../lib/mode-fix.js')

t.equal(mf(0o10666, 0o22, false), 0o644)
t.equal(mf(0o10666, 0o22, true),  0o755)
t.equal(mf(0o10604, 0o22, true),  0o705)
t.equal(mf(0o10622, 0o22, true),  0o700)
t.equal(mf(0o10066, 0o22, true),  0o055)
