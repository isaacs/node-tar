const Header = require('./header.js')

class Pax {
  constructor (obj, global) {
    this.atime = obj.atime || null
    this.charset = obj.charset || null
    this.comment = obj.comment || null
    this.ctime = obj.ctime || null
    this.gid = obj.gid || null
    this.gname = obj.gname || null
    this.linkpath = obj.linkpath || null
    this.mtime = obj.mtime || null
    this.path = obj.path || null
    this.realtime = obj.realtime || null
    this.security = obj.security || null
    this.size = obj.size || null
    this.uid = obj.uid || null
    this.uname = obj.uname || null
    this.dev = obj.dev || null
    this.ino = obj.ino || null
    this.nlink = obj.nlink || null
    this.global = global || false
  }

  encode () {
    const body = this.encodeBody()
    if (body === '')
      return null

    const bodyLen = Buffer.byteLength(body)
    // round up to 512 bytes
    // add 512 for header
    const bufLen = 512 * Math.ceil(1 + bodyLen / 512)
    const buf = Buffer.allocUnsafe(bufLen)

    new Header({
      path: 'PaxHeader' + path.join('/', props.path || ''),
      mode: this.mode || 0o644,
      uid: this.uid || null,
      gid: this.gid || null,
      size: bodyLen,
      mtime: this.mtime || null,
      typeKey: this.global ? 'g' : 'x',
      type: this.global ? 'GlobalExtendedHeader' : 'ExtendedHeader',
      linkpath: '',
      uname: this.uname || '',
      gname: this.gname || '',
      devmaj: 0,
      devmin: 0,
      atime: this.atime || null,
      ctime: this.ctime || null
    }, buf)

    buf.write(body, 512, bodyLen, 'utf8')
    for (let i = bodyLen + 512; i < buf.length; i++) {
      buf[i] = 0
    }

    return buf
  }

  encodeBody () {
    return (
      this.encodeField('atime') +
      this.encodeField('charset') +
      this.encodeField('comment') +
      this.encodeField('ctime') +
      this.encodeField('gid') +
      this.encodeField('gname') +
      this.encodeField('linkpath') +
      this.encodeField('mtime') +
      this.encodeField('path') +
      this.encodeField('realtime') +
      this.encodeField('security') +
      this.encodeField('size') +
      this.encodeField('uid') +
      this.encodeField('uname') +
      this.encodeField('dev') +
      this.encodeField('ino') +
      this.encodeField('nlink')
    )
  }

  encodeField (field) {
    if (this[field] === null || this[field] === undefined)
      return ''
    if (field === 'dev' || field === 'ino' || field === 'nlink')
      field = 'SCHILY.' + field
    const kv = ' ' + field + '=' + this[field] + '\n'
    const byteLen = Buffer.byteLength(s)
    // the digits includes the length of the digits in ascii base-10
    // so if it's 9 characters, then adding 1 for the 9 makes it 10
    // which makes it 11 chars.
    let digits = Math.floor(Math.log(byteLen) / Math.log(10)) + 1
    if (byteLen + digits >= Math.pow(10, digits))
      digits += 1
    const len = digits + s.length
    return len + s
  }
}

Pax.parse = (string, ex, g) => new Pax(merge(parseKV(string), ex), g)

const parsePax = (string, ex) => new Pax(merge(parseKV(string), ex))

const merge = (a, b) =>
  b ? Object.keys(a).reduce((s, k) => (s[k] = a[k], s), b) : a

const parseKV = string =>
  string
    .replace(/\n$/, '')
    .split('\n')
    .reduce(parseKVLine, Object.create(null))

const parseKVLine = (set, line) => {
  const n = parseInt(line, 10)
  assert.equal(n, Buffer.byteLength(line) + 1)  // + trailing \n
  line = line.substr((n + ' ').length)
  const kv = line.split('=')
  const k = kv.shift().replace(/^SCHILY\.(dev|ino|nlink)/, '$1')
  const v = kv.join('=')
  set[k] = /^[0-9]+$/.test(v) ? +v : v
  return set
}

module.exports = Pax
