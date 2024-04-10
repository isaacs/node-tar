import t from 'tap'
import * as types from '../dist/esm/types.js'
t.equal(types.name.get('0'), 'File')
t.equal(types.code.get('File'), '0')
t.equal(types.isCode('0'), true)
t.equal(types.isCode('Z'), false)
t.equal(types.isName('TapeVolumeHeader'), true)
t.equal(types.isName('Unsupported'), false)
