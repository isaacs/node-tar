// parse a 512-byte header block to a data object, or vice-versa
// If the data won't fit nicely in a simple header, then generate
// the appropriate extended header file, and return that.

module.exports = TarHeader

var tar = require("../tar.js")
  , fields = tar.fields
  , fieldOffs = tar.fieldOffs
  , fieldEnds = tar.fieldEnds
  , assert = require("assert").ok

function TarHeader (block) {
  if (!(this instanceof TarHeader)) return new TarHeader(block)
  if (block) this.decode(block)
}

TarHeader.prototype =
  { decode : decode
  , encode: encode
  , calcSum: calcSum
  , checkSum: checkSum }

// note that this will only do the normal ustar header, not any kind
// of extended posix header file.  If something doesn't fit comfortably,
// then it will set obj.needsExtendedHeader=true, and set the block to
// the closest approximation.
function encode (obj) {
  obj = obj || this
  var block = obj.block = new Buffer(tar.headerSize)

  Object.keys(fields).forEach(function (f) {
    var off = fieldOffs[fields[f]]
      , end = fieldEnds[fields[f]]

    switch (f) {
      case "mode":
      case "uid":
      case "gid":
      case "size":
      case "mtime":
        writeNumeric(block, off, end, obj[f])
        break

      // all other fields are text
      case default:
        obj.needExtended = writeText(block, off, end, obj[f])
        break
    }
  })

  var off = fieldOffs[fields.cksum]
    , end = fieldEnds[fields.cksum]

  writeNumeric(block, off, end, calcSum.call(this, block))

  return block
}

function calcSum (block) {
  block = block || this.block
  assert(Buffer.isBuffer(block) && block.length === tar.headerSize)

  if (!block) throw new Error("Need block to checksum")

  // now figure out what it would be if the cksum was "        "
  var sum = 0
    , space = " ".charCodeAt(0)
    , start = fieldOffs[fields.cksum]
    , end = fieldEnds[fields.cksum]

  for (var i = 0; i < fieldOffs[fields.cksum]; i ++) {
    sum += block[i]
  }

  for (var i = start; i < end; i ++) {
    sum += space
  }

  for (var i = end; i < tar.headerSize; i ++) {
    sum += block[i]
  }

  return sum
}


function checkSum (block) {
  var sum = calcSum.call(this, block)

  var cksum = block.slice(fieldOffs[fields.cksum], fieldEnds[fields.cksum])
  cksum = parseNumeric(cksum)

  return cksum === sum
}

function decode (block) {
  block = block || this.block
  assert(Buffer.isBuffer(block) && block.length === tar.headerSize)

  this.block = block
  this.checkSum()

  // slice off each field.
  for (var f = 0; fields[f] !== null; f ++) {
    var field = fields[f]
    this[field] = block.slice(fieldOffs[f], fieldEnds[f])

    // if not ustar, then everything after that is invalid.
    if (field === "ustar" && this[field].toString() !== "ustar\0") {
      this[field] = new Buffer([0, 0, 0, 0, 0, 0])
      break
    }
  }

  this.mode  = parseNumeric(this.mode)
  this.uid   = parseNumeric(this.uid)
  this.gid   = parseNumeric(this.gid)
  this.size  = parseNumeric(this.size)
  this.cksum = parseNumeric(this.cksum)
  this.mtime = parseNumeric(this.mtime)

  // check for xstar header
  var atime = parseNumeric(this.prefix.slice(131, 12))
    , ctime = parseNumeric(this.prefix.slice(131 + 12, 12))
  if ((this.prefix[130] === 0 || this.prefix[130] === " ".charCodeAt(0)) &&
      typeof atime === "number" &&
      typeof ctime === "number") {
    this.atime = atime
    this.ctime = ctime
  }
}

function parse256 (buf) {
  // first byte MUST be either 80 or FF
  // 80 for positive, FF for 2's comp
  var positive
  if (buf[0] === 0x80) positive = true
  else if (buf[0] === 0xFF) positive = false
  else return 0

  if (!positive) {
    // this is rare enough that the string slowness
    // is not a big deal.  You need *very* old files
    // to ever hit this path.
    var s = ""
    for (var i = 1, l = buf.length; i < l; i ++) {
      var byte = buf[i].toString(2)
      if (byte.length < 8) {
        byte = new Array(byte.length - 8 + 1).join("1") + byte
      }
      s += byte
    }
    var ht = s.match(/^([01]*)(10*)$/)
      , head = ht[1]
      , tail = ht[2]
    head = head.split("1").join("2")
               .split("0").join("1")
               .split("2").join("0")
    return -1 * parseInt(head + tail, 2)
  }

  var sum = 0
  for (var i = 1, l = buf.length, p = l - 1; i < l; i ++, p--) {
    sum += buf[i] * Math.pow(256, p)
  }
  return sum
}

function parseNumeric (f) {
  if (f[0] & 128 === 128) {
    return parse256(f)
  }
  var str = f.toString("ascii").split("\0")[0].trim()
  return parseInt(str, 8) || 0
}

