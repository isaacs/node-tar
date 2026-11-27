import { CwdError } from './cwd-error.js'
import { SymlinkError } from './symlink-error.js'
import type { ExtractFS, ExtractFSSync } from './fs.js'
import { relative } from './path.js'

/** The options of `mkdir`. Each path has `/` separators. */
export type MkdirOptions = {
  /** The owner of each directory that is made, if it has `gid` also. */
  uid?: number
  gid?: number
  processUid?: number
  processGid?: number
  /** If the mode has a bit of this mask, `chmod` sets the mode. */
  umask: number
  /** Permit a symbolic link in the path. */
  preserve: boolean
  /** Remove an object in the path that is not a directory. */
  unlink: boolean
  /** The absolute path of the extraction directory. */
  cwd: string
  mode: number
}

type ErrorWithCode = Error & { code?: string }

// The parts of the mkdir options that do not need the file system.
const plan = (opt: MkdirOptions) => {
  const mode = opt.mode | 0o700
  const { uid, gid } = opt
  return {
    mode,
    // The umask removes bits when the system makes the directory.
    needChmod: (mode & opt.umask) !== 0,
    owner:
      (
        typeof uid === 'number' &&
        typeof gid === 'number' &&
        (uid !== opt.processUid || gid !== opt.processGid)
      ) ?
        { uid, gid }
      : undefined,
  }
}

const child = (dir: string, name: string) =>
  dir.endsWith('/') ? dir + name : dir + '/' + name

// The directories that a recursive mkdir made: `dir`, and its parents
// up to `first`, the one that was made first. On Windows, Node.js
// gives `first` with `\` separators, after the prefix `\\?\`. So
// `first` is the parent that it ends with. If it ends with none of
// them, only `dir` is known.
const chain = (first: string, dir: string) => {
  const end = first.replaceAll('\\', '/')
  const made = [dir]
  for (let i = dir.length; !end.endsWith(dir.slice(0, i)); ) {
    i = dir.lastIndexOf('/', i - 1)
    if (i <= 0) return [dir]
    made.push(dir.slice(0, i))
  }
  return made
}

/**
 * Make the directory `dir` and its parents, below `opt.cwd`.
 *
 * If `opt.preserve` is not set, a symbolic link in the path is an
 * error, so that no entry is extracted through a link. The
 * extraction directory itself is never made: it must be a directory,
 * or the error is a `CwdError`.
 */
export const mkdir = async (
  fs: ExtractFS,
  dir: string,
  opt: MkdirOptions,
): Promise<void> => {
  const { mode, needChmod, owner } = plan(opt)
  const { cwd } = opt
  let made: string[] = []
  if (dir === cwd) {
    let code: string | undefined = 'ENOTDIR'
    const ok = await fs.stat(dir).then(
      st => st.isDirectory(),
      (er: ErrorWithCode) => {
        code = er?.code || code
        return false
      },
    )
    if (!ok) throw new CwdError(dir, code)
  } else if (opt.preserve) {
    const first = await fs.mkdir(dir, { mode, recursive: true })
    if (first) made = chain(first, dir)
  } else {
    const parts = relative(cwd, dir).split('/')
    let part = cwd
    for (let i = 0; i < parts.length; i++) {
      part = child(part, parts[i] as string)
      try {
        await fs.mkdir(part, { mode })
      } catch (er) {
        const st = await fs.lstat(part)
        if (st.isDirectory()) continue
        if (!opt.unlink) {
          throw st.isSymbolicLink() ?
              new SymlinkError(
                part,
                part + '/' + parts.slice(i + 1).join('/'),
              )
            : er
        }
        await fs.unlink(part)
        await fs.mkdir(part, { mode })
      }
      made.push(part)
    }
  }
  if (owner) {
    for (const d of made) await fs.lchown(d, owner.uid, owner.gid)
  }
  if (needChmod) await fs.chmod(dir, mode)
}

/** The sync form of `mkdir`. */
export const mkdirSync = (
  fs: ExtractFSSync,
  dir: string,
  opt: MkdirOptions,
): void => {
  const { mode, needChmod, owner } = plan(opt)
  const { cwd } = opt
  let made: string[] = []
  if (dir === cwd) {
    let code: string | undefined = 'ENOTDIR'
    let ok = false
    try {
      ok = fs.statSync(dir).isDirectory()
    } catch (er) {
      code = (er as ErrorWithCode)?.code || code
    }
    if (!ok) throw new CwdError(dir, code)
  } else if (opt.preserve) {
    const first = fs.mkdirSync(dir, { mode, recursive: true })
    if (first) made = chain(first, dir)
  } else {
    const parts = relative(cwd, dir).split('/')
    let part = cwd
    for (let i = 0; i < parts.length; i++) {
      part = child(part, parts[i] as string)
      try {
        fs.mkdirSync(part, { mode })
      } catch (er) {
        const st = fs.lstatSync(part)
        if (st.isDirectory()) continue
        if (!opt.unlink) {
          throw st.isSymbolicLink() ?
              new SymlinkError(
                part,
                part + '/' + parts.slice(i + 1).join('/'),
              )
            : er
        }
        fs.unlinkSync(part)
        fs.mkdirSync(part, { mode })
      }
      made.push(part)
    }
  }
  if (owner) {
    for (const d of made) fs.lchownSync(d, owner.uid, owner.gid)
  }
  if (needChmod) fs.chmodSync(dir, mode)
}
