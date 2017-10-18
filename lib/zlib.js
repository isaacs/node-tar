'use strict'
const semver = require('semver')

module.exports = select(process.version)
module.exports._SELECT_ZLIB = select

function select (version) {
  return semver.gt(version, 'v9.0.0-0') ? require('zlib') : require('minizlib')
}
