import { assert, test } from 'ubqtest'
import { CwdError } from '../src/cwd-error.js'

test('CwdError has the chdir fields', () => {
  assert.match(new CwdError('path', 'code'), {
    name: 'CwdError',
    path: 'path',
    code: 'code',
    syscall: 'chdir',
    message: `code: Cannot cd into 'path'`,
  })
})
