import { assert, mockImport, test } from 'ubqtest'

import { posix, win32 } from 'node:path'

// Loads a new instance of the reserver that uses the given path module.
// Sets a fake platform when the real platform does not fit that module.
const load = async (path, win) => {
  const fake = (process.platform === 'win32') !== win
  if (fake) {
    process.env.TESTING_TAR_FAKE_PLATFORM = win ? 'win32' : 'posix'
  }
  try {
    const { PathReservations } = await mockImport(
      () => import('../src/path-reservations.js'),
      [[() => import('node:path'), path]],
    )
    return PathReservations
  } finally {
    if (fake) {
      delete process.env.TESTING_TAR_FAKE_PLATFORM
    }
  }
}

const PathReservations = await load(posix, false)
const WinPathReservations = await load(win32, true)

test('basic race', async () => {
  const { promise, resolve: end } = Promise.withResolvers()
  // simulate the race conditions we care about
  let didFile = false
  const file = done => {
    assert.equal(didFile, false, 'only call file once')
    didFile = true
    assert.equal(didLink, false, 'do file before link')
    setTimeout(done)
  }

  let didLink = false
  const link = done => {
    assert.equal(didLink, false, 'only call once')
    assert.equal(didFile, true, 'do file before link')
    didLink = true
    // make sure this one is super duper cleared lol
    // the subsequent calls are no-ops, but verify as much
    done()
    done()
    done()
  }

  let didDir = false
  const dir = done => {
    assert.equal(didDir, false, 'only do dir once')
    assert.equal(didLink, true, 'do link before dir')
    didDir = true
    done()
  }

  let didDir2 = false
  const dir2 = done => {
    assert.equal(didDir, true, 'did dir before dir2')
    assert.equal(didDir2, false, 'only do dir2 once')
    didDir2 = true
    done()
  }

  let didDir3 = false
  const dir3 = done => {
    assert.equal(didDir2, true, 'did dir2 before dir3')
    assert.equal(didDir3, false, 'only do dir3 once')
    didDir3 = true
    done()
    end()
  }

  const r = new PathReservations()

  assert(r.reserve(['a/b/c/d'], file), 'file starts right away')
  assert(!r.reserve(['a/B/c////D', 'a/b/e'], link), 'link waits')
  assert(!r.reserve(['a/b/e/f'], dir), 'dir waits')
  assert(!r.reserve(['a/b'], dir2), 'dir2 waits')
  assert(!r.reserve(['a/b/x'], dir3), 'dir3 waits')
  await promise
})

test('unicode shenanigans', () =>
  new Promise(end => {
    const e1 = Buffer.from([0xc3, 0xa9])
    const e2 = Buffer.from([0x65, 0xcc, 0x81])
    let didCafe1 = false
    const cafe1 = done => {
      assert.equal(didCafe1, false, 'did cafe1 only once')
      assert.equal(didCafe2, false, 'did cafe1 before cafe2')
      didCafe1 = true
      setTimeout(done)
    }
    let didCafe2 = false
    const cafe2 = done => {
      assert.equal(didCafe1, true, 'did cafe1 before cafe2')
      assert.equal(didCafe2, false, 'did cafe2 only once')
      didCafe2 = true
      done()
      end()
    }
    const cafePath1 = `c/a/f/${e1}`
    const cafePath2 = `c/a/f/${e2}`
    const r = new PathReservations()
    assert(r.reserve([cafePath1], cafe1))
    assert(!r.reserve([cafePath2], cafe2))
  }))

test('absolute paths and trailing slash', () =>
  new Promise(end => {
    let calledA1 = false
    let calledA2 = false
    const a1 = done => {
      assert.equal(calledA1, false, 'called a1 only once')
      assert.equal(calledA2, false, 'called a1 before 2')
      calledA1 = true
      setTimeout(done)
    }
    const a2 = done => {
      assert.equal(calledA1, true, 'called a1 before 2')
      assert.equal(calledA2, false, 'called a2 only once')
      calledA2 = true
      done()
      if (calledR2) {
        end()
      }
    }
    let calledR1 = false
    let calledR2 = false
    const r1 = done => {
      assert.equal(calledR1, false, 'called r1 only once')
      assert.equal(calledR2, false, 'called r1 before 2')
      calledR1 = true
      setTimeout(done)
    }
    const r2 = done => {
      assert.equal(calledR1, true, 'called r1 before 2')
      assert.equal(calledR2, false, 'called r1 only once')
      calledR2 = true
      done()
      if (calledA2) {
        end()
      }
    }
    const r = new PathReservations()
    assert(r.reserve(['/p/a/t/h'], a1))
    assert(!r.reserve(['/p/a/t/h/'], a2))
    assert(r.reserve(['p/a/t/h'], r1))
    assert(!r.reserve(['p/a/t/h/'], r2))
  }))

test('on windows, everything collides with everything', () =>
  new Promise(end => {
    const r = new WinPathReservations()
    let called1 = false
    let called2 = false
    const f1 = done => {
      assert.equal(called1, false, 'only call 1 once')
      assert.equal(called2, false, 'call 1 before 2')
      called1 = true
      setTimeout(done)
    }
    const f2 = done => {
      assert.equal(called1, true, 'call 1 before 2')
      assert.equal(called2, false, 'only call 2 once')
      called2 = true
      done()
      end()
    }
    assert.equal(r.reserve(['some/path'], f1), true)
    assert.equal(r.reserve(['other/path'], f2), false)
  }))

test('check a function that has no reservation', () => {
  const r = new PathReservations()
  assert.throws(() => r.check(() => {}), {
    message: 'function does not have any path reservations',
  })
})
