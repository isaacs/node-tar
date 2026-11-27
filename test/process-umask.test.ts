import { assert, test } from 'ubqtest'
import { umask } from '../src/process-umask.js'
test('umask returns the process umask', () => {
  assert.equal(umask(), process.umask())
})
