# Changelog

## 7.0

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

## 6.1.15

- Normalize unicode internally using NFD

## 6.1.14

- Update minipass dependency

## [6.1.13](https://github.com/npm/node-tar/compare/v6.1.12...v6.1.13) (2022-12-07)

### Dependencies

- [`cc4e0dd`](https://github.com/npm/node-tar/commit/cc4e0ddfe523a0bce383846a67442c637a65d486) [#343](https://github.com/npm/node-tar/pull/343) bump minipass from 3.3.6 to 4.0.0

## [6.1.12](https://github.com/npm/node-tar/compare/v6.1.11...v6.1.12) (2022-10-31)

### Bug Fixes

- [`57493ee`](https://github.com/npm/node-tar/commit/57493ee66ece50d62114e02914282fc37be3a91a) [#332](https://github.com/npm/node-tar/pull/332) ensuring close event is emited after stream has ended (@webark)
- [`b003c64`](https://github.com/npm/node-tar/commit/b003c64f624332e24e19b30dc011069bb6708680) [#314](https://github.com/npm/node-tar/pull/314) replace deprecated String.prototype.substr() (#314) (@CommanderRoot, @lukekarrys)

### Documentation

- [`f129929`](https://github.com/npm/node-tar/commit/f12992932f171ea248b27fad95e7d489a56d31ed) [#313](https://github.com/npm/node-tar/pull/313) remove dead link to benchmarks (#313) (@yetzt)
- [`c1faa9f`](https://github.com/npm/node-tar/commit/c1faa9f44001dfb0bc7638b2850eb6058bd56a4a) add examples/explanation of using tar.t (@isaacs)

## 6.0

- Drop support for node 6 and 8
- fix symlinks and hardlinks on windows being packed with `\`-style path
  targets

## 5.0

- Address unpack race conditions using path reservations
- Change large-numbers errors from TypeError to Error
- Add `TAR_*` error codes
- Raise `TAR_BAD_ARCHIVE` warning/error when there are no valid entries
  found in an archive
- do not treat ignored entries as an invalid archive
- drop support for node v4
- unpack: conditionally use a file mapping to write files on Windows
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

- Support `@file.tar` as an entry argument to copy entries from one tar
  file to another.
- Add `noPax` option
- `noResume` option for tar.t
- win32: convert `>|<?:` chars to windows-friendly form
- Exclude mtime for dirs in portable mode

## 3.0

- Minipass-based implementation
- Entirely new API surface, `tar.c()`, `tar.x()` etc., much closer to
  system tar semantics
- Massive performance improvement
- Require node 4.x and higher

## 0.x, 1.x, 2.x - 2011-2014

- fstream-based implementation
- slow and kinda bad, but better than npm shelling out to the system `tar`
