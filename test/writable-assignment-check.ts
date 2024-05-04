import { Unpack } from "../src/unpack.js";
import { WriteEntry } from "../src/write-entry.js";
import { Parser } from '../src/parse.js'
import { fileURLToPath } from 'url'

let tester: NodeJS.WritableStream
tester = new Parser()
tester = new Unpack()
tester = new WriteEntry(fileURLToPath(import.meta.url))

tester

import { pass } from 'tap'
pass(`just making sure TS doesn't complain`)
