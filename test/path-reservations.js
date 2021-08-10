const t = require('tap')
const { reserve } = require('../lib/path-reservations.js')()

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
