// The path functions that the extraction adds.
import { posix, win32 } from 'node:path'
import { assert, describe, test } from 'ubqtest'
import { isAbsolute, relative, resolve } from '../src/path.js'
import { stripAbsolutePath } from '../src/strip-absolute-path.js'
import {
  win32Dirname,
  win32IsAbsolute,
  win32Resolve,
  win32Root,
} from '../src/win32-path.js'

// Each path of up to `depth` parts from the list.
const combine = (parts: string[], depth: number) => {
  const paths = ['']
  const add = (prefix: string, d: number) => {
    for (const p of parts) {
      paths.push(prefix + p)
      if (d > 1) add(prefix + p, d - 1)
    }
  }
  add('', depth)
  return paths
}

describe('same results as path.posix', () => {
  const paths = combine(['a', '/', '.', '..', 'bc', '//'], 4)

  test('isAbsolute', () => {
    const bad = paths.filter(p => isAbsolute(p) !== posix.isAbsolute(p))
    assert.deepEqual(bad, [])
  })

  test('resolve from an absolute path', () => {
    const bad: string[][] = []
    for (const base of ['/', '/x', '/x/y/', '//x']) {
      for (const p of paths) {
        if (resolve(base, p) !== posix.resolve(base, p))
          bad.push([base, p])
      }
    }
    assert.deepEqual(bad, [])
    assert.equal(resolve('/a', '/b', 'c'), posix.resolve('/a', '/b', 'c'))
    assert.equal(resolve('/a', '', 'c'), '/a/c')
  })

  test('resolve with no absolute part gives a relative path', () => {
    assert.equal(resolve('a/b', '../c/'), 'a/c')
    assert.equal(resolve('', ''), '.')
    assert.equal(resolve(), '.')
  })

  test('relative', () => {
    const bad: string[][] = []
    const abs = paths.filter(p => isAbsolute(p))
    for (let i = 0; i < abs.length; i += 3) {
      for (let j = 0; j < abs.length; j += 7) {
        const a = abs[i] as string
        const b = abs[j] as string
        if (relative(a, b) !== posix.relative(a, b)) bad.push([a, b])
      }
    }
    assert.deepEqual(bad, [])
    assert.equal(relative('/a/b', '/a/b'), '')
    assert.equal(relative('/', '/a'), 'a')
    assert.equal(relative('/a', '/'), '..')
    assert.equal(relative('/a/b', '/a/c/d'), '../c/d')
    assert.equal(relative('c:/a', 'c:/a/b/c'), 'b/c')
  })
})

describe('same results as path.win32', () => {
  const paths = [
    ...combine(['a', '/', '\\', 'c:', '.', '..', '?'], 5),
    'c',
    'c:',
    'C:/',
    'z:\\x',
    '1:/x',
    '//host/share',
    '//host/share/',
    '//host/share/x/y',
    '\\\\host\\share\\x',
    '//host//share',
    '//?/c:/x',
    '///x/y/z',
  ]

  test('win32Root', () => {
    const bad = paths.filter(p => win32Root(p) !== win32.parse(p).root)
    assert.deepEqual(bad, [])
  })

  test('win32IsAbsolute', () => {
    const bad = paths.filter(
      p => win32IsAbsolute(p) !== win32.isAbsolute(p),
    )
    assert.deepEqual(bad, [])
  })

  test('win32Resolve', () => {
    for (const [base, p] of [
      ['c:/x', 'y/z'],
      ['c:/x', ''],
      ['c:/x', '../../../y'],
      ['c:/', 'y/./z/'],
      ['c:/x', 'd:/y'],
      ['c:/x', '//host/share/a/../b'],
      ['//host/share/x', 'y'],
    ] as const) {
      assert.equal(
        win32Resolve(base, p),
        win32.resolve(base, p).replaceAll('\\', '/'),
        `${base} ${p}`,
      )
    }
    // A path with a slash and no drive stays as it is.
    assert.equal(win32Resolve('c:/x', '/y/z/'), '/y/z')
    // A path that is relative to a drive is a relative path.
    assert.equal(win32Resolve('c:/x', 'd:y'), 'c:/x/d:y')
  })

  test('win32Dirname', () => {
    for (const p of ['c:/x/y', 'c:/x', 'c:/', '/x', '//host/share/x']) {
      assert.equal(
        win32Dirname(p),
        win32.dirname(p).replaceAll('\\', '/'),
        p,
      )
    }
  })
})

describe('stripAbsolutePath', () => {
  const cases: Record<string, [string, string]> = {
    '/': ['/', ''],
    '////': ['////', ''],
    'c:///a/b/c': ['c:///', 'a/b/c'],
    '\\\\foo\\bar\\baz': ['\\\\foo\\bar\\', 'baz'],
    '//foo//bar//baz': ['//', 'foo//bar//baz'],
    'c:\\c:\\c:\\c:\\\\d:\\e/f/g': ['c:\\c:\\c:\\c:\\\\d:\\', 'e/f/g'],
    'c:..\\system\\explorer.exe': ['c:', '..\\system\\explorer.exe'],
    'd:..\\..\\unsafe\\land': ['d:', '..\\..\\unsafe\\land'],
    'c:foo': ['c:', 'foo'],
    'D:mark': ['D:', 'mark'],
    '//?/X:/y/z': ['//?/X:/', 'y/z'],
    '\\\\?\\X:\\y\\z': ['\\\\?\\X:\\', 'y\\z'],
    'a/b': ['', 'a/b'],
    '': ['', ''],
  }
  for (const [input, expect] of Object.entries(cases)) {
    test(`strip root from ${JSON.stringify(input)}`, () => {
      assert.deepEqual(stripAbsolutePath(input), expect)
    })
  }
})
