import { assert, describe, test } from 'ubqtest'
import { Header } from '../src/header.js'
import { name } from '../src/types.js'

test('ustar format', () => {
  const buf = Buffer.from(
    '666f6f2e74787400000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000030303037353520003035373736312000303030303234200037373737' +
      '3737373737373700313236373735363735343000303133303531200030000000' +
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
    'hex',
  )

  const h = new Header({
    path: 'foo.txt',
  })
  const slab = Buffer.alloc(1024)
  Object.assign(h, {
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 0o77777777777,
    mtime: new Date('2016-04-01T22:00Z'),
    type: 'File',
    uname: 'isaacs',
    gname: 'staff',
  })
  h.encode(slab)

  assert.equal(slab.subarray(0, 512).toString('hex'), buf.toString('hex'))
  assert.equal(
    slab.toString('hex'),
    buf.toString('hex') + new Array(1025).join('0'),
  )

  const h2 = new Header(buf)

  assert.match(h2, {
    path: 'foo.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 0o77777777777,
    ctime: undefined,
    atime: undefined,
    uname: 'isaacs',
    gname: 'staff',
    cksumValid: true,
    cksum: 5673,
  })
})

test('xstar format', () => {
  const buf = Buffer.from(
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
    'hex',
  )

  const h = new Header({
    path: 'foo.txt',
  })

  Object.assign(h, {
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
  const slab = h.block

  assert.deepEqual(slab, new Uint8Array(buf.subarray(0, 512)))

  const h2 = new Header(buf)

  assert.match(h2, {
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
  })
})

describe('prefix handling', () => {
  test('no times', () => {
    const buf = Buffer.from(
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
      'hex',
    )

    const h = new Header({
      path:
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-' +
        '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/d/e/e/p/-/p/a/t/h/foo.txt',
      mode: 0o755,
      uid: 24561,
      gid: 20,
      size: 100,
      mtime: new Date('2016-04-01T22:00Z'),
      ctime: undefined,
      atime: undefined,
      type: '0',
      uname: 'isaacs',
      gname: 'staff',
    })
    const b2 = Buffer.alloc(512)
    h.encode(b2, 0)

    assert.equal(
      b2.toString().replace(/\0+/g, ' '),
      buf.toString().replace(/\0+/g, ' '),
    )
    assert.equal(b2.toString('hex'), buf.toString('hex'))

    const h2 = new Header(buf)

    assert.match(h2, {
      path:
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-' +
        '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/d/e/e/p/-/p/a/t/h/foo.txt',
      mode: 0o755,
      uid: 24561,
      gid: 20,
      size: 100,
      mtime: new Date('2016-04-01T22:00Z'),
      ctime: undefined,
      atime: undefined,
      type: 'File',
      uname: 'isaacs',
      gname: 'staff',
      cksumValid: true,
      cksum: 16060,
      needPax: false,
    })

    assert.equal(b2.toString().replace(/\0.*$/, ''), 'foo.txt')
    assert.equal(
      b2.subarray(345).toString().replace(/\0.*$/, ''),
      'r/e/a/l/l/y/-' +
        '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-' +
        '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-' +
        '/d/e/e/p/-/p/a/t/h',
    )
  })

  test('a/c times, use shorter prefix field', () => {
    const buf = Buffer.from(
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
      'hex',
    )

    const h = new Header()
    h.path =
      'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
      'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-' +
      '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/d/e/e/p/-/p/a/t/h/foo.txt'
    h.mode = 0o755
    h.uid = 24561
    h.gid = 20
    h.size = 100
    h.mtime = new Date('2016-04-01T22:00Z')
    h.ctime = new Date('2016-04-01T22:00Z')
    h.atime = new Date('2016-04-01T22:00Z')
    h.type = 'File'
    h.uname = 'isaacs'
    h.gname = 'staff'
    const b2 = Buffer.alloc(512)
    h.encode(b2, 0)

    assert.equal(b2.toString('hex'), buf.toString('hex'))

    const b3 = Buffer.alloc(1024)
    h.encode(b3, 100)
    assert.equal(b2.toString('hex'), b3.subarray(100, 612).toString('hex'))

    const h2 = new Header(b3, 100)

    assert.match(
      h2,
      {
        path:
          'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
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
        needPax: false,
      },
      'header from buffer',
    )

    assert.equal(
      b2.toString().replace(/\0.*$/, ''),
      'e/p/-/p/a/t/h/foo.txt',
    )
    assert.equal(
      b2.subarray(345).toString().replace(/\0.*$/, ''),
      'r/e/a/l/l/y/-' +
        '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-' +
        '/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/d/e',
    )
  })

  test('hella long basename', () => {
    const buf = Buffer.from(
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
      'hex',
    )
    const h = new Header({
      path:
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/d/e/e/p/-/p/a/t/h/' +
        new Array(20).join('long-file-') +
        'long-file.txt',
      mode: 0o755,
      uid: 24561,
      gid: 20,
      size: 100,
      mtime: new Date('2016-04-01T22:00Z'),
      ctime: undefined,
      atime: undefined,
      type: '0',
      uname: 'isaacs',
      gname: 'staff',
    })
    const b2 = Buffer.alloc(513)
    h.encode(b2, 1)

    assert.equal(b2.toString('hex'), '00' + buf.toString('hex'))
    assert(h.needPax, 'need pax because long filename')

    const h2 = new Header(b2, 1)

    assert.match(h2, {
      cksumValid: true,
      cksum: 24673,
      path:
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/r/e/a/l/l/y/-/' +
        'r/e/a/l/l/y/-/d/e/e/p/-/p/a/t/h/long-file-long-file-long-' +
        'file-long-file-long-file-long-file-long-file-long-file-long-' +
        'file-long-file',
      needPax: false,
    })
  })

  test('long basename, long dirname', () => {
    const buf = Buffer.from(
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
      'hex',
    )

    const h = new Header({
      path:
        new Array(30).join('long-dirname-') +
        'long-dirname/' +
        new Array(20).join('long-file-') +
        'long-file.txt',
      mode: 0o755,
      uid: 24561,
      gid: 20,
      size: 100,
      mtime: new Date('2016-04-01T22:00Z'),
      ctime: undefined,
      atime: undefined,
      type: '0',
      uname: 'isaacs',
      gname: 'staff',
    })
    const b2 = Buffer.alloc(512)
    h.encode(b2, 0)

    assert.equal(h.type, 'File')
    assert.equal(h.typeKey, '0')

    assert.equal(b2.toString('hex'), buf.toString('hex'))
    assert.equal(h.cksum, 14469)
    assert(h.needPax, 'need pax because long filename')

    const h2 = new Header(b2)

    assert.match(h2, {
      path:
        'long-dirname-long-dirname-long-dirname-long-dirname-' +
        'long-dirname-long-dirname-long-dirname-long-dir',
      cksum: 14469,
      cksumValid: true,
      needPax: false,
    })
  })
})

test('throwers', () => {
  assert.throws(_ => new Header(Buffer.alloc(100)), {
    message: 'need 512 bytes for header',
  })

  assert.throws(_ => new Header({}).encode(Buffer.alloc(100)), {
    message: 'need 512 bytes for header',
  })
})

test('null block', () => {
  const h = new Header(Buffer.alloc(512))
  assert.match(h, {
    cksumValid: false,
    needPax: false,
    path: '',
    type: 'File',
    mode: undefined,
    uid: undefined,
    gid: undefined,
    size: undefined,
    mtime: undefined,
    cksum: undefined,
    linkpath: '',
    uname: undefined,
    gname: undefined,
    devmaj: 0,
    devmin: 0,
    atime: undefined,
    ctime: undefined,
    nullBlock: true,
  })
})

test('unknown type', () => {
  const h = new Header(
    Buffer.from(
      '666f6f2e74787400000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000030303037353520003035373736312000303030303234200030303030' +
        '303030313434200031323637373536373534300030303630373620005a000000' +
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
      'hex',
    ),
  )

  assert.equal(h.type, 'Unsupported')
  assert.equal(h.typeKey, 'Unsupported')
})

test('dir as file with trailing /', () => {
  const b = Buffer.from(
    '782f792f00000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000030303030' +
      '3030303030302000000000000000000000000000303034363136200030000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0075737461720030300000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000003030303030302000303030303030200000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000',
    'hex',
  )
  const h = new Header(b)
  assert.equal(h.type, 'Directory')
  b[156] = '0'.charCodeAt(0)
  const h2 = new Header(b)
  assert.equal(h2.type, 'Directory')
})

test('null numeric values do not get written', () => {
  const b = Buffer.alloc(512)
  const h = new Header()
  h.encode(b, 0)
  assert.deepEqual(
    b,
    Buffer.from(
      '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000303033303737200030000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0075737461720030300000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000003030303030302000303030303030200000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000000',
      'hex',
    ),
  )
  const h2 = new Header(b)
  assert.match(h2, {
    type: 'File',
    cksumValid: true,
    needPax: false,
    nullBlock: false,
    path: '',
    mode: undefined,
    uid: undefined,
    gid: undefined,
    size: undefined,
    mtime: undefined,
    cksum: 1599,
    linkpath: '',
    uname: '',
    gname: '',
    devmaj: 0,
    devmin: 0,
    atime: undefined,
    ctime: undefined,
  })
})

test('big numbers', () => {
  const b = Buffer.alloc(512)
  const h = new Header({
    path: 'bignum',
    size: 0o77777777777 + 1,
  })
  h.encode(b, 0)
  const h2 = new Header(b)
  assert.equal(h2.size, 0o77777777777 + 1)
})

test('dir with long body', () => {
  const b = Buffer.from(
    '7061636b6167652f76656e646f72000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000030303037353520003030303030302000303030303030200030303030' +
      '3030313030303020313330363133303232343120303132303236200035000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0075737461720030300000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000003030303030302000303030303030200000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000',
    'hex',
  )
  const h = new Header(b)
  assert.equal(h.type, 'Directory')
  assert.equal(h.size, 0)
})

test('null block, global extended header', () => {
  const h = new Header(
    Buffer.alloc(512),
    0,
    {
      undef: undefined,
      blerg: 'bloo',
    },
    {
      path: '/global.path',
      foo: 'global foo',
      global: true,
      linkpath: 'asdf',
    },
  )
  assert.match(h, {
    cksumValid: false,
    needPax: false,
    path: '',
    type: 'File',
    mode: undefined,
    uid: undefined,
    gid: undefined,
    size: undefined,
    mtime: undefined,
    cksum: undefined,
    linkpath: '',
    uname: undefined,
    gname: undefined,
    devmaj: 0,
    devmin: 0,
    atime: undefined,
    ctime: undefined,
    nullBlock: true,
    blerg: 'bloo',
    foo: 'global foo',
  })
})

test('gnutar-generated 10gb file size', () => {
  const b = Buffer.from(
    '313067622e696d67000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000030303030363634003030303137353000303030313735300080000000' +
      '0000000280000000313334373434303132303500303131313437002030000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0075737461722020006973616163730000000000000000000000000000000000' +
      '0000000000000000006973616163730000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000',
    'hex',
  )
  const h = new Header(b)
  assert.equal(h.size, 1024 * 1024 * 1024 * 10, 'should be 10gb file')
  // cannot set type to something invalid
  assert.throws(() => (h.type = 'Z'), Error)
})

test('tarmageddon, ensure that Header prioritizes Pax size', async () => {
  const h = new Header({
    path: 'file.txt',
    size: 0,
  })
  h.encode()
  assert.equal(h.size, 0, 'size is zero in raw ustar header')
  const hPax = new Header(h.block, 0, { size: 123 })
  assert.equal(hPax.size, 123, 'if size is set in pax, takes priority')
})

test('do not apply ex/gex to meta entries', () => {
  const normalEntryTypes = new Set([
    'File',
    'OldFile',
    'Link',
    'SymbolicLink',
    'CharacterDevice',
    'BlockDevice',
    'Directory',
    'FIFO',
    'ContiguousFile',
    'GNUDumpDir',
  ])

  for (const type of name.values()) {
    const data = new Header({
      path: 'x',
      type,
      size: 1,
    })
    data.encode()
    const h = new Header(data.block, 0, {
      size: 100,
      dev: 5678,
      ino: 9876,
    })
    if (normalEntryTypes.has(type)) {
      if (h.type === 'Directory') {
        assert.equal(
          h.size,
          0,
          'Directories always size=0, no matter what',
        )
      } else {
        assert.equal(
          h.size,
          100,
          `expect ${type} to respect extended header`,
        )
      }
      assert.equal(
        h.dev,
        5678,
        `expect ${type} to respect extended header`,
      )
      assert.equal(
        h.ino,
        9876,
        `expect ${type} to respect extended header`,
      )
    } else {
      assert.equal(h.size, 1, `expect ${type} to ignore extended header`)
      assert.equal(
        h.dev,
        undefined,
        `expect ${type} to ignore extended header`,
      )
      assert.equal(
        h.ino,
        undefined,
        `expect ${type} to ignore extended header`,
      )
    }
  }
})

test('no negative size', () => {
  const i = new Header({ size: -1000 })
  // stubbornly refuse
  assert.equal(i.size, undefined)
})
