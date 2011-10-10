// parse a 512-byte header block to a data object, or vice-versa
// If the data won't fit nicely in a simple header, then generate
// the appropriate extended header file, and return that.

module.exports = TarHeaderReader

var tar = require("../tar.js")
  , assert = require("assert").ok

function TarHeaderReader (block) {
  if (!(this instanceof TarHeaderReader)) return new TarHeaderReader(block)
  if (block) this.decode(block)
}

TarHeaderReader.prototype =
  { decode : decode
  , checkSum: checkSum
  , encode: encode }

function encode () {
  throw new Error("stub")
}

function checkSum (block) {
  block = block || this.block
  assert(Buffer.isBuffer(block) && block.length === tar.headerSize)

  if (!block) throw new Error("Need block to checksum")

  var cksum = block.slice(fieldOffs[fields.CKSUM], fieldEnds[fields.CKSUM])
  cksum = parseNumeric(cksum)

  // now figure out what it would be if the cksum was "        "
  var sum = 0
  for (var i = 0; i < fieldOffs[field.CKSUM]; i ++) {
    sum += block[i]
  }
  var space = " ".charCodeAt(0)
  for (var i = fieldOffs[field.CKSUM]; i < fieldOffs[field.CKSUM + 1]; i ++) {
    sum += space
  }
  for (var i = fieldOffs[field.CKSUM + 1]; i < tar.headerSize; i ++) {
    sum += block[i]
  }

  return cksum === sum
}

function decode (block) {
  assert(Buffer.isBuffer(block) && block.length === tar.headerSize)

  this.block = block
  this.checkSum()

  // slice off each field.
  var fields = tar.fields
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

