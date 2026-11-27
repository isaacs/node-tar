// The security rules of the extraction. Each group names the reports
// that it covers.
import * as nodeFs from 'node:fs'
import { resolve } from 'node:path'
import { assert, cleanup, describe, test, testdir } from 'ubqtest'
import { Header, type HeaderData } from '../src/header.js'
import { extract, extractSync } from '../src/extract.js'
import type { ExtractFS, ExtractFSSync } from '../src/fs.js'
import { normalizeUnicode } from '../src/normalize-unicode.js'
import { EntryData } from '../src/read-entry.js'
import { UnpackBase } from '../src/unpack.js'
import {
  cat,
  ent,
  EOA,
  hdr,
  hookFs,
  longLink,
  longPath,
  runExtract,
  SKIP,
} from './helpers.js'

const modes = ['async', 'sync'] as const
const MTIME = new Date('2001-02-03T04:05:06Z')

const link = (path: string, linkpath: string) =>
  hdr({ path, linkpath, type: 'SymbolicLink', mode: 0o755 })
const hard = (path: string, linkpath: string) =>
  hdr({ path, linkpath, type: 'Link' })
const dir = (path: string, more: HeaderData = {}) =>
  hdr({ path, type: 'Directory', mode: 0o755, ...more })
const read = (...parts: string[]) =>
  nodeFs.readFileSync(resolve(...parts), 'utf8')
const brief = (warnings: [string, string, unknown][]) =>
  warnings.map(([code, message]) => [code, message])

// A file system in memory that has only the directory `root`. The
// value of a directory in `nodes` is null. The value of a file is
// its content.
const memFs = (root: string) => {
  const nodes = new Map<string, string | null>([[root, null]])
  const fds: string[] = []
  const error = (code: string) => Object.assign(new Error(code), { code })
  const lstat = (path: string) => {
    const node = nodes.get(path)
    if (node === undefined) throw error('ENOENT')
    return {
      isDirectory: () => node === null,
      isFile: () => node !== null,
      isSymbolicLink: () => false,
      nlink: 1,
      mode: 0o755,
      mtime: MTIME,
    }
  }
  const mkdir = (path: string) => {
    if (nodes.has(path)) throw error('EEXIST')
    nodes.set(path, null)
    return undefined
  }
  const open = (path: string) => {
    nodes.set(path, '')
    return fds.push(path) - 1
  }
  const write = (fd: number, data: Uint8Array) => {
    const path = fds[fd] as string
    nodes.set(path, nodes.get(path) + new TextDecoder().decode(data))
    return data.length
  }
  const no = () => {}
  const noAsync = async () => {}
  const fs: ExtractFS = {
    open: async path => {
      const fd = open(path)
      return {
        write: async data => write(fd, data),
        utimes: noAsync,
        chown: noAsync,
        close: noAsync,
      }
    },
    stat: async path => lstat(path),
    lstat: async path => lstat(path),
    mkdir: async path => mkdir(path),
    chmod: noAsync,
    chown: noAsync,
    lchown: noAsync,
    utimes: noAsync,
    lutimes: noAsync,
    rmdir: noAsync,
    unlink: noAsync,
    rename: noAsync,
    link: noAsync,
    symlink: noAsync,
  }
  const fsSync: ExtractFSSync = {
    openSync: open,
    writeSync: write,
    futimesSync: no,
    fchownSync: no,
    closeSync: no,
    statSync: lstat,
    lstatSync: lstat,
    mkdirSync: mkdir,
    chmodSync: no,
    chownSync: no,
    lchownSync: no,
    utimesSync: no,
    lutimesSync: no,
    rmdirSync: no,
    unlinkSync: no,
    renameSync: no,
    linkSync: no,
    symlinkSync: no,
  }
  return { fs, fsSync, nodes }
}

// A symlink in the archive must not resolve outside of the extraction
// directory. GHSA-3wwj-8j6r-q339, GHSA-jmj2-9c5q-vw73,
// GHSA-hqgx-p3r3-2cfg, and their duplicates.
describe('symlink targets that can leave the cwd', () => {
  const unpack = async (mode: 'async' | 'sync', entries: Uint8Array[]) => {
    const root = testdir({ 'outside.txt': 'outside', cwd: {} })
    const cwd = resolve(root, 'cwd')
    const { warnings } = await runExtract(
      mode,
      { cwd },
      cat(...entries, EOA),
    )
    return { cwd, warnings: brief(warnings) }
  }

  const escapes: Record<string, [Uint8Array[], string, string]> = {
    "'..' after an earlier symlink": [
      [link('s1', '.'), link('esc', 's1/../outside.txt')],
      "linkpath contains '..' after a path portion",
      'esc',
    ],
    "'..' after a later symlink": [
      [link('esc', 'x/y/../outside.txt'), dir('x'), link('x/y', '..')],
      "linkpath contains '..' after a path portion",
      'esc',
    ],
    "'..' after a nested symlink": [
      [
        dir('a'),
        link('a/b', '../x'),
        link('a/esc', 'b/../../outside.txt'),
      ],
      "linkpath contains '..' after a path portion",
      'a/esc',
    ],
    "entry path that ends in '/.'": [
      [link('esc/.', '../outside.txt')],
      'linkpath escapes extraction directory',
      'esc',
    ],
    "entry path that ends in '/./'": [
      [link('esc/./', '../outside.txt')],
      'linkpath escapes extraction directory',
      'esc',
    ],
    "nested entry path that ends in '/.'": [
      [dir('a'), link('a/esc/.', '../../outside.txt')],
      'linkpath escapes extraction directory',
      'a/esc',
    ],
    'backslash in a directory name': [
      [dir('A\\B'), link('esc', 'A\\B/../../outside.txt')],
      "linkpath contains '..' after a path portion",
      'esc',
    ],
    'only ..': [
      [link('esc', '..')],
      'linkpath escapes extraction directory',
      'esc',
    ],
  }

  for (const mode of modes) {
    for (const [name, [entries, message, esc]] of Object.entries(
      escapes,
    )) {
      test(`reject ${name}, ${mode}`, async () => {
        const { cwd, warnings } = await unpack(mode, entries)
        assert.deepEqual(warnings, [['TAR_ENTRY_ERROR', message]])
        assert.throws(() => nodeFs.lstatSync(resolve(cwd, esc)), {
          code: 'ENOENT',
        })
      })
    }

    test(`allow leading .. that stays in the directory, ${mode}`, async () => {
      const { cwd, warnings } = await unpack(mode, [
        dir('a'),
        dir('a/b'),
        hdr({ path: 'f', type: 'File' }),
        link('a/b/l', '../../f'),
        link('a/m', './b/./'),
        link('a/b/n', '../b'),
      ])
      assert.deepEqual(warnings, [])
      assert.equal(nodeFs.readlinkSync(resolve(cwd, 'a/b/l')), '../../f')
      assert.equal(nodeFs.readlinkSync(resolve(cwd, 'a/m')), './b/./')
      assert.equal(nodeFs.readlinkSync(resolve(cwd, 'a/b/n')), '../b')
      assert.equal(
        nodeFs.realpathSync(resolve(cwd, 'a/b/l')),
        nodeFs.realpathSync(resolve(cwd, 'f')),
      )
    })
  }
})

// GHSA-8qq5-rm4j-mr97
describe('hard link and symlink targets with absolute paths', () => {
  const targetSym = '/some/absolute/path'

  for (const mode of modes) {
    test(mode, async () => {
      const root = testdir({ 'secret.txt': 'ORIGINAL DATA', out: {} })
      const out = resolve(root, 'out')
      const data = cat(
        hard('exploit_hard', resolve(root, 'secret.txt')),
        dir('sub/'),
        hard('sub/exploit_sub', '../secret.txt'),
        link('exploit_sym', targetSym),
        link('secret.txt', '../secret.txt'),
        dir('a/'),
        link('a/link', '/../a/target'),
        link('a/winrootdotslink', 'c:..\\foo\\bar'),
        link('a/winrootdotsescapelink', 'c:..\\..\\..\\..\\foo\\bar'),
        EOA,
      )
      const opt = { cwd: out, jobs: 1 }
      const { warnings } = await runExtract(mode, opt, data)
      assert.deepEqual(
        brief(warnings).map(([code, message]) => [
          code,
          message?.replace(/, link .*$/, ', link'),
        ]),
        [
          ['TAR_ENTRY_INFO', 'stripping / from absolute linkpath'],
          ['TAR_ENTRY_ERROR', 'ENOENT: no such file or directory, link'],
          ['TAR_ENTRY_ERROR', "linkpath contains '..'"],
          ['TAR_ENTRY_INFO', 'stripping / from absolute linkpath'],
          ['TAR_ENTRY_ERROR', 'linkpath escapes extraction directory'],
          ['TAR_ENTRY_INFO', 'stripping / from absolute linkpath'],
          ['TAR_ENTRY_INFO', 'stripping c: from absolute linkpath'],
          ['TAR_ENTRY_ERROR', 'linkpath escapes extraction directory'],
        ],
      )

      // No hard link to the file outside was made.
      assert.throws(() => nodeFs.lstatSync(resolve(out, 'exploit_hard')), {
        code: 'ENOENT',
      })
      assert.throws(
        () => nodeFs.lstatSync(resolve(out, 'sub/exploit_sub')),
        { code: 'ENOENT' },
      )
      assert.equal(read(root, 'secret.txt'), 'ORIGINAL DATA')

      // The root of an absolute symlink target is removed.
      assert.equal(
        nodeFs.readlinkSync(resolve(out, 'exploit_sym')),
        'some/absolute/path',
      )
      assert.throws(() => nodeFs.lstatSync(resolve(out, 'secret.txt')), {
        code: 'ENOENT',
      })
      assert.equal(
        nodeFs.readlinkSync(resolve(out, 'a/link')),
        '../a/target',
      )
      assert.equal(
        nodeFs.readlinkSync(resolve(out, 'a/winrootdotslink')),
        '..\\foo\\bar',
      )
      assert.throws(
        () => nodeFs.lstatSync(resolve(out, 'a/winrootdotsescapelink')),
        { code: 'ENOENT' },
      )
    })

    test(`an absolute hard link target in the cwd is used as relative, ${mode}`, async () => {
      const cwd = testdir({ f: 'content' })
      const data = cat(hard('l', '/f'), EOA)
      const { warnings } = await runExtract(mode, { cwd }, data)
      assert.deepEqual(brief(warnings), [
        ['TAR_ENTRY_INFO', 'stripping / from absolute linkpath'],
      ])
      assert.equal(
        nodeFs.statSync(cwd + '/l').ino,
        nodeFs.statSync(cwd + '/f').ino,
      )
    })
  }
})

// GHSA-r6q2-hw4h-h46w: names that differ only in Unicode form or in
// case can be one file on disk.
describe('names that can be the same file', () => {
  const chars = {
    ['ﬀ'.normalize('NFC')]: 'FF',
    ['ﬁ'.normalize('NFC')]: 'FI',
    ['ﬂ'.normalize('NFC')]: 'FL',
    ['ﬃ'.normalize('NFC')]: 'FFI',
    ['ﬄ'.normalize('NFC')]: 'FFL',
    ['ﬅ'.normalize('NFC')]: 'ST',
    ['ﬆ'.normalize('NFC')]: 'ST',
    ['ẛ'.normalize('NFC')]: 'Ṡ',
    ['ß'.normalize('NFC')]: 'SS',
    ['ẞ'.normalize('NFC')]: 'SS',
    ['ſ'.normalize('NFC')]: 'S',
  }

  for (const [c, n] of Object.entries(chars)) {
    for (const mode of modes) {
      test(`${c} => ${n}: link then file, ${mode}`, async () => {
        assert.equal(normalizeUnicode(c), normalizeUnicode(n))
        const cwd = testdir({})
        const data = cat(
          link(c, './target'),
          ent({ path: n, type: 'File' }, 'x'),
          EOA,
        )
        await runExtract(mode, { cwd }, data)
        assert.throws(() => nodeFs.statSync(resolve(cwd, 'target')), Error)
        assert.equal(read(cwd, n), 'x')
      })

      test(`${c} => ${n}: file then link, ${mode}`, async () => {
        const cwd = testdir({})
        const data = cat(
          ent({ path: n, type: 'File' }, 'x'),
          link(c, './target'),
          EOA,
        )
        await runExtract(mode, { cwd }, data)
        assert.throws(() => nodeFs.statSync(resolve(cwd, 'target')), Error)
        assert.equal(
          nodeFs.lstatSync(resolve(cwd, c)).isSymbolicLink(),
          true,
        )
      })
    }
  }

  test('entries with such names are extracted in order', async () => {
    // Each open waits, so that entries that run at one time overlap.
    const { fs, calls } = hookFs()
    const slow: ExtractFS = {
      ...fs,
      open: async (...args) => {
        await new Promise(res => setTimeout(res, 10))
        return fs.open(...args)
      },
    }
    const cwd = testdir({})
    const input = cat(
      ent({ path: 'ﬁ', type: 'File' }, '1'),
      ent({ path: 'FI', type: 'File' }, '2'),
      ent({ path: 'fi', type: 'File' }, '3'),
      ent({ path: 'other', type: 'File' }, '4'),
      EOA,
    )
    await extract({ cwd, fs: slow, input })
    const ops = calls
      .filter(c => c[0] === 'open' || c[0] === 'close')
      .map(c => `${String(c[0])} ${String(c[1]).slice(cwd.length + 1)}`)
    assert.deepEqual(
      ops.filter(op => !op.endsWith('other')),
      ['open ﬁ', 'close ﬁ', 'open FI', 'close FI', 'open fi', 'close fi'],
    )
    // An entry with a different name does not wait.
    assert.lessThan(ops.indexOf('open other'), ops.indexOf('open FI'))
  })
})

// A symlink that another process puts at the path of a file, after
// the check of the path, must not be followed.
const skip =
  typeof nodeFs.constants.O_NOFOLLOW !== 'number' && 'no O_NOFOLLOW flag'
for (const mode of modes) {
  test(
    `extract does not follow a raced-in symlink, ${mode}`,
    { skip },
    async () => {
      const root = testdir({ cwd: {}, 'target.txt': 'ORIGINAL\n' })
      const cwd = resolve(root, 'cwd')
      const target = resolve(root, 'target.txt')
      const victim = resolve(cwd, 'victim.txt')
      const data = cat(
        ent({ path: 'victim.txt', type: 'File' }, 'PWNED\n'),
        EOA,
      )

      let raced = false
      const { warnings } = await runExtract(mode, { cwd }, data, {
        lstat: (path: unknown) => {
          if (!raced && path === victim) {
            raced = true
            nodeFs.symlinkSync(target, victim)
            throw Object.assign(new Error('raced symlink'), {
              code: 'ENOENT',
            })
          }
        },
      })

      assert.equal(raced, true)
      assert.equal(read(target), 'ORIGINAL\n')
      assert.equal(nodeFs.lstatSync(victim).isSymbolicLink(), true)
      assert.equal(warnings.length, 1)
      assert.equal(warnings[0]?.[0], 'TAR_ENTRY_ERROR')
      assert.match(
        warnings[0]?.[1],
        /ELOOP|symbolic link|Too many symbolic links/,
      )
    },
  )
}

// Defects and hardening items from security reports that are not
// archive-only attacks: GHSA-5x73-x9rx-m7x2, GHSA-m6rr-3gqh-4f88,
// GHSA-qf42-f7hw-qxrq.
describe('hardening', () => {
  for (const mode of modes) {
    test(`${mode}: directory times do not follow a symlink`, async () => {
      const root = testdir({ cwd: {}, outside: {} })
      const cwd = resolve(root, 'cwd')
      const outside = resolve(root, 'outside')
      const before = nodeFs.statSync(outside).mtime
      const data = cat(dir('d/', { mtime: MTIME }), EOA)
      // Replace the new directory with a symlink at the last moment
      // before the code sets the times.
      const { calls } = await runExtract(mode, { cwd }, data, {
        lutimes: (p: unknown) => {
          assert.equal(p, resolve(cwd, 'd'))
          nodeFs.rmdirSync(resolve(cwd, 'd'))
          nodeFs.symlinkSync(outside, resolve(cwd, 'd'))
        },
      })
      assert.deepEqual(
        calls.filter(c => /utimes/.test(String(c[0]))).map(c => c[0]),
        ['lutimes'],
      )
      assert.deepEqual(nodeFs.statSync(outside).mtime, before)
      assert.deepEqual(nodeFs.lstatSync(resolve(cwd, 'd')).mtime, MTIME)
    })

    test(`${mode}: directory owner does not follow a symlink`, async () => {
      const root = testdir({ cwd: {} })
      const cwd = resolve(root, 'cwd')
      const data = cat(dir('d/'), EOA)
      const { uid, gid } = nodeFs.statSync(cwd)
      const opt = { cwd, uid, gid, forceChown: true, noMtime: true }
      const { calls } = await runExtract(mode, opt, data, {})
      const chowns = calls.filter(c => /chown/.test(String(c[0])))
      // The code that makes the directory can also set the owner.
      assert.notEqual(chowns.length, 0)
      for (const call of chowns) {
        assert.deepEqual(call, ['lchown', resolve(cwd, 'd'), uid, gid])
      }
    })

    test(`${mode}: options do not come from Object.prototype`, async () => {
      const root = testdir({ cwd: {} })
      const cwd = resolve(root, 'cwd')
      const file = resolve(root, 'a.tar')
      const block = Buffer.from(ent({ path: 'x', type: 'File' }, 'escape'))
      // The Header class does not write '..', so write the name and
      // the checksum by hand.
      block.fill(0, 0, 100)
      block.write('../escaped', 0)
      block.fill(' ', 148, 156)
      const sum = block.subarray(0, 512).reduce((a, b) => a + b, 0)
      block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
      nodeFs.writeFileSync(file, cat(block, EOA))

      const proto = Object.prototype as {
        preservePaths?: boolean
        strip?: number
        input?: Uint8Array
      }
      proto.preservePaths = true
      proto.strip = 1
      proto.input = EOA
      cleanup(() => {
        delete proto.preservePaths
        delete proto.strip
        delete proto.input
      })
      const warnings: string[] = []
      const onwarn = (_: string, message: string) => {
        warnings.push(message)
      }
      if (mode === 'sync') {
        extractSync({ file, cwd, onwarn, fs: nodeFs })
      } else {
        await extract({ file, cwd, onwarn, fs: nodeFs.promises })
      }
      delete proto.preservePaths
      delete proto.strip
      delete proto.input
      assert.deepEqual(warnings, ["path contains '..'"])
      assert.equal(nodeFs.existsSync(resolve(root, 'escaped')), false)
    })

    // GHSA-3482-qrvx-gvgq
    test(`${mode}: no setuid, setgid, or sticky bit from an archive`, async () => {
      const cwd = testdir({})
      const data = cat(
        dir('d', { mode: 0o7777 }),
        ent({ path: 'f', type: 'File', mode: 0o6755 }, 'x'),
        ent({ path: 'g', type: 'File', mode: 0o1644 }, 'x'),
        EOA,
      )
      // Some systems remove these bits when a normal user makes a
      // file, so also check the mode that the code asks for.
      const opt = { cwd, chmod: true, processUmask: 0o22, jobs: 1 }
      const { calls } = await runExtract(mode, opt, data, {})
      assert.deepEqual(
        calls.filter(c => c[0] === 'open').map(c => [c[1], c[3]]),
        [
          [resolve(cwd, 'f'), 0o755],
          [resolve(cwd, 'g'), 0o644],
        ],
      )
      assert.deepEqual(
        calls
          .filter(c => c[0] === 'mkdir' || c[0] === 'chmod')
          .map(c => [c[0], c[2]]),
        [
          ['mkdir', { mode: 0o777 }],
          ['chmod', 0o777],
        ],
      )
      assert.equal(nodeFs.statSync(resolve(cwd, 'd')).mode & 0o7777, 0o777)
      assert.equal(nodeFs.statSync(resolve(cwd, 'f')).mode & 0o7000, 0)
    })
  }

  test('sync: no use of the file descriptor after a write error', () => {
    const cwd = testdir({})
    const body = 'A'.repeat(512) + 'B'.repeat(512)
    const archive = cat(
      ent({ path: 'f', type: 'File', mtime: MTIME }, body),
      EOA,
    )
    let failed = false
    const { fsSync, calls } = hookFs({
      write: () => {
        if (!failed) {
          failed = true
          throw Object.assign(new Error('no space'), { code: 'ENOSPC' })
        }
      },
    })
    const warnings: string[] = []
    extractSync({
      cwd,
      fs: fsSync,
      // The header and the first body block, then the rest.
      input: [archive.subarray(0, 1024), archive.subarray(1024)],
      onwarn: (_, message) => {
        warnings.push(message)
      },
    })
    const ops = calls.map(c => c[0])
    assert.equal(ops.filter(op => op === 'write').length, 1)
    assert.equal(ops.filter(op => op === 'close').length, 1)
    assert.equal(ops.filter(op => op === 'futimes').length, 0)
    assert.equal(ops[ops.length - 1], 'close')
    assert.deepEqual(warnings, ['no space'])
  })

  for (const mode of modes) {
    test(`${mode}: a file that replaces a directory is made one time`, async () => {
      const cwd = testdir({ f: {} })
      const data = cat(ent({ path: 'f', type: 'File' }, 'data'), EOA)
      const { calls } = await runExtract(mode, { cwd }, data, {})
      assert.equal(calls.filter(c => c[0] === 'open').length, 1)
      assert.equal(read(cwd, 'f'), 'data')
    })

    test(`${mode}: an entry cannot replace the extraction directory`, async () => {
      const root = testdir({ cwd: { keep: 'keep' } })
      const cwd = resolve(root, 'cwd')
      const data = cat(
        link('.', 'elsewhere'),
        hard('./', 'keep'),
        dir('.', { mode: 0o700 }),
        EOA,
      )
      const opt = {
        cwd,
        preservePaths: true,
        chmod: true,
        processUmask: 0,
      }
      const { warnings, calls } = await runExtract(mode, opt, data, {})
      assert.deepEqual(warnings, [])
      assert(nodeFs.lstatSync(cwd).isDirectory())
      assert.equal(read(cwd, 'keep'), 'keep')
      // A directory entry can set the mode of the directory.
      assert.equal(nodeFs.statSync(cwd).mode & 0o777, 0o700)
      assert.deepEqual(
        calls.map(c => c[0]),
        ['stat', 'lstat', 'chmod', 'stat'],
      )
    })
  }

  for (const mode of modes) {
    for (const [platform, cwd, root] of [
      ['posix', '/', '/'],
      ['win32', 'c:\\', 'c:/'],
    ] as const) {
      test(`${mode}: ${platform} entries extract under a root cwd`, async () => {
        const { fs, fsSync, nodes } = memFs(root)
        const data = cat(
          dir('d'),
          ent({ path: 'd/f', type: 'File' }, 'data'),
          ent({ path: 'top', type: 'File' }, 'top'),
          EOA,
        )
        const warnings: unknown[][] = []
        const opt = {
          cwd,
          platform,
          input: data,
          onwarn: (...w: unknown[]) => warnings.push(w),
        }
        if (mode === 'sync') extractSync({ ...opt, fs: fsSync })
        else await extract({ ...opt, fs })
        assert.deepEqual(warnings, [])
        assert.deepEqual(Object.fromEntries(nodes), {
          [root]: null,
          [root + 'd']: null,
          [root + 'd/f']: 'data',
          [root + 'top']: 'top',
        })
      })
    }
  }

  // The checks of the path refuse each known escape before this
  // check. The test gives the check a resolved path directly.
  test('a resolved path that is not below the cwd is refused', () => {
    const cases = [
      ['posix', '/a/b', '/a/b/x', true],
      ['posix', '/a/b', '/a/bc/x', false],
      ['posix', '/a/b', '/a', false],
      ['posix', '/a/b', '/x', false],
      ['posix', '/', '/x', true],
      ['win32', 'c:\\', 'c:/x', true],
      ['win32', 'c:\\', 'd:/x', false],
      ['win32', 'c:\\a', 'c:/ab/x', false],
    ] as const
    for (const [platform, cwd, resolved, ok] of cases) {
      const warnings: [string, string][] = []
      const unpack = new UnpackBase({
        cwd,
        platform,
        fs: {},
        onwarn: (code, message) => warnings.push([code, message]),
      })
      unpack.resolve = () => resolved
      const entry = new EntryData(new Header({ path: 'x', type: 'File' }))
      assert.equal(unpack.check(entry), ok, `${cwd} ${resolved}`)
      assert.deepEqual(
        warnings,
        ok ? [] : [['TAR_ENTRY_ERROR', 'path escaped extraction target']],
      )
    }
  })
})

// A small archive must not use memory or CPU without limit, or stop
// the extraction. GHSA-343g-5v7x-x325, GHSA-7c32-79xj-j3jp,
// GHSA-98v3-7xjr-fg83, GHSA-25mm-r35j-6hgm.
describe('resource limits', () => {
  const unpack = async (
    mode: 'async' | 'sync',
    chunks: Uint8Array[],
    opt = {},
    cwd = testdir({}),
  ) => {
    const { warnings } = await runExtract(
      mode,
      { cwd, ...opt },
      cat(...chunks, EOA),
    )
    return { cwd, warnings: brief(warnings) }
  }

  for (const mode of modes) {
    test(`reject a linkpath that is too deep, ${mode}`, async () => {
      const { cwd, warnings } = await unpack(mode, [
        longLink('a/'.repeat(1024) + 'x'),
        hdr({ path: 'ln', type: 'SymbolicLink', linkpath: 'p' }),
      ])
      assert.deepEqual(warnings, [
        ['TAR_ENTRY_ERROR', 'linkpath excessively deep'],
      ])
      assert.deepEqual(nodeFs.readdirSync(cwd), [])
    })

    test(`a deep linkpath with no depth limit, ${mode}`, async () => {
      const target = 'a/'.repeat(1024) + 'x'
      const cwd = testdir({})
      const data = cat(
        longLink(target),
        hdr({ path: 'ln', type: 'SymbolicLink', linkpath: 'p' }),
        EOA,
      )
      const opt = { cwd, maxDepth: Infinity }
      // The system refuses a target of this length.
      const { warnings, calls } = await runExtract(mode, opt, data, {
        symlink: () => SKIP,
      })
      assert.deepEqual(warnings, [])
      assert.deepEqual(
        calls.filter(c => c[0] === 'symlink'),
        [['symlink', target, cwd + '/ln']],
      )
    })

    test(`reject a linkpath that is too long, ${mode}`, async () => {
      const { cwd, warnings } = await unpack(mode, [
        longLink('a'.repeat(32769)),
        hdr({ path: 'ln', type: 'SymbolicLink', linkpath: 'p' }),
      ])
      assert.deepEqual(warnings, [
        ['TAR_ENTRY_ERROR', 'linkpath excessively long'],
      ])
      assert.deepEqual(nodeFs.readdirSync(cwd), [])
    })

    test(`a long name entry over maxMetaEntrySize is not used, ${mode}`, async () => {
      const { cwd, warnings } = await unpack(
        mode,
        [
          longPath('long/' + 'a'.repeat(200)),
          hdr({ path: 'f', type: 'File' }),
        ],
        { maxMetaEntrySize: 100 },
      )
      assert.deepEqual(warnings, [])
      assert.deepEqual(nodeFs.readdirSync(cwd), ['f'])
    })

    test(`reject a path that is too long, ${mode}`, async () => {
      const { cwd, warnings } = await unpack(mode, [
        longPath(('a'.repeat(99) + '/').repeat(400) + 'x'),
        hdr({ path: 'f', type: 'File' }),
      ])
      assert.deepEqual(warnings, [
        ['TAR_ENTRY_ERROR', 'path excessively long'],
      ])
      assert.deepEqual(nodeFs.readdirSync(cwd), [])
    })

    const related: Record<string, HeaderData> = {
      'a link to its parent directory': {
        path: 'a/b',
        type: 'Link',
        linkpath: 'a',
      },
      'a symlink to its child': {
        path: 'a',
        type: 'SymbolicLink',
        linkpath: 'a/b',
      },
      'a symlink to its parent directory': {
        path: 'a/b',
        type: 'SymbolicLink',
        linkpath: 'a',
      },
      'a symlink to its own path': {
        path: 'a',
        type: 'SymbolicLink',
        linkpath: './a',
      },
    }
    for (const [name, header] of Object.entries(related)) {
      test(`extraction continues after ${name}, ${mode}`, async () => {
        const { cwd } = await unpack(mode, [
          hdr(header),
          ent({ path: 'after.txt', type: 'File' }, 'ok'),
        ])
        assert.equal(read(cwd, 'after.txt'), 'ok')
      })
    }

    test(`the extraction ends after an entry that fails, ${mode}`, async () => {
      const { cwd, warnings } = await unpack(mode, [
        hdr({ path: 'l', type: 'Link', linkpath: 'missing' }),
        ent({ path: 'after.txt', type: 'File' }, 'ok'),
      ])
      assert.equal(warnings.length, 1)
      assert.equal(warnings[0]?.[0], 'TAR_ENTRY_ERROR')
      assert.match(warnings[0]?.[1], /^ENOENT/)
      assert.equal(read(cwd, 'after.txt'), 'ok')
    })

    test(`the extraction ends after an entry that is skipped, ${mode}`, async () => {
      const cwd = testdir({ f: 'old' })
      const { warnings } = await unpack(
        mode,
        [ent({ path: 'f', type: 'File' }, 'new')],
        { keep: true },
        cwd,
      )
      assert.deepEqual(warnings, [])
      assert.equal(read(cwd, 'f'), 'old')
    })
  }
})
