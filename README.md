# node-tar

Tar for Node.js.

[![NPM](https://nodei.co/npm/tar.png)](https://nodei.co/npm/tar/)

## API

See `examples/` for usage examples.

### var tar = require('tar')

Returns an object with `.Pack`, `.Extract` and `.Parse` methods.

### tar.Pack([properties])

Returns a through stream. Use [fstream](https://npmjs.org/package/fstream) to write files into the pack stream and you will receive tar archive data from the pack stream.

The optional `properties` object are used to set properties in the tar 'Global Extended Header'.

### tar.Extract([options])

Returns a through stream. Write tar data to the stream and the files in the tarball will be extracted onto the filesystem.

`options` can be:

```js
{
  path: '/path/to/extract/tar/into',
  strip: 0, // how many path segments to strip from the root when extracting
}
```

`options` also get passed to the `fstream.Writer` instance that `tar` uses internally.

### tar.Parse()

Returns a writable stream. Write tar data to it and it will emit `entry` events for each entry parsed from the tarball. This is used by `tar.Extract`. 

## Goals of this project

1. Be able to parse and reasonably extract the contents of any tar file
   created by any program that creates tar files, period.

        At least, this includes every version of:

        * bsdtar
        * gnutar
        * solaris posix tar
        * Joerg Schilling's star ("Schilly tar")

2. Create tar files that can be extracted by any of the following tar programs:

        * bsdtar/libarchive version 2.6.2
        * gnutar 1.15 and above
        * SunOS Posix tar
        * Joerg Schilling's star ("Schilly tar")

3. 100% test coverage.  Speed is important.  Correctness is slightly more important.

4. Create the kind of tar interface that Node users would want to use.

5. Satisfy npm's needs for a portable tar implementation with a JavaScript interface.

6. No excuses.  No complaining.  No tolerance for failure.

## But isn't there already a tar.js?

Yes, there are a few.  This one is going to be better, and it will be
fanatically maintained, because npm will depend on it.

That's why I need to write it from scratch.  Creating and extracting
tarballs is such a large part of what npm does, I simply can't have it
be a black box any longer.

## Didn't you have something already?  Where'd it go?

It's in the "old" folder.  It's not functional.  Don't use it.

It was a useful exploration to learn the issues involved, but like most
software of any reasonable complexity, node-tar won't be useful until
it's been written at least 3 times.
