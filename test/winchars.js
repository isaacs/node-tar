import t from 'tap'
import * as wc from '../dist/esm/winchars.js'

t.equal(wc.encode('<>'), '\uf03c\uf03e', 'encode')
t.equal(wc.decode(wc.encode('<>')), '<>', 'decode')
t.equal(wc.decode(wc.encode('\\|<>?:')), '\\|<>?:', 'all chars')
