'use strict'
const t = require('tap')
const Header = require('../lib/header.js')

t.test('basic fieldset', t => {
  // note: basic fieldset doens't support uname, gname, atime, ctime
  const buf = new Buffer(
    '666f6f2e74787400000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000030303037353520003035373736312000303030303234200030303030' +
    '3030303134342000313236373735363735343000303036303736200030000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000',
    'hex')

  const h = new Header({
    fieldset: 'basic',
    path: 'foo.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 100,
    mtime: new Date('2016-04-01T22:00Z'),
    ctime: new Date('2016-04-01T22:00Z'),
    atime: new Date('2016-04-01T22:00Z'),
    type: 'File',
    uname: 'isaacs',
    gname: 'staff'
  })

  t.equal(h.block.toString('hex'), buf.toString('hex'))

  const h2 = new Header(buf)

  t.match(h2, {
    fieldset: h.fieldset,
    path: 'foo.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 100,
    mtime: new Date('2016-04-01T22:00Z'),
    type: 'File',
    atime: null,
    ctime: null,
    uname: null,
    gname: null,
    cksumValid: true,
    cksum: 3134
  })

  t.end()
})

t.test('ustar format', t => {
  const buf = new Buffer(
    '666f6f2e74787400000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000030303037353520003035373736312000303030303234200030303030' +
    '3030303134342000313236373735363735343000303132373235200030000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0075737461720030306973616163730000000000000000000000000000000000' +
    '0000000000000000007374616666000000000000000000000000000000000000' +
    '0000000000000000003030303030302000303030303030200000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000',
    'hex')

  const h = new Header({
    path: 'foo.txt',
    fieldset: 'ustar'
  })
  const slab = Buffer.alloc(1024)
  h.encode({
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 100,
    mtime: new Date('2016-04-01T22:00Z'),
    ctime: new Date('2016-04-01T22:00Z'),
    atime: new Date('2016-04-01T22:00Z'),
    type: 'File',
    uname: 'isaacs',
    gname: 'staff'
  }, slab)

  t.equal(h.block.length, 512)
  t.equal(h.block.toString('hex'), buf.toString('hex'))
  t.equal(slab.toString('hex'), h.block.toString('hex') +
          (new Array(1025).join('0')))

  const h2 = new Header(buf)

  t.match(h2, {
    fieldset: h.fieldset,
    path: 'foo.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 100,
    mtime: new Date('2016-04-01T22:00Z'),
    ctime: null,
    atime: null,
    type: 'File',
    uname: 'isaacs',
    gname: 'staff',
    cksumValid: true,
    cksum: 5589,
    ustar: 'ustar'
  })

  t.end()
})

t.test('xstar format', t => {
  const buf = new Buffer(
    '666f6f2e74787400000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000030303037353520003035373736312000303030303234200030303030' +
    '3030303134342000313236373735363735343000303135313331200030000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0075737461720030306973616163730000000000000000000000000000000000' +
    '0000000000000000007374616666000000000000000000000000000000000000' +
    '0000000000000000003030303030302000303030303030200000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000031323637' +
    '3735363735343000313236373735363735343000000000000000000000000000' +
    // just some junk
    '420420420420420420420420420420420420420420420420420420420420',
    'hex')

  const h = new Header({
    fieldset: 'xstar',
    path: 'foo.txt'
  })

  const slab = Buffer.alloc(512)
  h.encode({
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 100,
    mtime: new Date('2016-04-01T22:00Z'),
    ctime: new Date('2016-04-01T22:00Z'),
    atime: new Date('2016-04-01T22:00Z'),
    type: 'File',
    uname: 'isaacs',
    gname: 'staff'
  }, slab)

  t.equal(h.block, slab)
  t.equal(h.block.toString('hex'), buf.slice(0, 512).toString('hex'))

  const h2 = new Header(buf)

  t.match(h2, {
    fieldset: h.fieldset,
    path: 'foo.txt',
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
    cksumValid: true,
    cksum: 6745,
    ustar: 'ustar'
  })

  t.end()
})

t.test('prefix handling', t => {
  t.plan(5)

  t.test('no times', t => {
    const buf = new Buffer(
      '666f6f2e74787400000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000030303037353520003035373736312000303030303234200030303030' +
      '3030303134342000313236373735363735343000303337323734200030000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0075737461720030306973616163730000000000000000000000000000000000' +
      '0000000000000000007374616666000000000000000000000000000000000000' +
      '00000000000000000030303030303020003030303030302000722f652f612f6c' +
      '2f6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f722f652f612f6c2f6c2f79' +
      '2f2d2f722f652f612f6c2f6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f72' +
      '2f652f612f6c2f6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f722f652f61' +
      '2f6c2f6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f642f652f652f702f2d' +
      '2f702f612f742f68000000000000000000000000000000000000000000000000',
      'hex')

    const h = new Header({
      path: 'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' + 
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-' +
        '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/d/e/e/p/-/p/a/t/h/foo.txt',
      mode: 0o755,
      uid: 24561,
      gid: 20,
      size: 100,
      mtime: new Date('2016-04-01T22:00Z'),
      ctime: null,
      atime: undefined,
      type: '0',
      uname: 'isaacs',
      gname: 'staff'
    })

    t.equal(h.block.toString('hex'), buf.toString('hex'))

    const h2 = new Header(buf)

    t.match(h2, {
      fieldset: h.fieldset,
      path: 'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' + 
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-' +
        '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/d/e/e/p/-/p/a/t/h/foo.txt',
      mode: 0o755,
      uid: 24561,
      gid: 20,
      size: 100,
      mtime: new Date('2016-04-01T22:00Z'),
      ctime: null,
      atime: null,
      type: 'File',
      uname: 'isaacs',
      gname: 'staff',
      cksumValid: true,
      cksum: 16060,
      ustar: 'ustar',
      needPax: false
    })

    t.equal(h2.fieldset.path.read(h2.block), 'foo.txt')
    t.equal(h2.fieldset.ustarPrefix.read(h2.block), 'r/e/a/l/l/y/-' +
            '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-' +
            '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-' +
            '/d/e/e/p/-/p/a/t/h')

    t.end()
  })

  t.test('a/c times', t => {
    const buf = new Buffer(
      '652f702f2d2f702f612f742f682f666f6f2e7478740000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000030303037353520003035373736312000303030303234200030303030' +
      '3030303134342000313236373735363735343000303431353030200030000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0075737461720030306973616163730000000000000000000000000000000000' +
      '0000000000000000007374616666000000000000000000000000000000000000' +
      '00000000000000000030303030303020003030303030302000722f652f612f6c' +
      '2f6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f722f652f612f6c2f6c2f79' +
      '2f2d2f722f652f612f6c2f6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f72' +
      '2f652f612f6c2f6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f722f652f61' +
      '2f6c2f6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f642f65000031323637' +
      '3735363735343000313236373735363735343000000000000000000000000000',
      'hex')

    const h = new Header()
    h.path = 'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-' +
        '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/d/e/e/p/-/p/a/t/h/foo.txt'
    h.mode = 0o755
    h.uid = 24561
    h.gid = 20
    h.size = 100
    h.mtime = new Date('2016-04-01T22:00Z')
    h.ctime = new Date('2016-04-01T22:00Z')
    h.atime = new Date('2016-04-01T22:00Z')
    h.type = '0'
    h.uname = 'isaacs'
    h.gname = 'staff'
    h.encode()

    t.equal(h.block.toString('hex'), buf.toString('hex'))

    const h2 = new Header(buf)

    t.match(h2, {
      fieldset: h.fieldset,
      path: 'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-' +
        '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/d/e/e/p/-/p/a/t/h/foo.txt',
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
      cksumValid: true,
      cksum: 17216,
      ustar: 'ustar',
      needPax: false
    }, 'header from buffer')

    t.equal(h2.fieldset.path.read(h2.block), 'e/p/-/p/a/t/h/foo.txt')
    t.equal(h2.fieldset.xstarPrefix.read(h2.block), 'r/e/a/l/l/y/-' +
            '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-' +
            '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/d/e')

    t.end()
  })

  t.test('force basic fieldset', t => {
    const buf = new Buffer(
      '722f652f612f6c2f6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f722f652f' +
      '612f6c2f6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f722f652f612f6c2f' +
      '6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f722f652f612f6c2f6c2f792f' +
      '2d2f720030303037353520003035373736312000303030303234200030303030' +
      '3030303134342000313236373735363735343000303232373237200030000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000',
      'hex')

    const h = new Header()
    h.path = 'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/d/e/e/p/-/p/a/t/h/foo.txt'
    h.mode = 0o755
    h.uid = 24561
    h.gid = 20
    h.size = 100
    h.mtime = new Date('2016-04-01T22:00Z')
    h.ctime = new Date('2016-04-01T22:00Z')
    h.atime = new Date('2016-04-01T22:00Z')
    h.type = '0'
    h.uname = 'isaacs'
    h.gname = 'staff'
    h.encode({ fieldset: 'basic' })

    t.ok(h.needPax, 'need pax, because no prefix on basic')

    t.equal(h.block.toString('hex'), buf.toString('hex'))

    const h2 = new Header(buf)

    t.match(h2, {
      path: 'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
            'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r',
      mode: 0o755,
      uid: 24561,
      gid: 20,
      size: 100,
      mtime: new Date('2016-04-01T22:00Z'),
      ctime: null,
      atime: null,
      type: 'File',
      uname: null,
      gname: null,
      cksumValid: true,
      cksum: 9687,
      ustar: null,
      needPax: false
    }, 'header from buffer')

    t.equal(h2.fieldset.path.read(h2.block),
            'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
            'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r')

    t.end()
  })

  t.test('hella long basename', t => {
    const buf = new Buffer(
      '6c6f6e672d66696c652d6c6f6e672d66696c652d6c6f6e672d66696c652d6c6f' +
      '6e672d66696c652d6c6f6e672d66696c652d6c6f6e672d66696c652d6c6f6e67' +
      '2d66696c652d6c6f6e672d66696c652d6c6f6e672d66696c652d6c6f6e672d66' +
      '696c650030303037353520003035373736312000303030303234200030303030' +
      '3030303134342000313236373735363735343000303630313431200030000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0075737461720030306973616163730000000000000000000000000000000000' +
      '0000000000000000007374616666000000000000000000000000000000000000' +
      '00000000000000000030303030303020003030303030302000722f652f612f6c' +
      '2f6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f722f652f612f6c2f6c2f79' +
      '2f2d2f722f652f612f6c2f6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f72' +
      '2f652f612f6c2f6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f722f652f61' +
      '2f6c2f6c2f792f2d2f722f652f612f6c2f6c2f792f2d2f642f652f652f702f2d' +
      '2f702f612f742f68000000000000000000000000000000000000000000000000',
      'hex')
    const h = new Header({
      path: 'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' + 
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/d/e/e/p/-/p/a/t/h/' +
        (new Array(20).join('long-file-')) + 'long-file.txt',
      mode: 0o755,
      uid: 24561,
      gid: 20,
      size: 100,
      mtime: new Date('2016-04-01T22:00Z'),
      ctime: null,
      atime: undefined,
      type: '0',
      uname: 'isaacs',
      gname: 'staff'
    })

    t.equal(h.block.toString('hex'), buf.toString('hex'))
    t.ok(h.needPax, 'need pax because long filename')

    const h2 = new Header(buf)

    t.match(h2, {
      fieldset: h.fieldset,
      cksumValid: true,
      cksum: 24673,
      path: 'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/d/e/e/p/-/p/a/t/h/long-file-long-file-long-' +
        'file-long-file-long-file-long-file-long-file-long-file-long-' +
        'file-long-file',
      needPax: false
    })

    t.end()
  })

  t.test('long basename, long dirname', t => {
    const buf = new Buffer(
      '6c6f6e672d6469726e616d652d6c6f6e672d6469726e616d652d6c6f6e672d64' +
      '69726e616d652d6c6f6e672d6469726e616d652d6c6f6e672d6469726e616d65' +
      '2d6c6f6e672d6469726e616d652d6c6f6e672d6469726e616d652d6c6f6e672d' +
      '6469720030303037353520003035373736312000303030303234200030303030' +
      '3030303134342000313236373735363735343000303334323035200030000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0075737461720030306973616163730000000000000000000000000000000000' +
      '0000000000000000007374616666000000000000000000000000000000000000' +
      '0000000000000000003030303030302000303030303030200000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000',
      'hex')
    const h = new Header({
      path: (new Array(30).join('long-dirname-')) + 'long-dirname/' +
        (new Array(20).join('long-file-')) + 'long-file.txt',
      mode: 0o755,
      uid: 24561,
      gid: 20,
      size: 100,
      mtime: new Date('2016-04-01T22:00Z'),
      ctime: null,
      atime: undefined,
      type: '0',
      uname: 'isaacs',
      gname: 'staff'
    })

    t.equal(h.block.toString('hex'), buf.toString('hex'))
    t.equal(h.cksum, 14469)
    t.ok(h.needPax, 'need pax because long filename')

    const h2 = new Header(buf)

    t.match(h2, {
      path: 'long-dirname-long-dirname-long-dirname-long-dirname-' +
        'long-dirname-long-dirname-long-dirname-long-dir',
      cksum: 14469,
      cksumValid: true,
      needPax: false,
      ustarPrefix: ''
    })

    t.end()
  })

})

t.test('throwers', t => {
  t.throws(_ => new Header({ fieldset: 'nope' }),
           new Error('unknown fieldset: nope'))

  t.throws(_ => new Header(Buffer.alloc(100)),
           new Error('need 512 bytes for header, got 100'))

  t.throws(_ => new Header().encode({}, Buffer.alloc(100)),
           new Error('need 512 bytes for header, got 100'))

  t.throws(_ => new Header({ type: 'XYZ' }),
           new Error('unknown type: XYZ'))

  t.throws(_ => new Header({ type: 'File', linkpath: 'xyz' }),
           new Error('linkpath not allowed for type File'))

  t.throws(_ => new Header({ type: 'Link' }),
           new Error('linkpath required for type Link'))

  t.end()
})
