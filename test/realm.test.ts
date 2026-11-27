// Input that a different realm made. For such an object, a check
// with `instanceof` is false in the realm of this package.
import vm from 'node:vm'
import { assert, describe, stub, test } from 'ubqtest'
import {
  isArrayBuffer,
  isBlob,
  isReadableStream,
  isUint8Array,
} from '../src/bytes.js'
import { entries, entriesSync } from '../src/entries.js'
import { Header } from '../src/header.js'
import { list, listSync } from '../src/list.js'
import { Pack, PackSync } from '../src/pack.js'
import { tarError, warn } from '../src/warn.js'
import { WriteEntry } from '../src/write-entry.js'
import { collect, read } from './create-helpers.js'
import { cat, EOA, file } from './helpers.js'

const tar = cat(file('a.txt', 'alpha'), file('b.txt', 'beta'), EOA)

/** A copy of the data in a `Uint8Array` of a new realm. */
const otherBytes = (data: Uint8Array): Uint8Array => {
  const copy = vm.runInNewContext(
    `new Uint8Array(${data.length})`,
  ) as Uint8Array
  copy.set(data)
  assert(!(copy instanceof Uint8Array))
  return copy
}

/** A copy of the data in an `ArrayBuffer` of a new realm. */
const otherBuffer = (data: Uint8Array): ArrayBuffer => {
  const { buffer } = otherBytes(data)
  assert(!(buffer instanceof ArrayBuffer))
  return buffer as unknown as ArrayBuffer
}

const pathsOf = async (input: Uint8Array | ArrayBuffer) => {
  const found: string[] = []
  for await (const entry of entries(input)) {
    found.push(`${entry.path}=${await entry.text()}`)
  }
  return found
}

const pathsOfSync = (input: Uint8Array | ArrayBuffer) => {
  const found: string[] = []
  for (const entry of entriesSync(input)) {
    found.push(`${entry.path}=${entry.text()}`)
  }
  return found
}

const expect = ['a.txt=alpha', 'b.txt=beta']

describe('the type checks', () => {
  test('isUint8Array', () => {
    assert.equal(isUint8Array(new Uint8Array(1)), true)
    assert.equal(isUint8Array(Buffer.from('a')), true)
    assert.equal(isUint8Array(otherBytes(tar)), true)
    assert.equal(isUint8Array(new Uint16Array(1)), false)
    assert.equal(isUint8Array(new DataView(new ArrayBuffer(1))), false)
    assert.equal(isUint8Array(new ArrayBuffer(1)), false)
    assert.equal(isUint8Array([1]), false)
    assert.equal(isUint8Array(undefined), false)
  })

  test('isArrayBuffer', () => {
    assert.equal(isArrayBuffer(new ArrayBuffer(1)), true)
    assert.equal(isArrayBuffer(otherBuffer(tar)), true)
    assert.equal(isArrayBuffer(new Uint8Array(1)), false)
    assert.equal(isArrayBuffer(undefined), false)
  })

  test('isBlob and isReadableStream', () => {
    const blob = new Blob(['a'])
    assert.equal(isBlob(blob), true)
    assert.equal(isBlob(new File(['a'], 'a')), true)
    assert.equal(isBlob(blob.stream()), false)
    assert.equal(isBlob(new Uint8Array(1)), false)
    assert.equal(isBlob(undefined), false)
    assert.equal(isReadableStream(blob.stream()), true)
    assert.equal(isReadableStream(blob), false)
    assert.equal(isReadableStream([new Uint8Array(1)]), false)
    assert.equal(isReadableStream(undefined), false)
  })
})

describe('a Uint8Array of a different realm', () => {
  test('the block of a Header', () => {
    const header = new Header(otherBytes(tar))
    assert.match(header, { path: 'a.txt', size: 5, cksumValid: true })
  })

  test('the input of entries and of entriesSync', async () => {
    assert.deepEqual(await pathsOf(otherBytes(tar)), expect)
    assert.deepEqual(pathsOfSync(otherBytes(tar)), expect)
  })

  test('the input of list and of listSync', async () => {
    const found: string[] = []
    const onEntry = (entry: { path: string }) => found.push(entry.path)
    await list({ input: otherBytes(tar), onEntry })
    listSync({ input: otherBytes(tar), onEntry })
    assert.deepEqual(found, ['a.txt', 'b.txt', 'a.txt', 'b.txt'])
  })

  test('the body of a WriteEntry, in Pack and in PackSync', async () => {
    const body = otherBytes(new TextEncoder().encode('alpha'))
    const entry = new WriteEntry({ path: 'a.txt' }, body)
    assert.equal(entry.size, 5)
    assert.equal(entry.body, body)
    const expect = [{ entry: { path: 'a.txt', size: 5 }, body: 'alpha' }]
    assert.match(read(await collect(new Pack().add(entry).end())), expect)
    assert.match(read(await collect(new PackSync().add(entry))), expect)
  })
})

describe('an ArrayBuffer of a different realm', () => {
  test('the input of entries and of entriesSync', async () => {
    assert.deepEqual(await pathsOf(otherBuffer(tar)), expect)
    assert.deepEqual(pathsOfSync(otherBuffer(tar)), expect)
  })
})

test('a Date of a different realm, in a PAX header', async () => {
  const mtime = vm.runInNewContext('new Date(1500)') as Date
  assert(!(mtime instanceof Date))
  // A long path needs a PAX header, and that header has the time.
  const path = 'a'.repeat(200)
  const entry = new WriteEntry({ path, mtime }, 'alpha')
  const data = await collect(new Pack().add(entry).end())
  assert.match(read(data), [
    { entry: { path, mtime: new Date(1500) }, body: 'alpha' },
  ])
})

test('an Error of a different realm, in a warning', () => {
  const error = () =>
    vm.runInNewContext(
      'Object.assign(new Error("boom"), { code: "ENOENT" })',
    ) as Error
  const er = error()
  assert(!(er instanceof Error))
  const warnings: unknown[][] = []
  warn({ onwarn: (...args) => warnings.push(args) }, 'TAR_X', er)
  assert.deepEqual(warnings, [['TAR_X', 'boom', er]])
  assert.match<unknown>(er, { code: 'ENOENT', tarCode: 'TAR_X' })

  const strict = error()
  assert.equal(
    assert.throws(() => warn({ strict: true }, 'TAR_X', strict), {
      message: 'boom',
      code: 'ENOENT',
      tarCode: 'TAR_X',
    }),
    strict,
  )
  const made = error()
  assert.equal<unknown>(tarError({}, 'TAR_X', made), made)
})

// The constructors of this realm are not the ones that made the
// objects, as when a different window made them.
describe('a Blob and a ReadableStream of a different realm', () => {
  class Other {}

  test('a Blob is the input of entries', async () => {
    const blob = new Blob([tar])
    stub(globalThis, 'Blob', Other as unknown as typeof Blob)
    assert(!(blob instanceof Blob))
    assert.deepEqual(await pathsOf(blob as unknown as Uint8Array), expect)
  })

  test('a ReadableStream is the input of entries', async () => {
    const stream = new Blob([tar]).stream()
    stub(
      globalThis,
      'ReadableStream',
      Other as unknown as typeof ReadableStream,
    )
    assert(!(stream instanceof ReadableStream))
    const found: string[] = []
    for await (const entry of entries(stream)) {
      found.push(
        `${entry.path}=${new TextDecoder().decode(await entry.bytes())}`,
      )
    }
    assert.deepEqual(found, expect)
  })

  test('a Blob is the body of a WriteEntry', async () => {
    const blob = new Blob(['alpha'])
    stub(globalThis, 'Blob', Other as unknown as typeof Blob)
    const entry = new WriteEntry({ path: 'a.txt' }, blob)
    assert.equal(entry.size, 5)
    const data = await collect(new Pack().add(entry).end())
    assert.match(read(data), [{ entry: { path: 'a.txt' }, body: 'alpha' }])
  })

  test('a ReadableStream is the body of a WriteEntry', async () => {
    const stream = new Blob(['alpha']).stream()
    stub(
      globalThis,
      'ReadableStream',
      Other as unknown as typeof ReadableStream,
    )
    const entry = new WriteEntry({ path: 'a.txt', size: 5 }, stream)
    const data = await collect(new Pack().add(entry).end())
    assert.match(read(data), [{ entry: { path: 'a.txt' }, body: 'alpha' }])
  })
})
