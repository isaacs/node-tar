import { assert, test } from 'ubqtest'
import { stripTrailingSlashes } from '../src/strip-trailing-slashes.js'
test('strips trailing slashes from short and long strings', () => {
  const short = '///a///b///c///'
  const long = short.repeat(10) + '/'.repeat(1000000)

  assert.equal(stripTrailingSlashes('no slash'), 'no slash')
  assert.equal(stripTrailingSlashes(short), '///a///b///c')
  assert.equal(
    stripTrailingSlashes(long),
    short.repeat(9) + '///a///b///c',
  )
})
