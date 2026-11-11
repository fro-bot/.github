import {main} from '@fro-bot/registry/renovate-approve-cli'

// Node's main-module check, not the `file://${process.argv[1]}` comparison the other entrypoints use: that
// comparison is false for a checkout path the URL form escapes (a space, `#`, `%`), and a false guard would
// end the sweep step in exit 0 without running it.
if (import.meta.main) {
  await main()
}
