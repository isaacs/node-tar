const platform = process.platform === 'win32' ? 'win32' : 'posix'
const { spawn } = require('child_process')
const c = spawn(process.execPath, [
  process.env.npm_execpath,
  'run',
  `test:${platform}`,
  '--',
  ...process.argv.slice(2),
], {
  stdio: 'inherit',
})
c.on('close', (code, signal) => {
  process.exitCode = code
  if (signal) {
    process.kill(process.pid, signal)
    setTimeout(() => {}, 200)
  }
})
process.on('SIGTERM', () => c.kill('SIGTERM'))
process.on('SIGINT', () => c.kill('SIGINT'))
