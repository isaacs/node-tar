'use strict'
const t = require('tap')
const Pack = require('../lib/pack.js')
const PackSync = Pack.Sync
const fs = require('fs')
const path = require('path')
const fixtures = path.resolve(__dirname, 'fixtures')
const files = path.resolve(fixtures, 'files')
const parse = path.resolve(fixtures, 'parse')
const tars = path.resolve(fixtures, 'tars')
const chmodr = require('chmodr')
const Header = require('../lib/header.js')
const zlib = require('zlib')
const miniz = require('minizlib')
const mutateFS = require('mutate-fs')
const MiniPass = require('minipass')
process.env.USER = 'isaacs'
const EE = require('events').EventEmitter
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const ReadEntry = require('../lib/read-entry.js')

const ctime = new Date('2017-05-10T01:03:12.000Z')
const atime = new Date('2017-04-17T00:00:00.000Z')
const mtime = new Date('2016-04-01T19:00:00.000Z')

t.teardown(mutateFS.statMutate((er, st) => {
  if (st) {
    st.ctime = ctime
    st.atime = atime
    st.mtime = mtime
  }
}))

t.test('set up', t => {
  const one = fs.statSync(files + '/hardlink-1')
  const two = fs.statSync(files + '/hardlink-2')
  if (one.dev !== two.dev || one.ino !== two.ino) {
    try { fs.unlinkSync(files + '/hardlink-2') } catch (e) {}
    fs.linkSync(files + '/hardlink-1', files + '/hardlink-2')
  }
  chmodr.sync(files, 0o644)
  t.end()
})

t.test('pack a file', t => {
  const out = []
  new Pack({ cwd: files })
    .end('one-byte.txt')
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
        mode: 0o644,
        size: 1,
        mtime: mtime,
        cksum: Number,
        linkpath: '',
        uname: 'isaacs',
        gname: '',
        devmaj: 0,
        devmin: 0,
        atime: atime,
        ctime: ctime,
        nullBlock: false,
        type: 'File'
      }
      t.match(h, expect) || console.log(h, expect)
      const ps = new PackSync({ cwd: files })
      const sout = []
      ps.on('data', chunk => sout.push(chunk))
      ps.add('one-byte.txt').end()
      const sync = Buffer.concat(sout)
      if (sync.length === 0)
        throw new Error('no data!')

      t.equal(sync.slice(512).toString(), data.slice(512).toString())
      const hs = new Header(sync)
      t.match(hs, expect)
      t.end()
    })
})

t.test('pack a file with a prefix', t => {
  const out = []
  new Pack({ cwd: files, prefix: 'package/' })
    .end('.dotfile')
    .on('data', c => out.push(c))
    .on('end', _ => {
      const data = Buffer.concat(out)
      t.equal(data.length, 2048)
      t.match(data.slice(512).toString(), /^.\n\0{510}\0{1024}$/)
      const h = new Header(data)
      const expect = {
        cksumValid: true,
        needPax: false,
        path: 'package/.dotfile',
        mode: 0o644,
        size: 2,
        mtime: mtime,
        cksum: Number,
        linkpath: '',
        uname: 'isaacs',
        gname: '',
        devmaj: 0,
        devmin: 0,
        atime: atime,
        ctime: ctime,
        nullBlock: false,
        type: 'File'
      }
      t.match(h, expect)
      const sync = new PackSync({ cwd: files, prefix: 'package' })
        .add('.dotfile').end().read()
      t.equal(sync.slice(512).toString(), data.slice(512).toString())
      const hs = new Header(sync)
      t.match(hs, expect)
      t.end()
    })
})

t.test('pack a dir', t => {
  const out = []

  new Pack({ cwd: files, portable: true })
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
        mode: 0o755,
        size: 0,
        mtime: null,
        cksum: Number,
        linkpath: '',
        uname: '',
        gname: '',
        devmaj: 0,
        devmin: 0,
        atime: null,
        ctime: null,
        nullBlock: false
      }
      t.match(h, expect)
      t.equal(data.length, 2048)
      t.match(data.slice(1024).toString(), /^\0{1024}$/)

      const sync = new PackSync({ cwd: files, portable: true })
        .add('dir').end().read()
      t.equal(sync.slice(512).toString(), data.slice(512).toString())
      const hs = new Header(sync)
      t.match(hs, expect)

      const expect2 = {
        type: 'File',
        cksumValid: true,
        needPax: false,
        path: 'dir/x',
        mode: 0o644,
        size: 0,
        mtime: mtime,
        cksum: Number,
        linkpath: '',
        uname: '',
        gname: '',
        devmaj: 0,
        devmin: 0,
        atime: null,
        ctime: null,
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
        mode: 0o755,
        size: 0,
        mtime: mtime,
        cksum: Number,
        linkpath: '',
        uname: 'isaacs',
        gname: '',
        devmaj: 0,
        devmin: 0,
        atime: atime,
        ctime: ctime,
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
        mode: 0o644,
        size: 0,
        mtime: mtime,
        cksum: Number,
        linkpath: '',
        uname: 'isaacs',
        gname: '',
        devmaj: 0,
        devmin: 0,
        atime: atime,
        ctime: ctime,
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
        mode: 0o755,
        size: 0,
        mtime: mtime,
        cksum: Number,
        linkpath: '',
        uname: 'isaacs',
        gname: '',
        devmaj: 0,
        devmin: 0,
        atime: atime,
        ctime: ctime,
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
        mode: 0o755,
        size: 0,
        mtime: mtime,
        cksum: Number,
        linkpath: '',
        uname: 'isaacs',
        gname: '',
        devmaj: 0,
        devmin: 0,
        atime: atime,
        ctime: ctime,
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

t.test('if gzip is truthy, make it an object', t => {
  const opt = { gzip: true }
  const pack = new Pack(opt)
  t.isa(opt.gzip, 'object')
  t.end()
})

t.test('gzip, also a very deep path', t => {
  const out = []

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
        [ 'File', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', '1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111' ],
        [ 'ExtendedHeader', 'PaxHeader/ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'],
        [ 'File', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', '2222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222' ],
        [ 'ExtendedHeader', 'PaxHeader/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxccccccccccccccccccccccccccccccccccccccc' ],
        [ 'File', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxccccccccccccccccccccccccccccccccccccccccccccccccc', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' ],
        [ 'ExtendedHeader', 'PaxHeader/Ω.txt' ],
        [ 'File', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt', 'Ω' ],
        'null block',
        'null block'
      ]

      let ok = true
      entries.forEach((entry, i) => {
        ok = ok &&
          t.equal(entry[0], expect[i][0]) &&
          t.equal(entry[1], expect[i][1]) &&
          (!entry[2] || t.equal(entry[2], expect[i][2]))
      })

      // t.match(entries, expect)
      t.end()
    })
})

t.test('very deep gzip path, sync', t => {
  const out = []

  const pack = new PackSync({
    cwd: files,
    gzip: true
  }).add('dir')
    .add('long-path')
    .end()

  // these do nothing!
  pack.pause()
  pack.resume()

  const zipped = pack.read()
  t.isa(zipped, Buffer)
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
    [ 'File', 'dir/x' ],
    [ 'Directory', 'long-path/' ],
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
    [ 'File', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', '1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111' ],
    [ 'ExtendedHeader', 'PaxHeader/ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'],
    [ 'File', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', '2222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222' ],
    [ 'ExtendedHeader', 'PaxHeader/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxccccccccccccccccccccccccccccccccccccccc' ],
    [ 'File', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxccccccccccccccccccccccccccccccccccccccccccccccccc', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' ],
    [ 'ExtendedHeader', 'PaxHeader/Ω.txt' ],
    [ 'File', 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt', 'Ω' ],
    'null block',
    'null block'
  ]

  let ok = true
  entries.forEach((entry, i) => {
    ok = ok &&
      t.equal(entry[0], expect[i][0]) &&
      t.equal(entry[1], expect[i][1]) &&
      (!entry[2] || t.equal(entry[2], expect[i][2]))
  })

  // t.match(entries, expect)
  t.end()
})

t.test('write after end', t => {
  const p = new Pack()
  p.end()
  t.throws(_ => p.add('nope'), new Error('write after end'))
  t.end()
})

t.test('emit error when stat fail', t => {
  t.tearDown(mutateFS.statFail(new Error('xyz')))
  t.throws(_ => new PackSync({ cwd: files }).add('one-byte.txt'),
           new Error('xyz'))

  const p = new Pack({ cwd: files }).add('one-byte.txt').on('error', e => {
    t.match(e, { message: 'xyz' })
    t.end()
  })
})

t.test('readdir fail', t => {
  t.tearDown(mutateFS.fail('readdir', new Error('xyz')))
  t.throws(_ => new PackSync({ cwd: files }).add('dir'), new Error('xyz'))

  const p = new Pack({ cwd: files }).add('dir').on('error', e => {
    t.match(e, { message: 'xyz' })
    t.end()
  })
})

t.test('pipe into a slow reader', t => {
  const out = []
  const mp = new MiniPass()
  const mp2 = new MiniPass()
  const p = new Pack({ cwd: files }).add('long-path').end()
  p.pause()
  p.pipe(mp).pipe(mp2)
  setTimeout(_ => {
    mp2.on('data', c => out.push(c))
    setTimeout(_ => p.resume(), 100)
  }, 100)
  mp.on('end', _ => {
    const data = Buffer.concat(out)
    const h = new Header(data)
    const expect = {
      type: 'Directory',
      cksumValid: true,
      needPax: false,
      path: 'long-path/',
      mode: 0o755,
      size: 0,
      mtime: mtime,
      cksum: Number,
      linkpath: '',
      uname: 'isaacs',
      gname: '',
      devmaj: 0,
      devmin: 0,
      atime: atime,
      ctime: ctime,
      nullBlock: false
    }
    t.match(h, expect)
    t.equal(data.length, 21504)
    t.match(data.slice(data.length - 1024).toString(), /^\0{1024}$/)
    t.end()
  })
})

t.test('pipe into a slow gzip reader', t => {
  const out = []
  const mp2 = new miniz.Unzip()
  const p = new Pack({ cwd: files, gzip: true }).add('long-path').end()
  p.pause()

  class SlowStream extends EE {
    write (chunk) {
      mp2.write(chunk)
      setTimeout(_ => {
        this.emit('drain')
        p.resume()
      })
      return false
    }
    end (chunk) {
      return mp2.end(chunk)
    }
  }
  const ss = new SlowStream()

  setTimeout(_=> {
    p.pipe(ss)
    p.resume()
  })

  mp2.on('data', c => out.push(c))
  mp2.on('end', _ => {
    t.pass('mp2 end')
    const data = Buffer.concat(out)
    // dir/, dir/x, and the nulls
    // neither the dir or the file have any body bits
    const h = new Header(data)
    const expect = {
      type: 'Directory',
      cksumValid: true,
      needPax: false,
      path: 'long-path/',
      mode: 0o755,
      size: 0,
      mtime: mtime,
      cksum: Number,
      linkpath: '',
      uname: 'isaacs',
      gname: '',
      devmaj: 0,
      devmin: 0,
      atime: atime,
      ctime: ctime,
      nullBlock: false
    }
    t.match(h, expect)
    t.equal(data.length, 21504)
    t.match(data.slice(data.length - 1024).toString(), /^\0{1024}$/)
    t.end()
  })
})

t.test('ignores mid-queue', t => {
  // we let the first one through, and then ignore all the others
  // so that we trigger the case where an ignored entry is not the
  // head of the queue.
  let didFirst = false
  const p = new Pack({
    cwd: tars,
    filter: (p, st) => {
      if (p === './')
        return true
      if (!didFirst)
        return didFirst = true
      return false
    }
  })

  const out = []
  const files = fs.readdirSync(tars)

  p.on('data', c => out.push(c))
  p.on('end', _ => {
    const data = Buffer.concat(out)
    t.equal(data.slice(0, 100).toString().replace(/\0.*$/, ''), './')
    const file = data.slice(512, 612).toString().replace(/\0.*$/, '')
    t.notequal(files.indexOf(file), -1)
    t.end()
  })

  p.add('')
  p.end()
})

t.test('warnings', t => {
  const f = path.resolve(files, '512-bytes.txt')
  t.test('preservePaths=false strict=false', t => {
    const warnings = []
    const p = new Pack({
      cwd: files,
      onwarn: (m, p) => warnings.push([m, p])
    }).end(f).on('data', c => out.push(c))

    const out = []
    p.on('end', _ => {
      const data = Buffer.concat(out)
      t.equal(data.length, 2048)
      t.match(warnings, [[
        /stripping .* from absolute path/, f
      ]])

      t.match(new Header(data), {
        path: f.replace(/^(\/|[a-z]:\\\\)/, '')
      })
      t.end()
    })
  })

  t.test('preservePaths=true', t => {
    t.plan(2)
    // with preservePaths, strictness doens't matter
    ;[true, false].forEach(strict => {

      t.test('strict=' + strict, t => {
        const warnings = []
        const out = []
        const p = new Pack({
          cwd: files,
          strict: strict,
          preservePaths: true,
          onwarn: (m, p) => warnings.push([m, p])
        }).end(f).on('data', c => out.push(c))
        p.on('end', _ => {
          const data = Buffer.concat(out)
          t.equal(warnings.length, 0)

          t.match(new Header(data), {
            path: f
          })
          t.end()
        })
      })
    })
  })

  t.test('preservePaths=false strict=true', t => {
    new Pack({
      strict: true,
      cwd: files
    }).end(f).on('error', e => {
      t.match(e, { message: /stripping .* from absolute path/, data: f })
      t.end()
    })
  })

  t.end()
})

t.test('no dir recurse', t => {
  const dir = path.resolve(fixtures, 'pack-no-dir-recurse')
  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir + '/x')
    fs.writeFileSync(dir + '/x/y', 'y')
    cb()
  })

  const check = (t, data) => {
    t.equal(data.length, 512 + 1024)
    t.equal(data.slice(512).toString(), new Array(1025).join('\0'))
    t.match(new Header(data), {
      type: 'Directory',
      path: 'x/',
      size: 0
    })
    t.end()
  }

  t.test('async', t => {
    const p = new Pack({
      cwd: dir,
      noDirRecurse: true
    })

    const out = []
    p.end('x')
      .on('data', c => out.push(c))
      .on('end', _ => check(t, Buffer.concat(out)))
  })

  t.test('sync', t => {
    const p = new Pack.Sync({
      cwd: dir,
      noDirRecurse: true
    })

    p.end('x')
    check(t, p.read())
  })

  t.end()
})

t.test('follow', t => {
  const check = (out, t) => {
    const data = Buffer.concat(out)
    t.equal(data.length, 2048)
    t.match(new Header(data, 0), {
      type: 'File',
      cksumValid: true,
      needPax: false,
      path: 'symlink',
      mode: 0o644,
      size: 26
    })
    t.match(data.slice(512).toString(), /this link is like diamond\n\0+$/)
    t.end()
  }

  t.test('async', t => {
    const out = []
    const p = new Pack({ cwd: files, follow: true })
    p.on('data', c => out.push(c))
    p.on('end', _ => check(out, t))
    p.end('symlink')
  })

  t.test('sync', t => {
    const out = []
    const p = new Pack.Sync({ cwd: files, follow: true })
    p.on('data', c => out.push(c))
    p.end('symlink')
    check(out, t)
  })

  t.end()
})

t.test('pack ReadEntries', t => {
  t.test('basic', t => {
    const readEntry = new ReadEntry(new Header({
      path: 'x',
      type: 'File',
      size: 1
    }))
    const p = new Pack()
    p.end(readEntry)
    const out = []
    p.on('data', c => out.push(c))
    p.on('end', _ => {
      const data = Buffer.concat(out)
      t.equal(data.length, 2048)
      t.match(data.slice(1024).toString(), /^\0+$/)
      t.equal(data.slice(0, 100).toString().replace(/\0.*$/, ''), 'x')
      t.equal(data.slice(512, 514).toString(), 'x\0')
      t.end()
    })
    const buf = Buffer.alloc(512)
    buf.write('x')
    readEntry.end(buf)
  })

  t.test('prefix', t => {
    const readEntry = new ReadEntry(new Header({
      path: 'x',
      type: 'File',
      size: 1
    }))
    const p = new Pack({ prefix: 'y' })
    p.end(readEntry)
    const out = []
    p.on('data', c => out.push(c))
    p.on('end', _ => {
      const data = Buffer.concat(out)
      t.equal(data.length, 2048)
      t.match(data.slice(1024).toString(), /^\0+$/)
      t.equal(data.slice(0, 100).toString().replace(/\0.*$/, ''), 'y/x')
      t.equal(data.slice(512, 514).toString(), 'x\0')
      t.end()
    })
    const buf = Buffer.alloc(512)
    buf.write('x')
    readEntry.end(buf)
  })

  t.test('filter out', t => {
    const re1 = new ReadEntry(new Header({
      path: 'a',
      type: 'File',
      size: 1
    }))
    const re2 = new ReadEntry(new Header({
      path: 'x',
      type: 'File',
      size: 1
    }))
    const re3 = new ReadEntry(new Header({
      path: 'y',
      type: 'File',
      size: 1
    }))
    const p = new Pack({ filter: p => p === 'x' })
    p.add(re1)
    p.add(re2)
    p.end(re3)
    const out = []
    p.on('data', c => out.push(c))
    p.on('end', _ => {
      const data = Buffer.concat(out)
      t.equal(data.length, 2048)
      t.match(data.slice(1024).toString(), /^\0+$/)
      t.equal(data.slice(0, 100).toString().replace(/\0.*$/, ''), 'x')
      t.equal(data.slice(512, 514).toString(), 'x\0')
      t.end()
    })
    {
      const buf = Buffer.alloc(512)
      buf.write('x')
      re1.end(buf)
    }
    {
      const buf = Buffer.alloc(512)
      buf.write('x')
      re2.end(buf)
    }
    {
      const buf = Buffer.alloc(512)
      buf.write('x')
      re3.end(buf)
    }
  })

  t.end()
})

t.test('filter out everything', t => {
  const filter = _ => false

  const check = (out, t) => {
    const data = Buffer.concat(out)
    t.equal(data.length, 1024)
    t.match(data.toString(), /^\0+$/)
    t.end()
  }

  t.test('sync', t => {
    const out = []
    const p = new Pack.Sync({ cwd: files, filter: filter })
    p.on('data', c => out.push(c))
    p.end('./')
    check(out, t)
  })

  t.test('async', t => {
    const out = []
    const p = new Pack.Sync({ cwd: files, filter: filter })
    p.on('data', c => out.push(c))
    p.on('end', _ => check(out, t))
    p.end('./')
  })

  t.end()
})

t.test('fs.open fails', t => {
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('open', poop))

  t.test('async', t => {
    t.plan(1)
    const p = new Pack({ cwd: files })
      .on('error', er => t.equal(er, poop))
      .end('one-byte.txt')
  })

  t.test('sync', t => {
    t.plan(1)
    t.throws(_ =>
      new Pack.Sync({ cwd: files }).end('one-byte.txt'), poop)
  })

  t.end()
})

const write = opts => new Promise((resolve, reject) => {
  const p = new Pack()
  let totalSize = 0
  p.on('data', d => totalSize += d.length)
  p.once('error', reject)
  p.once('end', () => resolve(totalSize))

  const file1 = new ReadEntry(new Header({
    path: 'file1.txt',
    size: 5,
  }))
  if (opts.before) {
    file1.end('file1')
    p.add(file1)
  } else {
    p.add(file1)
    file1.end('file1')
  }

  p.end()
})

t.test('padding works regardless of arite/add order', t =>
  Promise.all([
    write({ before: true }),
    write({ before: false })
  ]).then(res =>
    t.is(res[0], res[1], 'length is the same regardless of write/add order')))

t.test('prefix and subdirs', t => {
  const dir = path.resolve(fixtures, 'pack-prefix-subdirs')
  t.teardown(_ => rimraf.sync(dir))
  mkdirp.sync(dir + '/in/a/b/c')
  fs.writeFileSync(dir + '/in/a/b/c/d', 'ddd')
  fs.writeFileSync(dir + '/in/a/b/d', 'ddd')
  fs.writeFileSync(dir + '/in/a/d', 'ddd')
  fs.writeFileSync(dir + '/in/d', 'ddd')

  const expect = [
    'out/x/\0',
    'out/x/a/\0',
    'out/x/d\0',
    'ddd\0',
    'out/x/a/b/\0',
    'out/x/a/d\0',
    'ddd\0',
    'out/x/a/b/c/\0',
    'out/x/a/b/d\0',
    'ddd\0',
    'out/x/a/b/c/d\0',
    'ddd\0',
    '\0',
    '\0'
  ]

  const check = (out, t) => {
    const data = Buffer.concat(out)
    expect.forEach((e, i) =>
      t.equal(e, data.slice(i * 512, i * 512 + e.length).toString()))
    t.end()
  }

  const runTest = (t, path, Class) => {
    const p = new Class({
      cwd: dir + '/in',
      prefix: 'out/x'
    })
    const out = []
    p.on('data', d => out.push(d))
    p.on('end', _ => check(out, t))
    p.end(path)
  }

  t.test('async', t => {
    t.test('.', t => runTest(t, '.', Pack))
    return t.test('./', t => runTest(t, './', Pack))
  })

  return t.test('sync', t => {
    t.test('.', t => runTest(t, '.', Pack.Sync))
    return t.test('./', t => runTest(t, './', Pack.Sync))
  })
})
