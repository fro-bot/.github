import {main} from '@fro-bot/ci-checks/mutation-shard-cli'

// `import.meta.main`, not a `file://${process.argv[1]}` comparison, which is false for a path with a space.
if (import.meta.main) {
  await main()
}
