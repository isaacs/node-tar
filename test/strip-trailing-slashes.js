import t from 'tap'
import { stripTrailingSlashes } from '../dist/esm/strip-trailing-slashes.js'
const short = '///a///b///c///'
const long = short.repeat(10) + '/'.repeat(1000000)

t.equal(stripTrailingSlashes('no slash'), 'no slash')
t.equal(stripTrailingSlashes(short), '///a///b///c')
t.equal(stripTrailingSlashes(long), short.repeat(9) + '///a///b///c')
