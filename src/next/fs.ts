// The file system functions that this package calls. `node:fs/promises`
// fits `TarFS`, and `node:fs` fits `TarFSSync`.

/** The subset of a `node:fs/promises` `FileHandle` that the code uses. */
export type TarFileHandle = {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>
  stat(): Promise<{ size: number }>
  close(): Promise<void>
}

/** The subset of `node:fs/promises` that the code uses. */
export type TarFS = {
  open(path: string, flags: string): Promise<TarFileHandle>
}

/** The subset of `node:fs` that the sync code uses. */
export type TarFSSync = {
  openSync(path: string, flags: string): number
  fstatSync(fd: number): { size: number }
  readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): number
  closeSync(fd: number): void
}
