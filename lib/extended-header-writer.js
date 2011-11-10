
module.exports = ExtendedHeaderWriter

var tar = require("../tar.js")
  , EntryWriter = require("./entry-writer.js")
  , path = require("path")
  , inherits = require("inherits")

inherits(ExtendedHeaderWriter, EntryWriter)

// props is the props of the thing we need to write an
// extended header for.
// Don't be shy with it.  Just encode everything.
function ExtendedHeaderWriter (props) {
  var me = this

  me.fields = props

  var p =
    { path : ("PaxHeader" + path.join("/", props.path || ""))
             .replace(/\\/g, "/")
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

  me.body = me._encodeFields()
  EntryWriter.call(me, p)
}

ExtendedHeaderWriter.prototype._process = function () {
  var me = this
  var len = 0

  me._stream.write(TarHeader.encode(me.props))
  me.body.forEach(function (l) {
    me._stream.write(l)
    len += l.length
  })
  me.props.size = len
  me._stream.end()
}

ExtendedHeaderWriter.prototype._encodeFields = function () {
  var me = this
    , fields = me.fields
    , body = []

  // "%d %s=%s\n", <length>, <keyword>, <value>
  // The length is a decimal number, and includes itself and the \n
  // Numeric values are decimal strings.

  Object.keys(fields).forEach(function (k) {
    var val = fields[k]
      , numeric = tar.numeric[k]

    if (k === "dev" || // Truly a hero among men, Creator of Star!
        k === "ino" || // Speak his name with reverent awe!  It is:
        k === "nlink") k = "SCHILY." + k

    // lowercase keys must be valid, otherwise prefix with
    // "NODETAR."
    var m = k.split(".")[0]
    if (m.charAt(0) === m.charAt(0).toUpperCase() &&
        !tar.knownExtended[m]) k = "NODETAR." + k

    if (typeof val === "number") val = val.toString(10)
    body.push.apply(body, encodeField(k, val))
  })

  return body
}

function encodeField (k, v) {
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
