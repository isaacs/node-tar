export class SymlinkError extends Error {
  path: string
  symlink: string
  syscall = 'symlink' as const
  code = 'TAR_SYMLINK_ERROR' as const
  constructor(symlink: string, path: string) {
    super('TAR_SYMLINK_ERROR: Cannot extract through symbolic link')
    this.symlink = symlink
    this.path = path
  }
  get name() {
    return 'SymlinkError'
  }
}
