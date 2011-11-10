
module.exports = ExtendedHeaderWriter

var inherits = require("inherits")
  , EntryWriter = require("./entry-writer.js")

inherits(ExtendedHeaderWriter, EntryWriter)

var tar = require("../tar.js")
  , path = require("path")
  , inherits = require("inherits")
  , TarHeader = require("./header.js")

// props is the props of the thing we need to write an
// extended header for.
// Don't be shy with it.  Just encode everything.
function ExtendedHeaderWriter (props) {
  var me = this

  if (!(me instanceof ExtendedHeaderWriter)) {
    console.error("not an EHW!")
    return new ExtendedHeaderWriter(props)
  }

  me.fields = props

  var p =
    { path : ("PaxHeader" + path.join("/", props.path || ""))
             .replace(/\\/g, "/").substr(0, 100)
    , mode : props.mode || 0666
    , uid : props.uid || 0
    , gid : props.gid || 0
    , mtime : props.mtime || Date.now() / 1000
    , type : "x"
    , linkpath : ""
    , ustar : "ustar\0"
    , ustarver : "00"
    , uname : props.uname || ""
    , gname : props.gname || ""
    , devmaj : props.devmaj || 0
    , devmin : props.devmin || 0
    }

  me._extended = me

  me.body = me._encodeFields()
  console.error("\tcalling EW from EHW", p.path)
  EntryWriter.call(me, p)
}

ExtendedHeaderWriter.prototype._writeExtended = function () {}

ExtendedHeaderWriter.prototype._process = function () {
  var me = this
  var len = 0

  if (me._processing) return
  me._processing = true

  console.error("extended props", me.constructor.name, me.props)

  me._stream.write(TarHeader.encode(me.props))
  me.body.forEach(function (l) {
    me._stream.write(l)
    len += l.length
  })
  me.props.size = len
  me._ready = true

  console.error("EHW _process calling end()")
  me.end()
}

ExtendedHeaderWriter.prototype.end = function () {
  console.error("EHW End")
  if (this._ended) return
  this._ended = true
  this._stream.end()
}

ExtendedHeaderWriter.prototype._encodeFields = function () {
  return encodeFields(this.fields)
}

function encodeFields (fields, prefix, body) {

  prefix = prefix || ""
  body = body || []

  // "%d %s=%s\n", <length>, <keyword>, <value>
  // The length is a decimal number, and includes itself and the \n
  // Numeric values are decimal strings.

  Object.keys(fields).forEach(function (k) {
    var val = fields[k]
      , numeric = tar.numeric[k]

    if (prefix) k = prefix + "." + k

    if (k === "dev" || // Truly a hero among men, Creator of Star!
        k === "ino" || // Speak his name with reverent awe!  It is:
        k === "nlink") k = "SCHILY." + k

    if (k === "block") return

    if (val && typeof val === "object" &&
        !Buffer.isBuffer(val)) encodeFields(val, k, body)
    else if (val === null || val === undefined) return
    else body.push.apply(body, encodeField(k, val))
  })

  return body
}

function encodeField (k, v) {
  // lowercase keys must be valid, otherwise prefix with
  // "NODETAR."
  if (k.charAt(0) === k.charAt(0).toLowerCase()) {
    var m = k.split(".")[0]
    if (!tar.knownExtended[m]) k = "NODETAR." + k
  }

  if (typeof val === "number") val = val.toString(10)

  var s = new Buffer(" " + k + "=" + v + "\n")
    , digits = Math.floor(Math.log(s.length) / Math.log(10)) + 1

  // if adding that many digits will make it go over that length,
  // then add one to it. For example, if the string is:
  // " foo=bar\n"
  // then that's 9 characters.  With the "9", that bumps the length
  // up to 10.  However, this is invalid:
  // "10 foo=bar\n"
  // but, since that's actually 11 characters, since 10 adds another
  // character to the length, and the length includes the number
  // itself.  In that case, just bump it up by 1.
  if (s.length > Math.pow(10, digits) - digits) digits ++

  return [new Buffer("" + digits), s]
}
