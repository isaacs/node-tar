import { assert, describe, test } from 'ubqtest'
import { encode, parse } from '../src/large-numbers.js'

test('parse', () => {
  const cases = new Map([
    ['ffffffffffffffffffffffff', -1],
    ['800000000000100000000020', 17592186044448],
    ['fffffffffffffffe1ecc8020', -8073215968],
    ['fffffffffffffff000000020', -68719476704],
    ['80000000001fffffffffffff', 9007199254740991], // MAX_SAFE_INTEGER
    ['ffffffffffe0000000000001', -9007199254740991], // MIN_SAFE_INTEGER
    ['800000000000100000000000', 17592186044416],
    ['fffffffffffffffe1ecc8000', -8073216000],
    ['fffffffffffffff000000000', -68719476736],
    ['800000000000000353b66200', 14289363456],
  ])
  cases.forEach((value, hex) =>
    assert.equal(parse(Buffer.from(hex, 'hex')), value),
  )
})

test('parse out of range', () => {
  const cases = [
    '800000030000000000000000',
    '800000000020000000000000', // MAX_SAFE_INTEGER + 1
    'ffffffffffe0000000000000', // MIN_SAFE_INTEGER - 1
    'fffffffffdd0000000000000',
  ]
  cases.forEach(hex =>
    assert.throws(_ => parse(Buffer.from(hex, 'hex')), {
      message: 'parsed number outside of javascript safe integer range',
    }),
  )
})

test('parse invalid base256 encoding', () => {
  const cases = [
    '313233343536373131', // octal encoded
    '700000030000000000000000', // does not start with 0x80 or 0xff
  ]
  cases.forEach(hex =>
    assert.throws(_ => parse(Buffer.from(hex, 'hex')), {
      message: 'invalid base256 encoding',
    }),
  )
})

describe('encode', () => {
  const cases = new Map([
    ['ffffffffffffffffffffffff', -1],
    ['800000000000100000000020', 17592186044448],
    ['800000000000100000000000', 17592186044416],
    ['fffffffffffffffe1ecc8020', -8073215968],
    ['fffffffffffffff000000020', -68719476704],
    ['fffffffffffffff000000000', -68719476736], // Allows us to test the case where there's a trailing 00
    ['80000000001fffffffffffff', 9007199254740991], // MAX_SAFE_INTEGER
    ['ffffffffffe0000000000001', -9007199254740991], // MIN_SAFE_INTEGER
  ])
  test('alloc', () => {
    cases.forEach((value, hex) =>
      assert.equal(encode(value, Buffer.alloc(12)).toString('hex'), hex),
    )
  })
  test('allocUnsafe', () => {
    cases.forEach((value, hex) =>
      assert.equal(
        encode(value, Buffer.allocUnsafe(12)).toString('hex'),
        hex,
      ),
    )
  })
})

test('encode unsafe numbers', () => {
  const cases = [
    Number.MAX_VALUE,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1,
    Number.MIN_VALUE,
  ]

  cases.forEach(value =>
    assert.throws(_ => encode(value), {
      message:
        'cannot encode number outside of javascript safe integer range',
    }),
  )
})
