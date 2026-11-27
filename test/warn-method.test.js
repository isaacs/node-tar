import { assert, test } from 'ubqtest'
import EE from 'events'
import { warnMethod } from '../src/warn-method.js'

test('warnMethod emits or throws by strictness', () => {
  class Warner extends EE {
    warn(code, message, data = {}) {
      return warnMethod(this, code, message, data)
    }
  }

  const w = new Warner()

  assert.equal(typeof w.warn, 'function')

  const warning = []
  w.once('warn', (code, msg, data) => warning.push(code, msg, data))
  w.warn('code', 'hello')
  assert.deepEqual(warning, [
    'code',
    'hello',
    { tarCode: 'code', code: 'code' },
  ])

  warning.length = 0
  w.once('warn', (code, msg, data) => warning.push(code, msg, data))
  w.warn('ok', new Error('this is fine'), { foo: 'bar' })
  assert.match(warning, [
    'ok',
    'this is fine',
    {
      message: 'this is fine',
      foo: 'bar',
    },
  ])

  w.strict = true
  assert.throws(_ => w.warn('code', 'hello', { data: 123 }), {
    message: 'code: hello',
    data: 123,
  })
  const poop = new Error('poop')
  assert.throws(_ => w.warn('ok', poop), { message: poop.message })

  w.file = 'some/file'
  assert.throws(_ => w.warn('ok', 'this is fine'), { file: 'some/file' })
  w.cwd = 'some/dir'
  assert.throws(_ => w.warn('ok', 'this is fine'), { cwd: 'some/dir' })

  w.strict = false
  assert.throws(
    _ => w.warn('ok', 'this is fine', { recoverable: false }),
    {
      cwd: 'some/dir',
      recoverable: false,
    },
  )
})
