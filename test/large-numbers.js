'use strict'
const large = require('../lib/large-numbers.js')
const encode = large.encode
const parse = large.parse
const t = require('tap')

t.test('parse', t => {
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
  t.plan(cases.size)
  cases.forEach((value, hex) =>
    t.equal(parse(Buffer.from(hex, 'hex')), value))
})

t.test('parse out of range', t => {
  const cases = [
    '800000030000000000000000',
    '800000000020000000000000', // MAX_SAFE_INTEGER + 1
    'ffffffffffe0000000000000', // MIN_SAFE_INTEGER - 1
    'fffffffffdd0000000000000',
  ]
  t.plan(cases.length)
  cases.forEach((hex) =>
    t.throws(_ => parse(Buffer.from(hex, 'hex')),
      Error('parsed number outside of javascript safe integer range')))
})

t.test('parse invalid base256 encoding', t => {
  const cases = [
    '313233343536373131', // octal encoded
    '700000030000000000000000', // does not start with 0x80 or 0xff
  ]
  t.plan(cases.length)
  cases.forEach((hex) =>
    t.throws(_ => parse(Buffer.from(hex, 'hex')),
      Error('invalid base256 encoding')))
})

t.test('encode', t => {
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
  t.plan(2)
  t.test('alloc', t => {
    t.plan(cases.size)
    cases.forEach((value, hex) =>
      t.equal(encode(value, Buffer.alloc(12)).toString('hex'), hex))
  })
  t.test('allocUnsafe', t => {
    t.plan(cases.size)
    cases.forEach((value, hex) =>
      t.equal(encode(value, Buffer.allocUnsafe(12)).toString('hex'), hex))
  })
})

t.test('encode unsafe numbers', t => {
  const cases = [
    Number.MAX_VALUE,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1,
    Number.MIN_VALUE,
  ]

  t.plan(cases.length)
  cases.forEach((value) =>
    t.throws(_ => encode(value),
      Error('cannot encode number outside of javascript safe integer range')))
})
