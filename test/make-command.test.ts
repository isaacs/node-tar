import { any, assert, test } from 'ubqtest'
import { makeCommand } from '../src/make-command.js'
import {
  isAsyncFile,
  isAsyncNoFile,
  isSyncFile,
  isSyncNoFile,
} from '../src/options.js'

class Sync {
  sync: true = true
}
class Async {}

const cmd = makeCommand<Async, Sync>(
  (opt, entries) => {
    assert.equal(isSyncFile(opt), true)
    assert(entries instanceof Array)
  },
  async (opt, entries) => {
    assert.equal(isAsyncFile(opt), true)
    assert(entries instanceof Array)
  },
  (opt, entries) => {
    assert.equal(isSyncNoFile(opt), true)
    assert(entries instanceof Array)
    return new Sync()
  },
  (opt, entries) => {
    assert.equal(isAsyncNoFile(opt), true)
    assert(entries instanceof Array)
    return new Async()
  },
  (opt, entries) => {
    if (entries?.length === 2) throw new Error('should not be len 2')
    if (!opt) throw new Error('should get opt')
  },
)

test('validation function is called', () => {
  assert.throws(() => cmd({}, ['a', 'b']), Error)
  assert.throws(() => cmd({ sync: true }, ['a', 'b']), Error)
  assert.throws(() => cmd({ sync: true, file: 'x' }, ['a', 'b']), Error)
  assert.throws(() => cmd({ file: 'x' }, ['a', 'b']), Error)
  // cases where cb is not allowed
  assert.throws(() => cmd({}, [], () => {}), Error)
  assert.throws(() => cmd({}, () => {}), Error)
  //@ts-expect-error
  assert.throws(() => cmd({ sync: true }, [], () => {}), Error)
  //@ts-expect-error
  assert.throws(() => cmd({ sync: true }, () => {}), Error)
  assert.throws(() => cmd({ sync: true, file: 'x' }, [], () => {}), Error)
  assert.throws(() => cmd({ sync: true, file: 'x' }, () => {}), Error)
})

test('basic calls', async () => {
  assert.match(cmd(), any.instanceOf(Async))
  assert.match(cmd({}), any.instanceOf(Async))
  assert.match(cmd({}, []), any.instanceOf(Async))
  assert.match(cmd({ sync: true }), any.instanceOf(Sync))
  assert.match(cmd({ sync: true }, []), any.instanceOf(Sync))
  assert.equal(cmd({ sync: true, file: 'x' }), undefined)
  assert.equal(await cmd({ file: 'x' }), undefined)
  assert.equal(await cmd({ file: 'x' }, []), undefined)
  let cbCalled = false
  assert.equal(
    await cmd({ file: 'x' }, [], () => {
      cbCalled = true
    }),
    undefined,
  )
  assert.equal(cbCalled, true, 'called callback')
})
