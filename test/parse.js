'use strict'
const t = require('tap')
const Parse = require('../lib/parse.js')

const fs = require('fs')
const path = require('path')
const tardir = path.resolve(__dirname, 'fixtures/tars')
const etoa = require('events-to-array')
const zlib = require('zlib')
const MiniPass = require('minipass')
const Header = require('../lib/header.js')
const EE = require('events').EventEmitter

t.test('fixture tests', t => {
  class ByteStream extends MiniPass {
    write (chunk) {
      for (let i = 0; i < chunk.length - 1; i++) {
        super.write(chunk.slice(i, i + 1))
      }
      return super.write(chunk.slice(chunk.length - 1, chunk.length))
    }
  }

  const trackEvents = (t, expect, p, slow) => {
    let ok = true
    let cursor = 0
    p.on('entry', entry => {
      ok = ok && t.match(['entry', entry], expect[cursor++], entry.path)
      if (slow)
        setTimeout(_ => entry.resume())
      else
        entry.resume()
    })
    p.on('ignoredEntry', entry => {
      ok = ok && t.match(['ignoredEntry', entry], expect[cursor++],
                         'ignored: ' + entry.path)
    })
    p.on('warn', (message, data) => {
      ok = ok && t.match(['warn', message], expect[cursor++], 'warn')
    })
    p.on('nullBlock', _ => {
      ok = ok && t.match(['nullBlock'], expect[cursor++], 'null')
    })
    p.on('error', er => {
      ok = ok && t.match(['error', er], expect[cursor++], 'error')
    })
    p.on('meta', meta => {
      ok = ok && t.match(['meta', meta], expect[cursor++], 'meta')
    })
    p.on('end', _ => {
      ok = ok && t.match(['end'], expect[cursor++], 'end')
      t.end()
    })
  }

  t.jobs = 4
  const path = require('path')
  const tardir = path.resolve(__dirname, 'fixtures/tars')
  const parsedir = path.resolve(__dirname, 'fixtures/parse')
  const files = fs.readdirSync(tardir)
  const maxMetaOpt = [50, null]
  const filterOpt = [ true, false ]
  const strictOpt = [ true, false ]
  const runTest = (file, maxMeta, filter, strict) => {
    const tardata = fs.readFileSync(file)
    const base = path.basename(file, '.tar')
    t.test('file=' + base + '.tar' +
           ' maxmeta=' + maxMeta +
           ' filter=' + filter +
           ' strict=' + strict, t => {

      const o =
        (maxMeta ? '-meta-' + maxMeta : '') +
        (filter ? '-filter' : '') +
        (strict ? '-strict' : '')
      const tail = (o ? '-' + o : '') + '.json'
      const eventsFile = parsedir + '/' + base + tail
      const expect = require(eventsFile)

      t.test('one byte at a time', t => {
        const bs = new ByteStream
        const opt = (maxMeta || filter || strict) ? {
          maxMetaEntrySize: maxMeta,
          filter: filter ? entry => entry.size % 2 !== 0 : null,
          strict: strict
        } : null
        const bp = new Parse(opt)
        trackEvents(t, expect, bp)
        bs.pipe(bp)
        bs.end(tardata)
      })

      t.test('all at once', t => {
        const p = new Parse({
          maxMetaEntrySize: maxMeta,
          filter: filter ? entry => entry.size % 2 !== 0 : null,
          strict: strict
        })
        trackEvents(t, expect, p)
        p.end(tardata)
      })

      t.test('gzipped all at once', t => {
        const p = new Parse({
          maxMetaEntrySize: maxMeta,
          filter: filter ? entry => entry.size % 2 !== 0 : null,
          strict: strict
        })
        trackEvents(t, expect, p)
        p.end(zlib.gzipSync(tardata))
      })

      t.test('gzipped byte at a time', t => {
        const bs = new ByteStream
        const gz = new zlib.Gzip()
        const bp = new Parse({
          maxMetaEntrySize: maxMeta,
          filter: filter ? entry => entry.size % 2 !== 0 : null,
          strict: strict
        })
        trackEvents(t, expect, bp)
        bs.pipe(bp)
        bs.end(zlib.gzipSync(tardata))
      })

      t.test('async chunks', t => {
        const p = new Parse({
          maxMetaEntrySize: maxMeta,
          filter: filter ? entry => entry.size % 2 !== 0 : null,
          strict: strict
        })
        trackEvents(t, expect, p, true)
        p.write(tardata.slice(0, Math.floor(tardata.length/2)))
        process.nextTick(_ => p.end(tardata.slice(Math.floor(tardata.length/2))))
      })

      t.end()
    })
  }

  files
  .map(f => path.resolve(tardir, f)).forEach(file =>
    maxMetaOpt.forEach(maxMeta =>
      strictOpt.forEach(strict =>
        filterOpt.forEach(filter =>
          runTest(file, maxMeta, filter, strict)))))
  t.end()
})

t.test('strict warn with an error emits that error', t => {
  const p = new Parse({ strict: true })
  const er = new Error('yolo')
  p.on('error', emitted => {
    t.equal(emitted, er)
    t.end()
  })
  p.warn(er.message, er)
})

t.test('onwarn gets added to the warn event', t => {
  t.plan(1)
  const p = new Parse({ onwarn: message => t.equal(message, 'this is fine') })
  p.warn('this is fine')
})

t.test('onentry gets added to entry event', t => {
  t.plan(1)
  const p = new Parse({
    onentry: entry => t.equal(entry, 'yes hello this is dog')
  })
  p.emit('entry', 'yes hello this is dog')
})

t.test('drain event timings', t => {
  // write 1 header and body, write 2 header, verify false return
  // wait for drain event before continuing.
  // write 2 body, 3 header and body, 4 header, verify false return
  // wait for drain event
  // write 4 body and null blocks

  const data = [
    [
      new Header({
        path: 'one',
        size: 513,
        type: 'File'
      }),
      new Array(513).join('1'),
      '1',
      new Header({
        path: 'two',
        size: 513,
        type: 'File'
      }),
      new Array(513).join('2'),
      '2',
      new Header({
        path: 'three',
        size: 1024,
        type: 'File'
      })
    ],
    [
      new Array(513).join('3'),
      new Array(513).join('3'),
      new Header({
        path: 'four',
        size: 513,
        type: 'File'
      })
    ],
    [
      new Array(513).join('4'),
      '4',
      new Header({
        path: 'five',
        size: 1024,
        type: 'File'
      }),
      new Array(513).join('5'),
      new Array(513).join('5'),
      new Header({
        path: 'six',
        size: 1024,
        type: 'File'
      }),
      new Array(513).join('6'),
      new Array(513).join('6'),
      new Header({
        path: 'seven',
        size: 1024,
        type: 'File'
      }),
      new Array(513).join('7'),
      new Array(513).join('7'),
      new Header({
        path: 'eight',
        size: 1024,
        type: 'File'
      }),
      new Array(513).join('8'),
      new Array(513).join('8'),
      new Header({
        path: 'four',
        size: 513,
        type: 'File'
      }),
      new Array(513).join('4'),
      '4',
      new Header({
        path: 'five',
        size: 1024,
        type: 'File'
      }),
      new Array(513).join('5'),
      new Array(513).join('5'),
      new Header({
        path: 'six',
        size: 1024,
        type: 'File'
      }),
      new Array(513).join('6'),
      new Array(513).join('6'),
      new Header({
        path: 'seven',
        size: 1024,
        type: 'File'
      }),
      new Array(513).join('7'),
      new Array(513).join('7'),
      new Header({
        path: 'eight',
        size: 1024,
        type: 'File'
      }),
      new Array(513).join('8')
    ],
    [
      new Array(513).join('8'),
      new Header({
        path: 'nine',
        size: 1537,
        type: 'File'
      }),
      new Array(513).join('9')
    ],
    [ new Array(513).join('9') ],
    [ new Array(513).join('9') ],
    [ '9' ]
  ].map(chunks => Buffer.concat(chunks.map(chunk => {
    if (chunk instanceof Header) {
      chunk.encode()
      return chunk.block
    }
    const buf = Buffer.alloc(512)
    buf.write(chunk)
    return buf
  }), chunks.length * 512))

  const expect = [
    'one', 'two', 'three',
    'four', 'five', 'six', 'seven', 'eight',
    'four', 'five', 'six', 'seven', 'eight',
    'nine',
    'one', 'two', 'three',
    'four', 'five', 'six', 'seven', 'eight',
    'four', 'five', 'six', 'seven', 'eight',
    'nine'
  ]

  class SlowStream extends EE {
    write () {
      setTimeout(_ => this.emit('drain'))
      return false
    }
    end () { return this.write() }
  }

  let currentEntry
  let autoPipe = true
  const p = new Parse({
    onentry: entry => {
      t.equal(entry.path, expect.shift())
      currentEntry = entry
      if (autoPipe)
        setTimeout(_=> entry.pipe(new SlowStream()))
    }
  })

  data.forEach(d => {
    if (!t.equal(p.write(d), false, 'write should return false: ' + d))
      return t.end()
  })

  let interval
  const go = _ => {
    const d = data.shift()
    if (d === undefined)
      return p.end()

    let paused
    if (currentEntry) {
      currentEntry.pause()
      paused = true
    }

    const hunklen = Math.floor(d.length / 2)
    const hunks = [
      d.slice(0, hunklen),
      d.slice(hunklen)
    ]
    p.write(hunks[0])

    if (currentEntry && !paused) {
      console.error('has current entry')
      currentEntry.pause()
      paused = true
    }

    if (!t.equal(p.write(hunks[1]), false, 'write should return false: ' + d))
      return t.end()

    p.once('drain', go)

    if (paused)
      currentEntry.resume()
  }

  p.once('drain', go)
  p.on('end', _ => {
    clearInterval(interval)
    t.end()
  })
  go()
})

t.test('consume while consuming', t => {
  const data = Buffer.concat([
    new Header({
      path: 'one',
      size: 0,
      type: 'File'
    }),
    new Header({
      path: 'zero',
      size: 0,
      type: 'File'
    }),
    new Header({
      path: 'two',
      size: 513,
      type: 'File'
    }),
    new Array(513).join('2'),
    '2',
    new Header({
      path: 'three',
      size: 1024,
      type: 'File'
    }),
    new Array(513).join('3'),
    new Array(513).join('3'),
    new Header({
      path: 'zero',
      size: 0,
      type: 'File'
    }),
    new Header({
      path: 'zero',
      size: 0,
      type: 'File'
    }),
    new Header({
      path: 'four',
      size: 1024,
      type: 'File'
    }),
    new Array(513).join('4'),
    new Array(513).join('4'),
    new Header({
      path: 'zero',
      size: 0,
      type: 'File'
    }),
    new Header({
      path: 'zero',
      size: 0,
      type: 'File'
    }),
  ].map(chunk => {
    if (chunk instanceof Header) {
      chunk.encode()
      return chunk.block
    }
    const buf = Buffer.alloc(512)
    buf.write(chunk)
    return buf
  }))


  const runTest = (t, size) => {
    const p = new Parse()
    const first = data.slice(0, size)
    const rest = data.slice(size)
    p.once('entry', entry => {
      for (let pos = 0; pos < rest.length; pos += size) {
        p.write(rest.slice(pos, pos + size))
      }
      p.end()
    })
    .on('entry', entry => entry.resume())
    .on('end', _ => t.end())
    .write(first)
  }

  // one that aligns, and another that doesn't, so that we
  // get some cases where there's leftover chunk and a buffer
  t.test('size=1000', t => runTest(t, 1000))
  t.test('size=1024', t => runTest(t, 4096))
  t.end()
})
