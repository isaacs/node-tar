# node-tar

Tar for Node.js.

Designed to mimic the behavior of `tar(1)` on unix systems.  If you
are familiar with how tar works, most of this will hopefully be
straightforward for you.  If not, then hopefully this module can teach
you useful unix skills that may come in handy someday :)

## Background

A "tar file" or "tarball" is an archive of file system entries
(directories, files, links, etc.)  The name comes from "tape archive".
If you run `man tar` on almost any Unix command line, you'll learn
quite a bit about what it can do, and its history.

Tar has 5 main top-level commands:

* `c` Create an archive
* `r` Replace entries within an archive
* `u` Update entries within an archive (ie, replace if they're newer)
* `t` List out the contents of an archive
* `x` Extract an archive to disk

The other flags and options modify how this top level function works.

## High-Level API

These 5 functions are the high-level API.  All of them have a
single-character name (for unix nerds familiar with `tar(1)` as well
as a long name (for everyone else).

All the high-level functions take the following arguments, all three
of which are optional and may be omitted.

1. `options` - An optional object specifying various options
2. `paths` - An array of paths to add or extract
3. `callback` - Called when the command is completed, if async.  (If
   sync, providing a callback throws a `TypeError`.)

If the command is sync (ie, if `options.sync=true`), then the
callback is not allowed, and the action will be completed immediately.

If a `file` argument is specified, and the command is async, then a
`Promise` is returned.

If a `file` option is not specified, then a stream is returned.  For
`create`, this is a readable stream of the generated archive.  For
`list` and `extract` this is a writable stream that an archive should
be written into.

(`replace` and `update` only work on existing archives, and so require
a `file` argument.)

Sync commands return a stream that acts on its input immediately in
the same tick.  For readable streams, this means that all of the data
is immediately available by calling `stream.read()`.  For writable
streams, it will be acted upon as soon as it is provided, but this can
be at any time.

### tar.c(options, fileList, callback) alias: tar.create

Create a tarball archive.

The `fileList` is an array of paths to add to the tarball.  Adding a
directory also adds its children recursively.

The following options are supported:

- `file` Write the tarball archive to the specified filename.  If this
  is specified, then the callback will be fired when the file has been
  written, and a promise will be returned that resolves when the file
  is written.  If a filename is not specified, then a Readable Stream
  will be returned which will emit the file data.
- `sync` Act synchronously.  If this is set, then any provided file
  will be fully written after the call to `tar.c`.  If this is set,
  and a file is not provided, then the resulting stream will already
  have the data ready to `read` or `emit('data')` as soon as you
  request it.
- `onwarn` A function that will get called with `(message, data)` for
  any warnings encountered.
- `strict` Treat warnings as crash-worthy errors.  Default false.
- `cwd` The current working directory for creating the archive.
- `prefix` A path portion to prefix onto the entries in the archive.
- `gzip` Set to any truthy value to create a gzipped archive, or an
  object with settings for `zlib.Gzip()`
- `filter` A function that gets called with `(path, stat)` for each
  entry being added.  Return `true` to add the entry to the archive,
  or `false` to omit it.
- `portable` Omit metadata that is system-specific: `ctime`, `atime`,
  `uid`, `gid`, `uname`, `gname`, `dev`, `ino`, and `nlink`.  Note
  that `mtime` is still included, because this is necessary other
  time-based operations.
- `preservePaths` Allow absolute paths and paths containing `..`.  By
  default, `/` is stripped from absolute paths, `..` paths are not
  added to the archive.

The following options are mostly internal, but can be modified in some
advanced use cases, such as re-using caches between runs.

- `linkCache` A Map object containing the device and inode value for
  any file whose nlink is > 1, to identify hard links.
- `statCache` A Map object that caches calls `lstat`.
- `readdirCache` A Map object that caches calls to `readdir`.
- `jobs` A number specifying how many concurrent jobs to run.
  Defaults to 4.
- `maxReadSize` The maximum buffer size for `fs.read()` operations.
  Defaults to 1 MB.

### tar.x(options, fileList, callback) alias: tar.extract

Extract a tarball archive.

The `fileList` is an array of paths to extract from the tarball.  If
no paths are provided, then all the entries are extracted.

If the archive is gzipped, then tar will detect this and unzip it.

The following options are supported:

- `cwd` Extract files relative to the specified directory.  Defaults
  to `process.cwd()`.
- `file` The archive file to extract.  If not specified, then a
  Writable stream is returned where the archive data should be
  written.
- `sync` Create files and directories synchronously.
- `strict` Treat warnings as crash-worthy errors.  Default false.
- `filter` A function that gets called with `(path, entry)` for each
  entry being unpacked.  Return `true` to unpack the entry from the
  archive, or `false` to skip it.
- `newer` Set to true to keep the existing file on disk if it's newer
  than the file in the archive.
- `preservePaths` Allow absolute paths, paths containing `..`, and
  extracting through symbolic links.  By default, `/` is stripped from
  absolute paths, `..` paths are not extracted, and any file whose
  location would be modified by a symbolic link is not extracted.
- `unlink` Unlink files before creating them.  Without this option,
  tar overwrites existing files, which preserves existing hardlinks.
  With this option, existing hardlinks will be broken, as will any
  symlink that would affect the location of an extracted file
- `strip` Remove the specified number of leading path elements.
  Pathnames with fewer elements will be silently skipped.  Note that
  the pathname is edited after applying the filter, but before
  security checks.
- `onwarn` A function that will get called with `(message, data)` for
  any warnings encountered.

The following options are mostly internal, but can be modified in some
advanced use cases, such as re-using caches between runs.

- `umask` Filter the modes of entries like `process.umask()`.
- `dmode` Default mode for directories
- `fmode` Default mode for files
- `dirCache` A Map object of which directories exist.
- `maxMetaEntrySize` The maximum size of meta entries that is
  supported.  Defaults to 1 MB.

### tar.t(options, fileList, callback) alias: tar.list

List the contents of a tarball archive.

The `fileList` is an array of paths to list from the tarball.  If
no paths are provided, then all the entries are listed.

If the archive is gzipped, then tar will detect this and unzip it.

Returns an event emitter that emits `entry` events with
`tar.ReadEntry` objects.  However, they don't emit `'data'` or `'end'`
events.  (If you want to get actual readable entries, use the
`tar.Parse` class instead.)

The following options are supported:

- `cwd` Extract files relative to the specified directory.  Defaults
  to `process.cwd()`.
- `file` The archive file to list.  If not specified, then a
  Writable stream is returned where the archive data should be
  written.
- `sync` Read the specified field synchronously.  (This has no effect
  when a file option isn't specified, because entries are emitted as
  fast as they are parsed from the stream anyway.)
- `strict` Treat warnings as crash-worthy errors.  Default false.
- `filter` A function that gets called with `(path, entry)` for each
  entry being listed.  Return `true` to emit the entry from the
  archive, or `false` to skip it.

### tar.u(options, fileList, callback) alias: tar.update

Add files to an archive if they are newer than the entry already in
the tarball archive.

The `fileList` is an array of paths to add to the tarball.  Adding a
directory also adds its children recursively.

The following options are supported:

- `file` Required. Write the tarball archive to the specified
  filename.
- `sync` Act synchronously.  If this is set, then any provided file
  will be fully written after the call to `tar.c`.
- `onwarn` A function that will get called with `(message, data)` for
  any warnings encountered.
- `strict` Treat warnings as crash-worthy errors.  Default false.
- `cwd` The current working directory for adding entries to the
  archive.
- `prefix` A path portion to prefix onto the entries in the archive.
- `gzip` Set to any truthy value to create a gzipped archive, or an
  object with settings for `zlib.Gzip()`
- `filter` A function that gets called with `(path, stat)` for each
  entry being added.  Return `true` to add the entry to the archive,
  or `false` to omit it.
- `portable` Omit metadata that is system-specific: `ctime`, `atime`,
  `uid`, `gid`, `uname`, `gname`, `dev`, `ino`, and `nlink`.  Note
  that `mtime` is still included, because this is necessary other
  time-based operations.
- `preservePaths` Allow absolute paths and paths containing `..`.  By
  default, `/` is stripped from absolute paths, `..` paths are not
  added to the archive.

### tar.r(options, fileList, callback) alias: tar.replace

Add files to an existing archive.  Because later entries override
earlier entries, this effectively replaces any existing entries.

The `fileList` is an array of paths to add to the tarball.  Adding a
directory also adds its children recursively.

The following options are supported:

- `file` Required. Write the tarball archive to the specified
  filename.
- `sync` Act synchronously.  If this is set, then any provided file
  will be fully written after the call to `tar.c`.
- `onwarn` A function that will get called with `(message, data)` for
  any warnings encountered.
- `strict` Treat warnings as crash-worthy errors.  Default false.
- `cwd` The current working directory for adding entries to the
  archive.
- `prefix` A path portion to prefix onto the entries in the archive.
- `gzip` Set to any truthy value to create a gzipped archive, or an
  object with settings for `zlib.Gzip()`
- `filter` A function that gets called with `(path, stat)` for each
  entry being added.  Return `true` to add the entry to the archive,
  or `false` to omit it.
- `portable` Omit metadata that is system-specific: `ctime`, `atime`,
  `uid`, `gid`, `uname`, `gname`, `dev`, `ino`, and `nlink`.  Note
  that `mtime` is still included, because this is necessary other
  time-based operations.
- `preservePaths` Allow absolute paths and paths containing `..`.  By
  default, `/` is stripped from absolute paths, `..` paths are not
  added to the archive.

## Low-Level API

### class tar.Pack

A readable tar stream.

Has all the standard readable stream interface stuff.  `'data'` and
`'end'` events, `read()` method, `pause()` and `resume()`, etc.

#### constructor(options)

The following options are supported:

- `onwarn` A function that will get called with `(message, data)` for
  any warnings encountered.
- `strict` Treat warnings as crash-worthy errors.  Default false.
- `cwd` The current working directory for creating the archive.
- `prefix` A path portion to prefix onto the entries in the archive.
- `gzip` Set to any truthy value to create a gzipped archive, or an
  object with settings for `zlib.Gzip()`
- `filter` A function that gets called with `(path, stat)` for each
  entry being added.  Return `true` to add the entry to the archive,
  or `false` to omit it.
- `portable` Omit metadata that is system-specific: `ctime`, `atime`,
  `uid`, `gid`, `uname`, `gname`, `dev`, `ino`, and `nlink`.  Note
  that `mtime` is still included, because this is necessary other
  time-based operations.
- `preservePaths` Allow absolute paths and paths containing `..`.  By
  default, `/` is stripped from absolute paths, `..` paths are not
  added to the archive.
- `linkCache` A Map object containing the device and inode value for
  any file whose nlink is > 1, to identify hard links.
- `statCache` A Map object that caches calls `lstat`.
- `readdirCache` A Map object that caches calls to `readdir`.
- `jobs` A number specifying how many concurrent jobs to run.
  Defaults to 4.
- `maxReadSize` The maximum buffer size for `fs.read()` operations.
  Defaults to 1 MB.


#### addEntry(path) -> this

Adds an entry to the archive.  Returns the Pack stream.

#### write(path) -> Boolean

Adds an entry to the archive.  Returns true if flushed.

#### end() -> this

Finishes the archive.

### class tar.Pack.Sync

Synchronous version of `tar.Pack`.

### class tar.Unpack

A writable stream that unpacks a tar archive onto the file system.

All the normal writable stream stuff is supported.  `write()` and
`end()` methods, `'drain'` events, etc.

`'close'` is emitted when it's done writing stuff to the file system.

#### constructor(options)

- `cwd` Extract files relative to the specified directory.  Defaults
  to `process.cwd()`.
- `filter` A function that gets called with `(path, entry)` for each
  entry being unpacked.  Return `true` to unpack the entry from the
  archive, or `false` to skip it.
- `newer` Set to true to keep the existing file on disk if it's newer
  than the file in the archive.
- `preservePaths` Allow absolute paths, paths containing `..`, and
  extracting through symbolic links.  By default, `/` is stripped from
  absolute paths, `..` paths are not extracted, and any file whose
  location would be modified by a symbolic link is not extracted.
- `unlink` Unlink files before creating them.  Without this option,
  tar overwrites existing files, which preserves existing hardlinks.
  With this option, existing hardlinks will be broken, as will any
  symlink that would affect the location of an extracted file
- `strip` Remove the specified number of leading path elements.
  Pathnames with fewer elements will be silently skipped.  Note that
  the pathname is edited after applying the filter, but before
  security checks.
- `onwarn` A function that will get called with `(message, data)` for
  any warnings encountered.
- `umask` Filter the modes of entries like `process.umask()`.
- `dmode` Default mode for directories
- `fmode` Default mode for files
- `dirCache` A Map object of which directories exist.
- `maxMetaEntrySize` The maximum size of meta entries that is
  supported.  Defaults to 1 MB.

### class tar.Unpack.Sync

Synchronous version of `tar.Unpack`.

### class tar.Parse

A writable stream that parses a tar archive stream.  All the standard
writable stream stuff is supported.

If the archive is gzipped, then tar will detect this and unzip it.

Emits `'entry'` events with `tar.ReadEntry` objects, which are
themselves readable streams that you can pipe wherever.

#### constructor(options)

Returns an event emitter that emits `entry` events with
`tar.ReadEntry` objects.

The following options are supported:

- `cwd` Extract files relative to the specified directory.  Defaults
  to `process.cwd()`.
- `file` The archive file to list.  If not specified, then a
  Writable stream is returned where the archive data should be
  written.
- `sync` Read the specified field synchronously.  (This has no effect
  when a file option isn't specified, because entries are emitted as
  fast as they are parsed from the stream anyway.)
- `strict` Treat warnings as crash-worthy errors.  Default false.
- `filter` A function that gets called with `(path, entry)` for each
  entry being listed.  Return `true` to emit the entry from the
  archive, or `false` to skip it.
