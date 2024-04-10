import { basename } from 'path'

const map = test =>
  test === 'map.js'
    ? test
    : test === 'unpack.js'
      ? ['src/unpack.ts', 'src/mkdir.ts']
      : test === 'load-all.js'
        ? []
        : `src/${test.replace(/js$/, 'ts')}`

export default test => map(basename(test))
