// The async extraction does several entries at one time. Two entries
// must not work on the same path at one time: a link needs its
// target, and an entry can replace an object of a different type.

import { normalizeUnicode } from './normalize-unicode.js'
import { stripTrailingSlashes } from './strip-trailing-slashes.js'
import { join } from './path.js'

type Handler = () => void
type Queue = (Handler | Set<Handler>)[]
// One part of a path. `queue` has the tasks that wait for the path,
// in order. A function has the path for itself. A Set of functions
// shares the path as a parent directory. So a path uses memory for
// its own parts only, and not for each of its parent paths.
type Node = {
  queue: Queue
  name: string
  up?: Node
  kids?: Map<string, Node>
}
type Reservation = { paths: Set<Node>; dirs: Set<Node> }

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
  #root: Node = { queue: [], name: '' }
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

  #add(names: string[], fn: Handler) {
    const root = this.#root
    const paths = new Set<Node>()
    const dirs = new Set<Node>()
    for (const name of this.#win32 ?
      ['win32 parallelization disabled']
    : names) {
      const path =
        this.#win32 ? name : (
          stripTrailingSlashes(join(normalizeUnicode(name)))
        )
      let node = root
      for (const part of path.split('/')) {
        if (node !== root) dirs.add(node)
        const kids = (node.kids ??= new Map<string, Node>())
        let kid = kids.get(part)
        if (!kid)
          kids.set(part, (kid = { queue: [], name: part, up: node }))
        node = kid
      }
      paths.add(node)
    }
    // A path of the task is exclusive, so it also covers the use of
    // that path as a parent directory of another path.
    for (const p of paths) dirs.delete(p)
    this.#reservations.set(fn, { dirs, paths })
    for (const p of paths) p.queue.push(fn)
    for (const { queue } of dirs) {
      const last = queue[queue.length - 1]
      if (last instanceof Set) last.add(fn)
      else queue.push(new Set([fn]))
    }
    this.#run(fn)
  }

  // Start the task if it is first in line for each path, and in the
  // first set for each directory. A task that waits is never first in
  // line for each of them, so a task starts one time only.
  #run(fn: Handler) {
    const { paths, dirs } = this.#reservations.get(fn) as Reservation
    for (const p of paths) {
      if (p.queue[0] !== fn) return
    }
    for (const { queue } of dirs) {
      const first = queue[0]
      if (!(first instanceof Set) || !first.has(fn)) return
    }
    this.#running.add(fn)
    fn()
  }

  #clear(fn: Handler) {
    const { paths, dirs } = this.#reservations.get(fn) as Reservation
    const next = new Set<Handler>()
    for (const { queue } of paths) {
      // A running task is first in the queue of each of its paths.
      queue.shift()
      const after = queue[0]
      if (typeof after === 'function') next.add(after)
      else if (after) for (const f of after) next.add(f)
    }
    for (const { queue } of dirs) {
      // A running task is in the first set of each of its directories.
      const first = queue[0] as Set<Handler>
      if (first.size > 1) first.delete(fn)
      else {
        queue.shift()
        // Two sets in a row would be one set, so this is a function.
        if (queue.length) next.add(queue[0] as Handler)
      }
    }
    // Remove each node that no task uses. Each directory of the task
    // is above one of its paths.
    for (let node of paths) {
      while (node.up && !node.queue.length && !node.kids?.size) {
        node.up.kids?.delete(node.name)
        node = node.up
      }
    }
    this.#running.delete(fn)
    this.#reservations.delete(fn)
    for (const f of next) this.#run(f)
  }
}
