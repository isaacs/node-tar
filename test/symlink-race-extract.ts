import fs, {
  lstatSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import t from 'tap'
import { extract } from '../src/extract.js'
import { Header } from '../src/header.js'

if (typeof fs.constants.O_NOFOLLOW !== 'number') {
  t.plan(0, 'no O_NOFOLLOW flag')
  process.exit(0)
}

const makeTarball = () => {
  const header = Buffer.alloc(512)
  new Header({
    path: 'victim.txt',
    type: 'File',
    size: 6,
  }).encode(header)

  return Buffer.concat([
    header,
    Buffer.from('PWNED\n'.padEnd(512, '\0')),
    Buffer.alloc(1024),
  ])
}

t.test('extract does not follow a raced-in symlink', async t => {
  const dir = t.testdir({
    cwd: {},
    'target.txt': 'ORIGINAL\n',
  })
  const cwd = resolve(dir, 'cwd')
  const target = resolve(dir, 'target.txt')
  const tarball = resolve(dir, 'poc.tar')
  const victim = resolve(cwd, 'victim.txt')
  writeFileSync(tarball, makeTarball())

  const warnings: [code: string, message: string][] = []
  const lstat = fs.lstat
  let raced = false
  fs.lstat = ((path, options, cb) => {
    const callback =
      typeof options === 'function' ? options : (
        (cb as Parameters<typeof fs.lstat>[1] &
          ((err: NodeJS.ErrnoException | null, stats: fs.Stats) => void))
      )
    if (!raced && String(path) === victim) {
      raced = true
      symlinkSync(target, victim)
      const er = Object.assign(new Error('raced symlink'), {
        code: 'ENOENT',
      })
      process.nextTick(() => callback(er, undefined as never))
      return
    }
    return typeof options === 'function' ?
        lstat(path, options)
      : lstat(path, options, cb as never)
  }) as typeof fs.lstat
  t.teardown(() => {
    fs.lstat = lstat
  })

  await extract({
    cwd,
    file: tarball,
    onwarn: (code, message) => warnings.push([code, String(message)]),
  })

  t.equal(readFileSync(target, 'utf8'), 'ORIGINAL\n')
  t.equal(lstatSync(victim).isSymbolicLink(), true)
  t.match(warnings, [
    ['TAR_ENTRY_ERROR', /ELOOP|symbolic link|Too many symbolic links/],
  ])
})
