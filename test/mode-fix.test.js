import { assert, test } from 'ubqtest'
import { modeFix } from '../src/mode-fix.js'

test('modeFix sets default file and directory modes', () => {
  assert.equal(modeFix(0o10644, false), 0o644)
  assert.equal(modeFix(0o10644, true), 0o755)
  assert.equal(modeFix(0o10604, true), 0o705)
  assert.equal(modeFix(0o10600, true), 0o700)
  assert.equal(modeFix(0o10066, true), 0o077)

  assert.equal(modeFix(0o10664, false, true), 0o644)
  assert.equal(modeFix(0o10066, false, true), 0o644)
  assert.equal(modeFix(0o10666, true, true), 0o755)
  assert.equal(modeFix(0o10604, true, true), 0o705)
  assert.equal(modeFix(0o10600, true, true), 0o700)
  assert.equal(modeFix(0o10066, true, true), 0o755)
})
