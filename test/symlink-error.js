import t from 'tap'
import { SymlinkError } from '../dist/esm/symlink-error.js'

t.match(new SymlinkError('symlink', 'path'), {
  name: 'SymlinkError',
  path: 'path',
  symlink: 'symlink',
  syscall: 'symlink',
  code: 'TAR_SYMLINK_ERROR',
  message: 'TAR_SYMLINK_ERROR: Cannot extract through symbolic link',
})
