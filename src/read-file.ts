import type { TarFS, TarFSSync } from './fs.js'

const MAX_READ = 16 * 1024 * 1024

/**
 * Read a file in chunks of `maxReadSize` bytes at most (default
 * 16 MiB). Each chunk is a new array.
 */
export async function* readFile(
  fs: TarFS,
  file: string,
  maxReadSize: number = MAX_READ,
): AsyncGenerator<Uint8Array, void, void> {
  const handle = await fs.open(file, 'r')
  try {
    const { size } = await handle.stat()
    for (let pos = 0; pos < size; ) {
      const buf = new Uint8Array(Math.min(maxReadSize, size - pos))
      const { bytesRead } = await handle.read(buf, 0, buf.length, pos)
      if (!bytesRead) break
      pos += bytesRead
      yield bytesRead < buf.length ? buf.subarray(0, bytesRead) : buf
    }
  } finally {
    await handle.close().catch(() => {})
  }
}

/** The sync form of `readFile`. */
export function* readFileSync(
  fs: TarFSSync,
  file: string,
  maxReadSize: number = MAX_READ,
): Generator<Uint8Array, void, void> {
  const fd = fs.openSync(file, 'r')
  try {
    const { size } = fs.fstatSync(fd)
    for (let pos = 0; pos < size; ) {
      const buf = new Uint8Array(Math.min(maxReadSize, size - pos))
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, pos)
      if (!bytesRead) break
      pos += bytesRead
      yield bytesRead < buf.length ? buf.subarray(0, bytesRead) : buf
    }
  } finally {
    try {
      fs.closeSync(fd)
    } catch {}
  }
}
