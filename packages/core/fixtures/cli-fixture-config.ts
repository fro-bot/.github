import {appendFileSync} from 'node:fs'
import process from 'node:process'
import {defineCommand, z, type CliConfig} from '../src/cli.ts'

/**
 * CLI shapes for the runner's spawned tests. Each is a stand-in for a family of real `scripts/`
 * entrypoints; `cli-fixture.ts` picks one by `FIXTURE_SHAPE`.
 */

export type FixtureShape = 'dispatch' | 'usage' | 'direct-write' | 'payload' | 'github-output' | 'exit-three' | 'limit'

const PAYLOAD_BYTES = 300_000

export function fixtureConfig(shape: FixtureShape): CliConfig {
  switch (shape) {
    case 'dispatch': {
      return {
        name: 'fixture',
        commands: [
          defineCommand({
            readOnly: false,
            action: context => {
              context.stdout('dispatched\n')
            },
          }),
          defineCommand({
            name: 'plan',
            readOnly: true,
            action: context => {
              context.stdout('planned\n')
            },
          }),
        ],
      }
    }
    case 'usage': {
      return {
        name: 'fixture',
        noArgv: 'usage',
        usageStream: 'stdout',
        helpCode: 0,
        commands: [
          defineCommand({
            readOnly: true,
            options: {branch: {flag: '--branch <ref>', schema: z.string().optional()}},
            action: context => {
              context.stdout(`branch=${context.options.branch ?? ''}\n`)
            },
          }),
        ],
      }
    }
    case 'direct-write': {
      return {
        name: 'fixture',
        commands: [
          defineCommand({
            readOnly: true,
            action: () => {
              process.stdout.write('direct\n')
            },
          }),
        ],
      }
    }
    case 'payload': {
      return {
        name: 'fixture',
        commands: [
          defineCommand({
            readOnly: true,
            action: () => {
              process.stdout.write('x'.repeat(PAYLOAD_BYTES))
            },
          }),
        ],
      }
    }
    case 'github-output': {
      return {
        name: 'fixture',
        commands: [
          defineCommand({
            readOnly: false,
            action: context => {
              appendFileSync(context.env.GITHUB_OUTPUT ?? '', 'scan_result=error\n')
              throw new Error('boom')
            },
          }),
        ],
      }
    }
    case 'exit-three': {
      return {name: 'fixture', commands: [defineCommand({readOnly: true, action: () => 3})]}
    }
    case 'limit': {
      return {
        name: 'fixture',
        commands: [
          defineCommand({
            readOnly: true,
            options: {limit: {flag: '--limit <n>', schema: z.number().int().min(1).optional()}},
            action: context => {
              context.stdout(`limit=${String(context.options.limit)}\n`)
            },
          }),
        ],
      }
    }
  }
}
