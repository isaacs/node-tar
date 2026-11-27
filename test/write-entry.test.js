import {
  any,
  assert,
  cleanup,
  describe,
  env,
  stub,
  test,
  testdir,
} from 'ubqtest'
import fs from 'fs'
import { ReadEntry } from '../src/read-entry.js'
import { makeTar } from './fixtures/make-tar.js'
import {
  WriteEntry,
  WriteEntrySync,
  WriteEntryTar,
} from '../src/write-entry.js'
import path from 'path'
import { Header } from '../src/header.js'
import mutateFS from 'mutate-fs'
import { Parser } from '../src/parse.js'
import { normalizeWindowsPath as normPath } from '../src/normalize-windows-path.js'
import { chmodrSync } from 'chmodr'

const { filename, dirname } = import.meta
// The name of this file, as a path in `dirname`.
const self = path.basename(filename)

// make our tests verify that windows link targets get turned into / paths
const { readlink, readlinkSync } = fs
fs.readlink = (path, cb) => {
  readlink(path, (er, path) => {
    if (er) {
      return cb(er)
    } else {
      cb(null, path.replace(/\//g, '\\'))
    }
  })
}
fs.readlinkSync = path => readlinkSync(path).replace(/\//g, '\\')

const fixtures = path.resolve(dirname, 'fixtures')
const files = path.resolve(fixtures, 'files')
env({ USER: 'isaacs' })
const isWindows = process.platform === 'win32'
const fileMode = isWindows ? 0o666 : 0o644
const dirMode = isWindows ? 0o777 : 0o755

// Git does not keep hard links. Make the link again if it is gone.
{
  const one = fs.statSync(files + '/hardlink-1')
  const two = fs.statSync(files + '/hardlink-2')
  if (one.dev !== two.dev || one.ino !== two.ino) {
    fs.unlinkSync(files + '/hardlink-2')
    fs.linkSync(files + '/hardlink-1', files + '/hardlink-2')
  }
  chmodrSync(files, fileMode)
}

const f100 =
  '100-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
const deep =
  'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
const om = 'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt'

// Resolve to all the data that the stream emits.
const collect = stream =>
  new Promise((resolve, reject) => {
    const out = []
    stream.on('data', c => out.push(c))
    stream.on('end', () => resolve(Buffer.concat(out)))
    stream.on('error', reject)
  })

// The name field of the first header of the data.
const nameOf = data =>
  data.subarray(0, 100).toString().replace(/\0.*$/, '')

// Resolve to the first error that the stream emits.
const firstError = stream =>
  new Promise(resolve => stream.on('error', resolve))

// Resolve to the first entry of a tar. The input is a buffer or a
// stream.
const firstEntry = input =>
  new Promise(resolve => {
    const p = new Parser()
    p.on('entry', resolve)
    if (Buffer.isBuffer(input)) {
      p.end(input)
    } else {
      input.pipe(p)
    }
  })

// The header of an entry that WriteEntry makes from a fixture file.
const header = fields => ({
  cksumValid: true,
  needPax: false,
  linkpath: undefined,
  uname: 'isaacs',
  gname: undefined,
  devmaj: 0,
  devmin: 0,
  ...fields,
})

describe('100 byte filename', () => {
  // The second test uses the caches that the first test filled.
  let statCache = null
  let linkCache = null

  for (const name of ['uncached', 'cached']) {
    test(name, async () => {
      let entryInOWE = undefined
      const ws = new WriteEntry(f100, {
        cwd: files,
        linkCache: linkCache,
        statCache: statCache,
        onWriteEntry: self => {
          entryInOWE = self
          assert.equal(self.path, f100)
          assert.equal(self.header, undefined)
        },
      })

      const out = await collect(ws)
      assert.equal(entryInOWE, ws)
      assert.match(ws, {
        header: header({ path: f100, mode: fileMode, size: 100 }),
      })

      const wss = new WriteEntrySync(f100, {
        cwd: files,
        linkCache: linkCache,
        statCache: statCache,
      })
      linkCache = ws.linkCache
      statCache = ws.statCache

      assert.equal(
        out.subarray(512).toString('hex'),
        wss.read().subarray(512).toString('hex'),
      )

      assert.equal(out.length, 1024)
      assert.equal(out.subarray(0, 100).toString(), f100)
      assert.match(
        new Header(out.subarray(0, 512)),
        header({
          path: './' + f100,
          mode: fileMode,
          size: 100,
          linkpath: '',
          gname: '',
        }),
      )

      assert.equal(
        out.subarray(512).toString('hex'),
        '63'.repeat(100) + '00'.repeat(412),
      )
    })
  }
})

test('directory', async () => {
  const expect = header({ path: 'dir/', mode: dirMode, size: 0 })
  const ws = new WriteEntry('dir', { cwd: files })
  const out = await collect(ws)
  assert.match(ws.header, expect)
  assert.equal(out.length, 512)

  const wss = new WriteEntrySync('dir', { cwd: files })
  assert.equal(wss.read().length, 512)
  assert.match(wss.header, expect)
})

test('empty path for cwd', async () => {
  const ws = new WriteEntry('')
  await collect(ws)
  assert.match(
    ws.header,
    header({
      path: './',
      mode: isWindows ? 0o777 : fs.statSync('./').mode & 0o7777,
      size: 0,
    }),
  )
})

test(
  'symlink',
  { skip: isWindows && 'symlinks not fully supported' },
  async () => {
    const expect = header({
      path: 'symlink',
      size: 0,
      linkpath: 'hardlink-2',
    })

    const wss = new WriteEntrySync('symlink', { cwd: files })
    assert.match(wss.header, expect)

    const ws = new WriteEntry('symlink', { cwd: files })
    const out = await collect(ws)
    assert.equal(out.length, 512)
    assert.match(ws.header, expect)
  },
)

test('zero-byte file', async () => {
  const ws = new WriteEntry('files/zero-byte.txt', { cwd: fixtures })
  const out = await collect(ws)
  assert.equal(out.length, 512)
  assert.match(
    ws.header,
    header({ path: 'files/zero-byte.txt', mode: fileMode, size: 0 }),
  )
})

test('zero-byte file, but close fails', async () => {
  cleanup(mutateFS.fail('close', new Error('poop')))

  const ws = new WriteEntry('files/1024-bytes.txt', { cwd: fixtures })
  let ended = false
  ws.on('end', () => (ended = true))
  const er = firstError(ws)
  ws.resume()

  assert.match(await er, { message: 'poop' })
  assert(!ended, 'should not get an end, because the close fails')
})

test('hardlinks', async () => {
  const wss = new WriteEntrySync('hardlink-1', { cwd: files })

  const ws = new WriteEntry('files/hardlink-2', {
    cwd: fixtures,
    linkCache: wss.linkCache,
  })
  const out = await collect(ws)
  assert.equal(out.length, 512)
  assert.match(
    ws.header,
    header({
      type: 'Link',
      path: 'files/hardlink-2',
      mode: fileMode,
      size: 0,
      linkpath: 'files/hardlink-1',
    }),
  )
})

test('hardlinks far away', async () => {
  const stat = fs.statSync(path.resolve(files, 'hardlink-1'))
  const linkCache = new Map([[stat.dev + ':' + stat.ino, '/a/b/c/d/e']])

  const ws = new WriteEntry('files/hardlink-2', {
    cwd: fixtures,
    linkCache: linkCache,
  })
  const out = await collect(ws)
  assert.equal(out.length, 1024)
  assert.match(
    ws.header,
    header({ path: 'files/hardlink-2', mode: fileMode, size: 26 }),
  )
})

for (const [name, noPax, length] of [
  ['really deep path', false, 2048],
  ['no pax', true, 1024],
]) {
  test(name, async () => {
    const ws = new WriteEntry(deep, { cwd: files, noPax })
    const out = await collect(ws)
    assert.match(
      ws.header,
      header({ needPax: true, path: deep, mode: fileMode, size: 100 }),
    )
    assert.equal(out.length, length)
  })
}

test('nonexistent file', async () => {
  const f = path.resolve(files, 'does not exist')
  const ws = new WriteEntry('does not exist', { cwd: files })
  assert.match(await firstError(ws), {
    message: "ENOENT: no such file or directory, lstat '" + f + "'",
    code: 'ENOENT',
    path: f,
    syscall: 'lstat',
  })
})

describe('absolute path', () => {
  const absolute = path.resolve(files, '512-bytes.txt')
  const { root } = path.parse(absolute)
  // on windows, c:\c:\c:\... is a valid path, so just use the
  // single-root absolute version of it.
  const f = isWindows ? absolute : root + root + root + absolute
  const warn = normPath(isWindows ? root : root + root + root + root)

  test('preservePaths=false strict=false warn=' + warn, async () => {
    const warnings = []
    const ws = new WriteEntry(f, {
      cwd: files,
      onwarn: (c, m, p) => warnings.push([c, m, p]),
    })
    const out = await collect(ws)
    assert.equal(out.length, 1024)
    assert.match(warnings, [
      [
        'TAR_ENTRY_INFO',
        `stripping ${warn} from absolute path`,
        { path: normPath(f) },
      ],
    ])

    assert.match(
      ws.header,
      header({
        path: normPath(absolute.replace(/^(\/|[a-z]:[/\\])*/i, '')),
        mode: fileMode,
        size: 512,
      }),
    )
  })

  for (const strict of [true, false]) {
    test('preservePaths=true strict=' + strict, async () => {
      const warnings = []
      const ws = new WriteEntry(f, {
        cwd: files,
        strict: strict,
        preservePaths: true,
        onwarn: (c, m, p) => warnings.push([c, m, p]),
      })
      await collect(ws)
      assert.equal(warnings.length, 0)

      assert.match(
        ws.header,
        header({ path: normPath(f), mode: fileMode, size: 512 }),
      )
    })
  }

  test('preservePaths=false strict=true', () => {
    assert.throws(() => new WriteEntry(f, { strict: true, cwd: files }), {
      message: /stripping .* from absolute path/,
      path: normPath(f),
    })
  })
})

test('path must be a string', () => {
  assert.throws(() => new WriteEntry(null), TypeError)
})

test('no user environ, sets uname to empty string', async () => {
  env({ USER: undefined })
  const ws = new WriteEntry('512-bytes.txt', { cwd: files })
  const out = await collect(ws)
  assert.equal(out.length, 1024)
  assert.match(
    ws.header,
    header({
      path: '512-bytes.txt',
      mode: fileMode,
      size: 512,
      uname: '',
    }),
  )
})

test(
  'an unsuppored type',
  { skip: isWindows && '/dev/random on windows' },
  async () => {
    const ws = new WriteEntry('/dev/random', { preservePaths: true })
    const statEvent = new Promise(resolve => ws.on('stat', resolve))
    const out = await collect(ws)
    assert.equal(out.length, 0, 'should not get data from random')
    const stat = await statEvent
    assert.match(stat, {
      dev: any.number,
      mode: 0o020666,
      nlink: 1,
      rdev: any.number,
      blksize: any.number,
      ino: any.number,
      size: 0,
      blocks: 0,
    })
    assert(stat.isCharacterDevice(), 'random is a character device')
    assert.match(ws, { type: 'Unsupported', path: '/dev/random' })
  },
)

test('readlink fail', async () => {
  const expect = {
    syscall: 'readlink',
    path: any.string,
  }
  // pretend everything is a symbolic link, then read something that isn't
  cleanup(mutateFS.statType('SymbolicLink'))
  assert.throws(() => new WriteEntrySync(self, { cwd: dirname }), expect)
  const er = await firstError(new WriteEntry(self, { cwd: dirname }))
  assert.match(er, expect)
  assert.equal(normPath(er.path), normPath(filename))
})

test('open fail', async () => {
  cleanup(mutateFS.fail('open', new Error('pwn')))
  assert.throws(() => new WriteEntrySync(self, { cwd: dirname }), {
    message: 'pwn',
  })
  const er = await firstError(new WriteEntry(self, { cwd: dirname }))
  assert.match(er, { message: 'pwn' })
})

test('read fail', async () => {
  const expect = {
    message: 'EISDIR: illegal operation on a directory, read',
    code: 'EISDIR',
    syscall: 'read',
  }
  // pretend everything is a file, then read something that isn't
  cleanup(
    mutateFS.statMutate((er, st) => {
      if (er) {
        return [er, st]
      }
      st.isFile = () => true
      st.size = 123
    }),
  )
  assert.throws(
    () => new WriteEntrySync('fixtures', { cwd: dirname }),
    expect,
  )
  const er = await firstError(new WriteEntry('fixtures', { cwd: dirname }))
  assert.match(er, expect)
})

test('read invalid EOF', async () => {
  cleanup(mutateFS.mutate('read', (er, _bytesRead) => [er, 0]))
  const expect = {
    message: 'encountered unexpected EOF',
    path: normPath(filename),
    syscall: 'read',
    code: 'EOF',
  }
  assert.throws(() => new WriteEntrySync(self, { cwd: dirname }), expect)
  const er = await firstError(new WriteEntry(self, { cwd: dirname }))
  assert.match(er, expect)
})

test('read overflow expectation', async () => {
  cleanup(
    mutateFS.statMutate((_er, st) => {
      if (st) {
        st.size = 3
      }
    }),
  )
  const f = '512-bytes.txt'
  const expect = {
    message: 'did not encounter expected EOF',
    path: normPath(path.resolve(files, f)),
    syscall: 'read',
    code: 'EOF',
  }
  assert.throws(
    () => new WriteEntrySync(f, { cwd: files, maxReadSize: 2 }),
    expect,
  )
  const ws = new WriteEntry(f, { cwd: files, maxReadSize: 2 })
  const er = firstError(ws)
  ws.resume()
  assert.match(await er, expect)
})

describe('short reads', () => {
  const cases = {
    '1024-bytes.txt': new Array(1024).join('x') + '\n',
    [f100]: new Array(101).join('c'),
  }

  for (const [filename, contents] of Object.entries(cases)) {
    for (const maxReadSize of [null, 1024, 100, 111]) {
      const name = filename.split('byte').shift() + 'byte'
      test(`${name} maxReadSize=${maxReadSize}`, async () => {
        cleanup(mutateFS.zenoRead())
        const ws = new WriteEntry(filename, { maxReadSize, cwd: files })
        const out = await collect(ws)
        assert.equal(
          out.length,
          512 * Math.ceil(1 + contents.length / 512),
        )
        assert.equal(
          out.subarray(512).toString().replace(/\0.*$/, ''),
          contents,
        )
        const wss = new WriteEntrySync(filename, { cwd: files })
        const syncOut = wss.read()
        assert.equal(syncOut.length, out.length)
        assert.equal(
          syncOut.subarray(512).toString(),
          out.subarray(512).toString(),
        )
      })
    }
  }
})

test(
  'win32 path conversion',
  { skip: isWindows && 'no need to test on windows' },
  () => {
    const ws = new WriteEntry('long-path\\r', {
      cwd: files,
      win32: true,
    })
    assert.equal(ws.path, 'long-path/r')
  },
)

test(
  'win32 <|>? in paths',
  { skip: isWindows && 'do not create annoying junk on windows systems' },
  async () => {
    const uglyName = Buffer.from(
      'ef80bcef81bcef80beef80bf2e747874',
      'hex',
    ).toString()
    const dir = testdir({ [uglyName]: '<|>?' })

    const wc = new WriteEntry(uglyName, { cwd: dir, win32: true })
    assert.equal(wc.path, '<|>?.txt')
    assert.equal(wc.absolute, path.resolve(dir, uglyName))

    const data = (await collect(wc)).toString()
    assert.equal(data.slice(0, 4), '<|>?')
  },
)

test('uid doesnt match, dont set uname', () => {
  cleanup(
    mutateFS.statMutate((_er, st) => {
      if (st) {
        st.uid -= 1
      }
    }),
  )
  const ws = new WriteEntry('long-path/r', {
    cwd: files,
  })
  assert(!ws.uname)
})

test('override absolute to some other file', async () => {
  const opt = { absolute: files + '/one-byte.txt' }
  const ws = new WriteEntry('blerg', opt)
  const wss = new WriteEntrySync('blerg', opt)
  for (const [entry, data] of [
    [ws, await collect(ws)],
    [wss, wss.read()],
  ]) {
    assert.equal(data.length, 1024)
    assert.match(data.subarray(512).toString(), /^a\0{511}$/)
    assert.match(entry, {
      path: 'blerg',
      header: { size: 1 },
    })
  }
})

describe('portable entries', () => {
  const date = new Date('1979-07-01T19:10:00.000Z')

  const pexpect = {
    atime: undefined,
    charset: undefined,
    comment: undefined,
    ctime: undefined,
    gid: undefined,
    gname: undefined,
    linkpath: undefined,
    path: om,
    size: 2,
    uid: undefined,
    uname: undefined,
    dev: undefined,
    ino: undefined,
    nlink: undefined,
  }

  const hexpect = {
    size: 2,
    ctime: undefined,
    atime: undefined,
    uid: undefined,
    uname: '',
    gid: undefined,
    gname: '',
  }

  // Each case has a name, more options, and the mtime that the
  // entry must have. With no third value, the test does not check
  // the mtime.
  for (const [name, opt, ...mtime] of [
    ['nothing platform-specific', {}],
    ['no mtime', { noMtime: true }, undefined],
    ['force mtime', { mtime: date }, date],
  ]) {
    test(name, async () => {
      const options = { cwd: files, portable: true, ...opt }
      const extra = mtime.length ? { mtime: mtime[0] } : {}
      for (const input of [
        new WriteEntrySync(om, options).read(),
        new WriteEntry(om, options),
      ]) {
        const entry = await firstEntry(input)
        assert.match(entry.extended, { ...pexpect, ...extra })
        assert.match(entry.header, { ...hexpect, ...extra })
      }
    })
  }

  test('dir entries, no mtime', async () => {
    const dir = 'long-path/'
    const options = { cwd: files, portable: true }
    for (const input of [
      new WriteEntrySync(dir, options).read(),
      new WriteEntry(dir, options),
    ]) {
      const entry = await firstEntry(input)
      assert.match(entry.header, {
        path: 'long-path/',
        ctime: undefined,
        atime: undefined,
        uid: undefined,
        uname: '',
        gid: undefined,
        gname: '',
        mtime: undefined,
      })
    }
  })
})

test('writing more data than is appropriate', async () => {
  const dir = testdir({ file: 'hello' })
  const ws = new WriteEntry(`${dir}/file`)
  ws.on('stat', () => ws.write(Buffer.from('some more stuff')))
  assert.match(await firstError(ws), {
    message: 'writing more data than expected',
  })
})

test('write a string, with a callback or an encoding', async () => {
  const dir = testdir({ file: 'hello' })
  const ws = new WriteEntry(`${dir}/file`)
  let called = 0
  ws.write('', () => called++)
  ws.write('', 'utf8')
  const out = await collect(ws)
  assert.equal(called, 1)
  assert.equal(out.length, 1024)
  assert.equal(out.subarray(512).toString().replace(/\0*$/, ''), 'hello')
})

describe('write entry from read entry', () => {
  const data = makeTar([
    {
      path: '$',
      type: 'File',
      size: 10,
      mode: dirMode,
      uid: 123,
      gid: 321,
      ctime: new Date('1979-07-01'),
      atime: new Date('1980-08-17'),
    },
    '$$$$$$$$$$',
    {
      path: 'blep',
      type: 'SymbolicLink',
      linkpath: 'xyz',
    },
    '',
    '',
  ])

  // Make a WriteEntryTar from the file entry of `data`, write the
  // file body to it, and return all its output. The output must end
  // before this function returns.
  const rewrite = (opt, entryPath) => {
    const fileEntry = new ReadEntry(new Header(data))
    if (entryPath) {
      fileEntry.path = entryPath
    }
    const wet = new WriteEntryTar(fileEntry, opt)
    const out = []
    let ended = false
    wet.on('data', c => out.push(c))
    wet.on('end', () => (ended = true))
    fileEntry.write(data.subarray(512, 550))
    fileEntry.write(data.subarray(550, 1000))
    fileEntry.end(data.subarray(1000, 1024))
    assert.equal(ended, true)
    return Buffer.concat(out)
  }

  test('basic file', () => {
    const result = rewrite()
    assert.equal(result.length, 1024)
    assert.equal(result.toString().replace(/\0.*$/, ''), '$')
    const body = result.subarray(512).toString().replace(/\0*$/, '')
    assert.equal(body, '$$$$$$$$$$')
  })

  test('portable directory', () => {
    const data = makeTar([
      {
        path: '$',
        type: 'Directory',
        size: 0,
        mode: dirMode,
        uid: 123,
        gid: 321,
        ctime: new Date('1979-07-01'),
        atime: new Date('1980-08-17'),
        mtime: new Date('1997-06-21'),
      },
      '',
      '',
    ])
    const fileEntry = new ReadEntry(new Header(data))
    let entryInOWE = undefined
    const wetFile = new WriteEntryTar(fileEntry, {
      portable: true,
      onWriteEntry: self => {
        entryInOWE = self
        assert.equal(self.path, '$')
        assert.equal(self.header, undefined)
      },
    })
    const out = []
    let wetFileEnded = false
    wetFile.on('data', c => out.push(c))
    wetFile.on('end', () => {
      wetFileEnded = true
      assert.equal(entryInOWE, wetFile)
    })
    fileEntry.end()
    assert.equal(wetFileEnded, true)
    const result = Buffer.concat(out)
    assert.match(new Header(result), { mtime: undefined })
  })

  // Each case has the options, and the fields that the header of
  // the file must have, if the test checks them.
  for (const [name, opt, expect] of [
    ['with pax header'],
    [
      'pax and portable',
      { portable: true },
      { ctime: undefined, atime: undefined, uname: '', gname: '' },
    ],
    [
      'pax, portable, and noMtime',
      { noMtime: true, portable: true },
      {
        mtime: undefined,
        ctime: undefined,
        atime: undefined,
        uname: '',
        gname: '',
      },
    ],
  ]) {
    test(name, () => {
      const result = rewrite(opt, new Array(200).join('$'))
      assert.equal(result.length, 2048)
      assert.match(result.subarray(1024, 1124).toString(), /^\$+\0?$/)
      assert.match(new Header(result), { type: 'ExtendedHeader' })
      if (expect) {
        assert.match(new Header(result.subarray(1024)), expect)
      }
      const body = result.subarray(1536).toString().replace(/\0*$/, '')
      assert.equal(body, '$$$$$$$$$$')
    })
  }

  describe('abs path', () => {
    const absEntry = () => {
      const fileEntry = new ReadEntry(new Header(data))
      fileEntry.path = '/a/b/c'
      return fileEntry
    }

    test('warn', () => {
      const warnings = []
      new WriteEntryTar(absEntry(), {
        onwarn: (code, msg, data) => warnings.push(code, msg, data),
      })
      assert.match(warnings, [
        'TAR_ENTRY_INFO',
        'stripping / from absolute path',
        {
          path: '/a/b/c',
        },
      ])
    })

    test('preserve', () => {
      const warnings = []
      new WriteEntryTar(absEntry(), {
        onwarn: (code, msg, data) => warnings.push(code, msg, data),
        preservePaths: true,
      })
      assert.deepEqual(warnings, [])
    })

    test('throw', () => {
      assert.throws(
        () => new WriteEntryTar(absEntry(), { strict: true }),
        Error,
      )
    })
  })

  test('no block remain', () => {
    const readEntry = new ReadEntry(
      new Header({
        size: 512,
        type: 'File',
        path: 'x',
      }),
    )
    const wet = new WriteEntryTar(readEntry)
    const out = []
    wet.on('data', c => out.push(c))
    let wetEnded = false
    wet.on('end', _ => (wetEnded = true))
    assert.equal(wetEnded, false)
    readEntry.end(Buffer.from(new Array(513).join('@')))
    assert.equal(wetEnded, true)
    const res = Buffer.concat(out)
    assert.equal(res.length, 1024)
    assert.match(res.subarray(512).toString(), /^@+$/)
  })

  test('write more than appropriate', () => {
    const readEntry = new ReadEntry(
      new Header({
        path: 'x',
        type: 'File',
        size: '1',
      }),
    )
    const wet = new WriteEntryTar(readEntry)
    assert.throws(
      () => wet.write(Buffer.from(new Array(1024).join('x'))),
      Error,
    )
  })

  test('unsupported entry type', () => {
    const readEntry = new ReadEntry(new Header({ path: 'x', size: 0 }))
    assert.equal(readEntry.type, 'Unsupported')
    assert.throws(() => new WriteEntryTar(readEntry), {
      message: 'writing entry that should be ignored',
    })
  })

  describe('write and end with strings and callbacks', () => {
    // Each case ends the entry with different arguments. The callback
    // is `cb`.
    const cases = [
      ['end(cb)', (wet, cb) => wet.end(cb)],
      ['end(string, cb)', (wet, cb) => wet.end('', cb)],
      ['end(string, encoding, cb)', (wet, cb) => wet.end('', 'utf8', cb)],
    ]
    for (const [name, endWith] of cases) {
      test(name, async () => {
        const readEntry = new ReadEntry(
          new Header({ path: 'x', type: 'File', size: 4 }),
        )
        const wet = new WriteEntryTar(readEntry)
        const done = collect(wet)
        const calls = []
        wet.write('ab', () => calls.push('write'))
        wet.write('cd', 'utf8')
        endWith(wet, () => calls.push('end'))
        const out = await done
        assert.equal(out.length, 1024)
        assert.equal(nameOf(out), 'x')
        assert.equal(
          out.subarray(512).toString().replace(/\0*$/, ''),
          'abcd',
        )
        assert.equal(calls[0], 'write')
        assert.contains(calls, 'end')
      })
    }
  })
})

// https://github.com/npm/node-tar/issues/284
describe('hard links', () => {
  const long = 'y'.repeat(250)
  const longPax = '260 path=' + long + '\n19 linkpath=target\n'
  const longPaxHeader = {
    path: 'PaxHeader/yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
    type: 'ExtendedHeader',
  }

  // The header of the link has the first 99 characters of its name.
  const longLink = long.slice(0, 99)

  // The 512 byte blocks of a tar of the folder, where each path
  // starts with `dir`. An object is a header, a string is the start
  // of a block, and a RegExp tests the text of a block. `more` has
  // the blocks of the link with the long name. `linkpath` is the
  // target of each link.
  const blocks = (dir, more = [], linkpath = dir + 'target') => {
    const folder = name => ({ type: 'Directory', path: dir + name })
    const link = name => ({
      path: dir + name,
      type: 'Link',
      linkpath,
    })
    return [
      { type: 'Directory', path: dir || './' },
      { type: 'File', size: 3, path: dir + 'target' },
      'ddd\0',
      link('y'),
      ...more,
      folder('z/'),
      folder('z/b/'),
      link('z/d'),
      folder('z/b/c/'),
      link('z/b/d'),
      link('z/b/c/d'),
    ]
  }

  const prefixed = blocks('out/x/', [
    longPaxHeader,
    new RegExp(
      '^266 path=out.x.' + long + '[\\w\\W]*linkpath=out.x.target',
    ),
    {
      path: 'out/x/' + longLink,
      type: 'Link',
      linkpath: 'out/x/target',
    },
  ])

  const check = (data, expect) => {
    expect.forEach((e, i) => {
      const block = data.subarray(i * 512, (i + 1) * 512)
      if (typeof e === 'string') {
        assert.equal(block.subarray(0, e.length).toString(), e)
      } else if (e instanceof RegExp) {
        assert.match(block.toString(), e)
      } else {
        assert.match(new Header(block), e)
      }
    })
  }

  // Make a folder with hard links to one file. Write the folder,
  // then each name, as one entry each. Return all the output.
  const writeEntries = async (Class, root, names, opt) => {
    const cwd = testdir({ target: 'ddd', z: { b: { c: {} } } })
    for (const link of ['z/b/c/d', 'z/b/d', 'z/d', 'y', long]) {
      fs.linkSync(cwd + '/target', cwd + '/' + link)
    }
    const options = {
      ...opt,
      cwd,
      linkCache: new Map(),
      statCache: new Map(),
    }
    const dir = root === '.' ? './' : root
    const out = []
    for (const p of [root, ...names.map(name => dir + name)]) {
      out.push(await collect(new Class(p, options)))
    }
    return Buffer.concat(out)
  }

  // Parse the tar, make a WriteEntryTar from each entry, and return
  // all the output.
  const rewriteEntries = (tar, parserOpt, opt) =>
    new Promise(resolve => {
      const options = {
        ...opt,
        linkCache: new Map(),
        statCache: new Map(),
      }
      const out = []
      const parser = new Parser({
        ...parserOpt,
        onReadEntry: readEntry => {
          const p = new WriteEntryTar(readEntry, options)
          p.on('data', d => out.push(d))
        },
      })
      parser.on('end', () => resolve(Buffer.concat(out)))
      parser.end(tar)
    })

  const classes = [
    ['async', WriteEntry],
    ['sync', WriteEntrySync],
  ]
  const roots = ['.', './']

  describe('prefix and hard links', () => {
    const names = [
      'target',
      'y',
      long,
      'z',
      'z/b',
      'z/d',
      'z/b/c',
      'z/b/d',
      'z/b/c/d',
    ]
    for (const [name, Class] of classes) {
      for (const root of roots) {
        test(`${name} ${root}`, async () => {
          const out = await writeEntries(Class, root, names, {
            prefix: 'out/x',
            noDirRecurse: true,
          })
          check(out, prefixed)
        })
      }
    }
  })

  describe('prefix and hard links from tar entries', () => {
    const tar = makeTar([
      ...blocks('', [
        { ...longPaxHeader, size: longPax.length },
        longPax,
        { path: longLink, type: 'Link', linkpath: 'target' },
      ]),
      '',
      '',
    ])

    // The two tests are the same but for the name.
    for (const root of roots) {
      test(root, async () => {
        const out = await rewriteEntries(
          tar,
          { strict: true },
          { prefix: 'out/x', noDirRecurse: true },
        )
        check(out, prefixed)
      })
    }
  })

  describe('hard links and no prefix', () => {
    const names = [
      'target',
      'y',
      'z',
      'z/b',
      'z/d',
      'z/b/c',
      'z/b/d',
      'z/b/c/d',
    ]
    for (const [name, Class] of classes) {
      for (const root of roots) {
        test(`${name} ${root}`, async () => {
          check(
            await writeEntries(Class, root, names),
            blocks('./', [], 'target'),
          )
        })
      }
    }
  })

  describe('hard links from tar entries and no prefix', () => {
    const plain = blocks('')
    const tar = makeTar(plain)

    // The two tests are the same but for the name.
    for (const root of roots) {
      test(root, async () => {
        const out = await rewriteEntries(tar, {}, { noDirRecurse: true })
        check(out, plain)
      })
    }
  })
})

test('myuid set by getuid() if available, otherwise 0', () => {
  stub(process, 'getuid', null)
  const noUid = new WriteEntry(filename)
  assert.equal(noUid.myuid, 0, 'set to zero if no getuid function')
  stub(process, 'getuid', () => 123456789)
  const hasUid = new WriteEntry(filename)
  assert.equal(hasUid.myuid, 123456789, 'set to process.getuid()')
})
