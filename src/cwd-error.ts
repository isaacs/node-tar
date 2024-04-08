export class CwdError extends Error {
  path: string
  code: string
  syscall: 'chdir' = 'chdir'

  constructor(path: string, code: string) {
    super(code + ": Cannot cd into '" + path + "'")
    this.path = path
    this.code = code
  }

  get name() {
    return 'CwdError'
  }
}
