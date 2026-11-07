import {main} from './wiki-lockfile-gates-core.ts'

// Node's main-module check, not the `file://${process.argv[1]}` comparison: that is false for a checkout path
// the URL form escapes (a space, `#`, `%`), and a false guard would exit 0 without running the gate. The gate
// logic lives in `wiki-lockfile-gates-core.ts`, a relative sibling import and not an `@fro-bot/*` package:
// `publish-wiki.yaml` runs this file with `bun --no-install` before any dependencies are installed.
if (import.meta.main) {
  await main()
}
