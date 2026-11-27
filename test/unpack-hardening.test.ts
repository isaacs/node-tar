// Defects and hardening items from security reports that are not
// archive-only attacks: GHSA-5x73-x9rx-m7x2, GHSA-m6rr-3gqh-4f88,
// GHSA-qf42-f7hw-qxrq.
import fs from 'node:fs'
import { resolve } from 'node:path'
import { assert, cleanup, spyOn, test, testdir } from 'ubqtest'
import { extract } from '../src/extract.js'
import { Header, type HeaderData } from '../src/header.js'
import { UnpackSync } from '../src/unpack.js'

const MTIME = new Date('2001-02-03T04:05:06Z')
const ent = (h: HeaderData, body = '') => {
  const data = Buffer.from(body)
  const block = Buffer.alloc(512)
  new Header({ mode: 0o644, ...h, size: data.length }).encode(block)
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512)
  return Buffer.concat([block, data, pad])
}
const EOA = Buffer.alloc(1024)

for (const sync of [false, true]) {
  const mode = sync ? 'sync' : 'async'

  test(`${mode}: directory times do not follow a symlink`, async () => {
    const root = testdir({ cwd: {}, outside: {} })
    const cwd = resolve(root, 'cwd')
    const outside = resolve(root, 'outside')
    const before = fs.statSync(outside).mtime
    const file = resolve(root, 'a.tar')
    fs.writeFileSync(
      file,
      Buffer.concat([
        ent({ path: 'd/', type: 'Directory', mode: 0o755, mtime: MTIME }),
        EOA,
      ]),
    )
    // Replace the new directory with a symlink at the last moment
    // before the code sets the times.
    const swap = (p: fs.PathLike) => {
      assert.equal(String(p), resolve(cwd, 'd'))
      fs.rmdirSync(p)
      fs.symlinkSync(outside, p)
    }
    const { lutimes, lutimesSync } = fs
    const spies = [
      spyOn(fs, 'lutimes', ((p, a, m, cb) => {
        swap(p)
        lutimes(p, a, m, cb)
      }) as typeof fs.lutimes),
      spyOn(fs, 'lutimesSync', (p, a, m) => {
        swap(p)
        lutimesSync(p, a, m)
      }),
    ]
    if (sync) extract({ file, cwd, sync: true })
    else await extract({ file, cwd })
    assert.deepEqual(
      spies.map(s => s.calls.length),
      sync ? [0, 1] : [1, 0],
    )
    assert.deepEqual(fs.statSync(outside).mtime, before)
    assert.deepEqual(fs.lstatSync(resolve(cwd, 'd')).mtime, MTIME)
  })

  test(`${mode}: directory owner does not follow a symlink`, async () => {
    const root = testdir({ cwd: {} })
    const cwd = resolve(root, 'cwd')
    const file = resolve(root, 'a.tar')
    fs.writeFileSync(
      file,
      Buffer.concat([ent({ path: 'd/', type: 'Directory' }), EOA]),
    )
    const { uid, gid } = fs.statSync(cwd)
    const chown = spyOn(fs, sync ? 'chownSync' : 'chown')
    const { lchown, lchownSync } = fs
    const lchownSpy =
      sync ?
        spyOn(fs, 'lchownSync', (p, u, g) => lchownSync(p, u, g))
      : spyOn(fs, 'lchown', ((p, u, g, cb) =>
          lchown(p, u, g, cb)) as typeof fs.lchown)
    const opt = { file, cwd, uid, gid, forceChown: true, noMtime: true }
    if (sync) extract({ ...opt, sync: true })
    else await extract(opt)
    assert.deepEqual(chown.calls, [])
    // The code that makes the directory can also set the owner.
    assert(lchownSpy.calls.length > 0)
    for (const { args } of lchownSpy.calls) {
      assert.deepEqual(args.slice(0, 3), [resolve(cwd, 'd'), uid, gid])
    }
  })

  test(`${mode}: options do not come from Object.prototype`, async () => {
    const root = testdir({ cwd: {} })
    const cwd = resolve(root, 'cwd')
    const file = resolve(root, 'a.tar')
    const block = ent({ path: 'x', type: 'File' }, 'escape')
    // The Header class does not write '..', so write the name and
    // the checksum by hand.
    block.fill(0, 0, 100)
    block.write('../escaped', 0)
    block.fill(' ', 148, 156)
    const sum = block.subarray(0, 512).reduce((a, b) => a + b, 0)
    block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    fs.writeFileSync(file, Buffer.concat([block, EOA]))

    const proto = Object.prototype as { preservePaths?: boolean }
    proto.preservePaths = true
    cleanup(() => {
      delete proto.preservePaths
    })
    const warnings: string[] = []
    const opt = {
      file,
      cwd,
      onwarn: (_: string, message: string) => {
        warnings.push(message)
      },
    }
    if (sync) extract({ ...opt, sync: true })
    else await extract(opt)
    delete proto.preservePaths
    assert.deepEqual(warnings, ["path contains '..'"])
    assert.equal(fs.existsSync(resolve(root, 'escaped')), false)
  })
}

test('sync: no use of the file descriptor after a write error', () => {
  const cwd = testdir()
  const body = 'A'.repeat(512) + 'B'.repeat(512)
  const archive = Buffer.concat([
    ent({ path: 'f', type: 'File', mtime: MTIME }, body),
    EOA,
  ])
  const { writeSync } = fs
  let failed = false
  const write = spyOn(fs, 'writeSync', ((...args: unknown[]) => {
    if (!failed) {
      failed = true
      throw Object.assign(new Error('no space'), { code: 'ENOSPC' })
    }
    return (writeSync as (...a: unknown[]) => number)(...args)
  }) as typeof fs.writeSync)
  const futimes = spyOn(fs, 'futimesSync')
  const { closeSync } = fs
  const close = spyOn(fs, 'closeSync', fd => closeSync(fd))

  const warnings: string[] = []
  const u = new UnpackSync({
    cwd,
    onwarn: (_, message) => {
      warnings.push(String(message))
    },
  })
  // The header and the first body block. The write fails.
  u.write(archive.subarray(0, 1024))
  assert.equal(close.calls.length, 1)
  u.end(archive.subarray(1024))
  assert.equal(write.calls.length, 1)
  assert.equal(close.calls.length, 1)
  assert.deepEqual(futimes.calls, [])
  assert.deepEqual(warnings, ['no space'])
})

test('sync: a file that replaces a directory is made one time', () => {
  const cwd = testdir({ f: {} })
  const { openSync } = fs
  const open = spyOn(fs, 'openSync', ((...args: unknown[]) =>
    (openSync as (...a: unknown[]) => number)(
      ...args,
    )) as typeof fs.openSync)
  const u = new UnpackSync({ cwd })
  u.end(Buffer.concat([ent({ path: 'f', type: 'File' }, 'data'), EOA]))
  assert.equal(open.calls.length, 1)
  assert.equal(fs.readFileSync(resolve(cwd, 'f'), 'utf8'), 'data')
})
