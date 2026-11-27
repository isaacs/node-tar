// A failure in create or replace goes to the caller, and leaves no
// open file descriptor. GHSA-8h4g-6p7x-m3c9.
import fs from 'node:fs'
import { resolve } from 'node:path'
import { assert, describe, spyOn, test, testdir } from 'ubqtest'
import { create } from '../src/create.js'
import { Header } from '../src/header.js'
import { replace } from '../src/replace.js'

// Count the descriptors that this test opens and does not close.
const trackFds = () => {
  const { open, openSync, close, closeSync } = fs
  const fds = new Set<number>()
  spyOn(fs, 'openSync', ((...args: unknown[]) => {
    const fd = (openSync as (...a: unknown[]) => number)(...args)
    fds.add(fd)
    return fd
  }) as typeof fs.openSync)
  spyOn(fs, 'closeSync', fd => {
    fds.delete(fd)
    closeSync(fd)
  })
  spyOn(fs, 'open', ((...args: unknown[]) => {
    const cb = args.pop() as (er: unknown, fd?: number) => void
    const call = open as (...a: unknown[]) => void
    call(...args, (er: unknown, fd?: number) => {
      if (typeof fd === 'number') fds.add(fd)
      cb(er, fd)
    })
  }) as typeof fs.open)
  spyOn(fs, 'close', ((fd: number, cb: fs.NoParamCallback) => {
    fds.delete(fd)
    close(fd, cb)
  }) as typeof fs.close)
  return fds
}
// File streams close after the promise of the command settles.
const settle = () => new Promise<void>(res => setTimeout(res, 50))

const fixture = () => {
  const cwd = testdir({ 'new.txt': 'new' })
  const file = resolve(cwd, 'a.tar')
  create({ file, cwd, sync: true }, ['new.txt'])
  return { cwd, file }
}

describe('an @archive operand that does not exist', () => {
  test('replace async rejects', async () => {
    const { cwd, file } = fixture()
    const fds = trackFds()
    await assert.rejects(replace({ file, cwd }, ['@missing.tar']), {
      code: 'ENOENT',
    })
    await settle()
    assert.deepEqual([...fds], [])
  })
  test('replace sync throws', () => {
    const { cwd, file } = fixture()
    const fds = trackFds()
    assert.throws(
      () => replace({ file, cwd, sync: true }, ['@missing.tar']),
      { code: 'ENOENT' },
    )
    assert.deepEqual([...fds], [])
  })
  test('create async rejects', async () => {
    const { cwd } = fixture()
    const fds = trackFds()
    await assert.rejects(
      create({ file: resolve(cwd, 'out.tar'), cwd }, ['@missing.tar']),
      { code: 'ENOENT' },
    )
    await settle()
    assert.deepEqual([...fds], [])
  })
  test('create sync throws', () => {
    const { cwd } = fixture()
    const fds = trackFds()
    assert.throws(
      () =>
        create({ file: resolve(cwd, 'out.tar'), cwd, sync: true }, [
          '@missing.tar',
        ]),
      { code: 'ENOENT' },
    )
    assert.deepEqual([...fds], [])
  })
})

describe('a header with a size that is not a safe integer', () => {
  const badArchive = () => {
    const cwd = testdir({ 'new.txt': 'new' })
    const file = resolve(cwd, 'a.tar')
    const block = Buffer.alloc(512)
    new Header({ path: 'x', type: 'File', size: 0 }).encode(block)
    // base-256 size that is too large, with a correct checksum
    block[124] = 0x80
    block.fill(0x7f, 125, 136)
    block.fill(' ', 148, 156)
    const sum = block.reduce((a, b) => a + b, 0)
    block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    fs.writeFileSync(file, Buffer.concat([block, Buffer.alloc(1024)]))
    return { cwd, file }
  }
  const expect = {
    message: 'parsed number outside of javascript safe integer range',
  }
  test('replace async rejects', async () => {
    const { cwd, file } = badArchive()
    const fds = trackFds()
    await assert.rejects(replace({ file, cwd }, ['new.txt']), expect)
    assert.deepEqual([...fds], [])
  })
  test('replace sync throws', () => {
    const { cwd, file } = badArchive()
    const fds = trackFds()
    assert.throws(
      () => replace({ file, cwd, sync: true }, ['new.txt']),
      expect,
    )
    assert.deepEqual([...fds], [])
  })
})
