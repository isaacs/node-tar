/** has a warn method */
export type Warner = {
  warn(code: string, message: string | Error, data: any): void
  file?: string
  cwd?: string
  strict?: boolean

  emit(
    event: 'warn',
    code: string,
    message: string,
    data?: WarnData,
  ): void
  emit(event: 'error', error: TarError): void
}

export type WarnData = {
  file?: string
  cwd?: string
  code?: string
  tarCode?: string
  recoverable?: boolean
  [k: string]: any
}

export type TarError = Error & WarnData

export const warnMethod = (
  self: Warner,
  code: string,
  message: string | Error,
  data: WarnData = {},
) => {
  if (self.file) {
    data.file = self.file
  }
  if (self.cwd) {
    data.cwd = self.cwd
  }
  data.code =
    (message instanceof Error &&
      (message as NodeJS.ErrnoException).code) ||
    code
  data.tarCode = code
  if (!self.strict && data.recoverable !== false) {
    if (message instanceof Error) {
      data = Object.assign(message, data)
      message = message.message
    }
    self.emit('warn', code, message, data)
  } else if (message instanceof Error) {
    self.emit('error', Object.assign(message, data))
  } else {
    self.emit(
      'error',
      Object.assign(new Error(`${code}: ${message}`), data),
    )
  }
}
