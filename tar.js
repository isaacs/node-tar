// field names that every tar file must have.
// header is padded to 512 bytes.
var f = 0
  , fields = {}
  , NAME = fields.NAME = f++
  , MODE = fields.MODE = f++
  , UID = fields.UID = f++
  , GID = fields.GID = f++
  , SIZE = fields.SIZE = f++
  , MTIME = fields.MTIME = f++
  , CKSUM = fields.CKSUM = f++
  , TYPE = fields.TYPE = f++
  , LINKNAME = fields.LINKNAME = f++
  , headerSize = 512
  , blockSize = 512
  , fieldSize = []

fieldSize[NAME] = 100
fieldSize[MODE] = 8
fieldSize[UID] = 8
fieldSize[GID] = 8
fieldSize[SIZE] = 12
fieldSize[MTIME] = 12
fieldSize[CKSUM] = 8
fieldSize[TYPE] = 1
fieldSize[LINKNAME] = 100

// "ustar\0" may introduce another bunch of headers.
// these are optional, and will be nulled out if not present.
var ustar = new Buffer(6)
ustar.asciiWrite("ustar\0")

var USTAR = fields.USTAR = f++
  , USTARVER = fields.USTARVER = f++
  , UNAME = fields.UNAME = f++
  , GNAME = fields.GNAME = f++
  , DEVMAJ = fields.DEVMAJ = f++
  , DEVMIN = fields.DEVMIN = f++
  , PREFIX = fields.PREFIX = f++
  , FILL = fields.FILL = f++

// terminate fields.
fields[f] = null

fieldSize[USTAR] = 6
fieldSize[USTARVER] = 2
fieldSize[UNAME] = 32
fieldSize[GNAME] = 32
fieldSize[DEVMAJ] = 8
fieldSize[DEVMIN] = 8
fieldSize[PREFIX] = 155
fieldSize[FILL] = 12

// nb: PREFIX field may in fact be 130 bytes of prefix,
// a null char, 12 bytes for atime, 12 bytes for ctime.
//
// To recognize this format:
// 1. prefix[130] === ' ' or '\0'
// 2. atime and ctime are octal numeric values
// 3. atime and ctime have ' ' in their last byte

var fieldEnds = {}
  , fieldOffs = {}
  , fe = 0
for (var i = 0; i < f; i ++) {
  fieldOffs[i] = fe
  fieldEnds[i] = (fe += fieldSize[i])
}

// build a translation table of field names.
Object.keys(fields).forEach(function (f) {
  fields[fields[f]] = f
})

// different values of the 'type' field
// names match the values of Stats.isX() functions, where appropriate
var types =
  { 0: "File"
  , "\0": "OldFile" // like 0
  , 1: "Link"
  , 2: "SymbolicLink"
  , 3: "CharacterDevice"
  , 4: "BlockDevice"
  , 5: "Directory"
  , 6: "FIFO"
  , 7: "ContiguousFile" // like 0
  // posix headers
  , g: "GlobalExtendedHeader" // k=v for the rest of the archive
  , x: "ExtendedHeader" // k=v for the next file
  // vendor-specific stuff
  , A: "SolarisACL" // skip
  , D: "GNUDumpDir" // like 5, but with data, which should be skipped
  , I: "Inode" // metadata only, skip
  , K: "nextFileHasLongLinkname" // data = link name of next file
  , L: "nextFileHasLongName" // data = name of next file
  , M: "ContinuationFile" // skip
  , N: "OldGnuLongName" // like L
  , S: "SparseFile" // skip
  , V: "TapeVolumeHeader" // skip
  , X: "OldExtendedHeader" // like x
  }

Object.keys(types).forEach(function (t) {
  types[types[t]] = types[types[t]] || t
})

// values for the mode field
var modes =
  { suid: 04000 // set UID on extraction
  , sgid: 02000 // set GID on extraction
  , svtx: 01000 // set restricted deletion flag on dirs on extraction
  , uread:  0400
  , uwrite: 0200
  , uexec:  0100
  , gread:  040
  , gwrite: 020
  , gexec:  010
  , oread:  4
  , owrite: 2
  , oexec:  1
  , all: 07777
  }

Object.keys(modes).forEach(function (t) {
  modes[modes[t]] = modes[modes[t]] || t
})

exports.ustar = ustar
exports.fields = fields
exports.fieldSize = fieldSize
exports.fieldOffs = fieldOffs
exports.fieldEnds = fieldEnds
exports.types = types
exports.modes = modes
exports.headerSize = headerSize
exports.blockSize = blockSize

var Parser = exports.Parser = require("./parser.js")
exports.createParser = Parser.create

var Generator = exports.Generator = require("./generator.js")
exports.createGenerator = Generator.create
