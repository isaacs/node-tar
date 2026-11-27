// Tests of the core entry point (`tar/core`) in a real browser page.
// The page loads the built bundle, dist/esm/index.min.js, so run
// `npm run prepare` first. `npm run test:browser` does both.
//
// The function of each `page.evaluate()` call runs in the page. It
// cannot use a name of this file. It gets `tar` from the page, and
// returns plain data for the assertions.
import { assert, describe, test } from 'ubqtest'
import { browser } from 'ubqtest/browser'

type Core = typeof import('../../src/index.js')
type Kinds = Record<'Buffer' | 'process' | 'require' | 'module', string>
type PageGlobals = {
  tar: Core
  globals: { before: Kinds; after: Kinds }
}

// The first test of a run starts the browser.
const timeout = 30_000

const open = async () => {
  const page = await browser()
  await page.goto('/test/browser/page.html')
  await page.waitForFunction(() => 'tar' in globalThis)
  return page
}

const mtime = '2020-01-02T03:04:05.000Z'
const forms = ['Uint8Array', 'Blob', 'Response'] as const
type Case = { form: (typeof forms)[number]; gzip: boolean; mtime: string }
const cases: Case[] = forms.flatMap(form =>
  [false, true].map(gzip => ({ form, gzip, mtime })),
)
const title = ({ form, gzip }: Case) =>
  `${form}, ${gzip ? 'gzip' : 'plain'}`

// What each reader finds in the archive of the cases.
type Found = {
  path: string
  type: string
  size: number
  mode?: number
  mtime?: string
}
const found: Found[] = [
  { path: 'dir/', type: 'Directory', size: 0, mode: 0o755, mtime },
  { path: 'dir/hello.txt', type: 'File', size: 6, mode: 0o644, mtime },
  { path: 'dir/data.bin', type: 'File', size: 5, mode: 0o600, mtime },
  { path: 'dir/big.txt', type: 'File', size: 200_000, mode: 0o644, mtime },
]

test(
  'the bundle loads with no global of Node.js',
  { timeout },
  async () => {
    const page = await open()
    const res = await page.evaluate(() => {
      const { tar, globals } = globalThis as unknown as PageGlobals
      return {
        globals,
        create: typeof tar.create,
        names: Object.keys(tar),
      }
    })
    const none = {
      Buffer: 'undefined',
      process: 'undefined',
      require: 'undefined',
      module: 'undefined',
    }
    assert.deepEqual(res.globals, { before: none, after: none })
    assert.equal(res.create, 'function')
    for (const name of ['entries', 'list', 'extract', 'WriteEntry']) {
      assert.contains(res.names, name)
    }
  },
)

describe('create() to a stream', () => {
  for (const gzip of [false, true]) {
    test(gzip ? 'gzip' : 'plain', { timeout }, async () => {
      const page = await open()
      const res = await page.evaluate(
        async ({ gzip, mtime }) => {
          const { tar } = globalThis as unknown as PageGlobals
          const date = new Date(mtime)
          const stream = tar.create({ gzip }, [
            new tar.WriteEntry(
              { path: 'hello.txt', mtime: date },
              'hello\n',
            ),
            new tar.WriteEntry(
              { path: 'data.bin', mtime: date },
              new Uint8Array([1, 2, 3]),
            ),
          ])
          const isStream = stream instanceof ReadableStream
          const raw = new Uint8Array(
            await new Response(stream).arrayBuffer(),
          )
          const plain =
            gzip ?
              new Uint8Array(
                await new Response(
                  new Blob([raw])
                    .stream()
                    .pipeThrough(new DecompressionStream('gzip')),
                ).arrayBuffer(),
              )
            : raw
          const text = (start: number, end: number) =>
            new TextDecoder().decode(plain.subarray(start, end))
          return {
            isStream,
            magic: [raw[0], raw[1]],
            length: plain.length,
            names: [text(0, 9), text(1024, 1032)],
            bodies: [text(512, 518), [...plain.subarray(1536, 1539)]],
            end: plain.subarray(2048).every(byte => byte === 0),
          }
        },
        { gzip, mtime },
      )
      assert.equal(res.isStream, true)
      if (gzip) assert.deepEqual(res.magic, [0x1f, 0x8b])
      else assert.deepEqual(res.magic, [0x68, 0x65])
      // Two entries of two blocks each, and the two blocks of the end.
      assert.equal(res.length, 6 * 512)
      assert.deepEqual(res.names, ['hello.txt', 'data.bin'])
      assert.deepEqual(res.bodies, ['hello\n', [1, 2, 3]])
      assert.equal(res.end, true)
    })
  }
})

// Runs in the page. Make the archive of the case with create(), and
// give it in the form of the case.
const makeInput = async (c: Case) => {
  const { tar } = globalThis as unknown as PageGlobals
  const date = new Date(c.mtime)
  const stream = tar.create({ gzip: c.gzip }, [
    new tar.WriteEntry({
      path: 'dir/',
      type: 'Directory',
      mode: 0o755,
      mtime: date,
    }),
    new tar.WriteEntry(
      { path: 'dir/hello.txt', mode: 0o644, mtime: date },
      'hello\n',
    ),
    new tar.WriteEntry(
      { path: 'dir/data.bin', mode: 0o600, mtime: date },
      new Uint8Array([0, 1, 2, 254, 255]),
    ),
    new tar.WriteEntry(
      { path: 'dir/big.txt', mode: 0o644, mtime: date },
      new Blob(['0123456789'.repeat(20_000)]),
    ),
  ])
  const blob = await new Response(stream).blob()
  if (c.form === 'Blob') return blob
  if (c.form === 'Uint8Array')
    return new Uint8Array(await blob.arrayBuffer())
  const { body } = new Response(blob)
  if (!body) throw new Error('the response has no body')
  return body
}

describe('entries() reads what create() made', () => {
  for (const c of cases) {
    test(title(c), { timeout }, async () => {
      const page = await open()
      const makeInputText = String(makeInput)
      const res = await page.evaluate(
        async ({ c, makeInputText }) => {
          const { tar } = globalThis as unknown as PageGlobals
          const make = (0, eval)(`(${makeInputText})`) as typeof makeInput
          const list: Found[] = []
          const content: Record<string, unknown> = {}
          for await (const entry of tar.entries(await make(c))) {
            const { path, type, size, mode } = entry
            const mtime = entry.mtime?.toISOString()
            list.push({ path, type, size, mode, mtime })
            if (path === 'dir/hello.txt') {
              content.text = await entry.text()
              content.used = entry.bodyUsed
            } else if (path === 'dir/data.bin') {
              const bytes = await entry.bytes()
              content.isBytes = bytes instanceof Uint8Array
              content.bytes = [...bytes]
            } else if (path === 'dir/big.txt') {
              // The body is a stream of the browser.
              const { body } = entry
              content.isStream = body instanceof ReadableStream
              const text = await new Response(body).text()
              content.bigLength = text.length
              content.bigOk = text === '0123456789'.repeat(20_000)
            }
          }
          return { list, content }
        },
        { c, makeInputText },
      )
      assert.deepEqual(res.list, found)
      assert.deepEqual(res.content, {
        text: 'hello\n',
        used: true,
        isBytes: true,
        bytes: [0, 1, 2, 254, 255],
        isStream: true,
        bigLength: 200_000,
        bigOk: true,
      })
    })
  }
})

describe('list({ input })', () => {
  for (const c of cases) {
    test(title(c), { timeout }, async () => {
      const page = await open()
      const makeInputText = String(makeInput)
      const res = await page.evaluate(
        async ({ c, makeInputText }) => {
          const { tar } = globalThis as unknown as PageGlobals
          const make = (0, eval)(`(${makeInputText})`) as typeof makeInput
          const list: Found[] = []
          const texts: string[] = []
          await tar.list({
            input: await make(c),
            onEntry: async entry => {
              const { path, type, size, mode } = entry
              const mtime = entry.mtime?.toISOString()
              list.push({ path, type, size, mode, mtime })
              if (path === 'dir/hello.txt') texts.push(await entry.text())
            },
          })
          // Only the paths that the files argument names.
          const some: string[] = []
          await tar.list(
            {
              input: await make(c),
              onEntry: entry => {
                some.push(entry.path)
              },
            },
            ['dir/data.bin'],
          )
          return { list, texts, some }
        },
        { c, makeInputText },
      )
      assert.deepEqual(res.list, found)
      assert.deepEqual(res.texts, ['hello\n'])
      assert.deepEqual(res.some, ['dir/data.bin'])
    })
  }
})

test('extract() into a file system in memory', { timeout }, async () => {
  const page = await open()
  const res = await page.evaluate(async () => {
    const { tar } = globalThis as unknown as PageGlobals
    type Node = {
      type: 'dir' | 'file' | 'symlink'
      mode?: number
      mtime?: Date
      chunks?: Uint8Array[]
      target?: string
    }
    const tree = new Map<string, Node>([
      ['/out', { type: 'dir', mode: 0o755, mtime: new Date() }],
    ])
    const fail = (code: string, path: string) =>
      Object.assign(new Error(`${code}: ${path}`), { code })
    const get = (path: string) => {
      const node = tree.get(path)
      if (!node) throw fail('ENOENT', path)
      return node
    }
    const stats = (node: Node) => ({
      isDirectory: () => node.type === 'dir',
      isFile: () => node.type === 'file',
      isSymbolicLink: () => node.type === 'symlink',
      nlink: 1,
      mode: node.mode,
      mtime: node.mtime,
    })
    const setTime = async (path: string, _: unknown, mtime: Date) => {
      get(path).mtime = mtime
    }
    const calls: string[] = []
    const memfs = {
      stat: async (path: string) => stats(get(path)),
      lstat: async (path: string) => stats(get(path)),
      mkdir: async (path: string, { mode }: { mode?: number }) => {
        if (tree.has(path)) throw fail('EEXIST', path)
        calls.push(`mkdir ${path}`)
        tree.set(path, { type: 'dir', mode, mtime: new Date() })
        return undefined
      },
      open: async (path: string, flags: unknown, mode?: number) => {
        calls.push(`open ${path} ${String(flags)}`)
        const chunks: Uint8Array[] = []
        const file: Node = {
          type: 'file',
          mode,
          mtime: new Date(),
          chunks,
        }
        tree.set(path, file)
        return {
          // `data` is a view into the archive data. Keep a copy.
          write: async (data: Uint8Array) => {
            chunks.push(data.slice())
          },
          utimes: async (_: unknown, mtime: Date) => {
            file.mtime = mtime
          },
          chown: async () => {},
          close: async () => {},
        }
      },
      symlink: async (target: string, path: string) => {
        tree.set(path, { type: 'symlink', mode: 0o777, target })
      },
      link: async (target: string, path: string) => {
        tree.set(path, get(target))
      },
      unlink: async (path: string) => {
        tree.delete(path)
      },
      rmdir: async (path: string) => {
        tree.delete(path)
      },
      rename: async (from: string, to: string) => {
        tree.set(to, get(from))
        tree.delete(from)
      },
      chmod: async (path: string, mode: number) => {
        get(path).mode = mode
      },
      chown: async () => {},
      lchown: async () => {},
      utimes: setTime,
      lutimes: setTime,
    }

    const mtime = new Date('2020-01-02T03:04:05.000Z')
    const archive = tar.create({ gzip: true }, [
      new tar.WriteEntry({
        path: 'docs/',
        type: 'Directory',
        mode: 0o755,
      }),
      new tar.WriteEntry(
        { path: 'docs/hello.txt', mode: 0o644, mtime },
        'hello\n',
      ),
      new tar.WriteEntry({ path: 'docs/deep/more.txt', mtime }, 'more\n'),
      new tar.WriteEntry({
        path: 'docs/link',
        type: 'SymbolicLink',
        linkpath: 'hello.txt',
      }),
      // An entry that must not leave the target directory.
      new tar.WriteEntry({ path: '../escape.txt' }, 'no'),
    ])
    const warnings: string[] = []
    await tar.extract({
      input: archive,
      fs: memfs as unknown as NonNullable<
        Parameters<Core['extract']>[0]['fs']
      >,
      cwd: '/out',
      onwarn: code => {
        warnings.push(code)
      },
    })
    const nodes: Record<string, unknown> = {}
    for (const [path, node] of tree) {
      nodes[path] = {
        type: node.type,
        ...(node.target ? { target: node.target } : {}),
        ...(node.chunks ?
          { text: await new Blob(node.chunks as BlobPart[]).text() }
        : {}),
      }
    }
    return {
      nodes,
      warnings,
      calls,
      mode: tree.get('/out/docs/hello.txt')?.mode,
      mtime: tree.get('/out/docs/hello.txt')?.mtime?.toISOString(),
    }
  })
  assert.deepEqual(res.nodes, {
    '/out': { type: 'dir' },
    '/out/docs': { type: 'dir' },
    '/out/docs/hello.txt': { type: 'file', text: 'hello\n' },
    '/out/docs/deep': { type: 'dir' },
    '/out/docs/deep/more.txt': { type: 'file', text: 'more\n' },
    '/out/docs/link': { type: 'symlink', target: 'hello.txt' },
  })
  assert.deepEqual(res.warnings, ['TAR_ENTRY_ERROR'])
  assert.deepEqual(res.calls.sort(), [
    'mkdir /out/docs',
    'mkdir /out/docs/deep',
    'open /out/docs/deep/more.txt w',
    'open /out/docs/hello.txt w',
  ])
  assert.equal(res.mode, 0o644)
  assert.equal(res.mtime, mtime)
})

test('the decompression ratio limit', { timeout }, async () => {
  const page = await open()
  const res = await page.evaluate(async () => {
    const { tar } = globalThis as unknown as PageGlobals
    // 8 MiB of zeros. Gzip makes it about 1000 times smaller.
    const size = 8 * 1024 * 1024
    const stream = tar.create({ gzip: true }, [
      new tar.WriteEntry({ path: 'bomb' }, new Uint8Array(size)),
    ])
    const bomb = new Uint8Array(await new Response(stream).arrayBuffer())
    const read = async (maxDecompressionRatio?: number) => {
      let seen = 0
      try {
        for await (const entry of tar.entries(bomb, {
          maxDecompressionRatio,
        })) {
          for await (const part of entry.body) seen += part.length
        }
        return { seen }
      } catch (er) {
        const { name, message, tarCode } = er as Error & {
          tarCode?: string
        }
        return { seen, name, message, tarCode }
      }
    }
    return {
      size,
      compressed: bomb.length,
      limited: await read(10),
      unlimited: await read(Infinity),
    }
  })
  assert.lessThan(res.compressed, res.size / 500)
  assert.match(res.limited, {
    name: 'Error',
    tarCode: 'TAR_ABORT',
    message: /^max decompression ratio exceeded: \d+\.\d\d > 10$/,
  })
  assert.lessThan(res.limited.seen, res.size)
  assert.deepEqual(res.unlimited, { seen: res.size })
})
