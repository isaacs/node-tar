import t from 'tap'
import {
  dealias,
  isSync,
  isSyncFile,
  isFile,
  isAsyncFile,
  isAsyncNoFile,
  isSyncNoFile,
  isAsync,
  isNoFile,
} from '../dist/esm/options.js'

t.same(dealias(), {})
t.same(dealias(false), {})

t.same(
  dealias({
    C: 'dir',
    f: 'file',
    z: 'zip',
    P: 'preserve',
    U: 'unlink',
    'strip-components': 99,
    foo: 'bar',
  }),
  {
    cwd: 'dir',
    file: 'file',
    gzip: 'zip',
    preservePaths: 'preserve',
    unlink: 'unlink',
    strip: 99,
    foo: 'bar',
  },
)

t.same(
  dealias({
    C: 'dir',
    f: 'file',
    z: 'zip',
    P: 'preserve',
    U: 'unlink',
    stripComponents: 99,
    foo: 'bar',
  }),
  {
    cwd: 'dir',
    file: 'file',
    gzip: 'zip',
    preservePaths: 'preserve',
    unlink: 'unlink',
    strip: 99,
    foo: 'bar',
  },
)

t.same(dealias({ noChmod: false }), { chmod: true })
t.same(dealias({ noChmod: true }), {})

t.equal(isSyncFile(dealias({ sync: true, f: 'x' })), true)
t.equal(isSyncFile(dealias({ file: 'x' })), false)
t.equal(isSyncFile(dealias({ sync: true })), false)
t.equal(isSyncFile(dealias({})), false)
t.equal(isSync(dealias({ sync: true, f: 'x' })), true)
t.equal(isSync(dealias({ file: 'x' })), false)
t.equal(isSync(dealias({ sync: true })), true)
t.equal(isSync(dealias({})), false)
t.equal(isAsync(dealias({})), true)
t.equal(isFile(dealias({ sync: true, f: 'x' })), true)
t.equal(isNoFile(dealias({ sync: true, f: 'x' })), false)
t.equal(isFile(dealias({ file: 'x' })), true)
t.equal(isFile(dealias({ sync: true })), false)
t.equal(isFile(dealias({})), false)
t.equal(isSyncFile(dealias({})), false)
t.equal(isSyncNoFile(dealias({ sync: true })), true)
t.equal(isAsyncFile(dealias({})), false)
t.equal(isAsyncNoFile(dealias({})), true)
