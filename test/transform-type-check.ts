import { Minipass } from 'minipass'
import { extract } from '../src/extract.js'
import { Unpack } from '../src/unpack.js'

// MiniPass stream return (issue #462)
const streamTransform = () => new Minipass({ async: true })
extract({ transform: streamTransform }, [])
new Unpack({ transform: streamTransform })

// entry / falsey return remains valid (issue #459)
extract({ transform: entry => entry }, [])
extract({ transform: () => undefined }, [])
extract({ transform: () => false }, [])

import { pass } from 'tap'
pass(`transform may return a stream or a falsey value`)
