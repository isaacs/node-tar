import fs from 'fs'
import t from 'tap'
import { fileURLToPath } from 'url'
import { getWriteFlag } from '../dist/esm/get-write-flag.js'

const __filename = fileURLToPath(import.meta.url)

// run three scenarios
// unix (no fmap)
// win32 (without fmap support)
// win32 (with fmap support)

const hasFmap = !!fs.constants.UV_FS_O_FILEMAP
const { platform } = process
const UV_FS_O_FILEMAP = 0x20000000

switch (process.argv[2]) {
  case 'win32-fmap': {
    const { O_CREAT, O_TRUNC, O_WRONLY } = fs.constants
    t.equal(
      getWriteFlag(1),
      UV_FS_O_FILEMAP | O_TRUNC | O_CREAT | O_WRONLY,
    )
    t.equal(getWriteFlag(512 * 1024 + 1), 'w')
    break
  }

  case 'win32-nofmap': {
    t.equal(getWriteFlag(1), 'w')
    t.equal(getWriteFlag(512 * 1024 + 1), 'w')
    break
  }

  case 'unix': {
    t.equal(getWriteFlag(1), 'w')
    t.equal(getWriteFlag(512 * 1024 + 1), 'w')
    break
  }

  default: {
    const node = process.execPath
    t.spawn(node, [__filename, 'win32-fmap'], {
      env: {
        ...process.env,
        ...(platform === 'win32' ?
          {}
        : {
            __FAKE_FS_O_FILENAME__: String(UV_FS_O_FILEMAP),
            __FAKE_PLATFORM__: 'win32',
          }),
      },
    })
    t.spawn(node, [__filename, 'win32-nofmap'], {
      env: {
        ...process.env,
        ...(platform === 'win32' ?
          {}
        : {
            __FAKE_FS_O_FILENAME__: '0',
            __FAKE_PLATFORM__: 'win32',
          }),
      },
    })
    t.spawn(node, [__filename, 'unix'], {
      env: {
        ...process.env,
        ...(platform === 'win32' ?
          { __FAKE_PLATFORM__: 'linux' }
        : {}),
      },
    })
  }
}
