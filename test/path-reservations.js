const t = require('tap')
const requireInject = require('require-inject')

// load up the posix and windows versions of the reserver
if (process.platform === 'win32')
  process.env.TESTING_TAR_FAKE_PLATFORM = 'posix'
const { reserve } = require('../lib/path-reservations.js', {
  path: require('path').posix,
})()
delete process.env.TESTING_TAR_FAKE_PLATFORM
if (process.platform !== 'win32')
  process.env.TESTING_TAR_FAKE_PLATFORM = 'win32'
const { reserve: winReserve } = requireInject('../lib/path-reservations.js', {
  path: require('path').win32,
})()

t.test('basic race', t => {
  // simulate the race conditions we care about
  let didFile = false
  const file = done => {
    t.equal(didFile, false, 'only call file once')
    didFile = true
    t.equal(didLink, false, 'do file before link')
    setTimeout(done)
  }

  let didLink = false
  const link = done => {
    t.equal(didLink, false, 'only call once')
    t.equal(didFile, true, 'do file before link')
    didLink = true
    // make sure this one is super duper cleared lol
    // the subsequent calls are no-ops, but verify as much
    done()
    done()
    done()
  }

  let didDir = false
  const dir = done => {
    t.equal(didDir, false, 'only do dir once')
    t.equal(didLink, true, 'do link before dir')
    didDir = true
    done()
  }

  let didDir2 = false
  const dir2 = done => {
    t.equal(didDir, true, 'did dir before dir2')
    t.equal(didDir2, false, 'only do dir2 once')
    didDir2 = true
    done()
  }

  let didDir3 = false
  const dir3 = done => {
    t.equal(didDir2, true, 'did dir2 before dir3')
    t.equal(didDir3, false, 'only do dir3 once')
    didDir3 = true
    done()
    t.end()
  }

  t.ok(reserve(['a/b/c/d'], file), 'file starts right away')
  t.notOk(reserve(['a/B/c////D', 'a/b/e'], link), 'link waits')
  t.notOk(reserve(['a/b/e/f'], dir), 'dir waits')
  t.notOk(reserve(['a/b'], dir2), 'dir2 waits')
  t.notOk(reserve(['a/b/x'], dir3), 'dir3 waits')
})

t.test('unicode shenanigans', t => {
  const e1 = Buffer.from([0xc3, 0xa9])
  const e2 = Buffer.from([0x65, 0xcc, 0x81])
  let didCafe1 = false
  const cafe1 = done => {
    t.equal(didCafe1, false, 'did cafe1 only once')
    t.equal(didCafe2, false, 'did cafe1 before cafe2')
    didCafe1 = true
    setTimeout(done)
  }
  let didCafe2 = false
  const cafe2 = done => {
    t.equal(didCafe1, true, 'did cafe1 before cafe2')
    t.equal(didCafe2, false, 'did cafe2 only once')
    didCafe2 = true
    done()
    t.end()
  }
  const cafePath1 = `c/a/f/${e1}`
  const cafePath2 = `c/a/f/${e2}`
  t.ok(reserve([cafePath1], cafe1))
  t.notOk(reserve([cafePath2], cafe2))
})

t.test('absolute paths and trailing slash', t => {
  let calledA1 = false
  let calledA2 = false
  const a1 = done => {
    t.equal(calledA1, false, 'called a1 only once')
    t.equal(calledA2, false, 'called a1 before 2')
    calledA1 = true
    setTimeout(done)
  }
  const a2 = done => {
    t.equal(calledA1, true, 'called a1 before 2')
    t.equal(calledA2, false, 'called a2 only once')
    calledA2 = true
    done()
    if (calledR2)
      t.end()
  }
  let calledR1 = false
  let calledR2 = false
  const r1 = done => {
    t.equal(calledR1, false, 'called r1 only once')
    t.equal(calledR2, false, 'called r1 before 2')
    calledR1 = true
    setTimeout(done)
  }
  const r2 = done => {
    t.equal(calledR1, true, 'called r1 before 2')
    t.equal(calledR2, false, 'called r1 only once')
    calledR2 = true
    done()
    if (calledA2)
      t.end()
  }
  t.ok(reserve(['/p/a/t/h'], a1))
  t.notOk(reserve(['/p/a/t/h/'], a2))
  t.ok(reserve(['p/a/t/h'], r1))
  t.notOk(reserve(['p/a/t/h/'], r2))
})

t.test('on windows, everything collides with everything', t => {
  const reserve = winReserve
  let called1 = false
  let called2 = false
  const f1 = done => {
    t.equal(called1, false, 'only call 1 once')
    t.equal(called2, false, 'call 1 before 2')
    called1 = true
    setTimeout(done)
  }
  const f2 = done => {
    t.equal(called1, true, 'call 1 before 2')
    t.equal(called2, false, 'only call 2 once')
    called2 = true
    done()
    t.end()
  }
  t.equal(reserve(['some/path'], f1), true)
  t.equal(reserve(['other/path'], f2), false)
})
