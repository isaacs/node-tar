import type { TarFS, TarFSSync } from './fs.js'

const MAX_READ = 16 * 1024 * 1024
// The size of the first read, and of the read after a skip.
const FIRST_READ = 64 * 1024
// A skip of fewer bytes than this is slower than a read of them.
const MIN_SKIP = 1024 * 1024

/**
 * The key of the method of a chunk source that skips input. A
 * `TarReader` calls it with the number of bytes of a body that are
 * after the chunks given so far, when no consumer reads that body.
 * If it returns true, the next chunk starts after those bytes.
 */
export const SKIP: unique symbol = Symbol('skip')

/** A chunk source that can skip input. */
export type Skip = { [SKIP](n: number): boolean }

// The place and the size of the next read of a file.
class Plan {
  pos: number = 0
  /** The size of the file. 0 before the file is open. */
  size: number = 0
  #max: number
  #want: number = FIRST_READ

  constructor(max: number) {
    this.#max = max
  }

  // The number of bytes to read at `pos`. 0 at the end of the file.
  // Each read is two times the size of the read before it, so that
  // an archive of small entries is read in few reads.
  next(): number {
    const n = Math.min(this.#want, this.#max, this.size - this.pos)
    this.#want *= 2
    return n
  }

  // Skip only inside the file: the parser must see where a truncated
  // file ends. The read after a skip is small, because a header
  // comes next, and the body after it can be skipped also.
  skip(n: number): boolean {
    if (n < MIN_SKIP || this.pos + n > this.size) return false
    this.pos += n
    this.#want = FIRST_READ
    return true
  }
}

async function* chunks(
  fs: TarFS,
  file: string,
  plan: Plan,
): AsyncGenerator<Uint8Array, void, void> {
  const handle = await fs.open(file, 'r')
  try {
    plan.size = (await handle.stat()).size
    for (let n; (n = plan.next()); ) {
      const buf = new Uint8Array(n)
      const { bytesRead } = await handle.read(buf, 0, n, plan.pos)
      if (!bytesRead) break
      plan.pos += bytesRead
      yield bytesRead < n ? buf.subarray(0, bytesRead) : buf
    }
  } finally {
    await handle.close().catch(() => {})
  }
}

function* chunksSync(
  fs: TarFSSync,
  file: string,
  plan: Plan,
): Generator<Uint8Array, void, void> {
  const fd = fs.openSync(file, 'r')
  try {
    plan.size = fs.fstatSync(fd).size
    for (let n; (n = plan.next()); ) {
      const buf = new Uint8Array(n)
      const bytesRead = fs.readSync(fd, buf, 0, n, plan.pos)
      if (!bytesRead) break
      plan.pos += bytesRead
      yield bytesRead < n ? buf.subarray(0, bytesRead) : buf
    }
  } finally {
    try {
      fs.closeSync(fd)
    } catch {}
  }
}

/**
 * Read a file in chunks of `maxReadSize` bytes at most (default
 * 16 MiB). Each chunk is a new array. The first chunk is small, and
 * the chunks grow. A reader can skip a large part of the file.
 */
export const readFile = (
  fs: TarFS,
  file: string,
  maxReadSize: number = MAX_READ,
): AsyncGenerator<Uint8Array, void, void> & Skip => {
  const plan = new Plan(maxReadSize)
  return Object.assign(chunks(fs, file, plan), {
    [SKIP]: (n: number) => plan.skip(n),
  })
}

/** The sync form of `readFile`. */
export const readFileSync = (
  fs: TarFSSync,
  file: string,
  maxReadSize: number = MAX_READ,
): Generator<Uint8Array, void, void> & Skip => {
  const plan = new Plan(maxReadSize)
  return Object.assign(chunksSync(fs, file, plan), {
    [SKIP]: (n: number) => plan.skip(n),
  })
}
