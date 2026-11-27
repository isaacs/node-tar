/** The flag values of `fs.constants` that the extraction uses. */
export type OpenConstants = {
  O_CREAT: number
  O_TRUNC: number
  O_WRONLY: number
  O_NOFOLLOW?: number
  UV_FS_O_FILEMAP?: number
}

// Windows writes a small file faster through a file mapping.
const FMAP_LIMIT = 512 * 1024

/**
 * Make the function that gives the `open` flag for a new file of a
 * given size.
 *
 * With `O_NOFOLLOW`, `open` fails if the path is a symbolic link.
 * Windows does not have it. If `constants` is not set, the flag is
 * `'w'`.
 */
export const writeFlags = (
  constants: OpenConstants | undefined,
  win32: boolean,
): ((size: number) => string | number) => {
  if (!constants) return () => 'w'
  const { O_CREAT, O_TRUNC, O_WRONLY, O_NOFOLLOW, UV_FS_O_FILEMAP } =
    constants
  const write = O_TRUNC | O_CREAT | O_WRONLY
  if (!win32) {
    const flag = typeof O_NOFOLLOW === 'number' ? O_NOFOLLOW | write : 'w'
    return () => flag
  }
  if (!UV_FS_O_FILEMAP) return () => 'w'
  const fmap = UV_FS_O_FILEMAP | write
  return size => (size < FMAP_LIMIT ? fmap : 'w')
}
