const Field = require('../lib/field.js')
const t = require('tap')

t.test('string', t => {
  const f = new Field(5, 10, false)
  t.same(f, {
    size: 10,
    offset: 5,
    end: 15,
    numeric: false
  })
  const b = new Buffer('the quick red fox jumps a lot')
  const buf = f.readRaw(b)
  t.isa(buf, Buffer)
  t.same(buf.toString(), 'uick red f')
  t.equal(buf.length, f.size)
  t.notOk(f.write('XXXXXXXXXX', b), 'fits, should not need extended')
  t.equal(b.toString(), 'the qXXXXXXXXXXox jumps a lot')
  t.ok(f.write('___________', b), 'too long, should need extended header')
  t.equal(b.toString(), 'the q__________ox jumps a lot')
  t.notOk(f.write('.', b), 'too short, zero-fill')
  t.equal(b.toString(), 'the q.\0\0\0\0\0\0\0\0\0ox jumps a lot')
  t.equal(f.read(b), '.')
  t.notOk(f.write('', b), 'empty, zero-fill')
  t.equal(b.toString(), 'the q\0\0\0\0\0\0\0\0\0\0ox jumps a lot')
  t.end()
})

t.test('numeric', t => {
  const f = new Field(2, 8, true)
  const b = new Buffer('the quick red fox jumps a lot')
  t.notOk(f.write(1, b))
  t.equal(b.toString(), 'th000001 \0red fox jumps a lot')
  t.notOk(f.write(1234567, b))
  t.equal(f.read(b), 1234567)
  t.equal(b.toString(), 'th4553207\0red fox jumps a lot')
  t.ok(f.write(-1, b))
  t.equal(f.read(b), -1)
  t.equal(b.toString('hex'),
          '7468' +
          'ffffffffffffff20' +
          '72656420666f78206a756d70732061206c6f74')
  t.ok(f.write(0o7777777 + 1, b))
  t.equal(f.read(b), 0o7777777 + 1)
  t.equal(b.toString('hex'),
          '7468' +
          '8000000020000020' +
          '72656420666f78206a756d70732061206c6f74')
  t.ok(f.write(new Date('1979-07-01T19:10:00.000Z'), b))
  t.equal(b.toString('hex'),
          '7468' +
          '80000011dd1f8820' +
          '72656420666f78206a756d70732061206c6f74')
  t.equal(new Date(f.read(b) * 1000).toISOString(),
          '1979-07-01T19:10:00.000Z')
  t.equal(f.read(new Buffer('asdfasdfasdfasdfasdfasdfadsfasdf')), null)
  t.end()
})
