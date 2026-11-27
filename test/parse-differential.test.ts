// The parser must read an archive in the same way as other tar
// programs, so that a check of the archive with one tool holds for
// the other. These cases come from security reports.
import fs from 'node:fs'
import { resolve } from 'node:path'
import { assert, describe, test, testdir } from 'ubqtest'
import { create } from '../src/create.js'
import { Header, type HeaderData } from '../src/header.js'
import { list } from '../src/list.js'
import { Parser } from '../src/parse.js'
import { Pax } from '../src/pax.js'

const hdr = (h: HeaderData) => {
  const block = Buffer.alloc(512)
  new Header({ mode: 0o644, size: 0, uid: 501, ...h }).encode(block)
  return block
}
const pad = (data: Buffer) =>
  Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)])
const ent = (h: HeaderData, body: string | Buffer = '') => {
  const data = Buffer.from(body)
  return Buffer.concat([hdr({ size: data.length, ...h }), pad(data)])
}
const file = (path: string, body: string | Buffer = '') =>
  ent({ path, type: 'File' }, body)
// One PAX record: "<length> <key>=<value>\n"
const rec = (k: string, v: string) => {
  const tail = Buffer.from(` ${k}=${v}\n`)
  let n = tail.length + 1
  while (String(n).length + tail.length !== n) {
    n = String(n).length + tail.length
  }
  return Buffer.concat([Buffer.from(String(n)), tail])
}
const pax = (kv: [string, string][], global = false) =>
  ent(
    {
      path: 'PaxHeader/p',
      type: global ? 'GlobalExtendedHeader' : 'ExtendedHeader',
    },
    Buffer.concat(kv.map(([k, v]) => rec(k, v))),
  )
const longPath = (name: string) =>
  ent({ path: '././@LongLink', type: 'NextFileHasLongPath' }, name + '\0')
const longLink = (name: string) =>
  ent(
    { path: '././@LongLink', type: 'NextFileHasLongLinkpath' },
    name + '\0',
  )
const EOA = Buffer.alloc(1024)

type Found = {
  path: string
  size: number
  linkpath?: string
  uid?: number
  mtime?: Date
}
const parse = (chunks: Buffer[], strict = false) =>
  new Promise<{ entries: Found[]; warnings: [string, string][] }>(
    (res, rej) => {
      const entries: Found[] = []
      const warnings: [string, string][] = []
      const p = new Parser({
        strict,
        onwarn: (code, message) => {
          warnings.push([code, String(message)])
        },
        onReadEntry: e => {
          entries.push({
            path: e.path,
            size: e.size,
            linkpath: e.linkpath,
            uid: e.uid,
            mtime: e.mtime,
          })
          e.resume()
        },
      })
      p.on('error', rej)
      p.on('end', () => res({ entries, warnings }))
      p.end(Buffer.concat([...chunks, EOA]))
    },
  )
const paths = async (chunks: Buffer[]) =>
  (await parse(chunks)).entries.map(e => e.path)

describe('pending PAX fields apply to the next file entry only', () => {
  test('PAX size=0 does not change a GNU long name entry', async () => {
    assert.deepEqual(
      await paths([
        pax([['size', '0']]),
        hdr({
          path: '././@LongLink',
          type: 'NextFileHasLongPath',
          size: 512,
        }),
        hdr({ path: 'payload-only.txt', type: 'File' }),
        file('real.txt'),
      ]),
      ['payload-only.txt'],
    )
  })

  test('a large PAX size does not drop a GNU long name', async () => {
    const size = 1024 * 1024 + 1
    const { entries } = await parse([
      pax([['size', String(size)]]),
      longPath('long-name.txt'),
      file('raw-name.txt', 'a'.repeat(size)),
    ])
    assert.match(entries, [{ path: 'long-name.txt', size }])
  })

  for (const type of [
    'ExtendedHeader',
    'GlobalExtendedHeader',
    'NextFileHasLongLinkpath',
  ] as const) {
    test(`PAX size=0 does not change a ${type} entry`, async () => {
      assert.deepEqual(
        await paths([
          pax([['size', '0']]),
          hdr({ path: 'meta', type, size: 512 }),
          // The body of the meta entry. It is an entry if the parser
          // uses the PAX size for the meta entry.
          hdr({ path: 'hidden.txt', type: 'File' }),
          ent({ path: 'l', type: 'SymbolicLink', linkpath: 'x' }),
        ]),
        ['l'],
      )
    })
  }

  test('a local size wins over a global size', async () => {
    const { entries } = await parse([
      pax([['size', '512']]),
      pax([['size', '0']], true),
      hdr({ path: 'carrier.txt', type: 'File', size: 512 }),
      hdr({ path: 'hidden.txt', type: 'File' }),
    ])
    assert.match(entries, [{ path: 'carrier.txt', size: 512 }])
  })

  test('a filter sees each entry that a repack writes', async () => {
    const dir = testdir()
    const input = resolve(dir, 'in.tar')
    const output = resolve(dir, 'out.tar')
    fs.writeFileSync(
      input,
      Buffer.concat([
        pax([['size', '512']]),
        pax([['size', '0']], true),
        hdr({ path: 'carrier.txt', type: 'File', size: 512 }),
        hdr({ path: 'hidden.txt', type: 'File' }),
        EOA,
      ]),
    )
    const seen: string[] = []
    await create(
      {
        file: output,
        filter: p => {
          seen.push(p)
          return p !== 'hidden.txt'
        },
      },
      ['@' + input],
    )
    const written: string[] = []
    await list({ file: output, onReadEntry: e => written.push(e.path) })
    assert.deepEqual(seen, ['carrier.txt'])
    assert.deepEqual(written, ['carrier.txt'])
  })

  test('a local value wins over a global value', async () => {
    const { entries } = await parse([
      pax([['uid', '1']]),
      pax([['uid', '2']], true),
      file('f'),
    ])
    assert.match(entries, [{ path: 'f', uid: 1 }])
  })

  test('a global linkpath is ignored', async () => {
    const { entries } = await parse([
      pax([['linkpath', '../../etc/passwd']], true),
      file('f'),
      ent({ path: 'l', type: 'SymbolicLink', linkpath: 'safe' }),
    ])
    assert.match(entries, [
      { path: 'f', linkpath: undefined },
      { path: 'l', linkpath: 'safe' },
    ])
  })
})

describe('PAX records are framed by their length', () => {
  test('a newline in a value does not start a record', async () => {
    assert.deepEqual(
      await paths([
        pax([['comment', 'x\n24 path=forged-name.txt']]),
        file('carrier.txt', 'DATA'),
      ]),
      ['carrier.txt'],
    )
  })

  test('a path with a newline survives encode and parse', () => {
    const path = 'é\n21 path=package.json\n'
    const parsed = Pax.parse(new Pax({ path }).encodeBody())
    assert.equal(parsed.path, path)
  })

  for (const [name, body] of Object.entries({
    'no length': 'path=a\n',
    'length too long': '99 path=a\n',
    'length too short': '3 path=a\n',
    'no newline at the end of the record': '9 path=ab',
  })) {
    test(`stop at a record with ${name}`, () => {
      const parsed = Pax.parse(
        rec('comment', 'ok') + body + rec('path', 'later'),
      )
      assert.equal(parsed.comment, 'ok')
      assert.equal(parsed.path, undefined)
    })
  }
})

describe('a NUL ends a name, also before a line break', () => {
  for (const br of ['\n', '\r', ' ', ' ']) {
    const name = `a\0b${br}c\0d`
    const code = br.codePointAt(0)?.toString(16)
    test(`GNU long path, break U+${code}`, async () => {
      assert.deepEqual(await paths([longPath(name), file('f')]), ['a'])
    })
    test(`GNU long linkpath, break U+${code}`, async () => {
      const { entries } = await parse([
        longLink(name),
        ent({ path: 'l', type: 'SymbolicLink', linkpath: 'x' }),
      ])
      assert.match(entries, [{ path: 'l', linkpath: 'a' }])
    })
    test(`PAX path, break U+${code}`, async () => {
      assert.deepEqual(await paths([pax([['path', name]]), file('f')]), [
        'a',
      ])
    })
    test(`ustar name, break U+${code}`, async () => {
      const block = hdr({ path: 'f', type: 'File' })
      block.write(name, 0)
      // write the checksum again for the new name
      block.fill(' ', 148, 156)
      const sum = block.reduce((a, b) => a + b, 0)
      block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
      assert.deepEqual(await paths([block]), ['a'])
    })
  }
})

describe('PAX numbers are decimal digits only', () => {
  test('a size with a leading zero is decimal', async () => {
    const { entries } = await parse([
      pax([['size', '0512']]),
      hdr({ path: 'README.md', type: 'File' }),
      hdr({ path: 'cover', type: 'File' }),
    ])
    assert.match(entries, [{ path: 'README.md', size: 512 }])
  })

  for (const v of ['Infinity', '1e30', '-5', '1.5', 'abc', '0x10', '']) {
    test(`ignore uid=${JSON.stringify(v)}`, async () => {
      const { entries } = await parse([pax([['uid', v]]), file('f')])
      assert.match(entries, [{ path: 'f', uid: 501 }])
    })
  }

  test('ignore a time that is not a number', async () => {
    const mtime = new Date('2001-02-03T04:05:06Z')
    const { entries } = await parse([
      pax([['mtime', 'abc']]),
      ent({ path: 'f', type: 'File', mtime }),
    ])
    assert.match(entries, [{ path: 'f', mtime }])
  })

  test('repack an archive that has uid=Infinity', async () => {
    const dir = testdir()
    const input = resolve(dir, 'in.tar')
    const output = resolve(dir, 'out.tar')
    fs.writeFileSync(
      input,
      Buffer.concat([
        pax([['uid', 'Infinity']]),
        file('a.txt', 'hello'),
        EOA,
      ]),
    )
    await create({ file: output }, ['@' + input])
    const written: string[] = []
    await list({ file: output, onReadEntry: e => written.push(e.path) })
    assert.deepEqual(written, ['a.txt'])
  })
})

describe('an entry after a lone null block', () => {
  const chunks = [
    file('index.js', 'first\n'),
    Buffer.alloc(512),
    file('index.js', 'second\n'),
  ]
  test('is read, with a warning', async () => {
    const { entries, warnings } = await parse(chunks)
    assert.match(entries, [
      { path: 'index.js', size: 6 },
      { path: 'index.js', size: 7 },
    ])
    assert.deepEqual(warnings, [
      ['TAR_BAD_ARCHIVE', 'entry after a lone null block'],
    ])
  })
  test('is an error in strict mode', async () => {
    await assert.rejects(parse(chunks, true), {
      message: 'TAR_BAD_ARCHIVE: entry after a lone null block',
      tarCode: 'TAR_BAD_ARCHIVE',
    })
  })
})

describe('a PAX name wins over a GNU long name', () => {
  const link = ent({ path: 'l', type: 'SymbolicLink', linkpath: 'hdr' })
  test('PAX path, then GNU long path', async () => {
    assert.deepEqual(
      await paths([pax([['path', 'pax']]), longPath('gnu'), file('f')]),
      ['pax'],
    )
  })
  test('GNU long path, then PAX path', async () => {
    assert.deepEqual(
      await paths([longPath('gnu'), pax([['path', 'pax']]), file('f')]),
      ['pax'],
    )
  })
  test('PAX linkpath, then GNU long linkpath', async () => {
    const { entries } = await parse([
      pax([['linkpath', 'pax']]),
      longLink('gnu'),
      link,
    ])
    assert.match(entries, [{ path: 'l', linkpath: 'pax' }])
  })
  test('GNU long linkpath, then PAX linkpath', async () => {
    const { entries } = await parse([
      longLink('gnu'),
      pax([['linkpath', 'pax']]),
      link,
    ])
    assert.match(entries, [{ path: 'l', linkpath: 'pax' }])
  })
  test('GNU long path with a PAX header that has no path', async () => {
    assert.deepEqual(
      await paths([pax([['uid', '7']]), longPath('gnu'), file('f')]),
      ['gnu'],
    )
  })
})
