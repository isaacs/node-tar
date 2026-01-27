import {
  lstatSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'fs'
import { resolve } from 'path'
import t from 'tap'
import { Header, x } from 'tar'

const targetSym = '/some/absolute/path'
const absoluteWithDotDot = '/../a/target'

const getExploitTar = () => {
  const chunks: Buffer[] = []

  const hardHeader = Buffer.alloc(512)
  new Header({
    path: 'exploit_hard',
    type: 'Link',
    size: 0,
    linkpath: resolve(t.testdirName, 'secret.txt'),
  }).encode(hardHeader, 0)
  chunks.push(hardHeader)

  const hardSubHeader = Buffer.alloc(1024)
  new Header({
    path: 'sub/',
    type: 'Directory',
    size: 0,
  }).encode(hardSubHeader, 0)
  new Header({
    path: 'sub/exploit_sub',
    type: 'Link',
    size: 0,
    linkpath: '../secret.txt',
  }).encode(hardSubHeader, 512)
  chunks.push(hardSubHeader)

  const symHeader = Buffer.alloc(512)
  new Header({
    path: 'exploit_sym',
    type: 'SymbolicLink',
    size: 0,
    linkpath: targetSym,
  }).encode(symHeader, 0)
  chunks.push(symHeader)

  const escapeHeader = Buffer.alloc(512)
  new Header({
    path: 'secret.txt',
    type: 'SymbolicLink',
    linkpath: '../secret.txt',
  }).encode(escapeHeader, 0)
  chunks.push(escapeHeader)

  const aDirHeader = Buffer.alloc(512)
  new Header({
    path: 'a/',
    type: 'Directory',
    mode: 0o755,
  }).encode(aDirHeader, 0)
  chunks.push(aDirHeader)

  const absWithDotDotHeader = Buffer.alloc(512)
  new Header({
    path: 'a/link',
    type: 'SymbolicLink',
    linkpath: absoluteWithDotDot,
  }).encode(absWithDotDotHeader, 0)
  chunks.push(absWithDotDotHeader)

  chunks.push(Buffer.alloc(1024))
  return Buffer.concat(chunks)
}

const dir = t.testdir({
  'secret.txt': 'ORIGINAL DATA',
  'exploit.tar': getExploitTar(),
  out: {},
})

const out = resolve(dir, 'out')
const tarFile = resolve(dir, 'exploit.tar')

t.test('hardlink escape does not clobber target', async t => {
  await x({ cwd: out, file: tarFile })

  writeFileSync(resolve(out, 'exploit_hard'), 'OVERWRITTEN')
  t.equal(
    readFileSync(resolve(dir, 'secret.txt'), 'utf8'),
    'ORIGINAL DATA',
  )

  writeFileSync(resolve(out, 'sub/exploit_sub'), 'OVERWRITTEN SUB')
  t.equal(
    readFileSync(resolve(dir, 'secret.txt'), 'utf8'),
    'ORIGINAL DATA',
  )
})

t.test('symlink escapes are sanitized', async t => {
  await x({ cwd: out, file: tarFile })

  t.not(readlinkSync(resolve(out, 'exploit_sym')), targetSym)
  t.throws(() => lstatSync(resolve(out, 'secret.txt')), {
    code: 'ENOENT',
  })
})

t.test('absolute symlink with .. has prefix stripped', async t => {
  await x({ cwd: out, file: tarFile })

  t.equal(
    readlinkSync(resolve(out, 'a/link')),
    '../a/target',
    'symlink target should be normalized',
  )
})
