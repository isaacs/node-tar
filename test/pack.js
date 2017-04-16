const t = require('tap')
const Pack = require('../lib/pack.js')
const PackSync = Pack.Sync
const fs = require('fs')
const path = require('path')
const fixtures = path.resolve(__dirname, 'fixtures')
const files = path.resolve(fixtures, 'files')
const chmodr = require('chmodr')
const Header = require('../lib/header.js')
const zlib = require('zlib')
process.env.USER = 'isaacs'

t.test('set up', t => {
  const one = fs.statSync(files + '/hardlink-1')
  const two = fs.statSync(files + '/hardlink-2')
  if (one.dev !== two.dev || one.ino !== two.ino) {
    fs.unlinkSync(files + '/hardlink-2')
    fs.linkSync(files + '/hardlink-1', files + '/hardlink-2')
  }
  chmodr.sync(files, 0o644)
  t.end()
})

t.test('pack a file', t => {
  const out = []
  new Pack({ cwd: files })
    .add('one-byte.txt')
    .end()
    .on('data', c => out.push(c))
    .on('end', _ => {
      const data = Buffer.concat(out)
      t.equal(data.length, 2048)
      t.match(data.slice(512).toString(), /^a\0{511}\0{1024}$/)
      const h = new Header(data)
      const expect = {
        cksumValid: true,
        needPax: false,
        path: 'one-byte.txt',
        mode: 0o100644,
        size: 1,
        mtime: Date,
        cksum: Number,
        linkpath: '',
        ustar: 'ustar',
        ustarver: '00',
        uname: 'isaacs',
        gname: '',
        devmaj: 0,
        devmin: 0,
        ustarPrefix: null,
        xstarPrefix: '',
        prefixTerminator: '',
        atime: Date,
        ctime: Date,
        nullBlock: false,
        type: 'File'
      }
      t.match(h, expect)
      const sync = new PackSync({ cwd: files })
        .add('one-byte.txt').end().read()
      t.equal(sync.slice(512).toString(), data.slice(512).toString())
      const hs = new Header(sync)
      t.match(hs, expect)
      t.end()
    })
})

t.test('pack a dir', t => {
  const out = []

  new Pack({ cwd: files })
    .add('dir')
    .on('data', c => out.push(c))
    .end()
    .on('end', _ => {
      const data = Buffer.concat(out)
      // dir/, dir/x, and the nulls
      // neither the dir or the file have any body bits
      const h = new Header(data)
      const expect = {
        type: 'Directory',
        cksumValid: true,
        needPax: false,
        path: 'dir/',
        mode: 0o040755,
        size: 0,
        mtime: Date,
        cksum: Number,
        linkpath: '',
        ustar: 'ustar',
        ustarver: '00',
        uname: 'isaacs',
        gname: '',
        devmaj: 0,
        devmin: 0,
        ustarPrefix: null,
        xstarPrefix: '',
        prefixTerminator: '',
        atime: Date,
        ctime: Date,
        nullBlock: false
      }
      t.match(h, expect)
      t.equal(data.length, 2048)
      t.match(data.slice(1024).toString(), /^\0{1024}$/)

      const sync = new PackSync({ cwd: files })
        .add('dir').end().read()
      t.equal(sync.slice(512).toString(), data.slice(512).toString())
      const hs = new Header(sync)
      t.match(hs, expect)

      const expect2 = {
        type: 'File',
        cksumValid: true,
        needPax: false,
        path: 'dir/x',
        mode: 0o100644,
        size: 0,
        mtime: Date,
        cksum: Number,
        linkpath: '',
        ustar: 'ustar',
        ustarver: '00',
        uname: 'isaacs',
        gname: '',
        devmaj: 0,
        devmin: 0,
        ustarPrefix: null,
        xstarPrefix: '',
        prefixTerminator: '',
        atime: Date,
        ctime: Date,
        nullBlock: false
      }
      t.match(new Header(data.slice(512)), expect2)
      t.match(new Header(sync.slice(512)), expect2)
      t.end()
    })
})

t.test('use process cwd if cwd not specified', t => {
  const cwd = process.cwd()
  t.tearDown(_ => process.chdir(cwd))
  process.chdir(files)

  const out = []

  new Pack()
    .add('dir')
    .on('data', c => out.push(c))
    .end()
    .on('end', _ => {
      const data = Buffer.concat(out)
      // dir/, dir/x, and the nulls
      // neither the dir or the file have any body bits
      const h = new Header(data)
      const expect = {
        type: 'Directory',
        cksumValid: true,
        needPax: false,
        path: 'dir/',
        mode: 0o040755,
        size: 0,
        mtime: Date,
        cksum: Number,
        linkpath: '',
        ustar: 'ustar',
        ustarver: '00',
        uname: 'isaacs',
        gname: '',
        devmaj: 0,
        devmin: 0,
        ustarPrefix: null,
        xstarPrefix: '',
        prefixTerminator: '',
        atime: Date,
        ctime: Date,
        nullBlock: false
      }
      t.match(h, expect)
      t.equal(data.length, 2048)
      t.match(data.slice(1024).toString(), /^\0{1024}$/)

      const sync = new PackSync({ cwd: files })
        .add('dir').end().read()
      t.equal(sync.slice(512).toString(), data.slice(512).toString())
      const hs = new Header(sync)
      t.match(hs, expect)

      const expect2 = {
        type: 'File',
        cksumValid: true,
        needPax: false,
        path: 'dir/x',
        mode: 0o100644,
        size: 0,
        mtime: Date,
        cksum: Number,
        linkpath: '',
        ustar: 'ustar',
        ustarver: '00',
        uname: 'isaacs',
        gname: '',
        devmaj: 0,
        devmin: 0,
        ustarPrefix: null,
        xstarPrefix: '',
        prefixTerminator: '',
        atime: Date,
        ctime: Date,
        nullBlock: false
      }
      t.match(new Header(data.slice(512)), expect2)
      t.match(new Header(sync.slice(512)), expect2)
      t.end()
    })
})

t.test('filter', t => {
  const out = []
  const filter = (path, stat) => stat.isDirectory()

  // only include directories, so dir/x should not appear
  new Pack({ cwd: files, filter: filter })
    .add('dir')
    .on('data', c => out.push(c))
    .end()
    .on('end', _ => {
      const data = Buffer.concat(out)
      // dir/, dir/x, and the nulls
      // neither the dir or the file have any body bits
      const h = new Header(data)
      const expect = {
        type: 'Directory',
        cksumValid: true,
        needPax: false,
        path: 'dir/',
        mode: 0o040755,
        size: 0,
        mtime: Date,
        cksum: Number,
        linkpath: '',
        ustar: 'ustar',
        ustarver: '00',
        uname: 'isaacs',
        gname: '',
        devmaj: 0,
        devmin: 0,
        ustarPrefix: null,
        xstarPrefix: '',
        prefixTerminator: '',
        atime: Date,
        ctime: Date,
        nullBlock: false
      }
      t.match(h, expect)
      t.equal(data.length, 1536)
      t.match(data.slice(512).toString(), /^\0{1024}$/)

      const sync = new PackSync({ cwd: files, filter: filter })
        .add('dir').end().read()
      t.equal(sync.slice(512).toString(), data.slice(512).toString())
      const hs = new Header(sync)
      t.match(hs, expect)
      t.end()
    })
})

t.test('add the same dir twice (exercise cache code)', t => {
  const out = []
  const filter = (path, stat) => stat.isDirectory()

  // only include directories, so dir/x should not appear
  const pack = new Pack({ cwd: files, filter: filter })
    .add('dir')
    .add('dir')
    .on('data', c => out.push(c))
    .end()
    .on('end', _ => {
      const data = Buffer.concat(out)
      // dir/, dir/x, and the nulls
      // neither the dir or the file have any body bits
      const h = new Header(data)
      const expect = {
        type: 'Directory',
        cksumValid: true,
        needPax: false,
        path: 'dir/',
        mode: 0o040755,
        size: 0,
        mtime: Date,
        cksum: Number,
        linkpath: '',
        ustar: 'ustar',
        ustarver: '00',
        uname: 'isaacs',
        gname: '',
        devmaj: 0,
        devmin: 0,
        ustarPrefix: null,
        xstarPrefix: '',
        prefixTerminator: '',
        atime: Date,
        ctime: Date,
        nullBlock: false
      }
      t.match(h, expect)
      const h2 = new Header(data.slice(512))
      t.match(h2, expect)
      t.equal(data.length, 2048)
      t.match(data.slice(1024).toString(), /^\0{1024}$/)

      const sync = new PackSync({
        cwd: files,
        filter: filter,
        linkCache: pack.linkCache,
        readdirCache: pack.readdirCache,
        statCache: pack.statCache
      })
        .add('dir').add('dir').end().read()
      t.equal(sync.slice(1024).toString(), data.slice(1024).toString())
      const hs = new Header(sync)
      t.match(hs, expect)
      const hs2 = new Header(sync.slice(512))
      t.match(hs2, expect)
      t.end()
    })
})

t.test('gzip, also a very deep path', t => {
  const out = []

  // only include directories, so dir/x should not appear
  const pack = new Pack({
    cwd: files,
    gzip: { flush: 1 }
  })
    .add('dir')
    .add('long-path')
    .on('data', c => out.push(c))
    .end()
    .on('end', _ => {
      const zipped = Buffer.concat(out)
      const data = zlib.unzipSync(zipped)
      const entries = []
      for (var i = 0; i < data.length; i += 512) {
        const slice = data.slice(i, i + 512)
        const h = new Header(slice)
        if (h.nullBlock)
          entries.push('null block')
        else if (h.cksumValid)
          entries.push([h.type, h.path])
        else if (entries[entries.length-1][0] === 'File')
          entries[entries.length-1].push(slice.toString().replace(/\0.*$/, ''))
      }

      const expect = [
        [ 'Directory', 'dir/' ],
        [ 'Directory', 'long-path/' ],
        [ 'File', 'dir/x' ],
        [ 'Directory', 'long-path/r/' ],
        [ 'Directory', 'long-path/r/e/' ],
        [ 'Directory', 'long-path/r/e/a/' ],
        [ 'Directory', 'long-path/r/e/a/l/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/e/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/e/p/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/' ],
        [ 'Directory', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/' ],
        [ 'File', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt', 'short\n' ],
        [ 'File', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' ],
        [ 'ExtendedHeader', 'PaxHeader/ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'],
        [ 'File', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' ],
        [ 'ExtendedHeader', 'PaxHeader/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxccccccccccccccccccccccccccccccccccccccc' ],
        [ 'File', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxccccccccccccccccccccccccccccccccccccccccccccccccc', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' ],
        [ 'ExtendedHeader', 'PaxHeader/Ω.txt' ],
        [ 'File', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt', 'Ω' ],
        'null block',
        'null block'
      ]

      let ok = true
      entries.forEach((entry, i) => {
        ok = ok && t.match(entry, expect[i])
      })

      // t.match(entries, expect)
      t.end()
    })
})
