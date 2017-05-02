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

const path = require('path')
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
const EMITTEDEND = Symbol('emittedEnd')
const EMIT = Symbol('emit')
const UNZIP = Symbol('unzip')
const CONSUMECHUNK = Symbol('consumeChunk')
const CONSUMING = Symbol('consuming')
const WRITING = Symbol('writing')

const timerLogs = []
process.on('timerlog', msg => timerLogs.push(msg))
process.on('exit', _ => timerLogs.forEach(msg => console.error(msg)))

const timer = (start, msg) => {
  const end = process.hrtime(start)
  const t = (end[0]*1e3 + end[1]/1e6) + ''
  const space = t.length < 8 ? new Array(8 - t.length + 1).join(' ') : ''
  process.emit('timerlog', t + space + msg)
}

module.exports = class Parser extends EE {
  constructor (opt) {
    const start = process.hrtime()
    timer(start, '<< constructor')
    opt = opt || {}
    super(opt)

    this.strict = !!opt.strict
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
    if (typeof opt.onwarn === 'function')
      this.on('warn', opt.onwarn)
    if (typeof opt.onentry === 'function')
      this.on('entry', opt.onentry)

    this.timer = start
    timer(start, '>> constructor')
  }

  consumeHeader (chunk) {
    timer(this.timer, '<< consumeHeader')
    const header = new Header(chunk)
    timer(this.timer, '-- consumeHeader after new Header')

    if (header.nullBlock) {
      timer(this.timer, '>> consumeHeader nullBlock')
      return this[EMIT]('nullBlock')
    }

    if (!header.cksumValid) {
      timer(this.timer, '>> consumeHeader invalid')
      return this.warn('invalid entry', header)
    }

    if (!header.path) {
      timer(this.timer, '>> consumeHeader no path')
      return this.warn('invalid: path is required', header)
    }

    if (/^(Symbolic)?Link$/.test(header.type) && !header.linkpath) {
      timer(this.timer, '>> consumeHeader no linkpath')
      return this.warn('invalid: linkpath required', header)
    }

    if (!/^(Symbolic)?Link$/.test(header.type) && header.linkpath) {
      timer(this.timer, '>> consumeHeader forbidden linkpath')
      return this.warn('invalid: linkpath forbidden', header)
    }

    timer(this.timer, '-- consumeHeader before new Entry')
    const entry = this[WRITEENTRY] = new Entry(header, this[EX], this[GEX])
    timer(this.timer, '-- consumeHeader after new Entry')

    if (entry.meta) {
      if (entry.size > this.maxMetaEntrySize) {
        entry.ignore = true
        this[EMIT]('ignoredEntry', entry)
        this[STATE] = 'ignore'
      } else if (entry.size > 0) {
        this[META] = ''
        entry.on('data', c => this[META] += c)
        this[STATE] = 'meta'
      }
      timer(this.timer, '>> consumeHeader, meta')
      return
    }

    this[EX] = null
    entry.ignore = entry.ignore || !this.filter(entry.path, entry)
    if (entry.ignore) {
      this[EMIT]('ignoredEntry', entry)
      this[STATE] = entry.remain ? 'ignore' : 'begin'
      timer(this.timer, '>> consumeHeader, ignore')
      return
    }

    timer(this.timer, '-- consumeHeader before size check')
    const rem = entry.remain
    if (!rem)
      entry.end()
    this[STATE] = rem ? 'body' : 'begin'

    timer(this.timer, '-- consumeHeader before nextEntry')
    // XXX: we push and then pop it right out.  slow?
    if (!this[READENTRY]) {
      if (!this[QUEUE].length)
        this[NEXTENTRY](entry)
      else {
        this[QUEUE].push(entry)
        this[NEXTENTRY]()
      }
    } else
      this[QUEUE].push(entry)

    timer(this.timer, '-- consumeHeader after nextEntry')

    timer(this.timer, '>> consumeHeader\n')
  }

  [NEXTENTRY] () {
    timer(this.timer, '<< nextEntry')
    while (this[READENTRY] = this[QUEUE].shift()) {
      if (Array.isArray(this[READENTRY])) {
        this.emit.apply(this, this[READENTRY])
        continue
      }

      let entry = this[READENTRY]
      this.emit('entry', entry)
      if (!entry.emittedEnd) {
        entry.on('end', _ => this[NEXTENTRY]())
        break
      }
    }

    if (!this[QUEUE].length) {
      // At this point, there's nothing in the queue, but we may have an
      // entry which is being consumed (readEntry).
      // If we don't, then we definitely can handle more data.
      // If we do, and either it's flowing, or it has never had any data
      // written to it, then it needs more.
      // The only other possibility is that it has returned false from a
      // write() call, so we wait for the next drain to continue.
      const re = this[READENTRY]
      const drainNow = !re || re.flowing || re.size === re.remain
      if (drainNow) {
        if (!this[WRITING])
          this.emit('drain')
      } else
        re.once('drain', _ => this.emit('drain'))
    }
    timer(this.timer, '>> nextEntry')
  }

  consumeBodyChunk (chunk) {
    timer(this.timer, '<< consumeBodyChunk')
    // write up to but no  more than writeEntry.blockRemain
    const entry = this[WRITEENTRY]
    const br = entry.blockRemain
    const c = chunk.length <= br ? chunk : chunk.slice(0, br)
    entry.write(c)

    if (!entry.blockRemain) {
      this[STATE] = 'begin'
      this[WRITEENTRY] = null
      entry.end()
    }

    timer(this.timer, '>> consumeBodyChunk\n')
    return chunk.length <= br ? null : chunk.slice(br)
  }

  consumeMeta (chunk) {
    timer(this.timer, '<< consumeMeta')
    const entry = this[WRITEENTRY]
    const ret = this.consumeBodyChunk(chunk)

    // if we finished, then the entry is reset
    if (!this[WRITEENTRY])
      this[EMITMETA](entry)

    timer(this.timer, '>> consumeMeta')
    return ret
  }

  [EMIT] (ev, data, extra) {
    timer(this.timer, '<< EMIT ' + ev)
    if (!this[QUEUE].length && !this[READENTRY])
      this.emit(ev, data, extra)
    else
      this[QUEUE].push([ev, data, extra])
    timer(this.timer, '>> EMIT ' + ev)
  }

  [EMITMETA] (entry) {
    timer(this.timer, '<< EMITMETA')
    this[EMIT]('meta', this[META])
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
    timer(this.timer, '>> EMITMETA')
  }

  write (chunk) {
    timer(this.timer, '<< write')
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
        const ended = this[ENDED]
        this[ENDED] = false
        this[UNZIP] = new zlib.Unzip()
        this[UNZIP].on('data', chunk => this[CONSUMECHUNK](chunk))
        this[UNZIP].on('end', _ => {
          this[ENDED] = true
          this[CONSUMECHUNK]()
        })
        return ended ? this[UNZIP].end(chunk) : this[UNZIP].write(chunk)
      }
    }

    this[WRITING] = true
    if (this[UNZIP])
      this[UNZIP].write(chunk)
    else
      this[CONSUMECHUNK](chunk)
    this[WRITING] = false

    // return false if there's a queue, or if the current entry isn't flowing
    const ret =
      this[QUEUE].length ? false :
      this[READENTRY] ? this[READENTRY].flowing :
      true

    // if we have no queue, then that means a clogged READENTRY
    if (!ret && !this[QUEUE].length)
      this[READENTRY].once('drain', _ => this.emit('drain'))

    timer(this.timer, '>> write ret=' + ret)
    return ret
  }

  [CONSUMECHUNK] (chunk) {
    timer(this.timer, '<< CONSUMECHUNK')
    if (this[CONSUMING]) {
      if (chunk)
        this[BUFFER] = this[BUFFER] ? Buffer.concat([this[BUFFER], chunk]) : chunk
      return
    }

    this[CONSUMING] = true
    if (chunk && this[BUFFER]) {
      chunk = Buffer.concat([this[BUFFER], chunk])
      this[BUFFER] = null
    }

    // double-while to re-check if there's a buffer after each pass.
    // will typically either fail both or pass both but this is slightly
    // less copying, because there's no need to keep re-concatting if we
    // still have >512 bytes of chunk left.
    while (chunk && chunk.length >= 512) {
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

          /* istanbul ignore next */
          default:
            throw new Error('invalid state: ' + this[STATE])
        }
      }
      if (this[BUFFER]) {
        // acquired more along the way
        chunk = chunk ? Buffer.concat([chunk, this[BUFFER]]) : this[BUFFER]
        this[BUFFER] = null
      }
    }
    this[CONSUMING] = false

    // XXX: this is a writable stream, so 'end' isn't appropriate
    // we ought to emit 'finished', once the last byte has cleared
    // through the last entry.
    if (chunk && chunk.length)
      this[BUFFER] = chunk
    else if (this[ENDED] && !this[EMITTEDEND]) {
      this[EMITTEDEND] = true
      this[EMIT]('end')
    }
    timer(this.timer, '>> CONSUMECHUNK')
  }

  warn (msg, data) {
    timer(this.timer, '<< warn')
    if (!this.strict)
      return this.emit('warn', msg, data)

    if (data instanceof Error)
      return this.emit('error', data)

    const er = new Error(msg)
    er.data = data
    this[EMIT]('error', er)
    timer(this.timer, '>> warn')
  }

  end (chunk) {
    timer(this.timer, '<< end')
    if (this[UNZIP])
      this[UNZIP].end(chunk)
    else {
      this[ENDED] = true
      this.write(chunk)
    }
    timer(this.timer, '>> end')
  }
}
