// just load all the files so we can't cheat coverage by avoiding something
import fs from 'fs'
import t from 'tap'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const lib = path.resolve(__dirname, '../dist/esm')
await Promise.all(
  fs
    .readdirSync(lib)
    .filter(f => /\.js$/.test(f))
    .map(f => import('../dist/esm/' + f)),
)

t.pass('all lib files loaded')
