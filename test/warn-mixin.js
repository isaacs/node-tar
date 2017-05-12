const t = require('tap')
const EE = require('events').EventEmitter
const warner = require('../lib/warn-mixin.js')

const Warner = warner(EE)

const w = new Warner()

t.isa(w.warn, 'function')

const warning = []
w.once('warn', (msg, data) => warning.push(msg, data))
w.warn('hello', w)
t.same(warning, ['hello', w])

w.strict = true
t.throws(_ => w.warn('hello', 123), { message: 'hello', data: 123 })
const poop = new Error('poop')
t.throws(_ => w.warn('ok', poop), poop)
