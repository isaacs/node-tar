import { assert, test } from 'ubqtest'
import * as wc from '../src/winchars.js'

test('encode and decode reserved Windows characters', () => {
  assert.equal(wc.encode('<>'), '\uf03c\uf03e', 'encode')
  assert.equal(wc.decode(wc.encode('<>')), '<>', 'decode')
  assert.equal(wc.decode(wc.encode('\\|<>?:')), '\\|<>?:', 'all chars')
})
