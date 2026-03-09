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

const secretLinkpath = resolve(t.testdirName, 'secret.txt')

t.formatSnapshot = (o: unknown): unknown =>
  typeof o === 'string' ? o.replace(
    /^ENOENT: no such file or directory, link .*? -> .*?$/, 'ENOENT: no such file or directory, link')
  : Array.isArray(o) ? o.map(o => t.formatSnapshot?.(o))
  : o

const getExploitTar = () => {
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

const dir = t.testdir({
  'secret.txt': 'ORIGINAL DATA',
  'exploit.tar': getExploitTar(),
  out: {},
})

const out = resolve(dir, 'out')
const tarFile = resolve(dir, 'exploit.tar')

const WARNINGS: [code: string, message: string][] = []
t.before(() =>
  x({
    cwd: out,
    file: tarFile,
    onwarn: (code: string, message: string) =>
      WARNINGS.push([code, message]),
  }),
)

t.test('warnings', async t => t.matchSnapshot(WARNINGS))

t.test('writefile exploits fail', async t => {
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
  t.not(readlinkSync(resolve(out, 'exploit_sym')), targetSym)
  t.throws(() => lstatSync(resolve(out, 'secret.txt')), {
    code: 'ENOENT',
  })
})

t.test('absolute symlink with .. has prefix stripped', async t => {
  t.equal(
    readlinkSync(resolve(out, 'a/link')),
    '../a/target',
    'symlink target should be normalized',
  )

  t.equal(
    readlinkSync(resolve(out, 'a/winrootdotslink')),
    '..\\foo\\bar',
    'symlink target should be normalized',
  )
  t.throws(
    () => lstatSync(resolve(out, 'a/winrootdotsescapelink')),
    'escaping symlink is not created',
  )
})
