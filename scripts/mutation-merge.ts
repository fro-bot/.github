import {main} from '@fro-bot/ci-checks/mutation-merge-cli'

// Node's main-module check, not the `file://${process.argv[1]}` comparison: that comparison is false for a path the URL
// form escapes (a space, a non-ASCII character), and a false guard would end the final job in exit 0 without running.
// `Test Scripts Load` imports every non-test scripts/*.ts, and an import-time merge would read the environment.
if (import.meta.main) {
  await main()
}
