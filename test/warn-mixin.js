const t = require('tap')
const EE = require('events').EventEmitter
const warner = require('../lib/warn-mixin.js')

const Warner = warner(EE)

const w = new Warner()

t.type(w.warn, 'function')

const warning = []
w.once('warn', (code, msg, data) => warning.push(code, msg, data))
w.warn('code', 'hello')
t.same(warning, ['code', 'hello', { tarCode: 'code', code: 'code' }])

warning.length = 0
w.once('warn', (code, msg, data) => warning.push(code, msg, data))
w.warn('ok', new Error('this is fine'), { foo: 'bar' })
t.match(warning, ['ok', 'this is fine', {
  message: 'this is fine',
  foo: 'bar',
}])

w.strict = true
t.throws(_ => w.warn('code', 'hello', { data: 123 }),
  { message: 'hello', data: 123 })
const poop = new Error('poop')
t.throws(_ => w.warn('ok', poop), poop)

w.file = 'some/file'
t.throws(_ => w.warn('ok', 'this is fine'), { file: 'some/file' })
w.cwd = 'some/dir'
t.throws(_ => w.warn('ok', 'this is fine'), { cwd: 'some/dir' })

w.strict = false
t.throws(_ => w.warn('ok', 'this is fine', { recoverable: false }),
  { cwd: 'some/dir', recoverable: false })
