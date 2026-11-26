#!/usr/bin/env node
// Compare the speed of the current build against tar@7.5.24 from npm.
//
// Usage: node scripts/benchmark/index.js [--rounds=N] [--filter=text]
//
// Each round runs every case one time for each build, so that system
// noise affects both builds equally. The report shows the median time
// for each build, and the ratio of current to baseline. A ratio above 1
// means that the current build is slower.

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const BASELINE = 'tar@7.5.24'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const work = resolve(root, '.benchmark')
const arg = (name, def) => {
  const p = `--${name}=`
  const a = process.argv.find(a => a.startsWith(p))
  return a ? a.slice(p.length) : def
}
const rounds = Number(arg('rounds', '10'))
const filter = arg('filter', '')

// Get the baseline from the npm registry. This does not change
// package.json or node_modules. The baseline bundle has no imports
// other than node builtins.
const baselineDir = resolve(work, BASELINE)
if (!existsSync(resolve(baselineDir, 'package'))) {
  mkdirSync(baselineDir, { recursive: true })
  const tgz = execFileSync(
    'npm',
    ['pack', BASELINE, '--silent', '--pack-destination', baselineDir],
    { encoding: 'utf8' },
  ).trim()
  execFileSync('tar', ['xzf', tgz], { cwd: baselineDir })
}
const load = async dir =>
  import(String(pathToFileURL(resolve(dir, 'dist/esm/index.min.js'))))
const builds = {
  baseline: await load(resolve(baselineDir, 'package')),
  current: await load(root),
}

// Fixtures are the same on each run. The content compresses about as
// well as source code does.
const text = (seed, size) => {
  const words = []
  let n = 0
  let s = seed
  while (n < size) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    const w = s.toString(36)
    words.push(w)
    n += w.length + 1
  }
  return words.join(' ').slice(0, size)
}
const fixture = (name, dirs, filesPerDir, size) => {
  const dir = resolve(work, 'fixtures', name)
  if (existsSync(dir)) return dir
  for (let d = 0; d < dirs; d++) {
    const sub = resolve(dir, 'tree', `pkg-${d}`, 'lib')
    mkdirSync(sub, { recursive: true })
    for (let f = 0; f < filesPerDir; f++) {
      writeFileSync(
        resolve(sub, `file-${f}.txt`),
        text(d * 1000 + f + 1, size(f)),
      )
    }
  }
  return dir
}
const fixtures = {
  small: fixture('small', 200, 10, f => 512 + f * 700),
  large: fixture('large', 2, 2, () => 16 * 1024 * 1024),
}

// Each case gets the tar module, the fixture directory, and an empty
// output directory. The setup archives come from the baseline build.
const cases = {
  'create async': (tar, fx, out) =>
    tar.c({ cwd: fx, file: `${out}/a.tar` }, ['tree']),
  'create sync': (tar, fx, out) =>
    tar.c({ cwd: fx, file: `${out}/a.tar`, sync: true }, ['tree']),
  'create gzip async': (tar, fx, out) =>
    tar.c({ cwd: fx, file: `${out}/a.tgz`, gzip: true }, ['tree']),
  'list async': (tar, fx) => tar.t({ file: `${fx}/a.tar` }),
  'list sync': (tar, fx) => tar.t({ file: `${fx}/a.tar`, sync: true }),
  'list gzip async': (tar, fx) => tar.t({ file: `${fx}/a.tgz` }),
  'parse in memory': (tar, fx) =>
    new Promise((res, rej) => {
      const p = new tar.Parser()
      p.on('entry', e => e.resume())
      p.on('end', res)
      p.on('error', rej)
      p.end(archives[fx])
    }),
  'extract async': (tar, fx, out) =>
    tar.x({ cwd: out, file: `${fx}/a.tar` }),
  'extract sync': (tar, fx, out) =>
    tar.x({ cwd: out, file: `${fx}/a.tar`, sync: true }),
  'extract gzip async': (tar, fx, out) =>
    tar.x({ cwd: out, file: `${fx}/a.tgz` }),
}

const archives = {}
for (const fx of Object.values(fixtures)) {
  if (!existsSync(`${fx}/a.tgz`)) {
    builds.baseline.c({ cwd: fx, file: `${fx}/a.tar`, sync: true }, [
      'tree',
    ])
    builds.baseline.c(
      { cwd: fx, file: `${fx}/a.tgz`, sync: true, gzip: true },
      ['tree'],
    )
  }
  archives[fx] = readFileSync(`${fx}/a.tar`)
}

const time = async (fn, tar, fx) => {
  const out = mkdtempSync(resolve(work, 'out-'))
  try {
    const start = process.hrtime.bigint()
    await fn(tar, fx, out)
    return Number(process.hrtime.bigint() - start) / 1e6
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}
const median = list => {
  const s = list.toSorted((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const rows = []
for (const [fxName, fx] of Object.entries(fixtures)) {
  for (const [caseName, fn] of Object.entries(cases)) {
    const name = `${fxName}: ${caseName}`
    if (!name.includes(filter)) continue
    const times = { baseline: [], current: [] }
    // The first round warms up the code and the file cache.
    for (let r = 0; r <= rounds; r++) {
      const order =
        r % 2 ? ['baseline', 'current'] : ['current', 'baseline']
      for (const b of order) {
        const ms = await time(fn, builds[b], fx)
        if (r > 0) times[b].push(ms)
      }
    }
    const baseline = median(times.baseline)
    const current = median(times.current)
    rows.push({
      case: name,
      'baseline ms': baseline.toFixed(2),
      'current ms': current.toFixed(2),
      ratio: (current / baseline).toFixed(3),
    })
  }
}
console.table(rows)
