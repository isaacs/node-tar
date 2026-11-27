import { posix } from 'node:path'
import { assert, describe, test } from 'ubqtest'
import { Header } from '../src/header.js'
import { basename, dirname, join, normalize } from '../src/path.js'

// Each path of up to 5 parts from this list.
const parts = ['a', '/', '.', '..', 'bc', '//']
const paths = ['']
const add = (prefix: string, depth: number) => {
  for (const p of parts) {
    paths.push(prefix + p)
    if (depth > 1) add(prefix + p, depth - 1)
  }
}
add('', 5)

describe('same results as path.posix', () => {
  for (const [name, fn, expect] of [
    ['normalize', normalize, posix.normalize],
    ['dirname', dirname, posix.dirname],
    ['basename', basename, posix.basename],
  ] as const) {
    test(name, () => {
      const bad = paths.filter(p => fn(p) !== expect(p))
      assert.deepEqual(bad, [])
    })
  }

  test('join', () => {
    const bad: string[][] = []
    for (let i = 0; i < paths.length; i += 7) {
      for (let j = 0; j < paths.length; j += 501) {
        const a = paths[i] as string
        const b = paths[j] as string
        if (join(a, b) !== posix.join(a, b)) bad.push([a, b])
      }
    }
    assert.deepEqual(bad, [])
    assert.equal(join(), posix.join())
    assert.equal(join('a', '', 'b', '../c'), 'a/c')
  })
})

test('a header splits a long path at a slash', () => {
  for (const path of [
    'a/'.repeat(80) + 'file.txt',
    '/' + 'abcdefghi/'.repeat(20) + 'file.txt',
    'x'.repeat(60) + '/' + 'y'.repeat(60) + '/' + 'z'.repeat(60),
  ]) {
    const h = new Header({ path, type: 'File', size: 0 })
    assert.equal(h.encode(), false, path)
    assert(h.block)
    assert.equal(new Header(h.block).path, path)
  }
})
