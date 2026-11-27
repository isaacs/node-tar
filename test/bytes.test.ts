import { assert, test } from 'ubqtest'
import {
  decodeUtf8,
  encodeUtf8Into,
  utf8Length,
  writeAscii,
} from '../src/bytes.js'

// Node's Buffer is the reference for each helper.
const strings = [
  '',
  'plain ascii',
  'Ω.txt',
  '🌟.txt',
  'é\n\0mixed 日本語 🌟',
  // surrogates with no pair
  '\ud83c',
  '\udf1f',
  'a\ud83cb',
]

for (const str of strings) {
  const name = JSON.stringify(str)
  test(`utf8Length of ${name}`, () => {
    assert.equal(utf8Length(str), Buffer.byteLength(str))
  })

  test(`decodeUtf8 of ${name}`, () => {
    const bytes = Buffer.from(`<${str}>`)
    assert.equal(decodeUtf8(bytes), bytes.toString())
    assert.equal(
      decodeUtf8(bytes, 1, bytes.length - 1),
      bytes.subarray(1, bytes.length - 1).toString(),
    )
  })

  test(`encodeUtf8Into of ${name}`, () => {
    const expect = Buffer.alloc(40, 0)
    expect[0] = 1
    expect[39] = 1
    expect.write(str, 1)
    const bytes = new Uint8Array(40).fill(1)
    encodeUtf8Into(str, bytes, 1, 38)
    assert.deepEqual(bytes, new Uint8Array(expect))
  })
}

test('encodeUtf8Into does not write part of a character', () => {
  const bytes = new Uint8Array(6).fill(1)
  // The second star needs 4 bytes, and 3 are left.
  encodeUtf8Into('🌟🌟', bytes, 0, 5)
  assert.deepEqual(bytes, new Uint8Array([0xf0, 0x9f, 0x8c, 0x9f, 0, 1]))
})

test('writeAscii writes one byte for each character', () => {
  const bytes = new Uint8Array(6)
  writeAscii('0644', bytes, 1)
  assert.deepEqual(bytes, new Uint8Array([0, 0x30, 0x36, 0x34, 0x34, 0]))
})
