const t = require('tap')

// run three scenarios
// unix (no fmap)
// win32 (without fmap support)
// win32 (with fmap support)

const fs = require('fs')
const hasFmap = !!fs.constants.UV_FS_O_FILEMAP
const platform = process.platform

switch (process.argv[2]) {
  case 'win32-fmap': {
    if (!hasFmap)
      fs.constants.UV_FS_O_FILEMAP = 0x20000000
    const { O_CREAT, O_TRUNC, O_WRONLY, UV_FS_O_FILEMAP } = fs.constants
    if (platform !== 'win32')
      process.env.__FAKE_PLATFORM__ = 'win32'
    const getFlag = require('../lib/get-write-flag.js')
    t.equal(getFlag(1), UV_FS_O_FILEMAP | O_TRUNC | O_CREAT | O_WRONLY)
    t.equal(getFlag(512 * 1024 + 1), 'w')
    break
  }

  case 'win32-nofmap': {
    if (hasFmap)
      fs.constants.UV_FS_O_FILEMAP = 0
    if (platform !== 'win32')
      process.env.__FAKE_PLATFORM__ = 'win32'
    const getFlag = require('../lib/get-write-flag.js')
    t.equal(getFlag(1), 'w')
    t.equal(getFlag(512 * 1024 + 1), 'w')
    break
  }

  case 'unix': {
    if (platform === 'win32')
      process.env.__FAKE_PLATFORM__ = 'darwin'
    const getFlag = require('../lib/get-write-flag.js')
    t.equal(getFlag(1), 'w')
    t.equal(getFlag(512 * 1024 + 1), 'w')
    break
  }

  default: {
    const node = process.execPath
    t.spawn(node, [__filename, 'win32-fmap'])
    t.spawn(node, [__filename, 'win32-nofmap'])
    t.spawn(node, [__filename, 'unix'])
  }
}
