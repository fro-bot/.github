import {main} from '@fro-bot/ci-checks/check-mutation-guards-cli'

// Node's main-module check, not the `file://${process.argv[1]}` comparison the other entrypoints use: that
// comparison is false for a path the URL form escapes (a space, a non-ASCII character), and a false guard
// would end this gate in exit 0 without running it. `Test Scripts Load` imports every non-test
// scripts/*.ts, and an import-time Stryker spawn would make that job either run the mutation suite or fail.
if (import.meta.main) {
  await main()
}
