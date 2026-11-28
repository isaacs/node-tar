import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { assert, test } from 'ubqtest'
import { PathReservations } from '../src/path-reservations.js'

const tick = () => new Promise<void>(res => setTimeout(res))

// A task that adds its name to the log when it starts and when it
// ends. It ends after a timer, or when `gate` resolves.
const tasks = () => {
  const log: string[] = []
  const task = (name: string, gate?: Promise<void>) => async () => {
    log.push(`${name} start`)
    await (gate ?? tick())
    log.push(`${name} end`)
  }
  return { log, task }
}

test('tasks with related paths run in order', async () => {
  const { log, task } = tasks()
  const r = new PathReservations()
  await Promise.all([
    r.reserve(['a/b/c/d'], task('file')),
    // The same path as the file, in a different case.
    r.reserve(['a/B/c////D', 'a/b/e'], task('link')),
    // Below a path of the link.
    r.reserve(['a/b/e/f'], task('dir')),
    // Above each path so far.
    r.reserve(['a/b'], task('dir2')),
    r.reserve(['a/b/x'], task('dir3')),
  ])
  assert.deepEqual(log, [
    'file start',
    'file end',
    'link start',
    'link end',
    'dir start',
    'dir end',
    'dir2 start',
    'dir2 end',
    'dir3 start',
    'dir3 end',
  ])
})

test('tasks in one directory run at the same time', async () => {
  const { log, task } = tasks()
  const r = new PathReservations()
  await Promise.all([
    r.reserve(['a/'], task('dir')),
    r.reserve(['a/x'], task('x')),
    r.reserve(['a/y'], task('y')),
    r.reserve(['a/z/1'], task('z')),
    r.reserve(['a'], task('dir again')),
    r.reserve(['b'], task('other')),
  ])
  assert.deepEqual(log, [
    'dir start',
    'other start',
    'dir end',
    'x start',
    'y start',
    'z start',
    'other end',
    'x end',
    'y end',
    'z end',
    'dir again start',
    'dir again end',
  ])
})

test('a task that waits for a directory user and a path user', async () => {
  const { log, task } = tasks()
  const r = new PathReservations()
  let open = () => {}
  const gate = new Promise<void>(res => (open = res))
  await Promise.all([
    r.reserve(['a/x'], task('x', gate)),
    r.reserve(['a/y'], task('y')),
    // Waits for x and y, which use a as a directory.
    r.reserve(['a'], task('a')),
    // Waits for a.
    r.reserve(['a/x'], task('x again')),
    tick()
      .then(tick)
      .then(() => open()),
  ])
  assert.deepEqual(log, [
    'x start',
    'y start',
    'y end',
    'x end',
    'a start',
    'a end',
    'x again start',
    'x again end',
  ])
})

test('unicode forms of one name are one path', async () => {
  const { log, task } = tasks()
  const e1 = Buffer.from([0xc3, 0xa9]).toString()
  const e2 = Buffer.from([0x65, 0xcc, 0x81]).toString()
  assert.notEqual(e1, e2)
  const r = new PathReservations()
  await Promise.all([
    r.reserve([`c/a/f/${e1}`], task('cafe1')),
    r.reserve([`c/a/f/${e2}`], task('cafe2')),
  ])
  assert.deepEqual(log, [
    'cafe1 start',
    'cafe1 end',
    'cafe2 start',
    'cafe2 end',
  ])
})

test('absolute paths and trailing slash', async () => {
  const { log, task } = tasks()
  const r = new PathReservations()
  await Promise.all([
    r.reserve(['/p/a/t/h'], task('a1')),
    r.reserve(['/p/a/t/h/'], task('a2')),
    r.reserve(['p/a/t/h'], task('r1')),
    r.reserve(['p/a/t/h/'], task('r2')),
  ])
  assert.deepEqual(log, [
    'a1 start',
    'r1 start',
    'a1 end',
    'a2 start',
    'r1 end',
    'r2 start',
    'a2 end',
    'r2 end',
  ])
})

test('on windows, one task runs at a time', async () => {
  const { log, task } = tasks()
  const r = new PathReservations(true)
  await Promise.all([
    r.reserve(['some/path'], task('1')),
    r.reserve(['other/path'], task('2')),
  ])
  assert.deepEqual(log, ['1 start', '1 end', '2 start', '2 end'])
})

test('a task that fails frees its paths', async () => {
  const { log, task } = tasks()
  const r = new PathReservations()
  const poop = new Error('poop')
  const failed = r.reserve(['a'], () => Promise.reject(poop))
  const after = r.reserve(['a'], task('after'))
  assert.equal(await assert.rejects(failed, { message: 'poop' }), poop)
  await after
  assert.deepEqual(log, ['after start', 'after end'])
})

// A symbolic link `a/b` with the target `a` reserves the two paths.
for (const paths of [
  ['a/b', 'a'],
  ['a', 'a/b'],
]) {
  test(`a task with the paths ${paths.join(' and ')} starts at once`, async () => {
    const { log, task } = tasks()
    const r = new PathReservations()
    const done = r.reserve(paths, task('link'))
    assert.deepEqual(log, ['link start'])
    await done
    // The paths are free again.
    await r.reserve(['a'], task('a'))
    await r.reserve(['a/b'], task('b'))
    assert.deepEqual(log, [
      'link start',
      'link end',
      'a start',
      'a end',
      'b start',
      'b end',
    ])
  })
}

test('a path and its parent wait for a user of the parent', async () => {
  const { log, task } = tasks()
  const r = new PathReservations()
  await Promise.all([
    // Uses `a` as a directory.
    r.reserve(['a/c'], task('dir user')),
    r.reserve(['a/b', 'a'], task('link')),
  ])
  assert.deepEqual(log, [
    'dir user start',
    'dir user end',
    'link start',
    'link end',
  ])
})

test('a reservation is released when its work is done', async () => {
  // Bun has its own function to collect garbage, and no V8 flags.
  const { Bun } = globalThis as { Bun?: { gc(force: boolean): void } }
  let gc = () => Bun?.gc(true)
  if (!Bun) {
    setFlagsFromString('--expose-gc')
    gc = runInNewContext('gc') as () => void
  }
  const reservations = new PathReservations()
  let ref: WeakRef<object> | undefined
  await (() => {
    const held = { big: Array.from({ length: 1000 }, () => 'x') }
    ref = new WeakRef(held)
    return reservations.reserve(['a/b', 'a/c'], async () => {
      assert.equal(held.big.length, 1000)
    })
  })()
  // The promise callbacks drop their references in a later turn, so
  // collect until the object is gone.
  const held = ref
  assert(held)
  await assert.eventually(() => {
    gc()
    return held.deref() === undefined
  }, true)
  // The reservation system still works.
  const order: number[] = []
  await reservations.reserve(['a/b'], async () => {
    order.push(1)
  })
  assert.deepEqual(order, [1])
})

test('the root waits for a task below it, and the reverse', async () => {
  const { log, task } = tasks()
  const r = new PathReservations()
  await Promise.all([
    r.reserve(['/a/b'], task('below')),
    r.reserve(['/'], task('root')),
    r.reserve(['/c'], task('after')),
  ])
  assert.deepEqual(log, [
    'below start',
    'below end',
    'root start',
    'root end',
    'after start',
    'after end',
  ])
})

// A path uses memory for its own parts, and not for each of its
// parent paths. GHSA-7c32-79xj-j3jp.
test('long paths with many parts use little memory', async () => {
  const path = (i: number) =>
    Array.from({ length: 1024 }, () => `${i}`.padEnd(31, 'b')).join('/')
  const r = new PathReservations()
  let open!: () => void
  const gate = new Promise<void>(res => (open = res))
  const before = process.memoryUsage().heapUsed
  const all: Promise<void>[] = []
  for (let i = 0; i < 16; i++) all.push(r.reserve([path(i)], () => gate))
  const used = process.memoryUsage().heapUsed - before
  open()
  await Promise.all(all)
  // 16 paths of 32 KiB. A string for each parent path of each one
  // would be more than 250 MiB.
  assert(used < 64 * 1024 * 1024, `${used} bytes`)
})
