import { assert, test } from 'ubqtest'
import { SymlinkError } from '../src/symlink-error.js'

test('SymlinkError has the symlink fields', () => {
  assert.match(new SymlinkError('symlink', 'path'), {
    name: 'SymlinkError',
    path: 'path',
    symlink: 'symlink',
    syscall: 'symlink',
    code: 'TAR_SYMLINK_ERROR',
    message: 'TAR_SYMLINK_ERROR: Cannot extract through symbolic link',
  })
})
