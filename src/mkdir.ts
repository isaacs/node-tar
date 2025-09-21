import { chownr, chownrSync } from 'chownr'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { CwdError } from './cwd-error.js'
import { normalizeWindowsPath } from './normalize-windows-path.js'
import { SymlinkError } from './symlink-error.js'

export type MkdirOptions = {
  uid?: number
  gid?: number
  processUid?: number
  processGid?: number
  umask?: number
  preserve: boolean
  unlink: boolean
  cwd: string
  mode: number
}

export type MkdirError =
  | NodeJS.ErrnoException
  | CwdError
  | SymlinkError

const checkCwd = (
  dir: string,
  cb: (er?: null | MkdirError) => any,
) => {
  fs.stat(dir, (er, st) => {
    if (er || !st.isDirectory()) {
      er = new CwdError(
        dir,
        (er as NodeJS.ErrnoException)?.code || 'ENOTDIR',
      )
    }
    cb(er)
  })
}

/**
 * Wrapper around fs/promises.mkdir for tar's needs.
 *
 * The main purpose is to avoid creating directories if we know that
 * they already exist (and track which ones exist for this purpose),
 * and prevent entries from being extracted into symlinked folders,
 * if `preservePaths` is not set.
 */
export const mkdir = (
  dir: string,
  opt: MkdirOptions,
  cb: (er?: null | MkdirError, made?: string) => void,
) => {
  dir = normalizeWindowsPath(dir)

  // if there's any overlap between mask and mode,
  // then we'll need an explicit chmod
  /* c8 ignore next */
  const umask = opt.umask ?? 0o22
  const mode = opt.mode | 0o0700
  const needChmod = (mode & umask) !== 0

  const uid = opt.uid
  const gid = opt.gid
  const doChown =
    typeof uid === 'number' &&
    typeof gid === 'number' &&
    (uid !== opt.processUid || gid !== opt.processGid)

  const preserve = opt.preserve
  const unlink = opt.unlink
  const cwd = normalizeWindowsPath(opt.cwd)

  const done = (er?: null | MkdirError, created?: string) => {
    if (er) {
      cb(er)
    } else {
      if (created && doChown) {
        chownr(created, uid, gid, er =>
          done(er as NodeJS.ErrnoException),
        )
      } else if (needChmod) {
        fs.chmod(dir, mode, cb)
      } else {
        cb()
      }
    }
  }

  if (dir === cwd) {
    return checkCwd(dir, done)
  }

  if (preserve) {
    return fsp.mkdir(dir, { mode, recursive: true }).then(
      made => done(null, made ?? undefined), // oh, ts
      done,
    )
  }

  const sub = normalizeWindowsPath(path.relative(cwd, dir))
  const parts = sub.split('/')
  mkdir_(cwd, parts, mode, unlink, cwd, undefined, done)
}

const mkdir_ = (
  base: string,
  parts: string[],
  mode: number,
  unlink: boolean,
  cwd: string,
  created: string | undefined,
  cb: (er?: null | MkdirError, made?: string) => void,
): void => {
  if (!parts.length) {
    return cb(null, created)
  }
  const p = parts.shift()
  const part = normalizeWindowsPath(path.resolve(base + '/' + p))
  fs.mkdir(
    part,
    mode,
    onmkdir(part, parts, mode, unlink, cwd, created, cb),
  )
}

const onmkdir =
  (
    part: string,
    parts: string[],
    mode: number,
    unlink: boolean,
    cwd: string,
    created: string | undefined,
    cb: (er?: null | MkdirError, made?: string) => void,
  ) =>
  (er?: null | NodeJS.ErrnoException) => {
    if (er) {
      fs.lstat(part, (statEr, st) => {
        if (statEr) {
          statEr.path =
            statEr.path && normalizeWindowsPath(statEr.path)
          cb(statEr)
        } else if (st.isDirectory()) {
          mkdir_(part, parts, mode, unlink, cwd, created, cb)
        } else if (unlink) {
          fs.unlink(part, er => {
            if (er) {
              return cb(er)
            }
            fs.mkdir(
              part,
              mode,
              onmkdir(
                part,
                parts,
                mode,
                unlink,
                cwd,
                created,
                cb,
              ),
            )
          })
        } else if (st.isSymbolicLink()) {
          return cb(
            new SymlinkError(part, part + '/' + parts.join('/')),
          )
        } else {
          cb(er)
        }
      })
    } else {
      created = created || part
      mkdir_(part, parts, mode, unlink, cwd, created, cb)
    }
  }

const checkCwdSync = (dir: string) => {
  let ok = false
  let code: string | undefined = undefined
  try {
    ok = fs.statSync(dir).isDirectory()
  } catch (er) {
    code = (er as NodeJS.ErrnoException)?.code
  } finally {
    if (!ok) {
      throw new CwdError(dir, code ?? 'ENOTDIR')
    }
  }
}

export const mkdirSync = (dir: string, opt: MkdirOptions) => {
  dir = normalizeWindowsPath(dir)
  // if there's any overlap between mask and mode,
  // then we'll need an explicit chmod
  /* c8 ignore next */
  const umask = opt.umask ?? 0o22
  const mode = opt.mode | 0o700
  const needChmod = (mode & umask) !== 0

  const uid = opt.uid
  const gid = opt.gid
  const doChown =
    typeof uid === 'number' &&
    typeof gid === 'number' &&
    (uid !== opt.processUid || gid !== opt.processGid)

  const preserve = opt.preserve
  const unlink = opt.unlink
  const cwd = normalizeWindowsPath(opt.cwd)

  const done = (created?: string | undefined) => {
    if (created && doChown) {
      chownrSync(created, uid, gid)
    }
    if (needChmod) {
      fs.chmodSync(dir, mode)
    }
  }

  if (dir === cwd) {
    checkCwdSync(cwd)
    return done()
  }

  if (preserve) {
    return done(fs.mkdirSync(dir, { mode, recursive: true }) ?? undefined)
  }

  const sub = normalizeWindowsPath(path.relative(cwd, dir))
  const parts = sub.split('/')
  let created: string | undefined = undefined
  for (
    let p = parts.shift(), part = cwd;
    p && (part += '/' + p);
    p = parts.shift()
  ) {
    part = normalizeWindowsPath(path.resolve(part))

    try {
      fs.mkdirSync(part, mode)
      created = created || part
    } catch (er) {
      const st = fs.lstatSync(part)
      if (st.isDirectory()) {
        continue
      } else if (unlink) {
        fs.unlinkSync(part)
        fs.mkdirSync(part, mode)
        created = created || part
        continue
      } else if (st.isSymbolicLink()) {
        return new SymlinkError(part, part + '/' + parts.join('/'))
      }
    }
  }

  return done(created)
}
