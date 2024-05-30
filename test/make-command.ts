import t from 'tap'
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
    t.equal(isSyncFile(opt), true)
    t.type(entries, Array)
  },
  async (opt, entries) => {
    t.equal(isAsyncFile(opt), true)
    t.type(entries, Array)
  },
  (opt, entries) => {
    t.equal(isSyncNoFile(opt), true)
    t.type(entries, Array)
    return new Sync()
  },
  (opt, entries) => {
    t.equal(isAsyncNoFile(opt), true)
    t.type(entries, Array)
    return new Async()
  },
  (opt, entries) => {
    if (entries?.length === 2) throw new Error('should not be len 2')
    if (!opt) throw new Error('should get opt')
  },
)

t.test('validation function is called', t => {
  t.throws(() => cmd({}, ['a', 'b']))
  t.throws(() => cmd({ sync: true }, ['a', 'b']))
  t.throws(() => cmd({ sync: true, file: 'x' }, ['a', 'b']))
  t.throws(() => cmd({ file: 'x' }, ['a', 'b']))
  // cases where cb is not allowed
  t.throws(() => cmd({}, [], () => {}))
  t.throws(() => cmd({}, () => {}))
  //@ts-expect-error
  t.throws(() => cmd({ sync: true }, [], () => {}))
  //@ts-expect-error
  t.throws(() => cmd({ sync: true }, () => {}))
  t.throws(() => cmd({ sync: true, file: 'x' }, [], () => {}))
  t.throws(() => cmd({ sync: true, file: 'x' }, () => {}))
  t.end()
})

t.test('basic calls', async t => {
  t.match(cmd(), Async)
  t.match(cmd({}), Async)
  t.match(cmd({}, []), Async)
  t.match(cmd({ sync: true }), Sync)
  t.match(cmd({ sync: true }, []), Sync)
  t.equal(cmd({ sync: true, file: 'x' }), undefined)
  t.equal(await cmd({ file: 'x' }), undefined)
  t.equal(await cmd({ file: 'x' }, []), undefined)
  let cbCalled = false
  t.equal(
    await cmd({ file: 'x' }, [], () => {
      cbCalled = true
    }),
    undefined,
  )
  t.equal(cbCalled, true, 'called callback')
})
