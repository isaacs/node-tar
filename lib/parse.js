'use strict';

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
const PROCESSENTRY = Symbol('processEntry')
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
const CONSUMECHUNKSUB = Symbol('consumeChunkSub')
const CONSUMING = Symbol('consuming')
const BUFFERCONCAT = Symbol('bufferConcat')
const MAYBEEND = Symbol('maybeEnd')
const WRITING = Symbol('writing')

// let slices = 0
// Buffer.prototype.slice = (original => function () {
//   slices ++
//   return original.apply(this, arguments)
// })(Buffer.prototype.slice)

//const timerLogs = []
//process.on('timerlog', msg => timerLogs.push(msg))
//process.on('exit', _ => timerLogs.forEach(msg => console.error(msg)))
//
//const timer = (start, msg) => {
//  const end = process.hrtime(start)
//  const t = ((end[0]*1e3 + end[1]/1e6) + '').substr(0, 7)
//  const space = t.length < 8 ? new Array(8 - t.length + 1).join(' ') : ''
//  process.emit('timerlog', t + space + msg)
//}

function noop () { return true }

module.exports = class Parser extends EE {
  constructor (opt) {
    const start = process.hrtime()
    // timer(start, '<< constructor')
    opt = opt || {}
    super(opt)

    this.strict = !!opt.strict
    this.maxMetaEntrySize = opt.maxMetaEntrySize || maxMetaEntrySize
    this.filter = typeof opt.filter === 'function' ? opt.filter : noop

    this[QUEUE] = [] // new Yallist
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
    // timer(start, '>> constructor')
  }

  consumeHeader (chunk, position) {
    // timer(this.timer, '<< consumeHeader')
    const header = new Header(chunk, position)
    // timer(this.timer, '-- consumeHeader after new Header')

    if (header.nullBlock)
      this[EMIT]('nullBlock')
    else if (!header.cksumValid)
      this.warn('invalid entry', header)
    else if (!header.path)
      this.warn('invalid: path is required', header)
    else {
      const type = header.type
      if (/^(Symbolic)?Link$/.test(type) && !header.linkpath)
        this.warn('invalid: linkpath required', header)
      else if (!/^(Symbolic)?Link$/.test(type) && header.linkpath)
        this.warn('invalid: linkpath forbidden', header)
      else {
        // timer(this.timer, '-- consumeHeader valid')
        const entry = this[WRITEENTRY] = new Entry(header, this[EX], this[GEX])

        if (entry.meta) {
          // timer(this.timer, '-- consumeHeader meta')
          if (entry.size > this.maxMetaEntrySize) {
            entry.ignore = true
            this[EMIT]('ignoredEntry', entry)
            this[STATE] = 'ignore'
          } else if (entry.size > 0) {
            this[META] = ''
            entry.on('data', c => this[META] += c)
            this[STATE] = 'meta'
          }
        } else {
          // timer(this.timer, '-- consumeHeader body ' + entry.path)

          this[EX] = null
          entry.ignore = entry.ignore || !this.filter(entry.path, entry)
          if (entry.ignore) {
            this[EMIT]('ignoredEntry', entry)
            this[STATE] = entry.remain ? 'ignore' : 'begin'
          } else {
            if (entry.remain)
              this[STATE] = 'body'
            else {
              this[STATE] = 'begin'
              entry.end()
            }

            if (!this[READENTRY]) {
              this[QUEUE].push(entry)
              this[NEXTENTRY]()
            } else
              this[QUEUE].push(entry)
          }
        }
      }
    }

    // timer(this.timer, '>> consumeHeader ' + this[STATE] + '\n')
  }

  [PROCESSENTRY] (entry) {
    // timer(this.timer, '<< processEntry ' + (entry && (entry.path || entry[0])))
    let go = true

    if (!entry) {
      this[READENTRY] = null
      go = false
    } else if (Array.isArray(entry))
      this.emit.apply(this, entry)
    else {
      this[READENTRY] = entry
      this.emit('entry', entry)
      if (!entry.emittedEnd) {
        // timer(this.timer, '-- processEntry !endEmitted')
        entry.on('end', _ => this[NEXTENTRY]())
        go = false
      }
    }

    // timer(this.timer, '>> processEntry ' + go)
    return go
  }

  [NEXTENTRY] () {
    // timer(this.timer, '<< nextEntry')
    while (this[PROCESSENTRY](this[QUEUE].shift())) {
      continue
    }

    if (!this[QUEUE].length) {
      // timer(this.timer, '-- nextEntry queue drain')
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
     // timer(this.timer, '>> nextEntry')
  }

  consumeBody (chunk, position) {
    // timer(this.timer, '<< consumeBody')
    // write up to but no  more than writeEntry.blockRemain
    const entry = this[WRITEENTRY]
    const br = entry.blockRemain
    const c = (br >= chunk.length && position === 0) ? chunk
      : chunk.slice(position, position + br)

    entry.write(c)

    if (!entry.blockRemain) {
      this[STATE] = 'begin'
      this[WRITEENTRY] = null
      entry.end()
    }

    // timer(this.timer, '>> consumeBody ' + c.length)
    return c.length
  }

  consumeMeta (chunk, position) {
    // timer(this.timer, '<< consumeMeta')
    const entry = this[WRITEENTRY]
    const ret = this.consumeBody(chunk, position)

    // if we finished, then the entry is reset
    if (!this[WRITEENTRY])
      this[EMITMETA](entry)

    // timer(this.timer, '>> consumeMeta')
    return ret
  }

  [EMIT] (ev, data, extra) {
    // timer(this.timer, '<< EMIT ' + ev)
    if (!this[QUEUE].length && !this[READENTRY])
      this.emit(ev, data, extra)
    else
      this[QUEUE].push([ev, data, extra])
    // timer(this.timer, '>> EMIT ' + ev + ' ' + this[QUEUE].length)
  }

  [EMITMETA] (entry) {
    // timer(this.timer, '<< EMITMETA')
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
    // timer(this.timer, '>> EMITMETA')
  }

  write (chunk) {
    // timer(this.timer, '<< write')
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

    // timer(this.timer, '>> write ret=' + ret)
    return ret
  }

  [BUFFERCONCAT] (c) {
    if (c)
      this[BUFFER] = this[BUFFER] ? Buffer.concat([this[BUFFER], c]) : c
  }

  [MAYBEEND] () {
    // timer(this.timer, 'maybeEnd ' + this[ENDED] + ' ' + this[EMITTEDEND])
    if (this[ENDED] && !this[EMITTEDEND]) {
      this[EMITTEDEND] = true
      this[EMIT]('end')
    }
  }

  [CONSUMECHUNK] (chunk_) {
    // timer(this.timer, '<< consumeChunk main')
    const chunk = chunk_
    if (this[CONSUMING]) {
      this[BUFFERCONCAT](chunk)
    } else if (!chunk && !this[BUFFER]) {
      this[MAYBEEND]()
    } else {
      this[CONSUMING] = true
      if (this[BUFFER]) {
        this[BUFFERCONCAT](chunk)
        const c = this[BUFFER]
        this[BUFFER] = null
        this[CONSUMECHUNKSUB](c)
      } else {
        this[CONSUMECHUNKSUB](chunk)
      }

      while (this[BUFFER] && this[BUFFER].length >= 512) {
        const c = this[BUFFER]
        this[BUFFER] = null
        this[CONSUMECHUNKSUB](c)
      }
      this[CONSUMING] = false
    }

    if (!this[BUFFER])
      this[MAYBEEND]()
    // timer(this.timer, '>> consumeChunk main')
  }

  [CONSUMECHUNKSUB] (chunk_) {
    let chunk = chunk_
    // we know that we are in CONSUMING mode, so anything written goes into
    // the buffer.  Advance the position and put any remainder in the buffer.
    let position = 0
    let length = chunk.length
    while (position + 512 <= length) {
      switch (this[STATE]) {
        case 'begin':
          this.consumeHeader(chunk, position)
          position += 512
          break

        case 'ignore':
        case 'body':
          position += this.consumeBody(chunk, position)
          break

        case 'meta':
          position += this.consumeMeta(chunk, position)
          break

        /* istanbul ignore next */
        default:
          throw new Error('invalid state: ' + this[STATE])
      }
    }

    if (position < length) {
      if (this[BUFFER])
        this[BUFFER] = Buffer.concat([chunk.slice(position), this[BUFFER]])
      else
        this[BUFFER] = chunk.slice(position)
    }
  }

  warn (msg, data) {
    // timer(this.timer, '<< warn')
    if (!this.strict)
      this.emit('warn', msg, data)
    else if (data instanceof Error)
      this.emit('error', data)
    else {
      const er = new Error(msg)
      er.data = data
      this[EMIT]('error', er)
    }
    // timer(this.timer, '>> warn')
  }

  end (chunk) {
    // timer(this.timer, '<< end')
    if (this[UNZIP])
      this[UNZIP].end(chunk)
    else {
      this[ENDED] = true
      this.write(chunk)
    }
    // timer(this.timer, '>> end')
  }
}
