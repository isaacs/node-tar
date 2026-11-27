import { assert, test } from 'ubqtest'
import { Unpack } from '../src/unpack.js'
import { WriteEntry } from '../src/write-entry.js'
import { Parser } from '../src/parse.js'

// The type checker does the work of this test: each assignment must
// compile.
test('writable streams are assignable to NodeJS.WritableStream', () => {
  const testers: NodeJS.WritableStream[] = [
    new Parser(),
    new Unpack(),
    new WriteEntry(import.meta.filename),
  ]
  for (const tester of testers) {
    assert.equal(typeof tester.write, 'function')
    assert.equal(typeof tester.end, 'function')
  }
})
