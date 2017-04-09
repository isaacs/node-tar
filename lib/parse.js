'use strict'
// TODO:
// - set a parallelism level, so that multiple files can be piped out at once
// This will only be ok if they aren't the same file, parent dirs, etc.

// this[BUFFER] is the remainder of a chunk if we're waiting for
// the full 512 bytes of a header to come in.  We will Buffer.concat()
// it to the next write(), which is a mem copy, but a small one.
//
// this[QUEUE] is a Yallist of entries that haven't been emitted
// yet this can only get filled up if the user keeps write()ing after
// a write() returns false, or does a write() with more than one entry
//
// We don't buffer chunks, we always parse them and either create an
// entry, or push it into the active entry.  The ReadEntry class knows
// to throw data away if .ignore=true
//
// Shift entry off the buffer when it emits 'end', and emit 'entry' for
// the next one in the list.
//
// At any time, we're pushing body chunks into the entry at WRITEENTRY,
// and waiting for 'end' on the entry at READENTRY
//
// ignored entries get .resume() called on them straight away

const Header = require('./header.js')
const EE = require('events')
const Yallist = require('yallist')
const maxMetaEntrySize = 1024 * 1024
const Entry = require('./read-entry.js')
const Pax = require('./pax.js')
const zlib = require('minizlib')

const gzipHeader = new Buffer([0x1f, 0x8b])
const STATE = Symbol('state')
const WRITEENTRY = Symbol('writeEntry')
const READENTRY = Symbol('readEntry')
const NEXTENTRY = Symbol('nextEntry')
const EX = Symbol('extendedHeader')
const GEX = Symbol('globalExtendedHeader')
const META = Symbol('meta')
const EMITMETA = Symbol('emitMeta')
const BUFFER = Symbol('buffer')
const QUEUE = Symbol('queue')
const ENDED = Symbol('ended')
const UNZIP = Symbol('unzip')
const CONSUMECHUNK = Symbol('consumeChunk')
module.exports = class Parser extends EE {
  constructor (opt) {
    opt = opt || {}
    super(opt)

    this.maxMetaEntrySize = opt.maxMetaEntrySize || maxMetaEntrySize
    this.filter = typeof opt.filter === 'function' ? opt.filter : _=>true

    this[QUEUE] = new Yallist
    this[BUFFER] = null
    this[READENTRY] = null
    this[WRITEENTRY] = null
    this[STATE] = 'begin'
    this[META] = ''
    this[EX] = null
    this[GEX] = null
    this[ENDED] = false
    this[UNZIP] = null
  }

  consumeHeader (chunk) {
    const header = new Header(chunk)

    // probably a null block, definitely not valid
    if (!header.cksumValid) {
      for (let i = 0; i < 512; i++) {
        if (chunk[i])
          return this.warn('invalid entry', header)
      }
      return this.emit('nullBlock')
    }

    if (!header.path)
      return this.warn('invalid: path is required', header)

    if (/(Symbolic)?Link/.test(header.type) && !header.linkpath)
      return this.warn('invalid: linkpath required', header)

    if (!/(Symbolic)?Link/.test(header.type) && header.linkpath)
      return this.warn('invalid: linkpath forbidden', header)

    const entry = this[WRITEENTRY] = new Entry(header, this[EX], this[GEX])

    if (entry.meta) {
      if (entry.size > this.maxMetaEntrySize) {
        this.emit('ignoredEntry', entry)
        entry.ignore = true
        this[STATE] = ignore
      } else if (entry.size > 0) {
        this[META] = ''
        entry.on('data', c => this[META] += c)
        this[STATE] = 'meta'
      }
      return
    }

    this[EX] = null
    entry.ignore = entry.ignore || !this.filter(entry)
    if (entry.ignore) {
      this.emit('ignoredEntry', entry)
      this[STATE] = entry.remain ? 'ignore' : 'begin'
      return
    }

    if (!entry.size)
      entry.end()
    this[STATE] = entry.remain ? 'body' : 'begin'

    this[QUEUE].push(entry)
    if (!this[READENTRY])
      this[NEXTENTRY]()
  }

  [NEXTENTRY] () {
    while (this[READENTRY] = this[QUEUE].shift()) {
      let entry = this[READENTRY]
      this.emit('entry', entry)
      if (!entry.emittedEnd) {
        entry.on('end', _ => this[NEXTENTRY]())
        break
      }
    }
    if (!this[QUEUE].length)
      this.emit('drain')
  }

  consumeBodyChunk (chunk) {
    // write up to but no  more than writeEntry.blockRemain
    const entry = this[WRITEENTRY]
    const br = entry.blockRemain
    const c = chunk.length <= br ? chunk : chunk.slice(0, br)
    entry.write(c)
    if (!entry.blockRemain) {
      entry.end()
      this[STATE] = 'begin'
      this[WRITEENTRY] = null
    }
    return c === chunk ? null : chunk.slice(br)
  }

  consumeMeta (chunk) {
    const entry = this[WRITEENTRY]
    const ret = this.consumeBodyChunk(chunk)

    // if we finished, then the entry is reset
    if (!this[WRITEENTRY])
      this[EMITMETA](entry)

    return ret
  }

  [EMITMETA] (entry) {
    this.emit('meta', this[META])
    switch (entry.type) {
      case 'ExtendedHeader':
      case 'OldExtendedHeader':
        this[EX] = Pax.parse(this[META], this[EX], false)
        break

      case 'GlobalExtendedHeader':
        this[GEX] = Pax.parse(this[META], this[GEX], true)
        break

      case 'NextFileHasLongPath':
      case 'OldGnuLongPath':
        this[EX] = this[EX] || Object.create(null)
        this[EX].path = this[META]
        break

      case 'NextFileHasLongLinkpath':
        this[EX] = this[EX] || Object.create(null)
        this[EX].linkpath = this[META]
        break

      /* istanbul ignore next */
      default: throw new Error('unknown meta: ' + entry.type)
    }
  }

  write (chunk) {
    // first write, might be gzipped
    if (this[UNZIP] === null && chunk) {
      if (this[BUFFER]) {
        chunk = Buffer.concat([this[BUFFER], chunk])
        this[BUFFER] = null
      }
      if (chunk.length < gzipHeader.length) {
        this[BUFFER] = chunk
        return true
      }
      for (let i = 0; this[UNZIP] === null && i < gzipHeader.length; i++) {
        if (chunk[i] !== gzipHeader[i])
          this[UNZIP] = false
      }
      if (this[UNZIP] === null) {
        this[UNZIP] = new zlib.Unzip()
        this[UNZIP].on('data', chunk => this[CONSUMECHUNK](chunk))
      }
    }

    if (this[UNZIP]) {
      if (this[ENDED])
        this[UNZIP].end(chunk)
      else
        this[UNZIP].write(chunk)
    } else
      this[CONSUMECHUNK](chunk)

    // return false if there's a queue, or if the current entry isn't flowing
    const ret = this[STATE] === 'begin' ? true
      : this[STATE] === 'ignore' ? true
      : this[STATE] === 'meta' ? true
      : this[QUEUE].length ? false
      : true

    return ret
  }

  [CONSUMECHUNK] (chunk) {
    if (chunk && this[BUFFER]) {
      chunk = Buffer.concat([this[BUFFER], chunk])
      this[BUFFER] = null
    }

    while (chunk && chunk.length >= 512) {
      switch (this[STATE]) {
        case 'begin':
          // consume the header, create the entry, enter the next state
          this.consumeHeader(chunk.slice(0, 512))
          chunk = chunk.slice(512)
          break

        case 'ignore':
        case 'body':
          chunk = this.consumeBodyChunk(chunk)
          break

        case 'meta':
          chunk = this.consumeMeta(chunk)
          break

        default:
          throw new Error('invalid state: ' + this[STATE])
      }
    }

    // XXX: this is a writable stream, so 'end' isn't appropriate
    // we ought to emit 'finished', once the last byte has cleared
    // through the last entry.
    if (chunk && chunk.length)
      this[BUFFER] = chunk
    else if (this[ENDED])
      this.emit('end')
  }

  warn (msg, data) {
    if (!this.strict)
      return this.emit('warn', msg, data)

    const er = new Error(msg)
    if (data)
      er.data = data
    this.emit('error', er)
  }

  end (chunk) {
    this[ENDED] = true
    this.write(chunk)
  }
}
