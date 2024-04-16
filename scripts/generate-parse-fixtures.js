import { Parser } from '../dist/esm/parse.js'
import fs from 'fs'
import path, { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const tardir = resolve(__dirname, '../test/fixtures/tars')
const parsedir = resolve(__dirname, '../test/fixtures/parse')
const maxMetaOpt = [250, null]
const filterOpt = [true, false]
const strictOpt = [true, false]

const makeTest = (tarfile, tardata, maxMeta, filter, strict) => {
  const o =
    (maxMeta ? '-meta-' + maxMeta : '') +
    (filter ? '-filter' : '') +
    (strict ? '-strict' : '')
  const tail = (o ? '-' + o : '') + '.json'
  const eventsfile =
    parsedir + '/' + path.basename(tarfile, '.tar') + tail

  const p = new Parser({
    maxMetaEntrySize: maxMeta,
    filter: filter ? (_path, entry) => entry.size % 2 !== 0 : null,
    strict: strict,
  })
  const events = []

  const pushEntry = type => entry => {
    events.push([
      type,
      {
        extended: entry.extended,
        globalExtended: entry.globalExtended,
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
          ctime: entry.header.atime,
        },
      },
    ])
    entry.resume()
  }

  p.on('entry', pushEntry('entry'))
  p.on('ignoredEntry', pushEntry('ignoredEntry'))
  p.on('warn', (code, message, _data) =>
    events.push(['warn', code, message]),
  )
  p.on('error', er =>
    events.push([
      'error',
      {
        message: er.message,
        code: er.code,
      },
    ]),
  )
  p.on('end', _ => events.push(['end']))
  p.on('nullBlock', _ => events.push(['nullBlock']))
  p.on('eof', _ => events.push(['eof']))
  p.on('meta', meta => events.push(['meta', meta]))

  p.end(tardata)
  console.log(eventsfile)
  fs.writeFileSync(eventsfile, JSON.stringify(events, null, 2) + '\n')
}

fs.readdirSync(tardir).forEach(tar => {
  const tarfile = tardir + '/' + tar
  const tardata = fs.readFileSync(tarfile)
  maxMetaOpt.forEach(maxMeta =>
    filterOpt.forEach(filter =>
      strictOpt.forEach(strict =>
        makeTest(tarfile, tardata, maxMeta, filter, strict),
      ),
    ),
  )
})
