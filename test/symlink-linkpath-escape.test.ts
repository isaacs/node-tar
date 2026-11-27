// A symlink in the archive must not resolve outside of the extraction
// directory. GHSA-3wwj-8j6r-q339, GHSA-jmj2-9c5q-vw73,
// GHSA-hqgx-p3r3-2cfg, and their duplicates.
import fs from 'node:fs'
import { resolve } from 'node:path'
import { assert, describe, test, testdir } from 'ubqtest'
import { extract } from '../src/extract.js'
import { Header, type HeaderData } from '../src/header.js'

const archive = (entries: HeaderData[]) =>
  Buffer.concat([
    ...entries.map(e => {
      const block = Buffer.alloc(512)
      new Header({ mode: 0o755, size: 0, ...e }).encode(block, 0)
      return block
    }),
    Buffer.alloc(1024),
  ])

const link = (path: string, linkpath: string): HeaderData => ({
  path,
  linkpath,
  type: 'SymbolicLink',
})
const dir = (path: string): HeaderData => ({ path, type: 'Directory' })

const unpack = async (entries: HeaderData[], sync: boolean) => {
  const root = testdir({ 'outside.txt': 'outside', cwd: {} })
  const file = resolve(root, 'in.tar')
  const cwd = resolve(root, 'cwd')
  fs.writeFileSync(file, archive(entries))
  const warnings: [code: string, message: string][] = []
  const opt = {
    file,
    cwd,
    onwarn: (code: string, message: string) => {
      warnings.push([code, message])
    },
  }
  if (sync) extract({ ...opt, sync: true })
  else await extract(opt)
  return { cwd, warnings }
}

const escapes: Record<string, [HeaderData[], string]> = {
  "'..' after an earlier symlink": [
    [link('s1', '.'), link('esc', 's1/../outside.txt')],
    "linkpath contains '..' after a path portion",
  ],
  "'..' after a later symlink": [
    [link('esc', 'x/y/../outside.txt'), dir('x'), link('x/y', '..')],
    "linkpath contains '..' after a path portion",
  ],
  "'..' after a nested symlink": [
    [dir('a'), link('a/b', '../x'), link('a/esc', 'b/../../outside.txt')],
    "linkpath contains '..' after a path portion",
  ],
  "entry path that ends in '/.'": [
    [link('esc/.', '../outside.txt')],
    'linkpath escapes extraction directory',
  ],
  "entry path that ends in '/./'": [
    [link('esc/./', '../outside.txt')],
    'linkpath escapes extraction directory',
  ],
  "nested entry path that ends in '/.'": [
    [dir('a'), link('a/esc/.', '../../outside.txt')],
    'linkpath escapes extraction directory',
  ],
  'backslash in a directory name': [
    [dir('A\\B'), link('esc', 'A\\B/../../outside.txt')],
    "linkpath contains '..' after a path portion",
  ],
}

for (const sync of [false, true]) {
  describe(sync ? 'sync' : 'async', () => {
    for (const [name, [entries, message]] of Object.entries(escapes)) {
      test(`reject ${name}`, async () => {
        const { cwd, warnings } = await unpack(entries, sync)
        assert.deepEqual(warnings, [['TAR_ENTRY_ERROR', message]])
        const esc = entries.find(e => e.path?.includes('esc'))
        assert(esc?.path)
        const made = resolve(cwd, esc.path)
        assert.throws(() => fs.lstatSync(made), { code: 'ENOENT' })
      })
    }

    test('allow leading .. that stays in the directory', async () => {
      const { cwd, warnings } = await unpack(
        [
          dir('a'),
          dir('a/b'),
          { path: 'f', type: 'File' },
          link('a/b/l', '../../f'),
          link('a/m', './b/./'),
          link('a/b/n', '../b'),
        ],
        sync,
      )
      assert.deepEqual(warnings, [])
      assert.equal(fs.readlinkSync(resolve(cwd, 'a/b/l')), '../../f')
      assert.equal(fs.readlinkSync(resolve(cwd, 'a/m')), './b/./')
      assert.equal(fs.readlinkSync(resolve(cwd, 'a/b/n')), '../b')
      assert.equal(
        fs.realpathSync(resolve(cwd, 'a/b/l')),
        fs.realpathSync(resolve(cwd, 'f')),
      )
    })
  })
}
