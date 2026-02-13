import t from 'tap'
import { umask } from '../src/process-umask.js'
t.equal(umask(), process.umask())
