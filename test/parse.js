const t = require('tap')
const Parse = require('../lib/parse.js')

const fs = require('fs')
const path = require('path')
const tardir = path.resolve(__dirname, 'fixtures/tars')
const etoa = require('events-to-array')


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

  const trackEvents = (t, expect, p) => {
    let ok = true
    let cursor = 0
    p.on('entry', entry => {
      ok = ok && t.match(['entry', entry], expect[cursor++])
      entry.resume()
    })
    p.on('ignoredEntry', entry => {
      ok = ok && t.match(['ignoredEntry', entry], expect[cursor++])
      entry.resume()
    })
    p.on('warn', (message, data) => {
      ok = ok && t.match(['warn', message], expect[cursor++])
    })
    p.on('nullblock', _ => {
      ok = ok && t.match(['nullblock'], expect[cursor++])
    })
    p.on('meta', meta => {
      ok = ok && t.match(['meta', meta], expect[cursor++])
    })
    p.on('end', _ => {
      ok = ok && t.match(['end'], expect[cursor++])
      t.end()
    })
  }


  const path = require('path')
  const tardir = path.resolve(__dirname, 'fixtures/tars')
  const parsedir = path.resolve(__dirname, 'fixtures/parse')
  const files = fs.readdirSync(tardir)
  const maxMetaOpt = [50, 1024, null]
  const filterOpt = [ true, false ]
  const runTest = (file, maxMeta, filter) => {
    const tardata = fs.readFileSync(file)
    const base = path.basename(file, '.tar')
    t.test('file=' + base + '.tar' +
           ' maxmeta=' + maxMeta +
           ' filter=' + filter, t => {
      t.plan(2)
      const eventsfile = parsedir + '/' + base + '-' +
        '-meta-' + maxMeta + '-filter-' + filter + '.json'
      const expect = require(eventsfile)
      t.test('one byte at a time', t => {
        const bs = new ByteStream
        const bp = new Parse({
          maxMetaEntrySize: maxMeta,
          filter: filter ? entry => entry.size % 2 === 0 : null
        })
        trackEvents(t, expect, bp)
        bs.pipe(bp)
        bs.end(tardata)
      })

      t.test('all at once', t => {
        const p = new Parse({
          maxMetaEntrySize: maxMeta,
          filter: filter ? entry => entry.size % 2 === 0 : null
        })
        trackEvents(t, expect, p)
        p.end(tardata)
      })
    })
  }

  files.map(f => path.resolve(tardir, f)).forEach(file =>
    maxMetaOpt.forEach(maxMeta =>
      filterOpt.forEach(filter => runTest(file, maxMeta, filter))))
  t.end()
})
