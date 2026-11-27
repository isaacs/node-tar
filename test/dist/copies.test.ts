// Tests of the built files in `dist`, so run `npm run prepare` first.
// `npm run test:dist` does both, and `npm test` runs it at the end.
//
// The package has more than one copy of each class: `tar` and
// `tar/core` are separate bundles, the `raw` entry points are the
// files that are not bundled, and each has an ESM and a CommonJS
// build. An entry that one copy made must work in each other copy.
import { createRequire } from 'node:module'
import { assert, describe, test } from 'ubqtest'

type Core = typeof import('../../src/index.js')
type Server = typeof import('../../src/server/index.js')
type Copy = Core & Partial<Pick<Server, 'PackSync' | 'entriesSync'>>

const require = createRequire(import.meta.url)
const load = async (path: string): Promise<Copy> =>
  path.startsWith('commonjs/') ?
    (require(`../../dist/${path}`) as Copy)
  : ((await import(
      new URL(`../../dist/${path}`, import.meta.url).href
    )) as Copy)

const copies: Record<string, Copy> = {}
for (const format of ['esm', 'commonjs']) {
  for (const file of [
    'index.min.js',
    'server/index.min.js',
    'index.js',
    'server/index.js',
  ]) {
    copies[`${format}/${file}`] = await load(`${format}/${file}`)
  }
}

const concat = (parts: Uint8Array[]) =>
  new Uint8Array(Buffer.concat(parts))

const collect = async (source: AsyncIterable<Uint8Array>) => {
  const parts: Uint8Array[] = []
  for await (const part of source) parts.push(part)
  return concat(parts)
}

// The path and the body of each entry of the archive.
const read = async (tar: Copy, data: Uint8Array) => {
  const found: string[] = []
  for await (const entry of tar.entries(data)) {
    found.push(`${entry.path}=${await entry.text()}`)
  }
  return found
}

for (const [fromName, from] of Object.entries(copies)) {
  for (const [toName, to] of Object.entries(copies)) {
    if (from === to) continue
    describe(`entries of ${fromName} in ${toName}`, () => {
      const written = () => new from.WriteEntry({ path: 'w' }, 'write')
      const archive = () =>
        collect(
          new from.Pack()
            .add(new from.WriteEntry({ path: 'r' }, 'read'))
            .end(),
        )

      test('create with a WriteEntry', async () => {
        const data = await collect(to.create({}, [written()]))
        assert.deepEqual(await read(to, data), ['w=write'])
      })

      test('Pack with a WriteEntry and the entries of an archive', async () => {
        const reader = from.entries(await archive())
        const { value: one } = await reader.next()
        assert(one)
        const pack = new to.Pack()
          .add(written())
          .add(one)
          .add(from.entries(await archive()))
          .end()
        assert.deepEqual(await read(to, await collect(pack)), [
          'w=write',
          'r=read',
          'r=read',
        ])
      })

      // Only the entry points for Node.js have the sync classes.
      const { PackSync } = to
      const { entriesSync } = from
      if (!PackSync || !entriesSync) return
      test('PackSync with a WriteEntry and the entries of an archive', async () => {
        const data = await archive()
        const { value: one } = entriesSync(data).next()
        assert(one)
        const pack = new PackSync()
          .add(written())
          .add(one)
          .add(entriesSync(data))
        assert.deepEqual(await read(to, concat([...pack])), [
          'w=write',
          'r=read',
          'r=read',
        ])
      })
    })
  }
}
