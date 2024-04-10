import t from 'tap'
import { CwdError } from '../dist/esm/cwd-error.js'

t.match(new CwdError('path', 'code'), {
  name: 'CwdError',
  path: 'path',
  code: 'code',
  syscall: 'chdir',
  message: `code: Cannot cd into 'path'`,
})
