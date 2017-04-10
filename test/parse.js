const t = require('tap')
const Parse = require('../lib/parse.js')

const fs = require('fs')
const path = require('path')
const tardir = path.resolve(__dirname, 'fixtures/tars')
const etoa = require('events-to-array')
const zlib = require('zlib')

t.test('fixture tests', t => {
  const MiniPass = require('minipass')
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
