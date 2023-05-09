# Changelog

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
