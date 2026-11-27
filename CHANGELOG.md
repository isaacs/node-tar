# Changelog

## 8.0

A new API. See "Migration from version 7" in the README.

### Breaking changes

- Drop support for node <22
- Remove callbacks and Node.js streams. Each command returns a
  promise. `create()` with no `file` returns a web `ReadableStream`.
  `list()` and `extract()` read the `input` option, or a `file`.
- Remove the `sync` option. Use `createSync`, `extractSync`,
  `listSync`, `replaceSync`, and `updateSync`.
- Rename `onReadEntry` to `onEntry`, which is awaited. `onReadEntry`
  and `onentry` are aliases of it.
- The option aliases (`C`, `f`, `z`, `P`, `U`, `k`, `m`, `p`, `L`,
  `h`, `strip-components`, `keep-newer`, `keep-existing`, `no-mtime`,
  their camelCase forms, and `noChmod`) work in the commands only.
  `entries()`, `Pack`, `Unpack`, and `Parser` take only the names of
  the options.
- Remove the options `noResume`, `ondone`, `dirCache`, `linkCache`,
  `readdirCache`, and `statCache`.
- `ReadEntry` and `WriteEntry` are not streams. A `ReadEntry` has
  the shape of a `Response`: `body`, `bytes()`, `arrayBuffer()`,
  `text()`, and `blob()`. A `WriteEntry` is metadata and a `body`.
- `Parser`, `Pack`, and `Unpack` are not streams. `Parser` is a
  state machine with `push()` and `next()`. `Pack` is an async
  iterator of chunks. `Unpack` has an `extract(input)` method.
- Remove `WriteEntrySync` and `WriteEntryTar`.
- Use `Uint8Array`, not `Buffer`. `Header#block` and the result of
  `Pax#encode()` are a `Uint8Array`.
- `transform` returns a `TransformStream`. In `extractSync()`, it
  returns a function that changes a chunk.
- In strict mode, extraction stops at the first error.
- An entry that comes after a lone null block gives a
  `TAR_BAD_ARCHIVE` warning, and is still read and extracted. In
  strict mode it is an error.
- `update()` adds a file only if it is newer than the entry of the
  same path. It does not add a file that has the same time as the
  entry, or a time that differs only by a part of a second.
- A `jobs` or `maxReadSize` option that is not 0, a positive
  integer, or `Infinity` is a `TypeError`. 0 gives the default.
- The readers detect the compression format. The `brotli` and `zstd`
  options are only for `create()`.
- Remove the subpath exports (`tar/create`, `tar/extract`,
  `tar/parse`, and the others). The exports are `tar`, `tar/core`,
  `tar/raw`, and `tar/core/raw`.
- Remove all runtime dependencies: `minipass`, `minizlib`,
  `@isaacs/fs-minipass`, `chownr`, and `yallist`.

### New features

- Add the `tar/core` entry point, the runtime-neutral core. It runs
  in a browser, a worker, or another runtime with web streams. It
  uses no `node:` module, and it needs the `fs` and `cwd` options
  for work on files. It has no sync commands.
- `tar` is the entry point for server-side runtimes: Node.js, and
  each other runtime that has the `node:` modules. It has all of the
  core, the sync commands, and the defaults (`node:fs`, `node:zlib`,
  the working directory, the platform, and the user of the process).
- `tar/raw` and `tar/core/raw` are the same two entry points as
  separate modules that are not minified.
- Add the `fs` option. All file system work goes through it, so a
  caller can give another file system.
- Add the `input` option, and `entries()` and `entriesSync()`, which
  read a `Uint8Array`, an `ArrayBuffer`, a `Blob`, a
  `ReadableStream`, or an iterable of chunks.
- Add entries from memory to an archive: the file list of `create()`,
  `replace()`, and `update()` takes `WriteEntry` objects, `ReadEntry`
  objects, and iterables of entries.
- Add the `Codec` type and the `codecs` option, to add a compression
  format. `tar` has gzip, brotli, and zstd from `node:zlib`.
  `tar/core` has gzip.
- `create()` writes the names of a directory in sorted order, so
  the archive is the same on each runtime and file system.
- `list()` and `extract()` with a `file` do not read the body of an
  entry that nothing reads. A listing of an archive of large files
  reads only the headers.
- Add the `compress` option of `create()`. It takes a `Codec`, or
  `[codec, options]`, and writes the archive with that codec.
- The options `platform`, `processUid`, `processGid`, `processUname`,
  and `processUmask` give the facts of the process to `tar/core`.
- Nothing is read before the consumer asks for it: the readers read
  input, and `create()` reads files, only on demand.
- The async extraction writes up to 16 entries at one time (the
  `jobs` option).
- `replace()` and `update()` read PAX and GNU long name headers when
  they find the place to append, and refuse an archive in any known
  compressed format.
- Export `CwdError` and `SymlinkError`.
- `extract()` works with a `cwd` that is a root of the file system,
  such as `/` or `c:\`.

### Security fixes

- Refuse symbolic link targets that can resolve outside of the
  extraction directory: a `..` after a named part, an entry path
  that ends in `/.`, and a backslash in a directory name.
  (GHSA-3wwj-8j6r-q339, GHSA-mhqm-9wj8-w7r4, GHSA-6wwr-g865-f46r,
  GHSA-276f-qhr9-5cp8, GHSA-4pf9-5fpx-xmr6, GHSA-gvrf-jx37-rjv5,
  GHSA-7p36-m9mf-cxv7, GHSA-jmj2-9c5q-vw73, GHSA-wq85-w9p7-pgrm,
  GHSA-hqgx-p3r3-2cfg)
- Read archives in the same way as other tar programs: PAX records
  are read by their length, PAX fields are applied one time and only
  to the entry that they describe, PAX numbers must be decimal safe
  integers, a PAX path wins over a GNU long name, and a NUL ends a
  name. (GHSA-jc4p-66g7-qw5h, GHSA-p96f-8xj2-g85p,
  GHSA-gfqm-vh67-375f, GHSA-5x5g-4v8m-wwwm, GHSA-xgqw-r6hj-48hf,
  GHSA-qv2w-fc3h-pm27, GHSA-ffhw-4r4q-5cwv, GHSA-rgjp-p5j7-w36x,
  GHSA-mpg7-vg3p-wc3m, GHSA-xv7h-rgq8-7m7v, GHSA-wpwg-r92p-fjjh,
  GHSA-wcpc-xj6c-qvf9, GHSA-vw2x-rj6h-gpcw, GHSA-345f-p9f6-2h8c)
- Remove the setuid, setgid, and sticky bits from the mode of each
  extracted entry, also with `chmod: true`. (GHSA-3482-qrvx-gvgq,
  GHSA-m6rr-3gqh-4f88)
- Limit the work that a small archive can cause: `maxDepth` applies
  to link targets, a path or link target of more than 32768
  characters is refused, a link whose target is a parent or child of
  its path does not block the extraction, and data after the end of
  the archive is dropped. (GHSA-343g-5v7x-x325, GHSA-5qxq-cgm8-6j7r,
  GHSA-xm6h-2993-3ch9, GHSA-7c32-79xj-j3jp, GHSA-98v3-7xjr-fg83,
  GHSA-25mm-r35j-6hgm, GHSA-72fp-85cc-g945, GHSA-9239-v992-p74f)
- Harden extraction against local races and bad state: a file
  descriptor is not used after it is closed, the times and the owner
  of a directory are set with `lutimes` and `lchown`, and options
  cannot come from a changed `Object.prototype`.
  (GHSA-m6rr-3gqh-4f88, GHSA-5x73-x9rx-m7x2, GHSA-qf42-f7hw-qxrq)
- `create()` skips a file or directory that changes between `lstat`
  and `open` or `readdir`, and does not read it through a symbolic
  link. (GHSA-xj5v-fr6h-vw74)
- `create()` and `replace()` report each error to the caller and
  close the archive file. (GHSA-8h4g-6p7x-m3c9)
- The decompression ratio limit stops after about the permitted
  number of bytes, for each codec, and `replace()` and `update()`
  skip an entry by its PAX size and ignore a PAX or GNU header that
  has no entry after it. (GHSA-p7rf-cx2m-qgrr, GHSA-9239-v992-p74f,
  GHSA-9hmx-4f52-v64x, GHSA-8h4g-6p7x-m3c9)

### Bug fixes

- On Windows, `extract()` with `preservePaths` sets the owner of
  each directory that it makes, not only of the last one.

## 7.5

- Added `zstd` compression support.
- Consistent TOCTOU behavior in sync t.list
- Only read from ustar block if not specified in Pax
- Fix sync tar.list when file size reduces while reading
- Sanitize absolute linkpaths properly
- Prevent writing hardlink entries to the archive ahead of their
  file target

## 7.4

- Deprecate `onentry` in favor of `onReadEntry` for clarity.

## 7.3

- Add `onWriteEntry` option

## 7.2

- DRY the command definitions into a single `makeCommand` method,
  and update the type signatures to more appropriately infer the
  return type from the options and arguments provided.

## 7.1

- Update minipass to v7.1.0
- Update the type definitions of `write()` and `end()` methods on
  `Unpack` and `Parser` classes to be compatible with the
  NodeJS.WritableStream type in the latest versions of
  `@types/node`.

## 7.0

- Drop support for node <18
- Rewrite in TypeScript, provide ESM and CommonJS hybrid
  interface
- Add tree-shake friendly exports, like `import('tar/create')`
  and `import('tar/read-entry')` to get individual functions or
  classes.
- Add `chmod` option that defaults to false, and deprecate
  `noChmod`. That is, reverse the default option regarding
  explicitly setting file system modes to match tar entry
  settings.
- Add `processUmask` option to avoid having to call
  `process.umask()` when `chmod: true` (or `noChmod: false`) is
  set.

## 6.2

- Add support for brotli compression
- Add `maxDepth` option to prevent extraction into excessively
  deep folders.

## 6.1

- remove dead link to benchmarks (#313) (@yetzt)
- add examples/explanation of using tar.t (@isaacs)
- ensure close event is emitted after stream has ended (@webark)
- replace deprecated String.prototype.substr() (@CommanderRoot,
  @lukekarrys)

## 6.0

- Drop support for node 6 and 8
- fix symlinks and hardlinks on windows being packed with
  `\`-style path targets

## 5.0

- Address unpack race conditions using path reservations
- Change large-numbers errors from TypeError to Error
- Add `TAR_*` error codes
- Raise `TAR_BAD_ARCHIVE` warning/error when there are no valid
  entries found in an archive
- do not treat ignored entries as an invalid archive
- drop support for node v4
- unpack: conditionally use a file mapping to write files on
  Windows
- Set more portable 'mode' value in portable mode
- Set `portable` gzip option in portable mode

## 4.4

- Add 'mtime' option to tar creation to force mtime
- unpack: only reuse file fs entries if nlink = 1
- unpack: rename before unlinking files on Windows
- Fix encoding/decoding of base-256 numbers
- Use `stat` instead of `lstat` when checking CWD
- Always provide a callback to fs.close()

## 4.3

- Add 'transform' unpack option

## 4.2

- Fail when zlib fails

## 4.1

- Add noMtime flag for tar creation

## 4.0

- unpack: raise error if cwd is missing or not a dir
- pack: don't drop dots from dotfiles when prefixing

## 3.1

- Support `@file.tar` as an entry argument to copy entries from
  one tar file to another.
- Add `noPax` option
- `noResume` option for tar.t
- win32: convert `>|<?:` chars to windows-friendly form
- Exclude mtime for dirs in portable mode

## 3.0

- Minipass-based implementation
- Entirely new API surface, `tar.c()`, `tar.x()` etc., much
  closer to system tar semantics
- Massive performance improvement
- Require node 4.x and higher

## 0.x, 1.x, 2.x - 2011-2014

- fstream-based implementation
- slow and kinda bad, but better than npm shelling out to the
  system `tar`
