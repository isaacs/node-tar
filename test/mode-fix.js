import t from 'tap'
import { modeFix } from '../dist/esm/mode-fix.js'

t.equal(modeFix(0o10644, false), 0o644)
t.equal(modeFix(0o10644, true), 0o755)
t.equal(modeFix(0o10604, true), 0o705)
t.equal(modeFix(0o10600, true), 0o700)
t.equal(modeFix(0o10066, true), 0o077)

t.equal(modeFix(0o10664, false, true), 0o644)
t.equal(modeFix(0o10066, false, true), 0o644)
t.equal(modeFix(0o10666, true, true), 0o755)
t.equal(modeFix(0o10604, true, true), 0o705)
t.equal(modeFix(0o10600, true, true), 0o700)
t.equal(modeFix(0o10066, true, true), 0o755)
