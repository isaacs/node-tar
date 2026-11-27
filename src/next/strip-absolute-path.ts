import { win32Root } from './win32-path.js'

/**
 * Remove each root from the start of a path. Returns the roots and
 * the rest of the path.
 *
 * A POSIX absolute path is also absolute on Windows, so the rules of
 * Windows are used on each platform. A path that is relative to a
 * drive loses the drive: `c:../foo` gives `['c:', '../foo']`.
 */
export const stripAbsolutePath = (path: string): [string, string] => {
  let roots = ''
  for (let root; (root = win32Root(path)); ) {
    // Windows reads `//x/y/` as the root of `//x/y/z`. Remove only the
    // first slash, but remove all of `//?/c:/`.
    if (path.charAt(0) === '/' && path.slice(0, 4) !== '//?/') root = '/'
    path = path.slice(root.length)
    roots += root
  }
  return [roots, path]
}
