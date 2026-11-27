import { assert, test } from 'ubqtest'
import * as types from '../src/types.js'
test('type names and codes', () => {
  assert.equal(types.name.get('0'), 'File')
  assert.equal(types.code.get('File'), '0')
  assert.equal(types.isCode('0'), true)
  assert.equal(types.isCode('Z'), false)
  assert.equal(types.isName('TapeVolumeHeader'), true)
  assert.equal(types.isName('Unsupported'), false)
})
