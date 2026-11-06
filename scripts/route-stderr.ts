import {main} from '@fro-bot/wiki-ops/route-stderr-cli'

// Node's main-module check, not the `file://${process.argv[1]}` comparison: that is false for a checkout path
// the URL form escapes (a space, `#`, `%`), and a false guard would exit 0 without running the wrapped command.
if (import.meta.main) {
  await main()
}
