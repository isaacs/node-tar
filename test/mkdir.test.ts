import * as nodeFs from 'node:fs'
import { assert, describe, test, testdir } from 'ubqtest'
import { mkdir, mkdirSync, type MkdirOptions } from '../src/mkdir.js'
import { hookFs, SKIP, type FsOp } from './helpers.js'

const modes = ['async', 'sync'] as const

const run = async (
  mode: 'async' | 'sync',
  dir: string,
  opt: Partial<MkdirOptions> & { cwd: string },
  hooks: Partial<Record<FsOp, (...args: unknown[]) => unknown>> = {},
) => {
  const { fs, fsSync, calls } = hookFs(hooks)
  const options = {
    umask: 0,
    preserve: false,
    unlink: false,
    mode: 0o755,
    ...opt,
  }
  if (mode === 'sync') mkdirSync(fsSync, dir, options)
  else await mkdir(fs, dir, options)
  return calls
}

for (const mode of modes) {
  describe(mode, () => {
    test('make each part of the path', async () => {
      const cwd = testdir({ a: {} })
      const calls = await run(mode, cwd + '/a/b/c', { cwd, mode: 0o50 })
      // The owner can always use the directory.
      assert.deepEqual(calls, [
        ['mkdir', cwd + '/a', { mode: 0o750 }],
        ['lstat', cwd + '/a'],
        ['mkdir', cwd + '/a/b', { mode: 0o750 }],
        ['mkdir', cwd + '/a/b/c', { mode: 0o750 }],
      ])
      assert.equal(nodeFs.statSync(cwd + '/a/b/c').mode & 0o777, 0o750)
    })

    test('the extraction directory must be a directory', async () => {
      const cwd = testdir({ f: '' })
      assert.deepEqual(await run(mode, cwd, { cwd }), [['stat', cwd]])
      await assert.rejects(run(mode, cwd + '/f', { cwd: cwd + '/f' }), {
        name: 'CwdError',
        code: 'ENOTDIR',
        path: cwd + '/f',
      })
      await assert.rejects(run(mode, cwd + '/no', { cwd: cwd + '/no' }), {
        name: 'CwdError',
        code: 'ENOENT',
      })
    })

    test('a directory below the root', async () => {
      const calls = await run(
        mode,
        '/a/b',
        { cwd: '/' },
        { mkdir: () => SKIP },
      )
      assert.deepEqual(calls, [
        ['mkdir', '/a', { mode: 0o755 }],
        ['mkdir', '/a/b', { mode: 0o755 }],
      ])
    })

    test('chmod when the umask has a bit of the mode', async () => {
      const cwd = testdir({})
      const opt = { cwd, mode: 0o775, umask: 0o22 }
      const calls = await run(mode, cwd + '/a/b', opt)
      assert.deepEqual(calls.slice(2), [['chmod', cwd + '/a/b', 0o775]])
      assert.equal(nodeFs.statSync(cwd + '/a/b').mode & 0o777, 0o775)
    })

    test('a symbolic link in the path is an error', async () => {
      const cwd = testdir({ real: {} })
      nodeFs.symlinkSync('real', cwd + '/link')
      await assert.rejects(run(mode, cwd + '/link/a/b', { cwd }), {
        name: 'SymlinkError',
        symlink: cwd + '/link',
        path: cwd + '/link/a/b',
      })
      assert.deepEqual(nodeFs.readdirSync(cwd + '/real'), [])
    })

    test('a file in the path is an error', async () => {
      const cwd = testdir({ f: '' })
      await assert.rejects(run(mode, cwd + '/f/a', { cwd }), {
        code: 'EEXIST',
        syscall: 'mkdir',
      })
    })

    test('unlink removes a link or a file in the path', async () => {
      const cwd = testdir({ real: {}, f: '' })
      nodeFs.symlinkSync('real', cwd + '/link')
      await run(mode, cwd + '/link/a', { cwd, unlink: true })
      await run(mode, cwd + '/f', { cwd, unlink: true })
      assert(nodeFs.lstatSync(cwd + '/link').isDirectory())
      assert(nodeFs.lstatSync(cwd + '/link/a').isDirectory())
      assert(nodeFs.lstatSync(cwd + '/f').isDirectory())
      assert.deepEqual(nodeFs.readdirSync(cwd + '/real'), [])
    })

    test('preserve makes the path with one call', async () => {
      const cwd = testdir({ real: {} })
      nodeFs.symlinkSync('real', cwd + '/link')
      const opt = { cwd, preserve: true, uid: 1, gid: 2 }
      const dir = cwd + '/link/a/b/c'
      const calls = await run(mode, dir, opt, { lchown: () => SKIP })
      assert.deepEqual(calls, [
        ['mkdir', dir, { mode: 0o755, recursive: true }],
        ['lchown', cwd + '/link/a/b/c', 1, 2],
        ['lchown', cwd + '/link/a/b', 1, 2],
        ['lchown', cwd + '/link/a', 1, 2],
      ])
      assert(nodeFs.statSync(cwd + '/real/a/b/c').isDirectory())
      // Nothing is made the second time, so no owner is set.
      assert.deepEqual(await run(mode, dir, opt), [
        ['mkdir', dir, { mode: 0o755, recursive: true }],
      ])
    })

    test('the owner of each directory that is made', async () => {
      const cwd = testdir({ a: {} })
      const opt = { cwd, uid: 1, gid: 2, processUid: 1, processGid: 3 }
      const calls = await run(mode, cwd + '/a/b/c', opt, {
        lchown: () => SKIP,
      })
      assert.deepEqual(
        calls.filter(c => c[0] === 'lchown'),
        [
          ['lchown', cwd + '/a/b', 1, 2],
          ['lchown', cwd + '/a/b/c', 1, 2],
        ],
      )
      // Not for the owner of the process, and not with only one id.
      for (const ids of [
        { processUid: 1, processGid: 2 },
        { gid: undefined },
      ]) {
        const calls = await run(mode, cwd + '/a/d/e', { ...opt, ...ids })
        assert.deepEqual(
          calls.filter(c => c[0] === 'lchown'),
          [],
        )
      }
    })
  })
}
