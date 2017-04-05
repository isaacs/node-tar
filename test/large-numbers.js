const large = require('../lib/large-numbers.js')
const encode = large.encode
const parse = large.parse
const t = require('tap')

t.test('parse', t => {
  const cases = new Map([
    ['ffffffffffffffffffffff20', -1],
    ['800000000000100000000020', 68719476736],
    ['fffffffffffffffe1ecc8020', -31536000],
    ['fffffffffffffff000000020', -268435456],
    ['800000010203040506070020', 72623859790382850],
    ['ffffffffffffffffffffff00', -1],
    ['800000000000100000000000', 68719476736],
    ['fffffffffffffffe1ecc8000', -31536000],
    ['fffffffffffffff000000000', -268435456],
    ['800000010203040506070000', 72623859790382850]
  ])
  t.plan(cases.size)
  cases.forEach((value, hex) =>
    t.equal(parse(new Buffer(hex, 'hex')), value))
})

t.test('encode', t => {
  const cases = new Map([
    ['ffffffffffffffffffffff20', -1],
    ['800000000000100000000020', 68719476736],
    ['fffffffffffffffe1ecc8020', -31536000],
    ['fffffffffffffff000000020', -268435456],
    ['800000010203040506070020', 72623859790382850]
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
