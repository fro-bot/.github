import process from 'node:process'
import {runCliMain} from '../src/cli.ts'
import {fixtureConfig, type FixtureShape} from './cli-fixture-config.ts'

/**
 * The entrypoint the runner's spawned tests run, the way a workflow runs a `scripts/<name>.ts`:
 * `FIXTURE_SHAPE` picks the CLI. `FIXTURE_PRELOAD_GOKE=1` imports goke before the runner does, so
 * the runner's `NO_COLOR` cannot take effect and only its sink stripping is left.
 */
if (process.env.FIXTURE_PRELOAD_GOKE === '1') {
  const goke = await import('goke')
  if (process.env.FIXTURE_COLOUR_CONTROL === '1') process.stdout.write(goke.colors.red('control'))
}

await runCliMain(fixtureConfig((process.env.FIXTURE_SHAPE ?? 'dispatch') as FixtureShape))
