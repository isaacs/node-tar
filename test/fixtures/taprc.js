const fs = require('fs')
const path = require('path')

if (process.platform === 'win32') {
  fs.writeFileSync(path.resolve(__dirname, '..', '..', '.taprc'), [
    'lines: 98',
    'branches: 98',
    'statements: 98',
    'functions: 98',
  ].join('\n'))
}
