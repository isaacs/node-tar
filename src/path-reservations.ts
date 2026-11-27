// The async extraction does several entries at one time. Two entries
// must not work on the same path at one time: a link needs its
// target, and an entry can replace an object of a different type.

import { normalizeUnicode } from './normalize-unicode.js'
import { stripTrailingSlashes } from './strip-trailing-slashes.js'
import { join } from './path.js'

type Handler = () => void
type Queue = (Handler | Set<Handler>)[]
type Reservation = { paths: string[]; dirs: Set<string> }

// The parent directories of a normalized path.
// '/a/b/c' gives ['/', '/a', '/a/b'].
const getDirs = (path: string) => {
  const dirs: string[] = []
  for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) {
    dirs.push(path.slice(0, i) || '/')
  }
  return dirs
}

/**
 * Gives each task the exclusive use of its paths, and the shared use
 * of their parent directories. A task starts when each task before
 * it that uses one of its paths, or a directory above or below one,
 * is done.
 *
 * Paths that differ only in case or in Unicode form are the same
 * path, because they can be the same file on disk.
 */
export class PathReservations {
  // For each path: the tasks that wait for it, in order. A function
  // has the path for itself. A Set of functions shares the path as a
  // parent directory.
  #queues = new Map<string, Queue>()
  #reservations = new Map<Handler, Reservation>()
  #running = new Set<Handler>()
  #win32: boolean

  /** @param win32 run one task at a time */
  constructor(win32: boolean = false) {
    this.#win32 = win32
  }

  /**
   * Call `fn` when it is first in line for each of its paths. The
   * paths are free again when the promise of `fn` settles. Returns a
   * promise with the result of `fn`.
   */
  reserve(paths: string[], fn: () => Promise<void>): Promise<void> {
    return new Promise<void>((res, rej) => {
      const handler: Handler = () => {
        fn().then(
          () => {
            this.#clear(handler)
            res()
          },
          er => {
            this.#clear(handler)
            rej(er)
          },
        )
      }
      this.#add(paths, handler)
    })
  }

  #add(paths: string[], fn: Handler) {
    paths =
      this.#win32 ?
        ['win32 parallelization disabled']
      : [
          ...new Set(
            paths.map(p =>
              stripTrailingSlashes(join(normalizeUnicode(p))),
            ),
          ),
        ]
    const dirs = new Set<string>(paths.flatMap(getDirs))
    // A path of the task is exclusive, so it also covers the use of
    // that path as a parent directory of another path.
    for (const p of paths) dirs.delete(p)
    this.#reservations.set(fn, { dirs, paths })
    for (const p of paths) {
      const q = this.#queues.get(p)
      if (!q) this.#queues.set(p, [fn])
      else q.push(fn)
    }
    for (const dir of dirs) {
      const q = this.#queues.get(dir)
      const last = q?.[q.length - 1]
      if (!q) this.#queues.set(dir, [new Set([fn])])
      else if (last instanceof Set) last.add(fn)
      else q.push(new Set([fn]))
    }
    this.#run(fn)
  }

  // Start the task if it is first in line for each path, and in the
  // first set for each directory. A task that waits is never first in
  // line for each of them, so a task starts one time only.
  #run(fn: Handler) {
    const { paths, dirs } = this.#reservations.get(fn) as Reservation
    for (const p of paths) {
      if (this.#queues.get(p)?.[0] !== fn) return
    }
    for (const dir of dirs) {
      const first = this.#queues.get(dir)?.[0]
      if (!(first instanceof Set) || !first.has(fn)) return
    }
    this.#running.add(fn)
    fn()
  }

  #clear(fn: Handler) {
    const { paths, dirs } = this.#reservations.get(fn) as Reservation
    const next = new Set<Handler>()
    for (const path of paths) {
      // A running task is first in the queue of each of its paths.
      const q = this.#queues.get(path) as Queue
      const after = q[1]
      if (!after) {
        this.#queues.delete(path)
        continue
      }
      q.shift()
      if (typeof after === 'function') next.add(after)
      else for (const f of after) next.add(f)
    }
    for (const dir of dirs) {
      // A running task is in the first set of each of its directories.
      const q = this.#queues.get(dir) as Queue
      const first = q[0] as Set<Handler>
      if (first.size > 1) first.delete(fn)
      else if (q.length === 1) this.#queues.delete(dir)
      else {
        q.shift()
        // Two sets in a row would be one set, so this is a function.
        next.add(q[0] as Handler)
      }
    }
    this.#running.delete(fn)
    this.#reservations.delete(fn)
    for (const f of next) this.#run(f)
  }
}
