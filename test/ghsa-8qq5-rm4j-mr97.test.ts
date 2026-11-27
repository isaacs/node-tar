import { lstatSync, readFileSync, readlinkSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { assert, test, testdir } from 'ubqtest'
import { Header, x } from '../src/index.js'

const targetSym = '/some/absolute/path'
const absoluteWithDotDot = '/../a/target'

// The hard link error has paths that change from run to run.
const formatWarnings = (warnings: [code: string, message: string][]) =>
  warnings.map(([code, message]) => [
    code,
    message.replace(
      /^ENOENT: no such file or directory, link .*? -> .*?$/,
      'ENOENT: no such file or directory, link',
    ),
  ])

const getExploitTar = (secretLinkpath: string) => {
  const chunks: Buffer[] = []

  const hardHeader = Buffer.alloc(512)
  new Header({
    path: 'exploit_hard',
    type: 'Link',
    size: 0,
    linkpath: secretLinkpath,
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

  const winAbsWithDotDotHeader = Buffer.alloc(512)
  new Header({
    path: 'a/winrootdotslink',
    type: 'SymbolicLink',
    linkpath: 'c:..\\foo\\bar',
  }).encode(winAbsWithDotDotHeader, 0)
  chunks.push(winAbsWithDotDotHeader)

  const winAbsWithDotDotEscapeHeader = Buffer.alloc(512)
  new Header({
    path: 'a/winrootdotsescapelink',
    type: 'SymbolicLink',
    linkpath: 'c:..\\..\\..\\..\\foo\\bar',
  }).encode(winAbsWithDotDotEscapeHeader, 0)
  chunks.push(winAbsWithDotDotEscapeHeader)

  chunks.push(Buffer.alloc(1024))
  return Buffer.concat(chunks)
}

// The archive has the absolute path of secret.txt, so the folder comes
// first.
const dir = testdir({
  'secret.txt': 'ORIGINAL DATA',
  out: {},
})

const out = resolve(dir, 'out')
const tarFile = resolve(dir, 'exploit.tar')
writeFileSync(tarFile, getExploitTar(resolve(dir, 'secret.txt')))

const WARNINGS: [code: string, message: string][] = []
await x({
  cwd: out,
  file: tarFile,
  onwarn: (code: string, message: string) =>
    WARNINGS.push([code, message]),
})

test('warnings', async () => assert.snapshot(formatWarnings(WARNINGS)))

test('writefile exploits fail', async () => {
  writeFileSync(resolve(out, 'exploit_hard'), 'OVERWRITTEN')
  assert.equal(
    readFileSync(resolve(dir, 'secret.txt'), 'utf8'),
    'ORIGINAL DATA',
  )

  writeFileSync(resolve(out, 'sub/exploit_sub'), 'OVERWRITTEN SUB')
  assert.equal(
    readFileSync(resolve(dir, 'secret.txt'), 'utf8'),
    'ORIGINAL DATA',
  )
})

test('symlink escapes are sanitized', async () => {
  assert.notEqual(readlinkSync(resolve(out, 'exploit_sym')), targetSym)
  assert.throws(() => lstatSync(resolve(out, 'secret.txt')), {
    code: 'ENOENT',
  })
})

test('absolute symlink with .. has prefix stripped', async () => {
  assert.equal(
    readlinkSync(resolve(out, 'a/link')),
    '../a/target',
    'symlink target should be normalized',
  )

  assert.equal(
    readlinkSync(resolve(out, 'a/winrootdotslink')),
    '..\\foo\\bar',
    'symlink target should be normalized',
  )
  assert.throws(
    () => lstatSync(resolve(out, 'a/winrootdotsescapelink')),
    Error,
    'escaping symlink is not created',
  )
})
