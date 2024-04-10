import t from 'tap'
import { ReadEntry } from '../dist/esm/read-entry.js'
import { Header } from '../dist/esm/header.js'

t.test('create read entry', t => {
  const h = new Header({
    path: 'oof.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 100,
    mtime: new Date('2016-04-01T22:00Z'),
    ctime: new Date('2016-04-01T22:00Z'),
    atime: new Date('2016-04-01T22:00Z'),
    type: 'File',
    uname: 'isaacs',
    gname: 'staff',
  })
  h.encode()

  const entry = new ReadEntry(
    h,
    { x: 'y', path: 'foo.txt' },
    { z: 0, a: null, b: undefined },
  )

  t.ok(entry.header.cksumValid, 'header checksum should be valid')

  t.match(entry, {
    extended: { x: 'y', path: 'foo.txt' },
    globalExtended: { z: 0, a: null, b: undefined },
    header: {
      cksumValid: true,
      needPax: false,
      path: 'oof.txt',
      mode: 0o755,
      uid: 24561,
      gid: 20,
      size: 100,
      mtime: new Date('2016-04-01T22:00:00.000Z'),
      typeKey: '0',
      type: 'File',
      linkpath: null,
      uname: 'isaacs',
      gname: 'staff',
      devmaj: 0,
      devmin: 0,
      atime: new Date('2016-04-01T22:00:00.000Z'),
      ctime: new Date('2016-04-01T22:00:00.000Z'),
    },
    blockRemain: 512,
    remain: 100,
    type: 'File',
    meta: false,
    ignore: false,
    path: 'foo.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    uname: 'isaacs',
    gname: 'staff',
    size: 100,
    mtime: new Date('2016-04-01T22:00:00.000Z'),
    atime: new Date('2016-04-01T22:00:00.000Z'),
    ctime: new Date('2016-04-01T22:00:00.000Z'),
    linkpath: null,
    x: 'y',
    z: 0,
  })

  let data = ''
  let ended = false
  entry.on('data', c => (data += c))
  entry.on('end', _ => (ended = true))

  const body = Buffer.alloc(512)
  body.write(new Array(101).join('z'), 0)
  entry.write(body)
  entry.end()

  t.equal(data, new Array(101).join('z'))
  t.ok(ended, 'saw end event')

  t.end()
})

t.test('entry with extended linkpath', t => {
  const h = new Header({
    path: 'oof.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 0,
    mtime: new Date('2016-04-01T22:00Z'),
    ctime: new Date('2016-04-01T22:00Z'),
    atime: new Date('2016-04-01T22:00Z'),
    type: 'SymbolicLink',
    uname: 'isaacs',
    gname: 'staff',
  })
  h.encode()

  const entry = new ReadEntry(
    h,
    { x: 'y', linkpath: 'bar.txt', path: 'foo.txt' },
    { z: 0, a: null, b: undefined },
  )

  t.ok(entry.header.cksumValid, 'header checksum should be valid')

  t.match(entry, {
    extended: { x: 'y', path: 'foo.txt', linkpath: 'bar.txt' },
    globalExtended: { z: 0, a: null, b: undefined },
    header: {
      cksumValid: true,
      needPax: false,
      path: 'oof.txt',
      mode: 0o755,
      uid: 24561,
      gid: 20,
      size: 0,
      mtime: new Date('2016-04-01T22:00:00.000Z'),
      typeKey: '2',
      type: 'SymbolicLink',
      linkpath: null,
      uname: 'isaacs',
      gname: 'staff',
      devmaj: 0,
      devmin: 0,
      atime: new Date('2016-04-01T22:00:00.000Z'),
      ctime: new Date('2016-04-01T22:00:00.000Z'),
    },
    blockRemain: 0,
    remain: 0,
    type: 'SymbolicLink',
    meta: false,
    ignore: false,
    path: 'foo.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    uname: 'isaacs',
    gname: 'staff',
    size: 0,
    mtime: new Date('2016-04-01T22:00:00.000Z'),
    atime: new Date('2016-04-01T22:00:00.000Z'),
    ctime: new Date('2016-04-01T22:00:00.000Z'),
    linkpath: 'bar.txt',
    x: 'y',
    z: 0,
  })

  let data = ''
  entry.on('data', c => (data += c))

  const body = Buffer.alloc(512)
  body.write(new Array(101).join('z'), 0)
  t.throws(() => entry.write(body))
  entry.end()

  t.equal(data, '')

  t.end()
})

t.test('meta entry', t => {
  const h = new Header({
    path: 'PaxHeader/foo.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 23,
    mtime: new Date('2016-04-01T22:00Z'),
    ctime: new Date('2016-04-01T22:00Z'),
    atime: new Date('2016-04-01T22:00Z'),
    type: 'NextFileHasLongLinkpath',
    uname: 'isaacs',
    gname: 'staff',
  })
  const body = Buffer.alloc(512)
  body.write('not that long, actually')

  const expect = 'not that long, actually'
  let actual = ''

  const entry = new ReadEntry(h)
  entry.on('data', c => (actual += c))

  entry.write(body.subarray(0, 1))
  entry.write(body.subarray(1, 25))
  entry.write(body.subarray(25))
  t.throws(_ => entry.write(Buffer.alloc(1024)))

  t.equal(actual, expect)
  t.match(entry, { meta: true, type: 'NextFileHasLongLinkpath' })
  t.end()
})

t.test('unknown entry type', t => {
  const h = new Header({
    path: 'PaxHeader/foo.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 23,
    mtime: new Date('2016-04-01T22:00Z'),
    ctime: new Date('2016-04-01T22:00Z'),
    atime: new Date('2016-04-01T22:00Z'),
    uname: 'isaacs',
    gname: 'staff',
  })
  h.encode()
  // this triggers its type to be Unsupported, which means that any
  // data written to it will be thrown away.
  h.block.write('9', 156, 1, 'ascii')

  const body = Buffer.alloc(512)
  body.write('not that long, actually')

  const expect = ''
  let actual = ''

  const entry = new ReadEntry(new Header(h.block))

  entry.on('data', c => (actual += c))

  entry.write(body.subarray(0, 1))
  entry.write(body.subarray(1, 25))
  entry.write(body.subarray(25))
  t.throws(() => entry.write(Buffer.alloc(1024)))

  t.equal(actual, expect)
  t.match(entry, { ignore: true })
  t.end()
})

t.test('entry without mode', t => {
  const h = new Header({
    path: 'foo.txt',
    uid: 24561,
    gid: 20,
    size: 100,
    mtime: new Date('2016-04-01T22:00Z'),
    ctime: new Date('2016-04-01T22:00Z'),
    atime: new Date('2016-04-01T22:00Z'),
    type: 'File',
    uname: 'isaacs',
    gname: 'staff',
  })
  h.encode()

  const entry = new ReadEntry(h)

  t.ok(entry.header.cksumValid, 'header checksum should be valid')

  t.match(entry, {
    header: {
      cksumValid: true,
      needPax: false,
      path: 'foo.txt',
      mode: null,
      uid: 24561,
      gid: 20,
      size: 100,
      mtime: new Date('2016-04-01T22:00:00.000Z'),
      typeKey: '0',
      type: 'File',
      linkpath: null,
      uname: 'isaacs',
      gname: 'staff',
      devmaj: 0,
      devmin: 0,
      atime: new Date('2016-04-01T22:00:00.000Z'),
      ctime: new Date('2016-04-01T22:00:00.000Z'),
    },
    blockRemain: 512,
    remain: 100,
    type: 'File',
    meta: false,
    ignore: false,
    path: 'foo.txt',
    mode: null,
    uid: 24561,
    gid: 20,
    uname: 'isaacs',
    gname: 'staff',
    size: 100,
    mtime: new Date('2016-04-01T22:00:00.000Z'),
    atime: new Date('2016-04-01T22:00:00.000Z'),
    ctime: new Date('2016-04-01T22:00:00.000Z'),
    linkpath: null,
  })

  let data = ''
  let ended = false
  entry.on('data', c => (data += c))
  entry.on('end', _ => (ended = true))

  const body = Buffer.alloc(512)
  body.write(new Array(101).join('z'), 0)
  entry.write(body)
  entry.end()

  t.equal(data, new Array(101).join('z'))
  t.ok(ended, 'saw end event')

  t.end()
})
