import fs from 'node:fs'
import { basename, resolve } from 'node:path'
import { assert, describe, test } from 'ubqtest'
import { Header } from '../src/header.js'
import type { ParserOptions } from '../src/options.js'
import { Parser, type ParseEvent } from '../src/parser.js'
import { EntryData } from '../src/read-entry.js'
import { Pax } from '../src/pax.js'
import {
  cat,
  chunked,
  ent,
  EOA,
  file,
  hdr,
  longLink,
  longPath,
  parse,
  pax,
  rec,
  type Warning,
} from './helpers.js'

const tardir = resolve(import.meta.dirname, './fixtures/tars')
const parsedir = resolve(import.meta.dirname, './fixtures/parse')

// The fixtures in test/fixtures/parse hold the events of the old
// parser. This maps them to the events of this parser.
describe('fixtures', () => {
  type Old = [string, ...unknown[]]
  const fromOld = (events: Old[]): Old[] =>
    events.flatMap((ev): Old[] => {
      const [type, data] = ev
      if (type === 'entry' || type === 'ignoredEntry') {
        const { meta, ...entry } = data as Record<string, unknown>
        // This parser has no event for a meta entry.
        return meta ? [] : [[type, entry]]
      }
      return type === 'meta' || type === 'nullBlock' || type === 'eof' ?
          []
        : [ev]
    })

  const run = (chunks: readonly Uint8Array[], opt: ParserOptions) => {
    const events: Old[] = []
    const p = new Parser({
      ...opt,
      onwarn: (code, message) => events.push(['warn', code, message]),
    })
    const drain = () => {
      for (;;) {
        let ev: ParseEvent | undefined
        try {
          ev = p.next()
        } catch (er) {
          // Strict mode. The parser continues after the error.
          const { message, code } = er as Error & { code: string }
          events.push(['error', { message, code }])
          continue
        }
        if (!ev) return
        if (ev.type === 'entry') {
          events.push([
            ev.entry.ignore ? 'ignoredEntry' : 'entry',
            ev.entry,
          ])
        } else if (ev.type === 'end') events.push(['end'])
      }
    }
    for (const chunk of chunks) {
      p.push(chunk)
      drain()
    }
    p.end()
    drain()
    return events
  }

  for (const f of fs.readdirSync(tardir)) {
    const data = new Uint8Array(fs.readFileSync(resolve(tardir, f)))
    for (const maxMeta of [250, undefined]) {
      for (const strict of [true, false]) {
        for (const filter of [true, false]) {
          const o =
            (maxMeta ? '-meta-' + maxMeta : '') +
            (filter ? '-filter' : '') +
            (strict ? '-strict' : '')
          const name = basename(f, '.tar') + (o ? '-' + o : '') + '.json'
          const expect = fromOld(
            JSON.parse(
              fs.readFileSync(resolve(parsedir, name), 'utf8'),
              (k, v) =>
                /^[acm]time$/.test(k) && typeof v === 'string' ?
                  new Date(v)
                : v,
            ),
          )
          const opt: ParserOptions = {
            maxMetaEntrySize: maxMeta,
            strict,
            filter:
              filter ? (_, entry) => entry.size % 2 !== 0 : undefined,
          }
          for (const [how, chunks] of [
            ['all at once', [data]],
            ['one byte at a time', chunked(data, 1)],
            ['chunks of 1000 bytes', chunked(data, 1000)],
          ] as const) {
            test(`${name} ${how}`, () => {
              assert.match<unknown>(run(chunks, opt), expect)
            })
          }
        }
      }
    }
  }
})

describe('events', () => {
  test('entry, body, entryEnd, end', () => {
    const p = new Parser()
    p.push(cat(file('a', 'hello'), file('empty'), EOA))
    const events: ParseEvent[] = []
    for (let ev; (ev = p.next()); ) events.push(ev)
    assert.match(events, [
      { type: 'entry', entry: { path: 'a', size: 5 } },
      { type: 'body', data: new Uint8Array(Buffer.from('hello')) },
      { type: 'entryEnd' },
      { type: 'entry', entry: { path: 'empty', size: 0 } },
      { type: 'entryEnd' },
      { type: 'end' },
    ])
    assert(events[0]?.type === 'entry')
    assert(events[0].entry instanceof EntryData)
    // No event after the end.
    assert.equal(p.next(), undefined)
    p.end()
    assert.equal(p.next(), undefined)
  })

  test('undefined means that more input is needed', () => {
    const p = new Parser()
    assert.equal(p.next(), undefined)
    const data = file('a', 'x'.repeat(600))
    p.push(data.subarray(0, 100))
    assert.equal(p.next(), undefined)
    p.push(data.subarray(100, 700))
    assert.match(p.next(), { type: 'entry', entry: { path: 'a' } })
    assert.match(p.next(), { type: 'body' })
    assert.equal(p.next(), undefined)
  })

  test('a body is a view into the input, not a copy', () => {
    const data = cat(file('a', 'x'.repeat(2000)), EOA)
    const p = new Parser()
    p.push(data.subarray(0, 1000))
    p.push(data.subarray(1000))
    const bodies: Uint8Array[] = []
    for (let ev; (ev = p.next()); ) {
      if (ev.type === 'body') bodies.push(ev.data)
    }
    assert.deepEqual(
      bodies.map(b => [b.buffer === data.buffer, b.byteOffset, b.length]),
      [
        [true, 512, 488],
        [true, 1000, 1512],
      ],
    )
  })

  test('a chunk that is all body is the same object', () => {
    const data = file('a', 'x'.repeat(1024))
    const chunk = data.slice(512, 1536)
    const p = new Parser()
    p.push(data.subarray(0, 512))
    p.push(chunk)
    assert.match(p.next(), { type: 'entry' })
    const ev = p.next()
    assert(ev?.type === 'body')
    assert.equal(ev.data, chunk)
    assert.deepEqual(p.next(), { type: 'entryEnd' })
  })

  test('the padding of a body can come in a later chunk', () => {
    const data = cat(file('a', 'abc'), file('b'), EOA)
    for (const size of [1, 513, 515, 516, 700]) {
      const { found } = parse(chunked(data, size))
      assert.match(
        found,
        [
          { entry: { path: 'a' }, body: 'abc', ended: true },
          { entry: { path: 'b' }, body: '', ended: true },
        ],
        `size ${size}`,
      )
    }
  })

  test('an ignored entry has an entry event only', () => {
    const { found, ignored } = parse(
      [
        cat(
          file('skip', 'body'),
          file('skip-empty'),
          file('keep', 'k'),
          EOA,
        ),
      ],
      { filter: path => !path.startsWith('skip') },
    )
    assert.match(found, [{ entry: { path: 'keep' }, body: 'k' }])
    assert.match(ignored, [
      { path: 'skip', ignore: true },
      { path: 'skip-empty', ignore: true },
    ])
  })

  test('an unsupported type is ignored, with no call of the filter', () => {
    const block = hdr({ path: 'weird', type: 'File', size: 3 })
    block[156] = '9'.charCodeAt(0)
    new Header(new Header(block)).encode(block)
    block[156] = '9'.charCodeAt(0)
    // write the checksum again for the new type
    block.fill(0x20, 148, 156)
    const sum = block.reduce((a, b) => a + b, 0)
    block.set(Buffer.from(sum.toString(8).padStart(6, '0') + '\0 '), 148)
    const seen: string[] = []
    const { found, ignored } = parse(
      [cat(block, new Uint8Array(512), file('f'), EOA)],
      { filter: path => !!seen.push(path) },
    )
    assert.match(ignored, [{ path: 'weird', type: 'Unsupported' }])
    assert.match(found, [{ entry: { path: 'f' } }])
    assert.deepEqual(seen, ['f'])
  })

  test('a header with an empty size field has no body', () => {
    const { found } = parse([
      cat(
        hdr({ path: 'a', type: 'File', size: undefined }),
        file('b'),
        EOA,
      ),
    ])
    assert.match(found, [
      { entry: { path: 'a', size: 0, header: { size: undefined } } },
      { entry: { path: 'b' } },
    ])
  })

  test('the filter gets the path and the entry', () => {
    const calls: [string, string][] = []
    parse([cat(file('a'), ent({ path: 'd/', type: 'Directory' }), EOA)], {
      filter: (path, entry) => !!calls.push([path, entry.type]),
    })
    assert.deepEqual(calls, [
      ['a', 'File'],
      ['d/', 'Directory'],
    ])
  })

  test('platform win32 changes backslashes in paths', () => {
    const data = cat(
      ent({ path: 'a\\l', type: 'SymbolicLink', linkpath: 'b\\c' }),
      pax([
        ['path', 'p\\q'],
        ['linkpath', 'r\\s'],
      ]),
      ent({ path: 'x', type: 'SymbolicLink', linkpath: 'y' }),
      EOA,
    )
    assert.match(parse([data], { platform: 'win32' }).entries, [
      { path: 'a/l', linkpath: 'b/c' },
      { path: 'p/q', linkpath: 'r/s' },
    ])
    assert.match(parse([data]).entries, [
      { path: 'a\\l', linkpath: 'b\\c' },
      { path: 'p\\q', linkpath: 'r\\s' },
    ])
  })

  test('the caller can make the entry objects', () => {
    class MyEntry extends EntryData {
      mine = true
    }
    const p = new Parser<MyEntry>(
      { filter: (_, entry) => entry.mine },
      (header, ex, gex) => new MyEntry(header, ex, gex),
    )
    p.push(file('a'))
    const ev = p.next()
    assert(ev?.type === 'entry')
    assert(ev.entry instanceof MyEntry)
    assert.equal(ev.entry.ignore, false)
  })
})

describe('position', () => {
  test('is the end of the last complete entry', () => {
    const data = cat(file('a', 'abc'), file('b'), file('c', 'x'), EOA)
    const p = new Parser()
    const at: [string, number][] = []
    const drain = () => {
      for (let ev; (ev = p.next()); ) at.push([ev.type, p.position])
    }
    for (const chunk of chunked(data, 512)) {
      p.push(chunk)
      drain()
    }
    assert.deepEqual(at, [
      ['entry', 0],
      ['body', 1024],
      ['entryEnd', 1024],
      ['entry', 1536],
      ['entryEnd', 1536],
      ['entry', 1536],
      ['body', 2560],
      ['entryEnd', 2560],
      ['end', 2560],
    ])
  })

  test('a meta entry with no file entry after it does not count', () => {
    const data = cat(file('a'), pax([['path', 'b']]), longPath('c'))
    const { parser, paths } = parse([data])
    assert.deepEqual(paths, ['a'])
    assert.equal(parser.position, 512)
  })

  test('an ignored entry and an invalid block', () => {
    const bad = file('bad')
    bad[0] = 0x7a
    const data = cat(file('skip', 'body'), bad, file('skip'), EOA)
    const { parser, warnings } = parse([data], { filter: () => false })
    assert.deepEqual(warnings, [['TAR_ENTRY_INVALID', 'checksum failure']])
    assert.equal(parser.position, 2048)
  })

  test('a truncated entry does not count', () => {
    const data = cat(file('a'), file('b', 'x'.repeat(600)))
    const { parser } = parse([data.subarray(0, 1100)])
    assert.equal(parser.position, 512)
  })
})

describe('skipBody', () => {
  const data = cat(file('a', 'x'.repeat(2000)), file('b', 'y'), EOA)
  const types = (p: Parser) => {
    const found: string[] = []
    for (let ev; (ev = p.next()); ) found.push(ev.type)
    return found
  }

  test('the caller skips the rest of a body', () => {
    const p = new Parser()
    p.push(data.subarray(0, 1024))
    // The parser has input that it did not parse.
    assert.equal(p.bodyRemain, 0)
    assert.equal(p.next()?.type, 'entry')
    assert.equal(p.bodyRemain, 0)
    assert.deepEqual(types(p), ['body'])
    assert.equal(p.bodyRemain, 1536)
    p.skipBody()
    assert.equal(p.bodyRemain, 0)
    assert.equal(p.offset, 2560)
    assert.equal(p.position, 2560)
    p.push(data.subarray(2560))
    assert.equal(p.bodyRemain, 0)
    assert.deepEqual(types(p), [
      'entryEnd',
      'entry',
      'body',
      'entryEnd',
      'end',
    ])
  })

  test('an ignored entry has no end event', () => {
    const p = new Parser({ filter: path => path === 'b' })
    p.push(data.subarray(0, 1024))
    assert.deepEqual(types(p), ['entry'])
    assert.equal(p.bodyRemain, 1536)
    p.skipBody()
    p.push(data.subarray(2560))
    assert.deepEqual(types(p), ['entry', 'body', 'entryEnd', 'end'])
    assert.equal(p.position, 3584)
  })

  test('the body of a PAX header cannot be skipped', () => {
    const p = new Parser()
    p.push(pax([['path', 'p'.repeat(600)]]).subarray(0, 1024))
    assert.deepEqual(types(p), [])
    assert.equal(p.bodyRemain, 0)
  })

  test('a truncated body after a skip of no bytes', () => {
    const warnings: Warning[] = []
    const p = new Parser({ onwarn: (c, m) => warnings.push([c, m]) })
    p.push(data.subarray(0, 1124))
    assert.deepEqual(types(p), ['entry', 'body'])
    assert.equal(p.bodyRemain, 1436)
    p.end()
    assert.deepEqual(types(p), ['entryEnd', 'end'])
    assert.deepEqual(warnings, [
      [
        'TAR_BAD_ARCHIVE',
        'Truncated input (needed 1536 more bytes, only 100 available)',
      ],
    ])
  })
})

describe('end of the archive', () => {
  test('data after the end is dropped, and not kept', () => {
    const p = new Parser()
    p.push(cat(file('f'), EOA, file('after')))
    const types: string[] = []
    for (let ev; (ev = p.next()); ) types.push(ev.type)
    assert.deepEqual(types, ['entry', 'entryEnd', 'end'])
    const filler = new Uint8Array(64 * 1024).fill(1)
    for (let i = 0; i < 16; i++) {
      p.push(filler)
      assert.equal(p.next(), undefined)
    }
    p.end()
    assert.equal(p.next(), undefined)
  })

  test('the end event comes with no call of end()', () => {
    const { ends, paths } = parse([cat(file('f'), EOA)])
    assert.equal(ends, 1)
    assert.deepEqual(paths, ['f'])
    const p = new Parser()
    p.push(cat(file('f'), EOA))
    const types: string[] = []
    for (let ev; (ev = p.next()); ) types.push(ev.type)
    assert.deepEqual(types, ['entry', 'entryEnd', 'end'])
  })

  test('an end marker that is in two chunks', () => {
    const data = cat(file('f'), EOA, file('after'))
    for (const size of [1, 700, 1000]) {
      const { paths, warnings } = parse(chunked(data, size))
      assert.deepEqual(paths, ['f'], `size ${size}`)
      assert.deepEqual(warnings, [])
    }
  })

  test('an archive with only an end marker has a warning', () => {
    // The old parser gives the same warning.
    const { warnings, ends } = parse([EOA])
    assert.deepEqual(warnings, [
      ['TAR_BAD_ARCHIVE', 'Unrecognized archive format'],
    ])
    assert.equal(ends, 1)
  })

  test('input after end() is dropped', () => {
    const p = new Parser()
    p.push(file('a'))
    p.end()
    p.push(file('b'))
    const paths: string[] = []
    for (let ev; (ev = p.next()); ) {
      if (ev.type === 'entry') paths.push(ev.entry.path)
    }
    assert.deepEqual(paths, ['a'])
  })
})

describe('an entry after a lone null block', () => {
  const data = cat(
    file('index.js', 'first\n'),
    new Uint8Array(512),
    file('index.js', 'second\n'),
    EOA,
  )
  test('is read, with a warning', () => {
    const { found, warnings } = parse([data])
    assert.match(found, [
      { entry: { path: 'index.js', size: 6 }, body: 'first\n' },
      { entry: { path: 'index.js', size: 7 }, body: 'second\n' },
    ])
    assert.deepEqual(warnings, [
      ['TAR_BAD_ARCHIVE', 'entry after a lone null block'],
    ])
  })
  test('is an error in strict mode', () => {
    assert.throws(() => parse([data], { strict: true }), {
      message: 'TAR_BAD_ARCHIVE: entry after a lone null block',
      tarCode: 'TAR_BAD_ARCHIVE',
    })
  })
  test('an invalid block after a null block has its own warning', () => {
    const bad = file('bad')
    bad[0] = 0x7a
    const { warnings, paths } = parse([
      cat(new Uint8Array(512), bad, new Uint8Array(512), file('f'), EOA),
    ])
    assert.deepEqual(warnings, [
      ['TAR_ENTRY_INVALID', 'checksum failure'],
      ['TAR_BAD_ARCHIVE', 'entry after a lone null block'],
    ])
    assert.deepEqual(paths, ['f'])
  })
})

describe('truncated input', () => {
  const data = cat(
    ent({ path: 'foo/', type: 'Directory' }),
    hdr({ path: 'foo/bar', type: 'File', size: 18 }),
  )
  const message = (need: number, have: number) =>
    `Truncated input (needed ${need} more bytes, only ${have} available)`

  test('at a block boundary', () => {
    const { warnings, found } = parse([data])
    assert.deepEqual(warnings, [['TAR_BAD_ARCHIVE', message(512, 0)]])
    assert.match(found, [
      { entry: { path: 'foo/' }, ended: true },
      { entry: { path: 'foo/bar' }, body: '', ended: true },
    ])
  })

  test('in the middle of a block', () => {
    const tail = new Uint8Array(Buffer.from('not a full block'))
    const { warnings, found, ends } = parse([data, tail])
    assert.deepEqual(warnings, [['TAR_BAD_ARCHIVE', message(512, 16)]])
    assert.match(found[1], { body: 'not a full block', ended: true })
    assert.equal(ends, 1)
  })

  test('the numbers do not depend on the chunks', () => {
    const big = cat(
      hdr({ path: 'big', type: 'File', size: 2048 }),
      new Uint8Array(1000).fill(0x61),
    )
    // The body has one complete block, and 488 bytes of the next
    // block. The body needs 1536 bytes from the start of that block.
    for (const cuts of [
      [],
      [512],
      [1024],
      [612, 1112],
      [1112, 1212],
      [600, 1100],
      [100, 700, 701, 1300],
    ]) {
      const chunks = [...cuts, big.length].map((end, i) =>
        big.subarray(cuts[i - 1] ?? 0, end),
      )
      assert.deepEqual(
        parse(chunks).warnings,
        [['TAR_BAD_ARCHIVE', message(1536, 488)]],
        `cuts ${cuts}`,
      )
    }
  })

  test('a body that ends at a block boundary, in small chunks', () => {
    const big = cat(
      hdr({ path: 'big', type: 'File', size: 2048 }),
      new Uint8Array(1024),
    )
    assert.deepEqual(parse(chunked(big, 100)).warnings, [
      ['TAR_BAD_ARCHIVE', message(1024, 0)],
    ])
  })

  test('in strict mode, the entry ends after the error', () => {
    const p = new Parser({ strict: true })
    p.push(data)
    p.end()
    const types: string[] = []
    for (let i = 0; i < 3; i++) types.push(String(p.next()?.type))
    assert.deepEqual(types, ['entry', 'entryEnd', 'entry'])
    types.length = 0
    assert.throws(() => p.next(), {
      message: /^TAR_BAD_ARCHIVE: Truncated/,
    })
    for (let i = 0; i < 3; i++) types.push(String(p.next()?.type))
    assert.deepEqual(types, ['entryEnd', 'end', 'undefined'])
  })

  test('the warning has the entry and the header', () => {
    const data: unknown[] = []
    const p = new Parser({ onwarn: (_c, _m, d) => data.push(d) })
    p.push(hdr({ path: 'f', type: 'File', size: 5 }))
    p.end()
    while (p.next());
    assert.match(data, [
      {
        entry: { path: 'f' },
        header: { path: 'f' },
        tarCode: 'TAR_BAD_ARCHIVE',
        code: 'TAR_BAD_ARCHIVE',
      },
    ])
  })

  test('in a meta entry', () => {
    const meta = pax([['path', 'long']])
    const { warnings, found } = parse([
      cat(file('a'), meta.subarray(0, 520)),
    ])
    assert.deepEqual(warnings, [['TAR_BAD_ARCHIVE', message(512, 8)]])
    assert.equal(found.length, 1)
  })

  test('in an ignored entry', () => {
    const { warnings, found } = parse(
      [hdr({ path: 'f', type: 'File', size: 5 })],
      { filter: () => false },
    )
    assert.deepEqual(warnings, [['TAR_BAD_ARCHIVE', message(512, 0)]])
    assert.deepEqual(found, [])
  })

  test('a part of a header block at the end is dropped', () => {
    const { warnings, paths } = parse([
      cat(file('a'), file('b').subarray(0, 100)),
    ])
    assert.deepEqual(warnings, [])
    assert.deepEqual(paths, ['a'])
  })
})

describe('bad archives', () => {
  const unrecognized: Warning = [
    'TAR_BAD_ARCHIVE',
    'Unrecognized archive format',
  ]

  test('data that is not tar', () => {
    const { warnings, found, ends } = parse([
      new Uint8Array(fs.readFileSync(import.meta.filename)),
    ])
    assert.deepEqual(warnings.pop(), unrecognized)
    assert.deepEqual(found, [])
    assert.equal(ends, 1)
  })

  test('no data', () => {
    assert.deepEqual(parse([]).warnings, [unrecognized])
  })

  test('less than one block', () => {
    assert.deepEqual(parse([new Uint8Array(100)]).warnings, [unrecognized])
  })

  test('in strict mode, the end event comes after the error', () => {
    const p = new Parser({ strict: true })
    p.end()
    assert.throws(() => p.next(), {
      message: 'TAR_BAD_ARCHIVE: Unrecognized archive format',
      code: 'TAR_BAD_ARCHIVE',
      tarCode: 'TAR_BAD_ARCHIVE',
    })
    assert.deepEqual(p.next(), { type: 'end' })
    assert.equal(p.next(), undefined)
  })

  test('a header that throws', () => {
    const block = hdr({ path: 'path', type: 'File', size: 1 })
    block.set([0x81, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 100)
    assert.throws(() => new Header(block), Error)
    const data: [string, unknown][] = []
    const p = new Parser({ onwarn: (_c, m, d) => data.push([m, d]) })
    p.push(block)
    assert.equal(p.next(), undefined)
    assert.match<unknown>(data, [
      [
        'invalid base256 encoding',
        { code: 'TAR_ENTRY_INVALID', tarCode: 'TAR_ENTRY_INVALID' },
      ],
    ])
  })

  test('a header that throws, in strict mode', () => {
    const block = hdr({ path: 'path', type: 'File', size: 1 })
    block.set([0x81, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 100)
    const p = new Parser({ strict: true })
    p.push(cat(block, file('next')))
    assert.throws(() => p.next(), {
      message: 'invalid base256 encoding',
      tarCode: 'TAR_ENTRY_INVALID',
    })
    assert.match(p.next(), { type: 'entry', entry: { path: 'next' } })
  })

  for (const [name, block, message] of [
    [
      'a bad checksum',
      (b => ((b[0] = 0x7a), b))(file('f')),
      'checksum failure',
    ],
    [
      'no path',
      (() => {
        // An empty name field, with a valid checksum.
        const b = hdr({ path: 'x', type: 'File' })
        b[0] = 0
        b.fill(0x20, 148, 156)
        const sum = b.reduce((a, c) => a + c, 0)
        b.set(Buffer.from(sum.toString(8).padStart(6, '0') + '\0 '), 148)
        return b
      })(),
      'path is required',
    ],
    [
      'a link with no linkpath',
      hdr({ path: 'l', type: 'SymbolicLink' }),
      'linkpath required',
    ],
    [
      'a file with a linkpath',
      hdr({ path: 'f', type: 'File', linkpath: 'x' }),
      'linkpath forbidden',
    ],
  ] as const) {
    test(`${name} is a warning, and the next entry is read`, () => {
      const data = cat(file('before'), block, file('after'), EOA)
      const { warnings, paths } = parse([data])
      assert.deepEqual(warnings, [['TAR_ENTRY_INVALID', message]])
      assert.deepEqual(paths, ['before', 'after'])
      assert.throws(() => parse([data], { strict: true }), {
        message: `TAR_ENTRY_INVALID: ${message}`,
        tarCode: 'TAR_ENTRY_INVALID',
      })
    })
  }

  test('a PAX header can have a linkpath field', () => {
    const { warnings, paths } = parse([
      cat(
        ent(
          { path: 'PaxHeader/p', type: 'ExtendedHeader', linkpath: 'x' },
          rec('path', 'named'),
        ),
        file('f'),
        EOA,
      ),
    ])
    assert.deepEqual(warnings, [])
    assert.deepEqual(paths, ['named'])
  })

  test('an entry that the consumer marks invalid is not a valid entry', () => {
    // The consumer decides what is valid, as the extraction does.
    const run = (chunks: Uint8Array[], invalid = true) => {
      const warnings: string[] = []
      const p = new Parser({ onwarn: (_c, m) => warnings.push(m) })
      for (const chunk of chunks) p.push(chunk)
      p.end()
      for (let ev, first = true; (ev = p.next()); ) {
        if (ev.type === 'entry' && first) {
          ev.entry.invalid = invalid
          first = false
        }
      }
      return warnings
    }
    assert.deepEqual(run([file('/a/b/c', 'a'), EOA]), [
      'Unrecognized archive format',
    ])
    assert.deepEqual(
      run([
        file('/a/b/c', 'a'),
        ent({ path: 'd', type: 'Directory' }),
        EOA,
      ]),
      [],
    )
    // A truncated entry is valid, if the consumer does not refuse it.
    const truncated =
      'Truncated input (needed 512 more bytes, only 0 available)'
    const cut = [file('a', 'a').subarray(0, 512)]
    assert.deepEqual(run(cut, false), [truncated])
    assert.deepEqual(run(cut), [truncated, 'Unrecognized archive format'])
  })

  test('strict throws an error object as it is', () => {
    const p = new Parser({ strict: true, file: 'x.tar' })
    const er = new Error('yolo')
    assert.equal(
      assert.throws(() => p.warn('TAR_TEST', er), Error),
      er,
    )
    assert.match<unknown>(er, {
      tarCode: 'TAR_TEST',
      code: 'TAR_TEST',
      file: 'x.tar',
    })
  })

  test('onwarn gets the code, the message, and the data', () => {
    const calls: unknown[] = []
    const p = new Parser({
      file: 'x.tar',
      onwarn: (...args) => calls.push(args),
    })
    p.warn('TAR_TEST', 'this is fine')
    const er = Object.assign(new Error('with code'), { code: 'EWHAT' })
    p.warn('TAR_TEST', er, { more: 1 })
    assert.deepEqual(calls, [
      [
        'TAR_TEST',
        'this is fine',
        { file: 'x.tar', code: 'TAR_TEST', tarCode: 'TAR_TEST' },
      ],
      ['TAR_TEST', 'with code', er],
    ])
    assert.match<unknown>(er, {
      code: 'EWHAT',
      tarCode: 'TAR_TEST',
      more: 1,
    })
    // No onwarn function: the warning is dropped.
    new Parser().warn('TAR_TEST', 'dropped')
  })
})

// https://edera.dev/stories/tarmageddon
describe('tarmageddon', () => {
  const nested = file('one', '1')

  test('no pax, 2 entries', () => {
    const { entries } = parse([
      cat(hdr({ path: 'nested.tar' }), nested, EOA),
    ])
    assert.match(entries, [
      { size: 0, path: 'nested.tar' },
      { size: 1, path: 'one' },
    ])
  })

  test('with pax, 1 entry', () => {
    // The PAX size is the size of the body.
    const { entries } = parse([
      cat(
        new Pax({ path: 'nested.tar', size: nested.length }).encode(),
        hdr({ path: 'nested.tar', size: 0 }),
        nested,
      ),
    ])
    assert.equal(entries.length, 1)
    assert.match(entries, [{ size: 1024, path: 'nested.tar' }])
  })
})

describe('pending PAX fields apply to the next file entry only', () => {
  test('PAX size=0 does not change a GNU long name entry', () => {
    const { paths } = parse([
      pax([['size', '0']]),
      hdr({
        path: '././@LongLink',
        type: 'NextFileHasLongPath',
        size: 512,
      }),
      hdr({ path: 'payload-only.txt', type: 'File' }),
      file('real.txt'),
      EOA,
    ])
    assert.deepEqual(paths, ['payload-only.txt'])
  })

  test('a large PAX size does not drop a GNU long name', () => {
    const size = 1024 * 1024 + 1
    const { entries } = parse([
      pax([['size', String(size)]]),
      longPath('long-name.txt'),
      file('raw-name.txt', 'a'.repeat(size)),
      EOA,
    ])
    assert.match(entries, [{ path: 'long-name.txt', size }])
  })

  for (const type of [
    'ExtendedHeader',
    'GlobalExtendedHeader',
    'NextFileHasLongLinkpath',
  ] as const) {
    test(`PAX size=0 does not change a ${type} entry`, () => {
      const { paths } = parse([
        pax([['size', '0']]),
        hdr({ path: 'meta', type, size: 512 }),
        // The body of the meta entry. It is an entry if the parser
        // uses the PAX size for the meta entry.
        hdr({ path: 'hidden.txt', type: 'File' }),
        ent({ path: 'l', type: 'SymbolicLink', linkpath: 'x' }),
        EOA,
      ])
      assert.deepEqual(paths, ['l'])
    })
  }

  test('a local size wins over a global size', () => {
    const { entries } = parse([
      pax([['size', '512']]),
      pax([['size', '0']], true),
      hdr({ path: 'carrier.txt', type: 'File', size: 512 }),
      hdr({ path: 'hidden.txt', type: 'File' }),
      EOA,
    ])
    assert.equal(entries.length, 1)
    assert.match(entries, [{ path: 'carrier.txt', size: 512 }])
  })

  test('a local value wins over a global value', () => {
    const { entries } = parse([
      pax([['uid', '1']]),
      pax([['uid', '2']], true),
      file('f'),
      file('g'),
      EOA,
    ])
    assert.match(entries, [
      { path: 'f', uid: 1 },
      { path: 'g', uid: 2 },
    ])
  })

  test('a local PAX header applies to one entry', () => {
    const { entries } = parse([
      pax([['path', 'renamed']]),
      file('f'),
      file('g'),
      EOA,
    ])
    assert.match(entries, [
      { path: 'renamed', extended: { path: 'renamed' } },
      { path: 'g', extended: undefined },
    ])
  })

  test('two local PAX headers are merged', () => {
    const { entries } = parse([
      pax([
        ['path', 'first'],
        ['uid', '7'],
      ]),
      pax([['path', 'second']]),
      file('f'),
      EOA,
    ])
    assert.match(entries, [{ path: 'second', uid: 7 }])
  })

  test('a global linkpath and a global path are ignored', () => {
    const { entries } = parse([
      pax(
        [
          ['linkpath', '../../etc/passwd'],
          ['path', 'evil'],
        ],
        true,
      ),
      file('f'),
      ent({ path: 'l', type: 'SymbolicLink', linkpath: 'safe' }),
      EOA,
    ])
    assert.match(entries, [
      { path: 'f', linkpath: undefined, globalExtended: { path: 'evil' } },
      { path: 'l', linkpath: 'safe' },
    ])
  })
})

describe('PAX records are framed by their length', () => {
  test('a newline in a value does not start a record', () => {
    const { paths } = parse([
      pax([['comment', 'x\n24 path=forged-name.txt']]),
      file('carrier.txt', 'DATA'),
      EOA,
    ])
    assert.deepEqual(paths, ['carrier.txt'])
  })

  test('a path with a newline survives encode and parse', () => {
    const path = 'é\n21 path=package.json\n'
    const body = new TextEncoder().encode(new Pax({ path }).encodeBody())
    assert.equal(Pax.parseBytes(body).path, path)
    assert.equal(Pax.parse(new Pax({ path }).encodeBody()).path, path)
  })

  for (const [name, body] of Object.entries({
    'no length': 'path=a\n',
    'length too long': '99 path=a\n',
    'length too short': '3 path=a\n',
    'no newline at the end of the record': '9 path=ab',
  })) {
    test(`stop at a record with ${name}`, () => {
      const parsed = Pax.parseBytes(
        cat(rec('comment', 'ok'), Buffer.from(body), rec('path', 'later')),
      )
      assert.equal(parsed.comment, 'ok')
      assert.equal(parsed.path, undefined)
    })
  }

  test('the length counts bytes, also for bytes that are not UTF-8', () => {
    // The old parser decoded the body to text first. That changed
    // the byte count of a record with an invalid sequence.
    const { paths } = parse([
      pax([
        ['comment', new Uint8Array([0xff, 0xfe])],
        ['path', 'after-bad-bytes'],
      ]),
      file('f'),
      EOA,
    ])
    assert.deepEqual(paths, ['after-bad-bytes'])
  })

  test('a character that is in two chunks', () => {
    const data = cat(
      pax([['path', 'Ω/é/日本']]),
      longPath('λ'),
      file('f'),
      EOA,
    )
    for (const size of [1, 3, 7, 512]) {
      const { paths } = parse(chunked(data, size))
      assert.deepEqual(paths, ['Ω/é/日本'], `size ${size}`)
    }
    const gnu = cat(longPath('日本/λ'), file('f'), EOA)
    assert.deepEqual(parse(chunked(gnu, 1)).paths, ['日本/λ'])
  })
})

describe('a NUL ends a name, also before a line break', () => {
  for (const br of ['\n', '\r', ' ', ' ']) {
    const name = `a\0b${br}c\0d`
    const code = br.codePointAt(0)?.toString(16)
    test(`GNU long path, break U+${code}`, () => {
      assert.deepEqual(parse([longPath(name), file('f'), EOA]).paths, [
        'a',
      ])
    })
    test(`GNU long linkpath, break U+${code}`, () => {
      const { entries } = parse([
        longLink(name),
        ent({ path: 'l', type: 'SymbolicLink', linkpath: 'x' }),
        EOA,
      ])
      assert.match(entries, [{ path: 'l', linkpath: 'a' }])
    })
    test(`PAX path, break U+${code}`, () => {
      const { paths } = parse([pax([['path', name]]), file('f'), EOA])
      assert.deepEqual(paths, ['a'])
    })
    test(`ustar name, break U+${code}`, () => {
      const block = hdr({ path: 'f', type: 'File' })
      block.set(Buffer.from(name), 0)
      // write the checksum again for the new name
      block.fill(0x20, 148, 156)
      const sum = block.reduce((a, b) => a + b, 0)
      block.set(Buffer.from(sum.toString(8).padStart(6, '0') + '\0 '), 148)
      assert.deepEqual(parse([block, EOA]).paths, ['a'])
    })
  }

  test('a GNU long name with no NUL', () => {
    const { paths } = parse([
      ent(
        { path: '././@LongLink', type: 'NextFileHasLongPath' },
        'no-nul',
      ),
      file('f'),
      EOA,
    ])
    assert.deepEqual(paths, ['no-nul'])
  })
})

describe('PAX numbers are decimal digits only', () => {
  test('a size with a leading zero is decimal', () => {
    const { entries } = parse([
      pax([['size', '0512']]),
      hdr({ path: 'README.md', type: 'File' }),
      hdr({ path: 'cover', type: 'File' }),
      EOA,
    ])
    assert.equal(entries.length, 1)
    assert.match(entries, [{ path: 'README.md', size: 512 }])
  })

  for (const v of ['Infinity', '1e30', '-5', '1.5', 'abc', '0x10', '']) {
    test(`ignore uid=${JSON.stringify(v)}`, () => {
      const { entries } = parse([pax([['uid', v]]), file('f'), EOA])
      assert.match(entries, [{ path: 'f', uid: 501 }])
    })
  }

  test('ignore a time that is not a number', () => {
    const mtime = new Date('2001-02-03T04:05:06Z')
    const { entries } = parse([
      pax([['mtime', 'abc']]),
      ent({ path: 'f', type: 'File', mtime }),
      EOA,
    ])
    assert.match(entries, [{ path: 'f', mtime }])
  })
})

describe('a PAX name wins over a GNU long name', () => {
  const link = ent({ path: 'l', type: 'SymbolicLink', linkpath: 'hdr' })
  test('PAX path, then GNU long path', () => {
    assert.deepEqual(
      parse([pax([['path', 'pax']]), longPath('gnu'), file('f'), EOA])
        .paths,
      ['pax'],
    )
  })
  test('GNU long path, then PAX path', () => {
    assert.deepEqual(
      parse([longPath('gnu'), pax([['path', 'pax']]), file('f'), EOA])
        .paths,
      ['pax'],
    )
  })
  test('PAX linkpath, then GNU long linkpath', () => {
    const { entries } = parse([
      pax([['linkpath', 'pax']]),
      longLink('gnu'),
      link,
      EOA,
    ])
    assert.match(entries, [{ path: 'l', linkpath: 'pax' }])
  })
  test('GNU long linkpath, then PAX linkpath', () => {
    const { entries } = parse([
      longLink('gnu'),
      pax([['linkpath', 'pax']]),
      link,
      EOA,
    ])
    assert.match(entries, [{ path: 'l', linkpath: 'pax' }])
  })
  test('GNU long path with a PAX header that has no path', () => {
    const { entries } = parse([
      pax([['uid', '7']]),
      longPath('gnu'),
      file('f'),
      EOA,
    ])
    assert.match(entries, [{ path: 'gnu', uid: 7 }])
  })
  test('GNU long path and GNU long linkpath for one entry', () => {
    const { entries } = parse([
      longLink('to'),
      longPath('from'),
      link,
      EOA,
    ])
    assert.match(entries, [{ path: 'from', linkpath: 'to' }])
  })
  test('the old GNU long path type', () => {
    const { paths } = parse([
      ent({ path: 'x', type: 'OldGnuLongPath' }, 'old-gnu\0'),
      ent({ path: 'x', type: 'OldExtendedHeader' }, rec('uid', '9')),
      file('f'),
      EOA,
    ])
    assert.deepEqual(paths, ['old-gnu'])
  })
})

describe('the last GNU long name wins', () => {
  const link = ent({ path: 'l', type: 'SymbolicLink', linkpath: 'hdr' })
  test('two GNU long paths', () => {
    assert.deepEqual(
      parse([longPath('one'), longPath('two'), file('f'), file('g'), EOA])
        .paths,
      ['two', 'g'],
    )
  })
  test('two GNU long linkpaths', () => {
    const { entries } = parse([
      longLink('one'),
      longLink('two'),
      link,
      link,
      EOA,
    ])
    assert.match(entries, [
      { path: 'l', linkpath: 'two' },
      { path: 'l', linkpath: 'hdr' },
    ])
  })
  test('PAX path, then two GNU long paths', () => {
    assert.deepEqual(
      parse([
        pax([['path', 'pax']]),
        longPath('one'),
        longPath('two'),
        file('f'),
        EOA,
      ]).paths,
      ['pax'],
    )
  })
  test('a PAX path between two GNU long paths', () => {
    assert.deepEqual(
      parse([
        longPath('one'),
        pax([['path', 'pax']]),
        longPath('two'),
        file('f'),
        EOA,
      ]).paths,
      ['pax'],
    )
  })
  test('a PAX linkpath between two GNU long linkpaths', () => {
    const { entries } = parse([
      longLink('one'),
      pax([['linkpath', 'pax']]),
      longLink('two'),
      link,
      EOA,
    ])
    assert.match(entries, [{ path: 'l', linkpath: 'pax' }])
  })
})

describe('maxMetaEntrySize', () => {
  const name = 'n'.repeat(300)
  const data = cat(
    longPath(name),
    file('short'),
    pax([['path', name]]),
    file('s2'),
    EOA,
  )

  test('a meta entry that is too large is skipped', () => {
    const { paths, warnings } = parse(chunked(data, 100), {
      maxMetaEntrySize: 250,
    })
    assert.deepEqual(paths, ['short', 's2'])
    assert.deepEqual(warnings, [])
  })

  test('the default limit is 1 MiB', () => {
    assert.deepEqual(parse([data]).paths, [name, name])
    assert.equal(new Parser().maxMetaEntrySize, 1024 * 1024)
    const big = 'b'.repeat(1024 * 1024)
    assert.deepEqual(parse([longPath(big), file('f'), EOA]).paths, ['f'])
    assert.deepEqual(
      parse([longPath(big.slice(1)), file('f'), EOA]).paths,
      [big.slice(1)],
    )
  })

  test('a meta entry with no body changes nothing', () => {
    const { paths, warnings } = parse([
      hdr({ path: 'x', type: 'ExtendedHeader' }),
      hdr({ path: 'y', type: 'NextFileHasLongPath' }),
      file('f'),
      EOA,
    ])
    assert.deepEqual(paths, ['f'])
    assert.deepEqual(warnings, [])
  })

  test('an archive of only empty meta entries is valid tar', () => {
    assert.deepEqual(
      parse([hdr({ path: 'x', type: 'ExtendedHeader' })]).warnings,
      // The state of the old parser is still "begin" here.
      [['TAR_BAD_ARCHIVE', 'Unrecognized archive format']],
    )
  })
})
