// https://github.com/isaacs/node-tar/issues/192
import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { resolve } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { assert, describe, test, testdir } from 'ubqtest'
import { deleteSync as coreDeleteSync } from '../src/delete.js'
import * as core from '../src/index.js'
import * as tar from '../src/server/index.js'
import {
  cat,
  ent,
  EOA,
  file,
  hdr,
  isWindows,
  longPath,
  pax,
} from './helpers.js'

type Options = tar.DeleteOptions & tar.DeleteOptionsSync
const commands = {
  async: (opt: Options, files?: string[]) => tar.delete(opt, files),
  sync: async (opt: Options, files?: string[]) =>
    tar.deleteSync(opt, files),
}

const long = 'long/' + 'n'.repeat(120) + '/Ω.txt'
const gnu = 'gnu/' + 'g'.repeat(150)
const target = 'target/' + 't'.repeat(130)
const binary = Buffer.from(
  Array.from({ length: 70_000 }, (_, i) => (i * 7) % 256),
)
const mtime = new Date('2020-02-02T02:02:02.250Z')
const old = () =>
  Buffer.from(
    cat(
      file('keep.txt', 'keep'),
      pax([
        ['path', long],
        ['mtime', String(mtime.getTime() / 1000)],
      ]),
      ent({ path: 'short', type: 'File', mode: 0o600 }, 'pax body'),
      longPath(gnu),
      file('x', 'gnu body'),
      file('remove.txt', 'remove me'),
      file('dir/remove.txt', 'this one stays'),
      pax([['linkpath', target]]),
      hdr({ path: 'link', type: 'SymbolicLink', linkpath: 'x' }),
      file('/abs/binary', binary),
      file('remove.txt', 'the second one'),
      EOA,
    ),
  )
const content = (data: Uint8Array) => {
  const found = []
  for (const entry of tar.entriesSync(data)) {
    found.push({
      path: entry.path,
      type: entry.type,
      mode: entry.mode,
      mtime: entry.mtime,
      linkpath: entry.linkpath,
      body: Buffer.from(entry.bytes()),
    })
  }
  return found
}
const paths = (data: Uint8Array) => content(data).map(entry => entry.path)

for (const [name, del] of Object.entries(commands)) {
  describe(name, () => {
    test('remove the listed paths', async () => {
      const dir = testdir({ 'old.tar': old() })
      const file = resolve(dir, 'old.tar')
      nodeFs.chmodSync(file, 0o600)
      const before = content(nodeFs.readFileSync(file))
      assert.equal(before.length, 8)
      assert.match(before[1], { path: long, mtime, mode: 0o600 })
      assert.match(before[5], { path: 'link', linkpath: target })

      const warnings: unknown[] = []
      await del({ file, onwarn: (...w) => warnings.push(w) }, [
        'remove.txt',
      ])
      const after = content(nodeFs.readFileSync(file))
      // Each other entry is there, in the same order, with the same
      // fields and the same bytes of content.
      assert.deepEqual(
        after,
        before.filter(entry => entry.path !== 'remove.txt'),
      )
      assert.deepEqual(
        after.map(entry => entry.path),
        ['keep.txt', long, gnu, 'dir/remove.txt', 'link', '/abs/binary'],
      )
      assert.equal(after[5]?.body.equals(binary), true)
      assert.deepEqual(warnings, [])
      assert.deepEqual(nodeFs.readdirSync(dir), ['old.tar'])
      if (!isWindows) {
        assert.equal(nodeFs.statSync(file).mode & 0o777, 0o600)
      }

      // A directory, and all that is in it. The alias of `file`.
      await del({ f: file } as unknown as Options, ['long/', 'dir'])
      assert.deepEqual(paths(nodeFs.readFileSync(file)), [
        'keep.txt',
        gnu,
        'link',
        '/abs/binary',
      ])
    })

    test('remove with a filter', async () => {
      const dir = testdir({ 'old.tar': old() })
      const file = resolve(dir, 'old.tar')
      // With no list, each entry that the filter accepts.
      await del({
        file,
        filter: (path, entry) =>
          entry.type === 'SymbolicLink' || path.endsWith('remove.txt'),
      })
      assert.deepEqual(paths(nodeFs.readFileSync(file)), [
        'keep.txt',
        long,
        gnu,
        '/abs/binary',
      ])
      // With a list, only a listed entry that the filter accepts.
      await del({ file, filter: path => path !== gnu }, ['gnu', 'long'])
      assert.deepEqual(paths(nodeFs.readFileSync(file)), [
        'keep.txt',
        gnu,
        '/abs/binary',
      ])
      // All of the entries.
      await del({ file, filter: () => true })
      assert.deepEqual(paths(nodeFs.readFileSync(file)), [])
      assert.deepEqual(nodeFs.readdirSync(dir), ['old.tar'])
    })

    test('the archive keeps its compression', async () => {
      const small = Buffer.from(
        cat(file('a', 'a'), file('b', 'b'), file('c', 'c'), EOA),
      )
      const dir = testdir({
        'small.tgz': gzipSync(small),
        'large.tgz': gzipSync(old()),
      })
      for (const [name, remove, left] of [
        ['small.tgz', 'b', ['a', 'c']],
        ['large.tgz', 'keep.txt', paths(old()).slice(1)],
      ] as const) {
        const file = resolve(dir, name)
        await del({ file }, [remove])
        const data = nodeFs.readFileSync(file)
        assert.deepEqual([data[0], data[1]], [0x1f, 0x8b])
        assert.deepEqual(paths(gunzipSync(data)), [...left])
      }
    })

    test('a listed path that is not in the archive', async () => {
      const data = old()
      const dir = testdir({ 'old.tar': data })
      const file = resolve(dir, 'old.tar')
      const warnings: [string, string][] = []
      await del(
        {
          file,
          onwarn: (code, message) => warnings.push([code, message]),
        },
        ['keep.txt', 'not/there'],
      )
      assert.deepEqual(warnings, [
        ['TAR_ENTRY_ERROR', 'not/there: not found in archive'],
      ])
      const after = nodeFs.readFileSync(file)
      assert.deepEqual(paths(after), paths(data).slice(1))

      // With `strict`, the archive does not change.
      await assert.rejects(
        del({ file, strict: true }, [long, 'not/there']),
        { message: 'TAR_ENTRY_ERROR: not/there: not found in archive' },
      )
      assert.equal(nodeFs.readFileSync(file).equals(after), true)
      assert.deepEqual(nodeFs.readdirSync(dir), ['old.tar'])
    })

    test('bad arguments', async () => {
      const dir = testdir({ 'old.tar': old() })
      const file = resolve(dir, 'old.tar')
      await assert.rejects(del({ file }), {
        name: 'TypeError',
        message: 'no paths specified to delete',
      })
      await assert.rejects(del({ file }, []), { name: 'TypeError' })
      await assert.rejects(del({} as Options, ['x']), {
        name: 'TypeError',
        message: 'file is required',
      })
      await assert.rejects(
        del({ file: resolve(dir, 'none.tar') }, ['x']),
        { code: 'ENOENT' },
      )
      assert.deepEqual(nodeFs.readdirSync(dir), ['old.tar'])
    })
  })
}

test('the core command needs the fs option', async () => {
  await assert.rejects(
    core.delete({ file: 'x.tar' } as core.DeleteOptions, ['x']),
    { name: 'TypeError', message: 'the file option needs the fs option' },
  )
})

test('the new file cannot be made', async () => {
  const data = old()
  const dir = testdir({ 'old.tar': data })
  const file = resolve(dir, 'old.tar')
  const denied = () =>
    Object.assign(new Error('denied'), { code: 'EACCES' })
  const fs: core.DeleteFS = {
    ...nodeFsPromises,
    open: async (path: string, flags: string, mode?: number) => {
      if (flags === 'w') throw denied()
      return nodeFsPromises.open(path, flags, mode)
    },
  }
  const fsSync = {
    ...nodeFs,
    openSync: (path: string, flags: string, mode?: number) => {
      if (flags === 'w') throw denied()
      return nodeFs.openSync(path, flags, mode)
    },
  } as core.DeleteFSSync
  // The error is that of `open`, not that of the `unlink` of a file
  // that does not exist.
  await assert.rejects(core.delete({ file, fs }, ['keep.txt']), {
    code: 'EACCES',
  })
  assert.throws(() => coreDeleteSync({ file, fs: fsSync }, ['keep.txt']), {
    code: 'EACCES',
  })
  assert.equal(nodeFs.readFileSync(file).equals(data), true)
  assert.deepEqual(nodeFs.readdirSync(dir), ['old.tar'])
})
