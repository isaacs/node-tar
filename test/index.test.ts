import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { assert, describe, test } from 'ubqtest'
import * as tar from '../src/index.js'

const root = resolve(import.meta.dirname, '..')
const src = resolve(root, 'src')
const node = resolve(src, 'node')

// The text of the file with no comments.
const code = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

// The specifier of each import and each re-export of the file.
const imports = (file: string) =>
  [
    ...code(file).matchAll(
      /(?:\bfrom\s+|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g,
    ),
  ].map(m => m[2] as string)

// The files that a file imports, and the files that they import.
const graph = (entry: string) => {
  const seen = new Set<string>()
  const walk = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const spec of imports(file)) {
      if (spec.startsWith('.')) {
        walk(resolve(dirname(file), spec.replace(/\.js$/, '.ts')))
      }
    }
  }
  walk(entry)
  return [...seen]
}

// The reasons why a file cannot be in a bundle for a browser.
const problems = (file: string) => {
  const found: string[] = []
  const name = relative(root, file)
  if (file.startsWith(node)) found.push(`${name} is a node file`)
  for (const spec of imports(file)) {
    if (!spec.startsWith('.')) found.push(`${name} imports ${spec}`)
  }
  for (const word of code(file).match(/\b(Buffer|process)\b/g) ?? []) {
    found.push(`${name} uses ${word}`)
  }
  return found
}

describe('the core entry point', () => {
  const files = graph(resolve(src, 'index.ts'))

  test('the test finds the imports', () => {
    const names = files.map(f => relative(root, f))
    for (const name of [
      'src/index.ts',
      'src/replace.ts',
      'src/unpack.ts',
      'src/path.ts',
      'src/header.ts',
      'src/large-numbers.ts',
    ]) {
      assert.contains(names, name)
    }
    assert.deepEqual(
      [...new Set(problems(resolve(node, 'index.ts')))],
      [
        'src/node/index.ts is a node file',
        'src/node/index.ts imports node:fs',
        'src/node/index.ts imports node:fs/promises',
        'src/node/index.ts imports node:path',
        'src/node/index.ts imports node:zlib',
        'src/node/index.ts uses process',
      ],
    )
  })

  test('no file that it imports needs Node.js', () => {
    assert.greaterThan(files.length, 25)
    assert.deepEqual(files.flatMap(problems), [])
  })

  test('no file of the core needs Node.js', () => {
    const all = readdirSync(src)
      .filter(name => name.endsWith('.ts'))
      .map(name => resolve(src, name))
    assert.greaterThan(all.length, 20)
    assert.deepEqual(all.flatMap(problems), [])
  })

  test('the exports', () => {
    assert.deepEqual(Object.keys(tar).sort(), [
      'AppendScan',
      'CwdError',
      'EntryCursor',
      'EntryData',
      'Header',
      'Pack',
      'PackBase',
      'PackJob',
      'Parser',
      'PathReservations',
      'Pax',
      'ReadEntry',
      'SymlinkError',
      'TarReader',
      'Unpack',
      'UnpackBase',
      'WriteEntry',
      'c',
      'create',
      'entries',
      'extract',
      'gzip',
      'list',
      'r',
      'replace',
      't',
      'types',
      'u',
      'update',
      'x',
    ])
    assert.equal(tar.c, tar.create)
    assert.equal(tar.x, tar.extract)
    assert.equal(tar.t, tar.list)
    assert.equal(tar.r, tar.replace)
    assert.equal(tar.u, tar.update)
    assert.equal(tar.types.code.get('File'), '0')
  })

  test('the commands work with data of the caller', async () => {
    const stream = tar.create({}, [
      new tar.WriteEntry({ path: 'a.txt' }, 'alpha'),
    ])
    const found: string[][] = []
    await tar.list({
      input: stream,
      onEntry: async entry => {
        found.push([entry.path, await entry.text()])
      },
    })
    assert.deepEqual(found, [['a.txt', 'alpha']])
  })
})
