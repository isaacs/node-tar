/* IMPORTANT
 * This snapshot file is auto-generated, but designed for humans.
 * It should be checked into source control and tracked carefully.
 * Re-generate by setting TAP_SNAPSHOT=1 and running tests.
 * Make sure to inspect the output below.  Do not ignore changes!
 */
'use strict'
exports[`test/normalize-unicode.js TAP normalize with strip slashes "1/4foo.txt" > normalized 1`] = `
1/4foo.txt
`

exports[`test/normalize-unicode.js TAP normalize with strip slashes "\\\\a\\\\b\\\\c\\\\d\\\\" > normalized 1`] = `
/a/b/c/d
`

exports[`test/normalize-unicode.js TAP normalize with strip slashes "¼foo.txt" > normalized 1`] = `
¼foo.txt
`

exports[`test/normalize-unicode.js TAP normalize with strip slashes "﹨aaaa﹨dddd﹨" > normalized 1`] = `
﹨aaaa﹨dddd﹨
`

exports[`test/normalize-unicode.js TAP normalize with strip slashes "＼bbb＼eee＼" > normalized 1`] = `
＼bbb＼eee＼
`

exports[`test/normalize-unicode.js TAP normalize with strip slashes "＼＼＼＼＼eee＼＼＼＼＼＼" > normalized 1`] = `
＼＼＼＼＼eee＼＼＼＼＼＼
`
