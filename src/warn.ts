/** Data that a warning or an error of this package carries. */
export type WarnData = {
  file?: string
  code?: string
  tarCode?: string
  recoverable?: boolean
  [k: string]: unknown
}

/** An error with the data of the warning that caused it. */
export type TarError = Error & WarnData

/** The options that `warn` reads. */
export type WarnOptions = {
  /** Throw each warning as an error. */
  strict?: boolean
  /** Called for each warning when `strict` is not set. */
  onwarn?: (code: string, message: string, data: WarnData) => unknown
  /** The archive file. Each warning has it as `data.file`. */
  file?: string
}

const fill = (
  opt: WarnOptions,
  code: string,
  message: string | Error,
  data: WarnData,
) => {
  if (opt.file) data.file = opt.file
  data.code =
    (message instanceof Error && (message as TarError).code) || code
  data.tarCode = code
  return data
}

/** Make the error for a problem that is not recoverable. */
export const tarError = (
  opt: WarnOptions,
  code: string,
  message: string | Error,
  data: WarnData = {},
): TarError =>
  Object.assign(
    message instanceof Error ? message : new Error(`${code}: ${message}`),
    fill(opt, code, message, data),
  )

/**
 * Report a problem. Call `opt.onwarn(code, message, data)`, or throw
 * the error if `opt.strict` is set or `data.recoverable` is false.
 */
export const warn = (
  opt: WarnOptions,
  code: string,
  message: string | Error,
  data: WarnData = {},
): void => {
  if (opt.strict || data.recoverable === false) {
    throw tarError(opt, code, message, data)
  }
  fill(opt, code, message, data)
  if (message instanceof Error) {
    data = Object.assign(message, data)
    message = message.message
  }
  opt.onwarn?.(code, message, data)
}
