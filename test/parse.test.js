import { assert, describe, test } from 'ubqtest'
import { Parser } from '../src/parse.js'
import { makeTar } from './fixtures/make-tar.js'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { Minipass } from 'minipass'
import { Header } from '../src/header.js'
import EE from 'events'
import { Pax } from '../src/pax.js'

const tardir = path.resolve(import.meta.dirname, 'fixtures/tars')

// Resolves when the parser emits 'end'.
const ended = p => new Promise(res => p.on('end', res))

describe('fixture tests', () => {
  class ByteStream extends Minipass {
    write(chunk) {
      for (let i = 0; i < chunk.length - 1; i++) {
        super.write(chunk.subarray(i, i + 1))
      }

      const ret = super.write(
        chunk.subarray(chunk.length - 1, chunk.length),
      )
      if (ret === false) {
        throw new Error('BS write return false')
      }
      return ret
    }
  }

  // Compares each event of the parser with the expected event at the
  // same position. The promise resolves at the 'end' event, and rejects
  // at the first event that does not match.
  const trackEvents = (expect, p, slow) =>
    new Promise((resolve, reject) => {
      let cursor = 0
      const check = (actual, message) => {
        try {
          assert.match(actual, expect[cursor++], message)
        } catch (er) {
          reject(er)
        }
      }
      p.on('entry', entry => {
        check(['entry', entry], entry.path)
        if (slow) {
          setTimeout(() => entry.resume())
        } else {
          entry.resume()
        }
      })
      p.on('ignoredEntry', entry =>
        check(['ignoredEntry', entry], `ignored: ${entry.path}`),
      )
      p.on('warn', (c, message, _data) =>
        check(['warn', c, message], 'warn'),
      )
      p.on('nullBlock', () => check(['nullBlock'], 'null'))
      p.on('error', er => check(['error', er], 'error'))
      p.on('meta', meta => check(['meta', meta], 'meta'))
      p.on('eof', () => check(['eof'], 'eof'))
      p.on('end', () => {
        check(['end'], 'end')
        resolve()
      })
    })

  const byteAtATime = (p, data) => {
    const bs = new ByteStream()
    bs.pipe(p)
    bs.end(data)
  }

  // Each case is [name, parser options, function that writes the tar].
  // noOpts: use no options object when the base options are all unset.
  // slow: resume each entry in a later tick.
  const cases = [
    [
      'uncompressed one byte at a time',
      { noOpts: true },
      (p, tardata) => {
        const bs = new ByteStream()
        bs.on('data', c => {
          if (!Buffer.isBuffer(c)) throw new Error('wat1')
          if (c.length !== 1) throw new Error('wat2')
        })
        bs.pipe(p)
        bs.write(tardata)
        bs.end()
      },
    ],
    [
      'uncompressed all at once',
      {},
      // this one writes it as a string
      (p, tardata) => p.end(tardata.toString('hex'), 'hex', () => {}),
    ],
    [
      'uncompressed one byte at a time, filename .tbr',
      { noOpts: true, file: 'example.tbr' },
      byteAtATime,
    ],
    [
      'uncompressed all at once, filename .tar.br',
      { file: 'example.tar.br' },
      (p, tardata) => p.end(tardata),
    ],
    [
      'gzipped all at once',
      {},
      (p, tardata) => p.end(zlib.gzipSync(tardata), () => {}),
    ],
    [
      'gzipped all at once, filename .tbr',
      { file: 'example.tbr' },
      (p, tardata) => {
        p.write(zlib.gzipSync(tardata), () => {})
        p.end(() => {})
      },
    ],
    [
      'gzipped byte at a time',
      {},
      (p, tardata) => byteAtATime(p, zlib.gzipSync(tardata)),
    ],
    [
      'compress with brotli based on filename .tar.br',
      { file: 'example.tar.br' },
      (p, tardata) => p.end(zlib.brotliCompressSync(tardata)),
    ],
    [
      'compress with brotli based on filename .tbr',
      { file: 'example.tbr' },
      (p, tardata) => p.end(zlib.brotliCompressSync(tardata)),
    ],
    [
      'compress with brotli all at once',
      { brotli: {} },
      (p, tardata) => p.end(zlib.brotliCompressSync(tardata)),
    ],
    [
      'compress with brotli byte at a time',
      { brotli: {} },
      (p, tardata) => byteAtATime(p, zlib.brotliCompressSync(tardata)),
    ],
    [
      'compress with brotli .tbr byte at a time',
      { file: 'example.tbr' },
      (p, tardata) => byteAtATime(p, zlib.brotliCompressSync(tardata)),
    ],
    [
      'compress with zstd based on filename .tar.zst',
      { file: 'example.tar.zst' },
      (p, tardata) => p.end(zlib.zstdCompressSync(tardata)),
    ],
    [
      'compress with zstd based on filename .tzst',
      { file: 'example.tzst' },
      (p, tardata) => p.end(zlib.zstdCompressSync(tardata)),
    ],
    [
      'compress with zstd all at once',
      { zstd: {} },
      (p, tardata) => p.end(zlib.zstdCompressSync(tardata)),
    ],
    [
      'compress with zstd byte at a time',
      { zstd: {} },
      (p, tardata) => byteAtATime(p, zlib.zstdCompressSync(tardata)),
    ],
    [
      'compress with zstd .tzst byte at a time',
      { file: 'example.tzst' },
      (p, tardata) => byteAtATime(p, zlib.zstdCompressSync(tardata)),
    ],
    [
      'async chunks',
      { slow: true },
      (p, tardata) => {
        const half = Math.floor(tardata.length / 2)
        p.write(tardata.subarray(0, half).toString('hex'), 'hex')
        process.nextTick(() => p.end(tardata.subarray(half)))
      },
    ],
  ]

  const parsedir = path.resolve(import.meta.dirname, 'fixtures/parse')
  const files = fs.readdirSync(tardir)
  const maxMetaOpt = [250, undefined]
  const filterOpt = [true, false]
  const strictOpt = [true, false]
  const runTest = (file, maxMeta, filter, strict) => {
    const tardata = fs.readFileSync(file)
    const base = path.basename(file, '.tar')
    describe(`file=${base}.tar maxmeta=${maxMeta} filter=${filter} strict=${strict}`, () => {
      const o =
        (maxMeta ? '-meta-' + maxMeta : '') +
        (filter ? '-filter' : '') +
        (strict ? '-strict' : '')
      const tail = (o ? '-' + o : '') + '.json'
      const eventsFile = parsedir + '/' + base + tail
      // The fixtures have each time as an ISO string. The parser gives
      // Date objects.
      const expect = JSON.parse(
        fs.readFileSync(eventsFile, 'utf8'),
        (k, v) =>
          /^[acm]time$/.test(k) && typeof v === 'string' ? new Date(v) : v,
      )

      for (const [name, { noOpts, slow, ...extra }, write] of cases) {
        test(name, async () => {
          const opt =
            noOpts && !(maxMeta || filter || strict) ?
              undefined
            : {
                maxMetaEntrySize: maxMeta,
                filter:
                  filter ?
                    (_path, entry) => entry.size % 2 !== 0
                  : undefined,
                strict: strict,
                ...extra,
              }
          const p = new Parser(opt)
          const done = trackEvents(expect, p, slow)
          write(p, tardata)
          await done
        })
      }
    })
  }

  for (const f of files) {
    for (const maxMeta of maxMetaOpt) {
      for (const strict of strictOpt) {
        for (const filter of filterOpt) {
          runTest(path.resolve(tardir, f), maxMeta, filter, strict)
        }
      }
    }
  }
})

test('strict warn with an error emits that error', () => {
  const p = new Parser({
    strict: true,
  })
  const emitted = []
  p.on('error', er => emitted.push(er))
  const er = new Error('yolo')
  p.warn('TAR_TEST', er)
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0], er)
})

test('onwarn gets added to the warn event', () => {
  const messages = []
  const p = new Parser({
    onwarn(_code, message) {
      messages.push(message)
    },
  })
  p.warn('TAR_TEST', 'this is fine')
  assert.deepEqual(messages, ['this is fine'])
})

test('onReadEntry gets added to entry event', () => {
  const entries = []
  const p = new Parser({
    onReadEntry: entry => entries.push(entry),
  })
  p.emit('entry', 'yes hello this is dog')
  assert.deepEqual(entries, ['yes hello this is dog'])
})

test('drain event timings', async () => {
  let sawOndone = false
  const ondone = function () {
    sawOndone = true
    this.emit('prefinish')
    this.emit('finish')
    this.emit('end')
    this.emit('close')
  }

  // write 1 header and body, write 2 header, verify false return
  // wait for drain event before continuing.
  // write 2 body, 3 header and body, 4 header, verify false return
  // wait for drain event
  // write 4 body and null blocks

  const data = [
    [
      {
        path: 'one',
        size: 513,
        type: 'File',
      },
      new Array(513).join('1'),
      '1',
      {
        path: 'two',
        size: 513,
        type: 'File',
      },
      new Array(513).join('2'),
      '2',
      {
        path: 'three',
        size: 1024,
        type: 'File',
      },
    ],
    [
      new Array(513).join('3'),
      new Array(513).join('3'),
      {
        path: 'four',
        size: 513,
        type: 'File',
      },
    ],
    [
      new Array(513).join('4'),
      '4',
      {
        path: 'five',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('5'),
      new Array(513).join('5'),
      {
        path: 'six',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('6'),
      new Array(513).join('6'),
      {
        path: 'seven',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('7'),
      new Array(513).join('7'),
      {
        path: 'eight',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('8'),
      new Array(513).join('8'),
      {
        path: 'four',
        size: 513,
        type: 'File',
      },
      new Array(513).join('4'),
      '4',
      {
        path: 'five',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('5'),
      new Array(513).join('5'),
      {
        path: 'six',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('6'),
      new Array(513).join('6'),
      {
        path: 'seven',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('7'),
      new Array(513).join('7'),
      {
        path: 'eight',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('8'),
    ],
    [
      new Array(513).join('8'),
      {
        path: 'nine',
        size: 1537,
        type: 'File',
      },
      new Array(513).join('9'),
    ],
    [new Array(513).join('9')],
    [new Array(513).join('9')],
    ['9'],
  ].map(chunks => makeTar(chunks))

  const expect = [
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
  ]

  class SlowStream extends EE {
    write() {
      setTimeout(() => this.emit('drain'))
      return false
    }

    end() {
      return this.write()
    }
  }

  let currentEntry
  const autoPipe = true
  const p = new Parser({
    ondone,
    onReadEntry: entry => {
      assert.equal(entry.path, expect.shift())
      currentEntry = entry
      if (autoPipe) {
        setTimeout(() => entry.pipe(new SlowStream()))
      }
    },
  })

  for (const d of data) {
    assert.equal(p.write(d), false, 'write should return false')
  }

  const go = () => {
    const d = data.shift()
    if (d === undefined) {
      return p.end()
    }

    let paused
    if (currentEntry) {
      currentEntry.pause()
      paused = true
    }

    const hunklen = Math.floor(d.length / 2)
    const hunks = [d.subarray(0, hunklen), d.subarray(hunklen)]
    p.write(hunks[0])

    if (currentEntry && !paused) {
      currentEntry.pause()
      paused = true
    }

    assert.equal(p.write(hunks[1]), false, 'write should return false')

    p.once('drain', go)

    if (paused) {
      currentEntry.resume()
    }
  }

  p.once('drain', go)
  const done = ended(p)
  go()
  await done
  assert(sawOndone)
  assert.deepEqual(expect, [], 'saw each expected entry')
})

describe('consume while consuming', () => {
  const data = makeTar([
    {
      path: 'one',
      size: 0,
      type: 'File',
    },
    {
      path: 'zero',
      size: 0,
      type: 'File',
    },
    {
      path: 'two',
      size: 513,
      type: 'File',
    },
    new Array(513).join('2'),
    '2',
    {
      path: 'three',
      size: 1024,
      type: 'File',
    },
    new Array(513).join('3'),
    new Array(513).join('3'),
    {
      path: 'zero',
      size: 0,
      type: 'File',
    },
    {
      path: 'zero',
      size: 0,
      type: 'File',
    },
    {
      path: 'four',
      size: 1024,
      type: 'File',
    },
    new Array(513).join('4'),
    new Array(513).join('4'),
    {
      path: 'zero',
      size: 0,
      type: 'File',
    },
    {
      path: 'zero',
      size: 0,
      type: 'File',
    },
  ])

  const runTest = async size => {
    const p = new Parser()
    const first = data.subarray(0, size)
    const rest = data.subarray(size)
    const paths = []
    const done = ended(p)
    p.once('entry', _entry => {
      for (let pos = 0; pos < rest.length; pos += size) {
        p.write(rest.subarray(pos, pos + size))
      }

      p.end()
    })
      .on('entry', entry => {
        paths.push(entry.path)
        entry.resume()
      })
      .write(first)
    await done
    assert.deepEqual(paths, [
      'one',
      'zero',
      'two',
      'three',
      'zero',
      'zero',
      'four',
      'zero',
      'zero',
    ])
  }

  // one that aligns, and another that doesn't, so that we
  // get some cases where there's leftover chunk and a buffer
  test('size=1000', () => runTest(1000))
  test('size=1024', () => runTest(4096))
})

describe('truncated input', () => {
  const data = makeTar([
    {
      path: 'foo/',
      type: 'Directory',
    },
    {
      path: 'foo/bar',
      type: 'File',
      size: 18,
    },
  ])

  test('truncated at block boundary', () => {
    const warnings = []
    const p = new Parser({
      onwarn: (_c, message) => warnings.push(message),
    })
    p.end(data)
    assert.deepEqual(warnings, [
      'Truncated input (needed 512 more bytes, only 0 available)',
    ])
  })

  test('truncated mid-block', () => {
    const warnings = []
    const p = new Parser({
      onwarn: (_c, message) => warnings.push(message),
    })
    p.write(data)
    p.end(Buffer.from('not a full block'))
    assert.deepEqual(warnings, [
      'Truncated input (needed 512 more bytes, only 16 available)',
    ])
  })
})

describe('truncated gzip input', () => {
  const raw = makeTar([
    {
      path: 'foo/',
      type: 'Directory',
    },
    {
      path: 'foo/bar',
      type: 'File',
      size: 18,
    },
    new Array(19).join('x'),
    '',
    '',
  ])
  const tgz = zlib.gzipSync(raw)
  const split = Math.floor((tgz.length * 2) / 3)
  const trunc = tgz.subarray(0, split)

  test('early end', () => {
    const warnings = []
    const p = new Parser()
    p.on('error', er => warnings.push(er.message))
    let aborted = false
    p.on('abort', () => (aborted = true))
    p.end(trunc)
    assert.equal(aborted, true, 'aborted writing')
    assert.deepEqual(warnings, ['zlib: unexpected end of file'])
  })

  test('just wrong', () => {
    const warnings = []
    const p = new Parser()
    p.on('error', er => warnings.push(er.message))
    let aborted = false
    p.on('abort', () => (aborted = true))
    p.write(trunc)
    p.write(trunc)
    p.write(tgz.subarray(split))
    p.end()
    assert.equal(aborted, true, 'aborted writing')
    assert.match(warnings, [/^zlib: /])
  })
})

test('end while consuming', async () => {
  // https://github.com/npm/node-tar/issues/157
  const data = zlib.gzipSync(
    makeTar([
      {
        path: 'package/package.json',
        type: 'File',
        size: 130,
      },
      new Array(131).join('x'),
      {
        path: 'package/node_modules/@c/d/node_modules/e/package.json',
        type: 'File',
        size: 30,
      },
      new Array(31).join('e'),
      {
        path: 'package/node_modules/@c/d/package.json',
        type: 'File',
        size: 33,
      },
      new Array(34).join('d'),
      {
        path: 'package/node_modules/a/package.json',
        type: 'File',
        size: 59,
      },
      new Array(60).join('a'),
      {
        path: 'package/node_modules/b/package.json',
        type: 'File',
        size: 30,
      },
      new Array(31).join('b'),
      '',
      '',
    ]),
  )

  const actual = []
  const expect = [
    'package/package.json',
    'package/node_modules/@c/d/node_modules/e/package.json',
    'package/node_modules/@c/d/package.json',
    'package/node_modules/a/package.json',
    'package/node_modules/b/package.json',
  ]

  const mp = new Minipass()
  const p = new Parser({
    onReadEntry: entry => {
      actual.push(entry.path)
      entry.resume()
    },
    onwarn: (c, m) => assert.fail(`${c}: ${m}`),
  })
  const done = ended(p)
  mp.end(data)
  mp.pipe(p)
  await done
  assert.deepEqual(actual, expect)
})

test('bad archives', async () => {
  const p = new Parser()
  const warnings = []
  p.on('warn', (code, msg, data) => {
    warnings.push([code, msg, data])
  })
  const done = ended(p)
  // javascript test is not a tarball.
  p.end(fs.readFileSync(import.meta.filename))
  await done
  // last one should be 'this archive sucks'
  assert.match(warnings.pop(), [
    'TAR_BAD_ARCHIVE',
    'Unrecognized archive format',
    { code: 'TAR_BAD_ARCHIVE', tarCode: 'TAR_BAD_ARCHIVE' },
  ])
})

test('header that throws', () => {
  const p = new Parser()
  const warnings = []
  p.on('warn', (_c, m, d) => warnings.push([m, d]))
  const h = new Header({
    path: 'path',
    mode: 0o07777, // gonna make this one invalid
    uid: 1234,
    gid: 4321,
    type: 'File',
    size: 1,
  })
  h.encode()
  const buf = h.block
  const bad = Buffer.from([0x81, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
  bad.copy(buf, 100)
  assert.throws(
    () => new Header(buf),
    Error,
    'the header with that buffer throws',
  )
  p.write(buf)
  assert.equal(warnings.length, 1)
  const [m, d] = warnings[0]
  assert.equal(m, 'invalid base256 encoding')
  assert.match(d, {
    code: 'TAR_ENTRY_INVALID',
  })
})

test('warnings that are not so bad', async () => {
  const p = new Parser()
  const warnings = []
  p.on('warn', (code, m, d) => {
    warnings.push([code, m, d])
    assert.fail('should get no warnings')
  })
  // the parser doesn't actually decide what's "ok" or "supported",
  // it just parses.  So we have to set it ourselves like unpack does
  p.once('entry', entry => (entry.invalid = true))
  p.on('entry', entry => entry.resume())
  const data = makeTar([
    {
      path: '/a/b/c',
      type: 'File',
      size: 1,
    },
    'a',
    {
      path: 'a/b/c',
      type: 'Directory',
    },
    '',
    '',
  ])
  const done = ended(p)
  p.end(data)
  await done
  assert.deepEqual(warnings, [])
})

// verify that node-tar is not vulnerable to tarmageddon attack
// https://edera.dev/stories/tarmageddon
describe('tarmageddon', () => {
  // this is the nested tarball that will be inside the archive

  const nested = makeTar([
    {
      path: 'one',
      size: 1,
      type: 'File',
    },
    '1',
  ])

  test('gutcheck: the nested tar is 1024 bytes', () => {
    assert.equal(nested.byteLength, 1024)
  })

  // Expect this one to have 2 entries.
  // First a zero-length nested.tar, then the 'one' file.
  test('no pax, 2 entries', async () => {
    const noPax = makeTar([
      {
        path: 'nested.tar',
        size: 0,
      },
      nested,
      '',
      '',
    ])

    const expect = [
      { size: 0, path: 'nested.tar' },
      { size: 1, path: 'one' },
    ]

    const actual = []
    const p = new Parser()
    p.on('entry', e => {
      e.resume()
      actual.push({
        size: e.size,
        path: e.path,
      })
    })

    const done = ended(p)
    p.end(noPax)
    await done
    assert.deepEqual(actual, expect)
  })

  test('with pax, 1 entry', async () => {
    // when there is a Pax header, that size overrides the size in
    // the ustar header block.
    const withPax = makeTar([
      new Pax({
        path: 'nested.tar',
        // actual size of nested tarball, 1024 bytes
        size: nested.byteLength,
      }).encode(),
      {
        path: 'nested.tar',
        // fake size, attempting to unpack tar's contents directly
        size: 0,
      },
      nested,
    ])

    // expect a single 1024 byte file entry to be emitted
    const expect = [{ size: 1024, path: 'nested.tar' }]

    const actual = []
    const p = new Parser()
    p.on('entry', e => {
      actual.push({
        size: e.size,
        path: e.path,
      })
      e.resume()
    })
    const done = ended(p)
    p.end(withPax)
    await done
    assert.deepEqual(actual, expect)
  })
})

describe('max decompression ratio', () => {
  const makeCompressedBomb = () => {
    const payload = Buffer.alloc(8 * 1024 * 1024)
    return zlib.gzipSync(
      makeTar([
        {
          path: 'bomb',
          size: payload.length,
          type: 'File',
        },
        payload,
        '',
        '',
      ]),
    )
  }
  const bomb = makeCompressedBomb()

  test('parsing aborts by default', () => {
    const p = new Parser({})
    assert.throws(
      () => p.end(bomb),
      {
        tarCode: 'TAR_ABORT',
        recoverable: false,
        message: /max decompression ratio exceeded/,
      },
      'parsing aborts',
    )
    // no-op to abort again
    p.abort(new Error('hello'))
  })

  test('aborting only happens one time', () => {
    const p = new Parser({})
    assert.throws(() => p.abort(new Error('hello')), {
      message: 'hello',
      tarCode: 'TAR_ABORT',
      recoverable: false,
    })
    // this is ignored
    p.end(bomb)
  })

  test('parsing can disable the limit explicitly', async () => {
    let bytesRead = 0
    await new Promise(res =>
      new Parser({
        maxDecompressionRatio: Infinity,
        onReadEntry(e) {
          e.on('data', c => (bytesRead += c.byteLength))
        },
      })
        .on('end', res)
        .end(bomb)
        .resume(),
    )
    assert.equal(bytesRead, 8 * 1024 * 1024)
  })
})

test('write a string with no encoding', async () => {
  const data = makeTar([{ path: 'a', type: 'File', size: 0 }, '', ''])
  const paths = []
  const p = new Parser({
    onReadEntry: e => {
      paths.push(e.path)
      e.resume()
    },
  })
  const done = ended(p)
  // Each byte of this archive is ASCII, so utf8 keeps it as it is.
  p.write(data.toString('latin1'))
  p.end()
  await done
  assert.deepEqual(paths, ['a'])
})

test('end with the last part of gzip data', async () => {
  const tgz = zlib.gzipSync(
    makeTar([{ path: 'a', type: 'File', size: 1 }, 'a', '', '']),
  )
  const paths = []
  const p = new Parser({
    onReadEntry: e => {
      paths.push(e.path)
      e.resume()
    },
  })
  const done = ended(p)
  p.write(tgz.subarray(0, 20))
  p.end(tgz.subarray(20))
  await done
  assert.deepEqual(paths, ['a'])
})
