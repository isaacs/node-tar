const Parse = require('../lib/parse.js')
const fs = require('fs')
const path = require('path')
const tardir = path.resolve(__dirname, '../test/fixtures/tars')
const parsedir = path.resolve(__dirname, '../test/fixtures/parse')
const etoa = require('events-to-array')
const maxMetaOpt = [50, 1024, null]
const filterOpt = [ true, false ]

const makeTest = (tarfile, tardata, maxMeta, filter) => {
  const eventsfile = parsedir + '/' + path.basename(tarfile, '.tar') + '-' +
    '-meta-' + maxMeta + '-filter-' + filter + '.json'
  const p = new Parse({
    maxMetaEntrySize: maxMeta,
    filter: filter ? entry => entry.size % 2 === 0 : null
  })
  const events = []

  const pushEntry = type => entry => {
    events.push([type, {
      extended: entry.extended,
      globalExtended: entry.globalExtended,
      blockRemain: entry.blockRemain,
      remain: entry.remain,
      type: entry.type,
      meta: entry.meta,
      ignore: entry.ignore,
      path: entry.path,
      mode: entry.mode,
      uid: entry.uid,
      gid: entry.gid,
      uname: entry.uname,
      gname: entry.gname,
      size: entry.size,
      mtime: entry.mtime,
      atime: entry.atime,
      ctime: entry.ctime,
      linkpath: entry.linkpath,
      header: {
        cksumValid: entry.header.cksumValid,
        needPax: entry.header.needPax,
        path: entry.header.path,
        mode: entry.header.mode,
        uid: entry.header.uid,
        gid: entry.header.gid,
        size: entry.header.size,
        mtime: entry.header.mtime,
        cksum: entry.header.cksum,
        linkpath: entry.header.linkpath,
        ustar: entry.header.ustar,
        ustarver: entry.header.ustarver,
        uname: entry.header.uname,
        gname: entry.header.gname,
        devmaj: entry.header.devmaj,
        devmin: entry.header.devmin,
        ustarPrefix: entry.header.ustarPrefix,
        xstarPrefix: entry.header.xstarPrefix,
        prefixTerminator: entry.header.prefixTerminator,
        atime: entry.header.atime,
        ctime: entry.header.atime
      }
    }])
    entry.resume()
  }

  p.on('entry', pushEntry('entry'))
  p.on('ignoredEntry', pushEntry('ignoredEntry'))
  p.on('warn', (message, data) => events.push(['warn', message]))
  p.on('end', _ => events.push(['end']))
  p.on('nullblock', _ => events.push(['nullblock']))
  p.on('meta', meta => events.push(['meta', meta]))

  p.end(tardata)
  console.log(eventsfile)
  fs.writeFileSync(eventsfile, JSON.stringify(events, null, 2) + '\n')
}


fs.readdirSync(tardir)
.forEach(tar => {
  const tarfile = tardir + '/' + tar
  const tardata = fs.readFileSync(tarfile)
  maxMetaOpt.forEach(maxMeta => {
    filterOpt.forEach(filter => {
      makeTest(tarfile, tardata, maxMeta, filter)
    })
  })
})
