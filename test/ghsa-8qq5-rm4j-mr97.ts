import { readFileSync, readlinkSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import t from 'tap'
import { Header, x } from 'tar'

const targetSym = '/some/absolute/path'

const getExploitTar = () => {
  const exploitTar = Buffer.alloc(512 + 512 + 1024)

  new Header({
    path: 'exploit_hard',
    type: 'Link',
    size: 0,
    linkpath: resolve(t.testdirName, 'secret.txt'),
  }).encode(exploitTar, 0)

  new Header({
    path: 'exploit_sym',
    type: 'SymbolicLink',
    size: 0,
    linkpath: targetSym,
  }).encode(exploitTar, 512)

  return exploitTar
}

const dir = t.testdir({
  'secret.txt': 'ORIGINAL DATA',
  'exploit.tar': getExploitTar(),
  out_repro: {},
})

const out = resolve(dir, 'out_repro')
const tarFile = resolve(dir, 'exploit.tar')

t.test('verify that linkpaths get sanitized properly', async t => {
  await x({
    cwd: out,
    file: tarFile,
    preservePaths: false,
  })

  writeFileSync(resolve(out, 'exploit_hard'), 'OVERWRITTEN')
  t.equal(readFileSync(resolve(dir, 'secret.txt'), 'utf8'), 'ORIGINAL DATA')

  t.not(readlinkSync(resolve(out, 'exploit_sym')), targetSym)
})
