import type { HeaderData } from './header.js'
import { Header } from './header.js'
import { decodeUtf8, encodeUtf8Into, utf8Length } from './bytes.js'
import { basename } from './path.js'

const SIMPLE_NUMBER = /^\d+$/

export class Pax implements HeaderData {
  atime?: Date
  mtime?: Date
  ctime?: Date

  charset?: string
  comment?: string

  gid?: number
  uid?: number

  gname?: string
  uname?: string
  linkpath?: string
  dev?: number
  ino?: number
  nlink?: number
  path?: string
  size?: number
  mode?: number

  global: boolean

  constructor(obj: HeaderData, global: boolean = false) {
    this.atime = obj.atime
    this.charset = obj.charset
    this.comment = obj.comment
    this.ctime = obj.ctime
    this.dev = obj.dev
    this.gid = obj.gid
    this.global = global
    this.gname = obj.gname
    this.ino = obj.ino
    this.linkpath = obj.linkpath
    this.mtime = obj.mtime
    this.nlink = obj.nlink
    this.path = obj.path
    this.size = obj.size
    this.uid = obj.uid
    this.uname = obj.uname
  }

  encode() {
    const body = this.encodeBody()
    if (body === '') {
      return new Uint8Array(0)
    }

    const bodyLen = utf8Length(body)
    // round up to 512 bytes
    // add 512 for header
    const bufLen = 512 * Math.ceil(1 + bodyLen / 512)
    const buf = new Uint8Array(bufLen)

    new Header({
      // XXX split the path
      // then the path should be PaxHeader + basename, but less than 99,
      // prepend with the dirname
      path: ('PaxHeader/' + basename(this.path ?? '')).slice(0, 99),
      mode: this.mode || 0o644,
      uid: this.uid,
      gid: this.gid,
      size: bodyLen,
      mtime: this.mtime,
      type: this.global ? 'GlobalExtendedHeader' : 'ExtendedHeader',
      linkpath: '',
      uname: this.uname || '',
      gname: this.gname || '',
      devmaj: 0,
      devmin: 0,
      atime: this.atime,
      ctime: this.ctime,
    }).encode(buf)

    encodeUtf8Into(body, buf, 512, bodyLen)

    return buf
  }

  encodeBody() {
    return (
      this.encodeField('path') +
      this.encodeField('ctime') +
      this.encodeField('atime') +
      this.encodeField('dev') +
      this.encodeField('ino') +
      this.encodeField('nlink') +
      this.encodeField('charset') +
      this.encodeField('comment') +
      this.encodeField('gid') +
      this.encodeField('gname') +
      this.encodeField('linkpath') +
      this.encodeField('mtime') +
      this.encodeField('size') +
      this.encodeField('uid') +
      this.encodeField('uname')
    )
  }

  encodeField(field: keyof Pax): string {
    if (this[field] === undefined) {
      return ''
    }
    const r = this[field]
    const v = r instanceof Date ? r.getTime() / 1000 : r
    const s =
      ' ' +
      (field === 'dev' || field === 'ino' || field === 'nlink' ?
        'SCHILY.'
      : '') +
      field +
      '=' +
      v +
      '\n'
    const byteLen = utf8Length(s)
    // the digits includes the length of the digits in ascii base-10
    // so if it's 9 characters, then adding 1 for the 9 makes it 10
    // which makes it 11 chars.
    let digits = Math.floor(Math.log(byteLen) / Math.log(10)) + 1
    if (byteLen + digits >= Math.pow(10, digits)) {
      digits += 1
    }
    const len = digits + byteLen
    return len + s
  }

  static parse(str: string, ex?: HeaderData, g: boolean = false) {
    return Pax.parseBytes(new TextEncoder().encode(str), ex, g)
  }

  /** Parse the body of a PAX header entry. */
  static parseBytes(buf: Uint8Array, ex?: HeaderData, g: boolean = false) {
    return new Pax(merge(parseKV(buf), ex), g)
  }
}

const merge = (a: HeaderData, b?: HeaderData) =>
  b ? Object.assign({}, b, a) : a

// Each record is "<len> <key>=<value>\n". <len> is the byte length of
// the whole record. A value can contain a newline, so use the length
// to find the end of the record. Stop at the first malformed record.
const parseKV = (buf: Uint8Array) => {
  const set: Record<string, string | number | Date> = Object.create(null)
  let pos = 0
  while (pos < buf.length) {
    let sp = pos
    while (
      sp < buf.length &&
      (buf[sp] as number) >= 0x30 &&
      (buf[sp] as number) <= 0x39
    ) {
      sp++
    }
    if (sp === pos || buf[sp] !== 0x20) break
    const n = Number(decodeUtf8(buf, pos, sp))
    const end = pos + n
    if (end <= sp + 1 || end > buf.length || buf[end - 1] !== 0x0a) break
    parseKVLine(set, decodeUtf8(buf, sp + 1, end - 1))
    pos = end
  }
  return set
}

const parseKVLine = (
  set: Record<string, string | number | Date>,
  line: string,
) => {
  const kv = line.split('=')
  const r = kv.shift()

  if (!r) {
    return set
  }

  const k = r.replace(/^SCHILY\.(dev|ino|nlink)/, '$1')

  // The value ends at the first NUL.
  const joined = kv.join('=')
  const nul = joined.indexOf('\0')
  const v = nul === -1 ? joined : joined.slice(0, nul)
  switch (k) {
    case 'path':
    case 'linkpath':
    case 'type':
    case 'charset':
    case 'comment':
    case 'gname':
    case 'uname':
      set[k] = v
      break
    case 'ctime':
    case 'atime':
    case 'mtime':
      const d = new Date(Number(v) * 1000)
      if (!isNaN(d.getTime())) set[k] = d
      break
    case 'size':
    case 'gid':
    case 'uid':
    case 'dev':
    case 'ino':
    case 'nlink':
    case 'mode':
      // value must be a string of decimal digits
      if (!SIMPLE_NUMBER.test(v.trim())) break
      const s = +v
      if (!Number.isSafeInteger(s)) break
      set[k] = s
      break
  }
  return set
}
