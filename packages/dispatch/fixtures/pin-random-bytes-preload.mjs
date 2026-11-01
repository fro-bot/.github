// Bun preload for the dispatch flow tests: `randomBytes` returns `size` bytes of $PIN_RANDOM_BYTES_FILL
// (default 7), so the per-item nonce, and the correlation id and hashes derived from it, are known to the
// test that scripts the fake GitHub's marker answers. Bun reads a named import from the builtin's exports
// object, so assigning on the `require`d module reaches `import {randomBytes} from 'node:crypto'`.
import {Buffer} from 'node:buffer'
import {createRequire} from 'node:module'
import process from 'node:process'

const fill = Number(process.env.PIN_RANDOM_BYTES_FILL ?? '7')
const crypto = createRequire(import.meta.url)('node:crypto')
crypto.randomBytes = size => Buffer.alloc(size, fill)
