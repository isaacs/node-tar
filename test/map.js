import t from 'tap'
import map from '../map.js'
import { fileURLToPath } from 'url'
const __filename = fileURLToPath(import.meta.url)
t.equal(map('test/index.js'), 'src/index.ts')
t.same(map('test/unpack.js'), ['src/unpack.ts', 'src/mkdir.ts'])
t.same(map('test/load-all.js'), [])
t.equal(map(__filename), 'map.js')
t.equal(map('test/asdf'), 'src/asdf')
