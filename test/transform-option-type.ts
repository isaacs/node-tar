import { Minipass } from 'minipass'
import type { TarOptions } from '../src/options.js'

// A transform can return a stream other than the original ReadEntry.
const options: TarOptions = {
  transform: () => new Minipass<Buffer, Buffer>(),
}

options
