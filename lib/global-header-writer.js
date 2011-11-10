module.exports = GlobalHeaderWriter

var ExtendedHeaderWriter = require("./extended-header-writer.js")
  , inherits = require("inherits")

inherits(GlobalHeaderWriter, ExtendedHeaderWriter)

function GlobalHeaderWriter (props) {
  if (!(this instanceof GlobalHeaderWriter)) {
    return new GlobalHeaderWriter(props)
  }
  ExtendedHeaderWriter.call(this, props)
  console.error("GHW set type=g", this.props)
  this.props.type = "g"
}
