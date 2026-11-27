# tar

Tar for JavaScript.

This package reads and writes tar archives. It makes archives from
files or from data in memory. It extracts archives to a file system,
or gives you the entries one at a time. It reads and writes gzip, and
in a server-side runtime also brotli and zstd.

The package has two entry points:

- `tar` is for server-side runtimes: Node.js, and each other runtime
  that has the `node:` modules, such as Bun, Deno, and Cloudflare. It
  uses `node:fs` and `node:zlib`, and it has sync commands. Most users
  want this entry point.
- `tar/core` is for browsers and each other runtime. It uses no
  `node:` module. It runs in a browser, in a worker, and in each
  runtime that has web streams. It needs the `fs` option for work on
  files.

The package has no runtime dependencies. The API uses promises, web
streams, and `Uint8Array`.

## Install

```sh
npm install tar
```

`tar` needs Node.js 22 or later, or another server-side runtime that
has the `node:` modules. `tar/core` also runs in a browser.

The package has ES module and CommonJS builds. You can use `import` or
`require()`.

## Quick start

These examples use `tar`, the server-side entry point. A command has two arguments: an options
object, and for most commands a list of files.

### Create an archive

```js
import { create } from 'tar'

// A gzip archive of a directory and a file.
await create({ file: 'demo.tgz', gzip: true }, ['src', 'package.json'])
```

With no `file` option, `create()` returns a `ReadableStream` of the
bytes of the archive.

```js
import { createWriteStream } from 'node:fs'
import { Writable } from 'node:stream'
import { create } from 'tar'

const stream = create({ gzip: true }, ['src', 'package.json'])
await stream.pipeTo(Writable.toWeb(createWriteStream('demo.tgz')))
```

### Extract an archive

The directory to extract into must exist. The default is the current
working directory.

```js
import { mkdir } from 'node:fs/promises'
import { extract } from 'tar'

await mkdir('out', { recursive: true })
await extract({ file: 'archive.tgz', cwd: 'out' })

// Only some entries, with the first part of each path removed.
await extract({ file: 'archive.tgz', cwd: 'out', strip: 1 }, ['src/lib'])
```

The `input` option gives the archive as data. It can be a
`Uint8Array`, an `ArrayBuffer`, a `Blob`, a `ReadableStream`, or an
iterable of `Uint8Array` chunks.

```js
import { mkdir } from 'node:fs/promises'
import { extract } from 'tar'

const res = await fetch('https://example.com/archive.tgz')
await mkdir('out', { recursive: true })
await extract({ input: res.body, cwd: 'out' })
```

### List the entries

```js
import { list } from 'tar'

await list({
  file: 'archive.tgz',
  onEntry: entry => console.log(entry.type, entry.path, entry.size),
})
```

To read the content of the entries, use `entries()`. It is an async
iterator.

```js
import { readFile } from 'node:fs/promises'
import { entries } from 'tar'

for await (const entry of entries(await readFile('archive.tgz'))) {
  if (entry.path === 'package.json') {
    console.log(JSON.parse(await entry.text()))
  }
}
```

### Add files to an archive

`replace()` adds entries to the end of an archive that is not
compressed. `update()` does the same, but it adds a file only if it
is newer than the entry of the same path in the archive.

```js
import { replace, update } from 'tar'

await replace({ file: 'archive.tar' }, ['notes.txt'])
await update({ file: 'archive.tar' }, ['src', 'package.json'])
```

### Sync commands

Each command of `tar` has a sync form. A sync command returns when
the work is done. `tar/core` has no sync commands.

```js
import { mkdirSync } from 'node:fs'
import {
  createSync,
  extractSync,
  listSync,
  replaceSync,
  updateSync,
} from 'tar'

createSync({ file: 'demo.tar' }, ['src'])
replaceSync({ file: 'demo.tar' }, ['package.json'])
updateSync({ file: 'demo.tar' }, ['README.md'])
listSync({
  file: 'demo.tar',
  onEntry: entry => console.log(entry.path),
})
mkdirSync('out', { recursive: true })
extractSync({ file: 'demo.tar', cwd: 'out' })
```

With no `file` option, `createSync()` returns an iterator of
`Uint8Array` chunks.

## Entry points

| Import                    | Use                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tar`                     | Server-side runtimes: Node.js, and each other runtime that has the `node:` modules (Bun, Deno, Cloudflare). All of the core, the defaults below, the sync commands, and the `node:zlib` codecs. |
| `tar/core`                | Browsers, and each other runtime. The core: no `node:` module, no `process`, no `Buffer`. The async commands and the classes. It needs the `fs` option for work on files.                       |
| `tar/raw`, `tar/core/raw` | The same two entry points as separate modules that are not minified.                                                                                                                            |

`tar` and `tar/core` are each one minified file.

### The defaults of `tar`

Each command of `tar` calls the command of the core with these
defaults:

| Option         | Default in `tar`                                                 |
| -------------- | ---------------------------------------------------------------- |
| `fs`           | `node:fs/promises`. `node:fs` for a sync command.                |
| `cwd`          | `process.cwd()`. A relative `cwd` is resolved from it.           |
| `platform`     | `'win32'` if `process.platform` is `'win32'`. If not, `'posix'`. |
| `processUid`   | `process.getuid()`                                               |
| `processGid`   | `process.getgid()`                                               |
| `processUname` | `process.env.USER`                                               |
| `processUmask` | `process.umask()`, only when `chmod` is set                      |
| `codecs`       | Your codecs, then gzip, brotli, and zstd from `node:zlib`        |

`list()` and `entries()` write no file. They get only the `fs`,
`platform`, and `codecs` defaults.

### The core in a browser or another runtime

`tar/core` is the core. It does not know the file system, the working
directory, the platform, or the user of the process. You give them as
options.

The core needs these globals: `ReadableStream`, `TransformStream`,
`Blob`, `TextEncoder`, `TextDecoder`, and `crypto.getRandomValues`. It
needs `CompressionStream` and `DecompressionStream` for gzip.

A command of the core works with no `fs` option, if it does not touch
a file:

- `entries(input)` and `list({ input })` read archive data.
- `create()` with no `file` option, and with entries from memory,
  returns a stream.

This example reads an archive from a `fetch()` response. It stops the
download when it has the entry.

```js
import { entries } from 'tar/core'

const res = await fetch('https://example.com/archive.tgz')
for await (const entry of entries(res.body)) {
  if (entry.path === 'package.json') {
    console.log(JSON.parse(await entry.text()))
    break
  }
}
```

This example makes a gzip archive in memory, and reads it from a
`Blob`. A `File` from a file input is also a `Blob`.

```js
import { create, entries, WriteEntry } from 'tar/core'

const stream = create({ gzip: true }, [
  new WriteEntry({ path: 'hello.txt' }, 'hello\n'),
  new WriteEntry({ path: 'data.bin' }, new Uint8Array([1, 2, 3])),
])
const blob = await new Response(stream).blob()

for await (const entry of entries(blob)) {
  console.log(entry.path, entry.size)
}
```

#### The `input` option

`list()` and `extract()` read the archive from `input`, or from the
path `file` through `fs`. `entries()` takes the input as its first
argument. The input can be:

- a `Uint8Array` or an `ArrayBuffer`
- a `Blob`
- a `ReadableStream<Uint8Array>`
- an async iterable or an iterable of `Uint8Array` chunks

A sync command takes a `Uint8Array`, an `ArrayBuffer`, or an iterable
of `Uint8Array` chunks.

The readers do not copy the input. Do not change a chunk after you
give it.

When `input` is set, `file` is only the name of the archive. Warnings
have it, and the readers use it to find a format by the file name.

#### The `fs` option

The `fs` option is an object with file system functions. Each function
has the signature of the function of the same name in
`node:fs/promises`. For a sync command, it is the function of
`node:fs`. A command calls only the functions in its type.

| Type        | Commands                                                        | Functions                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TarFS`     | `list()` and `extract()` with `file`, and an `@archive` operand | `open(path, 'r')`. The handle has `read`, `stat`, and `close`.                                                                                                                                                      |
| `ExtractFS` | `extract()`                                                     | `open`, `stat`, `lstat`, `mkdir`, `chmod`, `chown`, `lchown`, `utimes`, `lutimes`, `rmdir`, `unlink`, `rename`, `link`, `symlink`. The handle has `write`, `utimes`, `chown`, and `close`. `constants` is optional. |
| `CreateFS`  | `create()`                                                      | `open`, `lstat`, `stat`, `readdir`, `readlink`. The handle has `read`, `write`, `stat`, and `close`. `lstat`, `stat`, and the `stat` of the handle can get the option `{ bigint: true }`.                           |
| `ReplaceFS` | `replace()`, `update()`                                         | The same as `CreateFS`. `open` gets the flags `'r+'`, `'w+'`, and `'r'`.                                                                                                                                            |

The sync types are `TarFSSync`, `ExtractFSSync`, `CreateFSSync`, and
`ReplaceFSSync`. They have the functions of `node:fs` that work on a
file descriptor: `openSync`, `fstatSync`, `readSync`, `writeSync`,
`futimesSync`, `fchownSync`, `closeSync`, and the sync forms of the
path functions above.

Notes for an `ExtractFS`:

- `mkdir` must fail if the path exists. `lstat` and `stat` must fail
  if the path does not exist.
- If `fs.constants` has `O_CREAT`, `O_TRUNC`, `O_WRONLY`, and
  `O_NOFOLLOW`, then `open` gets a number as its flag. With
  `O_NOFOLLOW`, `open` does not follow a symbolic link at the path.
  Without `constants`, the flag is `'w'`.
- `chown` and `lchown` are called only when the options set an owner.
  `chmod` is called only with the `chmod` option. `rename` is called
  only with `platform: 'win32'`.

Notes for a `CreateFS`:

- `create()` knows a file by the `dev` and `ino` numbers of its
  stat: to find the hard links of one file, and to find a path that
  is a different object after it is opened. Node.js gives the two
  values as numbers. On Windows, a value can be too large for a
  number, and then two files can have the same number.
- When `dev` or `ino` is not a safe integer, `create()` calls `lstat`
  (`stat` with `follow`) one more time with the option
  `{ bigint: true }`, and reads the `dev` and `ino` of the result,
  which can be `bigint` values. It then also gives the option to the
  `stat` of the file handle (`fstatSync`), and to the `lstat` after
  `readdir`. `node:fs` gives exact values with this option.
- Your function can ignore the option and return the stat with
  numbers. `create()` then compares the numbers. Two files with the
  same `dev` and `ino` numbers, and more than one link, are then one
  file and a hard link to it.
- A file whose numbers are safe integers gets no call with the option.

This example extracts an archive into a `Map`.

```js
import { create, extract, WriteEntry } from 'tar/core'

// path -> { type, mode, mtime, chunks, target }
const tree = new Map([
  ['/out', { type: 'dir', mode: 0o755, mtime: new Date() }],
])
const fail = (code, path) =>
  Object.assign(new Error(`${code}: ${path}`), { code })
const get = path => {
  const node = tree.get(path)
  if (!node) throw fail('ENOENT', path)
  return node
}
const stats = node => ({
  isDirectory: () => node.type === 'dir',
  isFile: () => node.type === 'file',
  isSymbolicLink: () => node.type === 'symlink',
  nlink: 1,
  mode: node.mode,
  mtime: node.mtime,
})
const setTime = async (path, atime, mtime) => {
  get(path).mtime = mtime
}

const memfs = {
  stat: async path => stats(get(path)),
  lstat: async path => stats(get(path)),
  mkdir: async (path, { mode }) => {
    if (tree.has(path)) throw fail('EEXIST', path)
    tree.set(path, { type: 'dir', mode, mtime: new Date() })
    return undefined
  },
  open: async (path, flags, mode) => {
    const file = { type: 'file', mode, mtime: new Date(), chunks: [] }
    tree.set(path, file)
    return {
      // `data` is a view into the archive data. Keep a copy.
      write: async data => file.chunks.push(data.slice()),
      utimes: async (atime, mtime) => {
        file.mtime = mtime
      },
      chown: async () => {},
      close: async () => {},
    }
  },
  symlink: async (target, path) => {
    tree.set(path, { type: 'symlink', mode: 0o777, target })
  },
  link: async (target, path) => {
    tree.set(path, get(target))
  },
  unlink: async path => {
    tree.delete(path)
  },
  rmdir: async path => {
    tree.delete(path)
  },
  rename: async (from, to) => {
    tree.set(to, get(from))
    tree.delete(from)
  },
  chmod: async (path, mode) => {
    get(path).mode = mode
  },
  chown: async () => {},
  lchown: async () => {},
  utimes: setTime,
  lutimes: setTime,
}

const archive = create({}, [
  new WriteEntry({ path: 'docs/', type: 'Directory', mode: 0o755 }),
  new WriteEntry({ path: 'docs/hello.txt', mode: 0o644 }, 'hello\n'),
  new WriteEntry({ path: 'docs/deep/more.txt' }, 'more\n'),
])

await extract({ input: archive, fs: memfs, cwd: '/out' })

for (const [path, node] of tree) console.log(node.type, path)
console.log(await new Blob(tree.get('/out/docs/hello.txt').chunks).text())
```

#### Electron and `asar` files

In Electron, the `fs` module is changed: a file with a name that ends
in `.asar` is a directory. With that module, `extract()` does not
write an `app.asar` entry as a file, and `create()` reads the paths
in the `asar` file and not the file. Electron has the module
`original-fs`, which is `node:fs` with no change. Give it as the `fs`
option.

An async command needs the functions that return promises:
`originalFs.promises`. A sync command needs `originalFs`.

This example is for the main process of Electron. It is not tested,
because the tests of this package do not run in Electron.

```javascript
import originalFs from 'original-fs'
import { create, extract, extractSync } from 'tar'

await create({ file: 'app.tgz', gzip: true, fs: originalFs.promises }, [
  'MyApp.app',
])
await extract({ file: 'app.tgz', cwd: 'out', fs: originalFs.promises })
extractSync({ file: 'app.tgz', cwd: 'out', fs: originalFs })
```

#### The process options

- `cwd` The directory that `extract()` writes into, and the directory
  that the paths of `create()` are relative to. In `tar/core` it must
  be an absolute path, by the rules of `platform`. A path that is not
  absolute is a `TypeError`. `extract()` needs it. `create()` needs it
  only to add a path.
- `platform` `'posix'` (default) or `'win32'`. With `'win32'`: each
  `\` in a path is a separator, and the path rules of Windows apply.
  `extract()` changes the characters `<|>?:` in a name to private-use
  characters, renames a file before it removes it, and extracts one
  entry at a time. `create()` changes those private-use characters
  back.
- `processUid`, `processGid` The user ID and the group ID of the
  process. `extract()` uses them to know if it must set an owner. If
  `processUid` is 0, the default of `preserveOwner` is true.
- `processUname` `create()` writes it as the `uname` of each file that
  `processUid` owns.
- `processUmask` The umask of the process. `extract()` uses it only
  with `chmod`. Default `0o22`.

## Entries

### `ReadEntry`

`entries()`, `onEntry`, `filter`, and `transform` give you a
`ReadEntry`. It has the shape of a `Response`: the metadata is in the
fields, and the content is the body.

| Field                          | Value                                                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`                         | The path in the archive.                                                                                                                                               |
| `type`                         | `'File'`, `'Directory'`, `'SymbolicLink'`, `'Link'` (a hard link), `'CharacterDevice'`, `'BlockDevice'`, `'FIFO'`, `'OldFile'`, `'ContiguousFile'`, or `'GNUDumpDir'`. |
| `size`                         | The number of bytes in the body.                                                                                                                                       |
| `mode`                         | The permission bits.                                                                                                                                                   |
| `mtime`, `atime`, `ctime`      | `Date` objects.                                                                                                                                                        |
| `uid`, `gid`, `uname`, `gname` | The owner.                                                                                                                                                             |
| `linkpath`                     | The target of a link.                                                                                                                                                  |
| `devmaj`, `devmin`             | The device numbers.                                                                                                                                                    |
| `dev`, `ino`, `nlink`          | Set only if a PAX header has them.                                                                                                                                     |
| `header`                       | The `Header` object of the entry.                                                                                                                                      |
| `extended`, `globalExtended`   | The PAX headers that apply to the entry.                                                                                                                               |
| `absolute`                     | The absolute path. `extract()` sets it.                                                                                                                                |
| `bodyUsed`                     | True when the body started to be read.                                                                                                                                 |

A field is `undefined` if the archive does not have it. The values of
PAX headers and GNU long name headers are applied.

Read the body with one of these:

- `entry.body` A `ReadableStream<Uint8Array>`.
- `await entry.bytes()` A new `Uint8Array`.
- `await entry.arrayBuffer()` A new `ArrayBuffer`.
- `await entry.text()` A string, decoded as UTF-8. As with `Response.text()`, a byte order mark at the start is not in the string.
- `await entry.blob()` A new `Blob`.

Rules for the body:

- You can read the body one time, in one way. A second read throws a
  `TypeError`.
- Read the body before you ask for the next entry. When the reader
  moves to the next entry, it skips the rest of the body. After that,
  a read throws a `TypeError`.
- You do not have to read the body.
- A chunk of `entry.body` is a view into the input. It is not a copy.

The readers get input only when you ask for an entry or for more of a
body.

```js
import { readFile } from 'node:fs/promises'
import { entries } from 'tar'

for await (const entry of entries(await readFile('archive.tgz'))) {
  if (entry.type !== 'File') continue
  if (entry.path.endsWith('.json')) {
    console.log(entry.path, JSON.parse(await entry.text()))
  } else {
    let bytes = 0
    for await (const chunk of entry.body) bytes += chunk.length
    console.log(entry.path, bytes)
  }
}
```

### `onEntry` is awaited

`list()` and `extract()` call `onEntry` with each entry. If it returns
a promise, the command waits for it before it reads the next entry.

In `list()`, you can read the body in `onEntry`.

```js
import { list } from 'tar'

await list({
  file: 'archive.tgz',
  onEntry: async entry => {
    if (entry.path === 'README.md') console.log(await entry.text())
  },
})
```

In `extract()`, `onEntry` gets each entry before the checks and before
the entry is written. If `onEntry` reads the body, the entry is not
extracted, because its content is used.

### `ReadEntrySync`

The sync commands give you a `ReadEntrySync`. It has the same fields.
`bytes()`, `arrayBuffer()`, and `text()` return the value, not a
promise. `body` is an iterator of `Uint8Array` chunks. There is no
`blob()`.

```js
import { readFileSync } from 'node:fs'
import { entriesSync } from 'tar'

for (const entry of entriesSync(readFileSync('archive.tgz'))) {
  if (entry.path === 'package.json') console.log(entry.text())
}
```

### `WriteEntry`

A `WriteEntry` is an entry to write. It has the shape of a `Request`:
the metadata is in the fields, and the content is `body`.

```js
import { WriteEntry } from 'tar'

const entry = new WriteEntry(
  { path: 'hello.txt', mode: 0o644, mtime: new Date() },
  'hello\n',
)
console.log(entry.type, entry.size)
```

`new WriteEntry(data, body)`:

- `data.path` is required.
- `data.type` Default `'File'`.
- `data.mode`, `uid`, `gid`, `uname`, `gname`, `mtime`, `atime`,
  `ctime`, `linkpath`, `dev`, `ino`, `nlink` are optional.
- `data.size` The number of bytes in the body. The default is the
  length of a body that is a string, a `Uint8Array`, or a `Blob`.
- `body` A string, a `Uint8Array`, a `Blob`, a
  `ReadableStream<Uint8Array>`, or an iterable or async iterable of
  `Uint8Array` chunks. A string is written as UTF-8.

Set `data.size` for a body that is a stream or an iterable. Without
it, the constructor throws a `TypeError`, because the header has the
size and comes before the content. The body must have `size` bytes.
If it does not, the pack stops with an error.

A sync command takes only a string, a `Uint8Array`, or a sync iterable
as the body.

### Add entries from memory to an archive

The list of files of `create()`, `replace()`, and `update()` can have:

- a path
- a path that starts with `@`, such as `'@other.tar'`: the rest is the
  path of an archive, and its entries are added
- a `WriteEntry`
- a `ReadEntry` of an archive that you read
- an iterable or async iterable of entries, such as the result of
  `entries()`

```js
import { create, WriteEntry } from 'tar'

await create({ file: 'bundle.tgz', gzip: true }, [
  'src',
  new WriteEntry(
    { path: 'build-info.json', mode: 0o644, mtime: new Date() },
    JSON.stringify({ built: new Date().toISOString() }),
  ),
  new WriteEntry({ path: 'empty/', type: 'Directory', mode: 0o755 }),
])
```

### Create an archive from a stream

A file of an archive can come from a `ReadableStream`, such as the
body of a `fetch()` response. Make a `WriteEntry` with the stream as
its body, and give it to `create()`.

You must set `size`, the number of bytes that the stream gives. A tar
header has the size of the file, and the header comes before the
content. `create()` cannot write the entry without it. If you do not
know the size, read the stream into memory first, for example with
`await new Response(stream).bytes()`, and give the bytes as the body.

```js
import { create, WriteEntry } from 'tar'

const text = new TextEncoder().encode('the content of the stream\n')
// A stream of two chunks. A stream from a file or from the network
// works in the same way.
const stream = new ReadableStream({
  start: controller => {
    controller.enqueue(text.subarray(0, 10))
    controller.enqueue(text.subarray(10))
    controller.close()
  },
})

await create({ file: 'from-stream.tgz', gzip: true }, [
  new WriteEntry({ path: 'stream.txt', size: text.length }, stream),
])
```

A Node.js `Readable` is an async iterable of chunks, so it can also be
the body. `Readable.toWeb(readable)` makes a `ReadableStream` of it.

This example copies an archive, and removes some entries.

```js
import { readFile } from 'node:fs/promises'
import { create, entries } from 'tar'

await create(
  {
    file: 'no-docs.tgz',
    gzip: true,
    filter: path => !path.endsWith('.md'),
  },
  [entries(await readFile('archive.tgz'))],
)
```

## Commands

Each command is `command(options, files)`. The aliases `c`, `x`, `t`,
`r`, and `u` are also exported.

These options are common to each command:

- `strict` Make each warning an error. See
  [Warnings and errors](#warnings-and-errors). For example, a path of
  `create()` that does not exist, and a path in `files` of `extract()`
  or `list()` that is not in the archive, are warnings without it.
- `onwarn` A function `(code, message, data)`. It gets each warning
  when `strict` is not set.
- `file` The path of the archive file.
- `fs`, `platform` See [Entry points](#entry-points).

### Option aliases

Each command takes the option aliases of version 7. An option that is
set wins over its aliases. `entries()` and the classes take only the
names of the options.

| Option          | Aliases                                                         |
| --------------- | --------------------------------------------------------------- |
| `cwd`           | `C`                                                             |
| `file`          | `f`                                                             |
| `gzip`          | `z`                                                             |
| `preservePaths` | `P`                                                             |
| `unlink`        | `U`                                                             |
| `strip`         | `strip-components`, `stripComponents`                           |
| `newer`         | `keep-newer`, `keepNewer`, `keep-newer-files`, `keepNewerFiles` |
| `keep`          | `k`, `keep-existing`, `keepExisting`                            |
| `noMtime`       | `m`, `no-mtime`                                                 |
| `preserveOwner` | `p`                                                             |
| `follow`        | `L`, `h`                                                        |
| `onEntry`       | `onentry`, `onReadEntry`                                        |
| `chmod`         | `noChmod: false` is `chmod: true`, if `chmod` is not set        |

```js
import { c, t } from 'tar'

await c({ f: 'alias.tgz', z: true, C: '.' }, ['src'])
await t({ f: 'alias.tgz', onentry: entry => console.log(entry.path) })
```

### `create(options, files)`

Make an archive of `files`. A directory is added with all that is in
it.

With `file`, the archive is written to that path, and the result is a
`Promise<void>`. With no `file`, the result is a
`ReadableStream<Uint8Array>`. `createSync()` returns `undefined` or an
iterator of chunks. The files are read only when the stream or the
iterator is read.

`create()` throws a `TypeError` when `files` is empty.

A path that does not exist is a `TAR_ENTRY_ERROR` warning, as it is
for bsdtar. The warning has the `ENOENT` error of the file system, and
the other paths are added. This is also true for a path in a directory
that is removed after the directory is read. With `strict`, it is an
error.

Each other error from the file system stops the command. With `file`,
the archive file that is not complete stays on disk.

`create()` writes the size that `lstat` gives for a file, and then
reads that number of bytes. If the file has fewer bytes or more
bytes, the command stops with an error that has the `code` `'EOF'`,
the `path`, and a message that starts with
`encountered unexpected EOF` or `did not encounter expected EOF`. The
cause is a file that changed while it was read, or a file system that
gives a wrong size, such as the `fs` module of Electron for a path in
an `asar` file. See
[Electron and `asar` files](#electron-and-asar-files).

Options:

- `file` The path of the archive to write. It is not relative to
  `cwd`.
- `mode` The mode of the archive file. Default `0o666`.
- `cwd` The directory that the paths in `files` are relative to.
- `prefix` A directory to put before the path of each entry.
- `gzip` Compress with gzip. In `tar`, an object is the options of
  `zlib.createGzip()`.
- `brotli` Compress with brotli. Not in `tar/core`. An object is the
  options of `zlib.createBrotliCompress()`.
- `zstd` Compress with zstd. Not in `tar/core`. An object is the
  options of `zlib.createZstdCompress()`.
- `compress` Compress with a `Codec` of your own: `codec`, or
  `[codec, options]`. See [Compression](#compression).
- `codecs` More compression formats. See [Compression](#compression).
- `filter` A function `(path, stat)`. If it returns false, the path is
  not added. For a directory, the paths in it are also not added. For
  an entry of another archive, the second argument is the `ReadEntry`.
  It is not called for a `WriteEntry`.
- `onWriteEntry` A function that gets the `WriteEntry` of each entry
  before its header is written. It can change the fields. The async
  commands wait for a promise.
- `portable` Leave out the data that is specific to one system: `uid`,
  `gid`, `uname`, `gname`, `atime`, `ctime`, `dev`, `ino`, `nlink`,
  and the `mtime` of a directory. Remove the write permission of the
  group and of others. With `gzip`, the header of the gzip data does
  not name the system.
- `follow` Add the target of a symbolic link, not the link.
- `noDirRecurse` Add a directory without the entries in it.
- `preservePaths` Keep a root at the start of a path, such as `/`. By
  default the root is removed, with a `TAR_ENTRY_INFO` warning.
- `noPax` Write no PAX header. A PAX header holds the fields that do
  not fit the basic header, such as a long path. Other tar programs
  can need it.
- `noMtime` Write no `mtime`.
- `mtime` A `Date`. The `mtime` of each entry.
- `maxReadSize` The most bytes to read from a file at one time.
  Default 16 MiB.
- `jobs` The number of paths that are read ahead at one time.
  Default 4. Async only.
- `maxReadSize` and `jobs` take a positive integer, or `Infinity`.
  0 gives the default. Each other value is a `TypeError`.
- `processUid`, `processUname` See
  [The process options](#the-process-options).
- `strict`, `onwarn`, `fs`, `platform` The common options.

The archive has these entry types: files, directories, symbolic links,
and hard links. A file with more than one link is a hard link entry
the second time that the pack finds it. Each other object, such as a
socket, a FIFO, or a device, is skipped with a `TAR_ENTRY_UNSUPPORTED`
warning. The object is not opened. A path that the `filter` refuses
gives no warning.

```js
import { create } from 'tar'

await create(
  {
    file: 'release.tgz',
    gzip: { level: 9 },
    prefix: 'package',
    portable: true,
    filter: path => !path.endsWith('.test.js'),
    onWriteEntry: entry => {
      entry.mtime = new Date('2020-01-01')
    },
  },
  ['src', 'package.json'],
)
```

### `extract(options, files)`

Extract the entries of an archive into the directory `cwd`. If `files`
is set, extract only the entries that it lists, and the entries in the
directories that it lists. The result is a `Promise<void>`. It
resolves when all the file system work is done.

A problem with one entry is a warning, and the extraction continues.
A path in `files` that no entry of the archive matches is a
`TAR_ENTRY_ERROR` warning when the archive ends, as it is for
`tar xf archive.tar not-found`. With `strict`, it is an error, and the
entries that match are extracted first.
See [Warnings and errors](#warnings-and-errors). See
[Security](#security) before you extract an archive that you do not
trust.

Options:

- `file` The path of the archive to read.
- `input` The archive data. Set `input` or `file`.
- `cwd` The directory to extract into. It must exist and be a
  directory. If not, the command fails with a `CwdError`.
- `strip` Remove this number of leading parts from each path. An entry
  with no part left is skipped, with no warning. Thus `strip: 1` does
  not apply the mode, the owner, or the times of the top directory of
  the archive to the extraction directory. `files` and `filter` see
  the path before this change.
- `filter` A function `(path, entry)`. If it returns false, the entry
  is not extracted.
- `onEntry` A function that gets each `ReadEntry` before it is
  extracted. A promise is awaited. An entry whose body `onEntry`
  reads is not extracted.
- `transform` A function that gets each file entry. It returns a
  `TransformStream<Uint8Array, Uint8Array>` that changes the content,
  or `undefined`. In `extractSync()`, it returns a function
  `(chunk) => chunk`, or `undefined`. With `transform`, one entry is
  extracted at a time. The result can be each object that has a
  `readable` and a `writable` web stream. For a Node.js `Transform`
  stream, return `zlibStream(stream)`. See
  [Migration from version 7](#migration-from-version-7).
- `keep` Do not write over an existing file.
- `newer` Do not write over a file that is newer than the entry.
- `unlink` Remove a file before the entry is written. By default the
  content of an existing file is replaced in place, and the file keeps
  its mode. Also remove an object in the path to an entry that is not
  a directory, and make a directory there.
- `noMtime` Do not set the times of the entries.
- `preserveOwner` Set the owner of each entry to the `uid` and `gid`
  in the archive. Default: true if `processUid` is 0 and `uid` is not
  set.
- `uid`, `gid` Set the owner of each entry to this user and group. You
  must set the two. You cannot set them with `preserveOwner`. Each
  must be an integer from 0 to 4294967295. Any other number is a
  `TypeError`.
- `forceChown` Set the owner of each entry, also when it is the owner
  of the process.
- `chmod` Call `fs.chmod()` on each directory, so that the umask of
  the process does not change its mode. It has no effect on files.
- `processUmask` The umask of the process. Only used with `chmod`.
- `umask` The mask for the default modes `dmode` and `fmode`. Default:
  `processUmask` with `chmod`, 0 without it. It does not change the
  mode of an entry that has one.
- `dmode` The mode of a directory that has no mode in the archive, and
  of a parent directory that is not in the archive. Default
  `0o777 & ~umask`.
- `fmode` The mode of a file that has no mode in the archive. Default
  `0o666 & ~umask`.
- `preservePaths` Permit absolute paths, `..` in paths, and extraction
  through symbolic links. This is not safe with an archive that you do
  not trust.
- `maxDepth` The most parts that a path or a link target can have.
  Default 1024. `Infinity` removes the limit.
- `jobs` The most entries to extract at one time. Default 16. Async
  only.
- `maxReadSize` The most bytes to read from the archive file at one
  time. Default 16 MiB.
- `jobs` and `maxReadSize` take a positive integer, or `Infinity`.
  0 gives the default. Each other value is a `TypeError`.
- `maxMetaEntrySize`, `maxDecompressionRatio`, `codecs` The options of
  [`entries()`](#entriesinput-options).
- `processUid`, `processGid` See
  [The process options](#the-process-options).
- `strict`, `onwarn`, `fs`, `platform` The common options.

Files, directories, symbolic links, and hard links are extracted.
Devices and FIFOs are skipped with a `TAR_ENTRY_UNSUPPORTED` warning.

```js
import { mkdir } from 'node:fs/promises'
import { extract } from 'tar'

await mkdir('out', { recursive: true })
await extract({
  file: 'archive.tgz',
  cwd: 'out',
  // No links.
  filter: (path, entry) =>
    entry.type !== 'SymbolicLink' && entry.type !== 'Link',
  // Make the text of each .md file upper case.
  transform: entry => {
    if (!entry.path.endsWith('.md')) return undefined
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    return new TransformStream({
      transform: (chunk, controller) => {
        const text = decoder.decode(chunk, { stream: true })
        controller.enqueue(encoder.encode(text.toUpperCase()))
      },
    })
  },
  onwarn: (code, message) => console.error(code, message),
})
```

### `list(options, files)`

Call `onEntry` with each entry of an archive. If `files` is set, only
with the entries that it lists, and the entries in the directories
that it lists. The result is a `Promise<void>`.

Options:

- `file` The path of the archive to read.
- `input` The archive data. Set `input` or `file`.
- `onEntry` A function that gets each `ReadEntry`. A promise is
  awaited.
- `filter` A function `(path, entry)`. If it returns false, `onEntry`
  does not get the entry.
- `maxReadSize` The most bytes to read from the archive file at one
  time. Default 16 MiB. A positive integer, or `Infinity`. 0 gives the
  default. Each other value is a `TypeError`.
- `maxMetaEntrySize`, `maxDecompressionRatio`, `codecs` The options of
  [`entries()`](#entriesinput-options).
- `strict`, `onwarn`, `fs`, `platform` The common options.

```js
import { listSync } from 'tar'

const paths = []
listSync(
  { file: 'archive.tgz', onEntry: entry => paths.push(entry.path) },
  ['src'],
)
console.log(paths)
```

A path in `files` matches an entry if it is the path of the entry, or
the path of one of its parent directories. Trailing slashes are
ignored.

A path in `files` that no entry matches is a `TAR_ENTRY_ERROR` warning
when the archive ends. The message is `<path>: not found in archive`,
and `data.path` is the path. An entry that `filter` refuses still
matches its path. With `strict`, the warning is an error, after
`onEntry` got the entries that match.

### `replace(options, files)`

Add `files` to the end of an archive file. The archive must not be
compressed. If the file does not exist, it is made. The result is a
`Promise<void>`.

The new entries go after the last complete entry of the archive. If a
path is in the archive two times, a reader gets the old entry and then
the new entry. An extraction writes the new entry last.

Options:

- `file` The path of the archive. Required.
- `mtimeCache` A `Map`. The command sets the path and the `mtime` of
  each entry that the archive has.
- All the options of `create()`, but not `gzip`, `brotli`, `zstd`, or
  `compress`.

### `update(options, files)`

The same as `replace()`, with the same options. A path is added only
if its `mtime` is later than the `mtime` of the last entry of the
archive that has that path.

A directory is always added again, and each path in it is checked.
So a changed file in a directory is added, also when the `mtime` of
the directory did not change.

A basic tar header holds the `mtime` in whole seconds. For such an
entry, the file is newer only if its `mtime` is in a later second. A
change in the same second as the entry is not seen.

### `entries(input, options)`

Read the entries of an archive. The result is an async iterator of
`ReadEntry` objects. `entriesSync()` returns an iterator of
`ReadEntrySync` objects. `tar/core` does not have `entriesSync()`.

Entries that are not an object of a file system, such as PAX headers,
are not given.

Options:

- `filter` A function `(path, entry)`. If it returns false, the entry
  is skipped.
- `maxMetaEntrySize` The largest PAX header or GNU long name entry to
  read, in bytes. A larger one is skipped. Default 1 MiB.
- `maxDecompressionRatio` Stop with an error when the decompressed
  size is more than this many times the compressed size. Default 1000.
  `Infinity` removes the limit.
- `codecs` More compression formats. See [Compression](#compression).
- `file` The name of the archive. Warnings have it, and the reader
  uses it to find a format by the file name.
- `strict`, `onwarn`, `platform` The common options.

## Compression

The readers find the format of the input. You set no option to read a
compressed archive.

To write a compressed archive, set `gzip`, `brotli`, or `zstd` in the
options of `create()`. To write with a codec of your own, set
`compress`. You can set only one of the four.

| Format | `tar`                                                  | `tar/core`                                                                       |
| ------ | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| gzip   | Yes, with `node:zlib`. Options of `zlib.createGzip()`. | Yes, with `CompressionStream` and `DecompressionStream`. Async only. No options. |
| brotli | Yes, if `node:zlib` of the runtime has it              | No                                                                               |
| zstd   | Yes, if `node:zlib` of the runtime has it              | No                                                                               |

```js
import { create, list } from 'tar'

await create({ file: 'src.tar.zst', zstd: true }, ['src'])
await create({ file: 'src.tar.br', brotli: true }, ['src'])
await create({ file: 'src.tgz', gzip: { level: 9 } }, ['src'])

for (const file of ['src.tar.zst', 'src.tar.br', 'src.tgz']) {
  await list({
    file,
    onEntry: entry => console.log(file, entry.path),
  })
}
```

### How a format is detected

1. The reader reads the first 512 bytes of the input, or more if a
   codec needs more.
2. It uses the first codec whose `detect()` function returns true.
   Gzip data starts with the bytes `1f 8b`. Zstd data starts with the
   bytes `28 b5 2f fd`.
3. If no codec detects the data, and the data does not start with a
   tar header, the reader uses the first codec that has an ending of
   the `file` option in its `extensions`.
4. If there is no such codec, the input is read as a tar archive.

Brotli data has no fixed first bytes. The reader uses brotli only if
the name of the archive ends in `.tar.br` or `.tbr`. To read brotli
from `input`, also set `file`.

```js
import { readFile } from 'node:fs/promises'
import { create, entries } from 'tar'

await create({ file: 'src.tar.br', brotli: true }, ['src'])
const data = await readFile('src.tar.br')

for await (const entry of entries(data, { file: 'src.tar.br' })) {
  console.log(entry.path)
}
```

`replace()` and `update()` refuse an archive that a codec detects, and
a `file` name that ends in `.br` or `.tbr`.

### `maxDecompressionRatio`

A small compressed file can hold a very large quantity of data. The
readers count the compressed bytes and the decompressed bytes. When
the decompressed count is more than `maxDecompressionRatio` times the
compressed count, the reader stops with a `TAR_ABORT` error. The
default is 1000.

The async codecs of `tar` give at most 64 KiB of output at a time, and
only when the reader asks. Thus the reader stops soon after the limit.
The sync codecs of `tar` give the limit to `node:zlib` as
`maxOutputLength`.

### The `Codec` type

A codec is one compression format. Give codecs in the `codecs` option,
to add a format or to replace the built-in gzip. Your codecs are tried
before the built-in codecs.

```ts
type Codec = {
  name: string
  /** The number of bytes that `detect` needs. */
  headLength: number
  /** True if the input is in this format. */
  detect(head: Uint8Array): boolean
  /** File name endings, for a format that `detect` cannot identify. */
  extensions?: string[]
  /** Make a stream that decompresses. */
  decompress(): CodecStream
  /** Make a stream that compresses. */
  compress?(options?: Record<string, unknown>): CodecStream
  /** Decompress all of `data`. The sync readers need it. */
  decompressSync?(
    data: Uint8Array,
    limit: { maxOutputLength: number },
  ): Uint8Array
  /** Compress all of `data`. The sync commands need it. */
  compressSync?(
    data: Uint8Array,
    options?: Record<string, unknown>,
  ): Uint8Array
}

type CodecStream = {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
}
```

A `TransformStream` is a `CodecStream`.

To compress with a codec, give it in the `compress` option of
`create()`. The codec does not need to be in `codecs`. To give options
to the `compress()` function of the codec, set `compress` to
`[codec, options]`. With `portable`, a codec that has the name `gzip`
also gets `portable: true` in its options.

```js
import { create, gzip } from 'tar'

// The built-in gzip of the core, not the gzip of `node:zlib`.
await create({ file: 'core.tgz', compress: gzip }, ['src'])
```

The options `gzip`, `brotli`, and `zstd` select the first codec of
`codecs` that has that name, then the built-in codec. An option with
the name of another codec selects nothing.

`decompressSync()` must throw before it makes more than
`limit.maxOutputLength` bytes. That number is `Infinity` when the
caller sets `maxDecompressionRatio: Infinity`.

A sync command with compression holds the complete archive in memory.
`createSync()` compresses the archive in one call. The sync readers
decompress all of the input in one call.

The exports for codecs are:

- `gzip` The built-in codec of the core.
- `zlibCodecs(zlib)` Makes the gzip, brotli, and zstd codecs of a
  `node:zlib` module. Not in `tar/core`.
- `zlibStream(stream)` Makes a `CodecStream` from a `node:zlib`
  stream, or from another Node.js `Transform` stream. Not in
  `tar/core`.

### Recipe: bzip2

This recipe adds bzip2 with the package
[`node-bzip2`](https://www.npmjs.com/package/node-bzip2). That package
is a native addon. It is not a dependency of `tar`.

`node-bzip2` works on complete buffers. It has no stream interface and
no output limit. Thus this codec has two limits:

- The async form collects all of the input in memory before it
  compresses or decompresses.
- All of the data is decompressed before the ratio limit is checked.
  `maxDecompressionRatio` cannot stop a large output before it is in
  memory. Do not use this codec for input that you do not trust,
  unless you limit the size of the input and you accept the memory
  use.

```js
import bzip2 from 'node-bzip2'
import { mkdir } from 'node:fs/promises'
import { create, extract, list } from 'tar'

// A stream that collects all of its input. At the end it gives the
// result of `fn` as one chunk.
const whole = fn => {
  const parts = []
  return new TransformStream({
    transform: chunk => {
      parts.push(chunk)
    },
    flush: async controller => {
      controller.enqueue(await fn(Buffer.concat(parts)))
    },
  })
}

const bz2 = {
  name: 'bzip2',
  // Bzip2 data starts with the characters "BZh".
  headLength: 3,
  detect: head => head[0] === 0x42 && head[1] === 0x5a && head[2] === 0x68,
  decompress: () => whole(data => bzip2.decompressAsync(data)),
  compress: options => whole(data => bzip2.compressAsync(data, options)),
  decompressSync: (data, { maxOutputLength }) => {
    // The limit is checked after the data is decompressed.
    const out = bzip2.decompress(data)
    if (out.length > maxOutputLength) {
      throw new Error('bzip2: the output is larger than the limit')
    }
    return out
  },
  compressSync: (data, options) => bzip2.compress(data, options),
}

// The second item is the options of the `compress` functions of
// node-bzip2.
await create({ file: 'src.tar.bz2', compress: [bz2, { level: 9 }] }, [
  'src',
])

await list({
  file: 'src.tar.bz2',
  codecs: [bz2],
  onEntry: entry => console.log(entry.path),
})

await mkdir('out', { recursive: true })
await extract({ file: 'src.tar.bz2', codecs: [bz2], cwd: 'out' })
```

## Lower-level classes

The commands use these classes. They are exported from `tar` and from
`tar/core`. The sync classes are exported only from `tar`.

| Export                       | What it is                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Parser`                     | A tar parser that you pull. It does not decompress, and it reads no input by itself.                                                                |
| `TarReader`, `TarReaderSync` | The iterators that `entries()` and `entriesSync()` return. They add decompression and the entry bodies to a `Parser`.                               |
| `EntryCursor`                | Gets entries and the parts of their bodies from a `Parser`.                                                                                         |
| `EntryData`                  | The metadata of an entry. The base class of `ReadEntry` and `ReadEntrySync`.                                                                        |
| `Pack`, `PackSync`           | Make an archive. `add()` paths and entries, then `end()`. A `Pack` is the async iterator of the bytes of the archive. A `PackSync` is the iterator. |
| `PackBase`, `PackJob`        | The parts that `Pack` and `PackSync` share, and a path in the queue of a pack.                                                                      |
| `Unpack`, `UnpackSync`       | Extract an archive. `new Unpack(options).extract(input)` returns a promise.                                                                         |
| `UnpackBase`                 | The checks of each entry, with no use of the file system.                                                                                           |
| `Header`                     | Encodes and decodes one 512 byte header block.                                                                                                      |
| `Pax`                        | Encodes and parses a PAX extended header.                                                                                                           |
| `types`                      | `types.name` is a `Map` from a type code to a type name. `types.code` is the opposite `Map`.                                                        |
| `AppendScan`                 | Finds the place in an archive file where `replace()` adds entries.                                                                                  |
| `PathReservations`           | Keeps the entries that use the same paths in order during an async extraction.                                                                      |
| `CwdError`, `SymlinkError`   | The error classes of an extraction directory that is not usable, and of a path that goes through a symbolic link.                                   |

`Pack`, `Unpack`, and `Parser` are not streams. They do not have
`write()`, `pipe()`, or events.

### The `Parser` state machine

Give the parser input with `push()`. Then call `next()` for each event
until it returns `undefined`. Then give it more input, or call `end()`
and call `next()` again.

The events are:

- `{ type: 'entry', entry }` An entry. If `entry.ignore` is true, no
  other event follows for this entry.
- `{ type: 'body', data }` A part of the body of the entry. `data` is
  a view into the input.
- `{ type: 'entryEnd' }` The end of the body of the entry.
- `{ type: 'end' }` The end of the archive.

```js
import { Pack, Parser, WriteEntry } from 'tar'

// Some archive data, in chunks.
const pack = new Pack()
  .add(new WriteEntry({ path: 'a.txt' }, 'the content of a'))
  .add(new WriteEntry({ path: 'b.txt' }, 'b'))
  .end()

const parser = new Parser()
const read = () => {
  for (let ev; (ev = parser.next()); ) {
    if (ev.type === 'entry') {
      console.log('entry', ev.entry.path, ev.entry.size)
    } else if (ev.type === 'body') {
      console.log('  body', ev.data.length)
    } else if (ev.type === 'entryEnd') {
      console.log('  end of entry')
    } else {
      console.log('end of archive')
    }
  }
}

for await (const chunk of pack) {
  parser.push(chunk)
  read()
}
parser.end()
read()
```

The options of a `Parser` are `filter`, `maxMetaEntrySize`,
`platform`, `strict`, `onwarn`, and `file`. `parser.position` is the
number of input bytes up to the end of the last complete entry.

## Warnings and errors

A warning is a problem that does not stop the command. In most cases
it is about one entry. An error stops the command: an async command
rejects its promise, a sync command throws, and a stream or an
iterator fails at the next read.

`onwarn(code, message, data)` gets each warning:

- `code` One of the codes below.
- `message` The text of the warning.
- `data` An object with more data. If the cause is an `Error`, `data`
  is that error. It can have these fields:
  - `tarCode` The code below.
  - `code` The code of the file system or of the codec, if the cause
    has one. If not, the same as `tarCode`.
  - `file` The `file` option.
  - `cwd` The extraction directory.
  - `entry` The entry.
  - `header` The header, if there is no entry.
  - `recoverable` False if the problem is always an error.

An error that comes from a warning has the same fields.

```js
import { list } from 'tar'

await list({
  // This is not an archive.
  input: new TextEncoder().encode('x'.repeat(1024)),
  onwarn: (code, message, data) => {
    console.log(code, message, data.tarCode)
  },
})
```

### Codes

- `TAR_ENTRY_INFO` The entry is changed, and then used. For example,
  the root is removed from an absolute path.
- `TAR_ENTRY_INVALID` The header is not valid, and the entry is
  skipped: the checksum is wrong, the path is missing, a link has no
  `linkpath`, or an entry that is not a link has a `linkpath`.
- `TAR_ENTRY_ERROR` The entry is valid, but it cannot be extracted or
  added. In an extraction: an error of the file system, a path with
  `..`, a path or a link target that goes out of the extraction
  directory, a path that goes through a symbolic link, or a path that
  is too deep or too long. In `create()`: a path that does not exist,
  a file or a directory that changed while it was read, or with
  `follow`, a directory that is in itself. In `extract()` and
  `list()`: a path in `files` that no entry of the archive matches.
- `TAR_ENTRY_UNSUPPORTED` The type of the entry is not supported, and
  the entry is skipped. `extract()` reports devices and FIFOs.
  `create()` reports each path that is not a file, a directory, or a
  symbolic link, such as a socket. `data.path` is the path.
- `TAR_BAD_ARCHIVE` The archive is damaged: the body of the last entry
  is cut off, no header is valid, or an entry comes after one block of
  zeros. An archive with no entries also gets this warning. This is a
  warning for `list()`, `entries()`, and `Parser`. It is always an
  error for `extract()`, because the extraction cannot be complete.
- `TAR_ABORT` The data cannot be decompressed, or the decompression
  ratio is more than the limit. This is always an error.

If the input ends in the middle of a header block, there is no
warning.

An error of the file system or of a codec keeps its `code`, such as
`ENOENT`. Read `tarCode` to get the code of this package.

### `strict`

With `strict: true`, each warning is thrown as an error. This includes
`TAR_ENTRY_INFO`.

In strict mode, `extract()` stops at the first error. The entries
before it are extracted. The entries after it are not.

```js
import { mkdir, readdir } from 'node:fs/promises'
import { create, extract, WriteEntry } from 'tar'

// An archive with a path that goes out of the extraction directory.
const archive = create({ preservePaths: true }, [
  new WriteEntry({ path: 'first.txt' }, '1'),
  new WriteEntry({ path: '../outside.txt' }, '2'),
  new WriteEntry({ path: 'last.txt' }, '3'),
])
const data = await new Response(archive).arrayBuffer()

// By default, the bad entry is a warning.
await mkdir('loose')
await extract({
  input: data,
  cwd: 'loose',
  onwarn: (code, message) => console.log(code, message),
})
console.log(await readdir('loose')) // first.txt, last.txt

// In strict mode, it is an error.
await mkdir('strict')
await extract({ input: data, cwd: 'strict', strict: true }).catch(er =>
  console.log(er.tarCode, er.message),
)
console.log(await readdir('strict')) // first.txt
```

Some problems are an error also when `strict` is not set:

- The extraction directory does not exist or is not a directory
  (`CwdError`).
- The archive cannot be read, or cannot be decompressed.
- `TAR_BAD_ARCHIVE` in `extract()`.
- `onEntry` or `filter` throws.
- In `create()`, a path cannot be read, for a cause other than that
  it does not exist.

## Security

This package is used to extract archives that unknown persons publish,
such as the packages of the npm registry. It has many protections
against archives that try to write outside of the extraction
directory, or to use too many resources.

`preservePaths: true` turns off the path protections. Do not set it
for an archive that you do not trust.

### What `extract()` does

Paths:

- An entry with `..` in its path is refused, with a warning.
- The root of an absolute path is removed. The entry is extracted
  below the extraction directory, with a `TAR_ENTRY_INFO` warning.
- An entry cannot replace the extraction directory with a file or a
  link. A directory entry with the path `.` sets the times of the
  extraction directory, and its mode with `chmod`, and its owner with
  the owner options. An entry whose path is empty after `strip` does
  not.
- No entry is extracted through a symbolic link. If a part of the path
  to an entry is a symbolic link, the entry is refused. With `unlink`,
  the link is removed and a directory is made.
- Where the file system has `O_NOFOLLOW`, a file is opened with it.
  Then the open fails if the path is a symbolic link.
- A path or a link target with more than `maxDepth` parts
  (default 1024) is refused. A path or a link target of more than
  32768 characters is refused.

Links:

- The target of a hard link is a path in the extraction directory. A
  target with `..` is refused. The root of an absolute target is
  removed.
- The target of a symbolic link is relative to the directory of the
  link. A `..` is permitted only at the start of the target, as in
  `../sibling/file`. A target such as `a/../b` is refused. A target
  that resolves outside of the extraction directory is refused. The
  root of an absolute target is removed, with a `TAR_ENTRY_INFO`
  warning.
- If a part of the path to the target of a link is a symbolic link on
  disk, the link is refused. Thus an archive cannot make a link to a
  symbolic link.

Types, owners, and modes:

- Character devices, block devices, and FIFOs are never made.
- The setuid, setgid, and sticky bits of a mode in the archive are
  always removed. This is also true with `chmod`.
- A file or a directory is made with the mode in the archive, and the
  umask of the process applies. A directory always gets the read,
  write, and search permissions of the owner.
- `chmod: true` sets the mode of each directory with `fs.chmod()`, so
  that the umask does not change it. It does not change files.
- `umask`, `dmode`, and `fmode` set only the default modes. They do
  not change an entry that has a mode.
- If a file exists, its content is replaced and it keeps its mode. Set
  `unlink` to make a new file with the mode of the entry.
- A file that has more than one link is not written in place. It is
  removed first, so that the other links do not change.
- The owner of an entry is not changed, unless `preserveOwner`, `uid`
  and `gid`, or `forceChown` is set. The default of `preserveOwner` is
  true only when `processUid` is 0.

Order and resources:

- The async extraction writes some entries at the same time. Entries
  that use the same path, or a path and a directory above it, are
  written in the order of the archive. A link also waits for the entry
  of its target. Paths that differ only in case or in Unicode form are
  the same path for this rule.
- The decompression ratio is limited. See
  [`maxDecompressionRatio`](#maxdecompressionratio).
- A PAX header or a GNU long name entry of more than
  `maxMetaEntrySize` bytes (default 1 MiB) is skipped.
- The first null block is the end of the archive, as it is for
  bsdtar. Data after it is dropped, with no warning. An entry after
  a single null block is not read.
- The option objects are copied to an object with no prototype. A
  changed `Object.prototype` cannot set an option.

The parser reads PAX headers and long names in the same way as other
tar programs. Thus an archive cannot show different entries to this
package than to GNU tar or bsdtar. One difference remains: other
programs stop at one block of zeros. `list()` and `entries()` read the
entries after it, with a `TAR_BAD_ARCHIVE` warning. `extract()` stops
there with an error, and extracts no entry after that block.

### What you must do

1. Do not extract an archive into a directory that an unknown person
   or process can write to. The extraction checks a path and then uses
   it. Between the check and the use, another process can replace a
   directory or a file with a symbolic link. Then a file is written
   outside of the extraction directory. This package cannot prevent
   that. A security report about extraction into a directory that an
   attacker controls will be closed.
2. If the archive comes from a source that you do not trust, use a
   `filter` that refuses hard links and symbolic links. Most
   extraction vulnerabilities of tar programs use links.
3. If the archive is compressed, also limit the size of the entries
   with a `filter`. A small archive can hold large files.
   `maxDecompressionRatio` limits the ratio, not the total size.
4. Use the latest version. Old versions get no fixes.

```js
import { mkdir } from 'node:fs/promises'
import { extract } from 'tar'

const maxSize = 10 * 1024 * 1024

await mkdir('out', { recursive: true })
await extract({
  file: 'archive.tgz',
  cwd: 'out',
  filter: (path, entry) =>
    entry.type !== 'Link' &&
    entry.type !== 'SymbolicLink' &&
    entry.size <= maxSize,
})
```

### Races that are out of scope

These need a local process that changes the file system during the
command. They are not vulnerabilities of this package.

In `extract()`:

- A parent directory of an entry is replaced with a symbolic link
  after it is checked and before the entry is made.
- The path of a link target is changed after it is checked and before
  the link is made.
- Where the file system has no `O_NOFOLLOW` (Windows, or an `fs`
  option with no `constants`), the path of a file is replaced with a
  symbolic link after it is checked and before it is opened.

The extraction sets the times and the owner of a file through the open
file, not through its path. It sets the times and the owner of a
directory with `lutimes` and `lchown`, which do not follow a symbolic
link.

In `create()`:

- The pack calls `lstat` on a path, and then opens the file or reads
  the directory. If the path is a different object then (its device
  number or inode number is different), the pack skips it with a
  `TAR_ENTRY_ERROR` warning. Thus a file that is replaced with a
  symbolic link is not read through the link. This check is not done
  with `follow`.
- If the pack finds that a file got shorter or longer after the
  `lstat`, it stops with an error. It does not find each change of
  size.
- One race remains. If a parent directory of a path is replaced with a
  symbolic link before the `lstat` of the path, the pack reads the
  file that the link gives. Do not make an archive of a directory that
  an unknown person or process can write to, if the result goes to a
  person who must not get other files.

### Report a vulnerability

If this package does not do what this section says, report it with the
GitHub Security Advisories system of the repository.

## Migration from version 7

Version 8 is a new API. The commands have the same names and most of
the same options.

The import does not change. `tar` is the entry point for Node.js, as
in version 7, and it has the same file system defaults. `tar/core` is
new. It is for browsers and for each runtime that does not have the
`node:` modules.

| Version 7                                                                                                                                                                                                                                            | Version 8                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js 18 or later                                                                                                                                                                                                                                  | Node.js 22 or later. `tar/core` also runs in a browser.                                                                                                                                                                                              |
| `import { x } from 'tar'`                                                                                                                                                                                                                            | `import { x } from 'tar'`. The same entry point, with the same file system defaults. `tar/core` is a new entry point with no `node:` module.                                                                                                         |
| `tar.x(options, files, callback)`                                                                                                                                                                                                                    | No callbacks. `await extract(options, files)`.                                                                                                                                                                                                       |
| `sync: true`                                                                                                                                                                                                                                         | `createSync`, `extractSync`, `listSync`, `replaceSync`, `updateSync`.                                                                                                                                                                                |
| `tar.c({}, files)` returns a Node.js stream                                                                                                                                                                                                          | `create({}, files)` returns a web `ReadableStream`. `createSync()` returns an iterator of chunks.                                                                                                                                                    |
| `stream.pipe(tar.x({ cwd }))`, `stream.pipe(tar.t())`                                                                                                                                                                                                | `extract({ input: stream, cwd })`, `list({ input: stream })`. The input is a web stream, an iterable of chunks, a `Blob`, or bytes. A Node.js `Readable` is an async iterable of chunks.                                                             |
| `onReadEntry`, `onentry`                                                                                                                                                                                                                             | `onEntry`. The old names are aliases of it. A promise is awaited.                                                                                                                                                                                    |
| `entry.on('data', ...)`, `entry.resume()`                                                                                                                                                                                                            | `entry.body`, `bytes()`, `arrayBuffer()`, `text()`, `blob()`. You do not have to read or drain a body.                                                                                                                                               |
| `new Parser()` and `'entry'` events                                                                                                                                                                                                                  | `for await (const entry of entries(input))`                                                                                                                                                                                                          |
| `Buffer`                                                                                                                                                                                                                                             | `Uint8Array`. `Header#block` and the result of `Pax#encode()` are a `Uint8Array`.                                                                                                                                                                    |
| Option aliases: `C`, `f`, `z`, `P`, `U`, `k`, `m`, `p`, `L`, `h`, `strip-components`, `stripComponents`, `keep-newer`, `keepNewer`, `keep-newer-files`, `keepNewerFiles`, `keep-existing`, `keepExisting`, `no-mtime`                                | The same aliases, in the commands. See [Option aliases](#option-aliases).                                                                                                                                                                            |
| `noChmod`                                                                                                                                                                                                                                            | `chmod`. `noChmod: false` is `chmod: true`, if `chmod` is not set.                                                                                                                                                                                   |
| `noResume`, `ondone`, `dirCache`, `linkCache`, `readdirCache`, `statCache`                                                                                                                                                                           | Removed.                                                                                                                                                                                                                                             |
| `transform` returns a Node.js stream                                                                                                                                                                                                                 | `transform` returns a `TransformStream`, or an object with a `readable` and a `writable` web stream. For a Node.js `Transform` stream, return `zlibStream(stream)`. In `extractSync()`, it returns a function that gets a chunk and returns a chunk. |
| In strict mode, an `Unpack` stream emitted `'error'` and then extracted the entries after it                                                                                                                                                         | In strict mode, the extraction stops at the first error.                                                                                                                                                                                             |
| `Pack`, `Unpack`, and `Parser` are Node.js streams                                                                                                                                                                                                   | `Pack` is an async iterator of chunks. `Unpack` has an `extract(input)` method. `Parser` has `push()` and `next()`.                                                                                                                                  |
| `ReadEntry` and `WriteEntry` are Minipass streams                                                                                                                                                                                                    | `ReadEntry` has the shape of a `Response`. `WriteEntry` is metadata and a body.                                                                                                                                                                      |
| `WriteEntrySync`, `WriteEntryTar`                                                                                                                                                                                                                    | Removed. `WriteEntry` is the one class.                                                                                                                                                                                                              |
| `PackSync`, `UnpackSync`                                                                                                                                                                                                                             | `PackSync`, `UnpackSync`, `TarReaderSync`, and `ReadEntrySync`. `tar/core` does not have the sync classes.                                                                                                                                           |
| Subpath exports: `tar/create`, `tar/extract`, `tar/list`, `tar/replace`, `tar/update`, `tar/pack`, `tar/unpack`, `tar/parse`, `tar/read-entry`, `tar/write-entry`, `tar/header`, `tar/pax`, `tar/types`, `tar/c`, `tar/x`, `tar/t`, `tar/r`, `tar/u` | Only `tar`, `tar/core`, `tar/raw`, and `tar/core/raw`.                                                                                                                                                                                               |
| `brotli: true` or `zstd: true` to read an archive                                                                                                                                                                                                    | Not needed. The readers detect the format. For brotli, they use the file name. `Codec` objects in the `codecs` option add formats.                                                                                                                   |
| Dependencies: `minipass`, `minizlib`, `@isaacs/fs-minipass`, `chownr`, `yallist`                                                                                                                                                                     | No dependencies.                                                                                                                                                                                                                                     |

Version 7 code, and the same work in version 8:

```js
import { createReadStream, mkdirSync } from 'node:fs'
import { create, extract, listSync } from 'tar'

// tar.c({ f: 'demo.tgz', z: true, C: '.' }, ['src'], callback)
await create({ file: 'demo.tgz', gzip: true, cwd: '.' }, ['src'])

// tar.t({ f: 'demo.tgz', sync: true, onReadEntry: e => ... })
listSync({ file: 'demo.tgz', onEntry: e => console.log(e.path) })

// fs.createReadStream('demo.tgz').pipe(tar.x({ strip: 1, C: 'out' }))
mkdirSync('out', { recursive: true })
await extract({
  input: createReadStream('demo.tgz'),
  strip: 1,
  cwd: 'out',
})
```

A `transform` of version 7 returned a Node.js stream, such as a
`Transform` of `node:stream` or a Minipass stream. In version 8 the
content goes through web streams. To keep a Node.js `Transform`
stream, give it to `zlibStream()`. The result has the `readable` and
`writable` streams that `transform` needs. A stream that is not a
`Transform` of `node:stream`, such as a Minipass stream, is not
tested with `zlibStream()`. Write it again as a `TransformStream`.

```js
import { mkdir } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { extract, zlibStream } from 'tar'

// The transform stream of version 7.
const upper = () =>
  new Transform({
    transform: (chunk, encoding, done) =>
      done(null, String(chunk).toUpperCase()),
  })

await mkdir('upper', { recursive: true })
await extract({
  file: 'archive.tgz',
  cwd: 'upper',
  transform: entry =>
    entry.path.endsWith('.md') ? zlibStream(upper()) : undefined,
})
```

`Duplex.toWeb(stream)` of `node:stream` also gives such an object. In
TypeScript it can need a type assertion, because the stream types of
`node:stream/web` are not the types of the DOM library.
