// The path rules of Windows that the extraction needs. Each function
// takes a path with `/` or `\` separators.

import { dirname, resolve } from './path.js'

const isSep = (code: number) => code === 47 || code === 92

const isDrive = (code: number) =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122)

/**
 * The root of a path: a slash, a drive such as `c:` or `c:/`, or a
 * UNC root such as `//host/share/`. The same result as the `root` of
 * `path.win32.parse`.
 */
export const win32Root = (path: string): string => {
  const len = path.length
  let end = 0
  if (isSep(path.charCodeAt(0))) {
    end = 1
    if (isSep(path.charCodeAt(1))) {
      // `//host/share` and what follows it
      let j = 2
      let last = j
      while (j < len && !isSep(path.charCodeAt(j))) j++
      if (j < len && j !== last) {
        last = j
        while (j < len && isSep(path.charCodeAt(j))) j++
        if (j < len && j !== last) {
          last = j
          while (j < len && !isSep(path.charCodeAt(j))) j++
          if (j === len) end = j
          else if (j !== last) end = j + 1
        }
      }
    }
  } else if (isDrive(path.charCodeAt(0)) && path.charCodeAt(1) === 58) {
    end = isSep(path.charCodeAt(2)) ? 3 : 2
  }
  return path.slice(0, end)
}

/** True for a path with a root that is not relative to a drive. */
export const win32IsAbsolute = (path: string): boolean =>
  isSep(path.charCodeAt(0)) || win32Root(path).length === 3

/**
 * Resolve `path` from the absolute path `base`. Both have `/`
 * separators.
 */
export const win32Resolve = (base: string, path: string): string => {
  const full = win32IsAbsolute(path) ? path : base + '/' + path
  const root = win32Root(full)
  return root + resolve('/', full.slice(root.length)).slice(1)
}

/** The parent directory of an absolute path with `/` separators. */
export const win32Dirname = (path: string): string => {
  const root = win32Root(path)
  const dir = dirname(path.slice(root.length))
  return dir === '.' ? root : root + dir
}
