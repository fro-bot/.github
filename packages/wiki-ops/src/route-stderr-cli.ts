/**
 * The `scripts/route-stderr.ts` entrypoint on the goke runner. A workflow step wraps a command with it:
 *
 *     bun scripts/route-stderr.ts --route 'wiki-ingest:warning:=Wiki ingest warnings' --summary filtered \
 *       bun scripts/wiki-ingest.ts
 *
 * The router's own flags come first and the command is the trailing variadic positional, with no `--` (the runner
 * rejects one). The wrapped commands take no flags of their own: an unknown flag anywhere is a usage error, and the
 * router's flags are read wherever they appear. Usage exits 1, so a misconfigured step fails instead of skipping the
 * command. It runs an arbitrary command, so it is not read-only.
 *
 * The command's stderr is replayed to the process stderr as bytes, not through the runner's sink: the sink strips
 * ANSI colour sequences, and a replay has to be verbatim. The command's stdout is inherited.
 */

import process from 'node:process'
import {defineCommand, runCliMain, z, type CliConfig} from '@fro-bot/core/cli'
import {parseRoute, RouteStderrUsageError, runRouteStderr, type RouteStderrPlan} from './route-stderr.ts'

export interface RouteStderrCliOptions {
  /** Where the command's stderr goes. Defaults to the process stderr. A test passes a collector. */
  readonly replay?: (stderr: Uint8Array) => void
}

function formatRouteStderrError(error: unknown): string {
  return `route-stderr: ${error instanceof Error ? error.message : String(error)}\n`
}

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function routeStderrCli(options: RouteStderrCliOptions = {}): CliConfig {
  const replay = options.replay ?? (stderr => process.stderr.write(stderr))
  return {
    name: 'route-stderr',
    errorFormat: formatRouteStderrError,
    commands: [
      defineCommand({
        readOnly: false,
        positionals: [{name: 'command', kind: 'variadic'}],
        options: {
          route: {flag: '--route <prefix=heading>', schema: z.union([z.string(), z.array(z.string())]).optional()},
          summary: {flag: '--summary <mode>', schema: z.enum(['filtered', 'all']).default('filtered')},
          conflictExit: {flag: '--conflict-exit <code>', schema: z.number().int().min(1).max(255).optional()},
          conflictOutput: {flag: '--conflict-output <name>', schema: z.string().min(1).optional()},
        },
        action: async context => {
          const {route, summary, conflictExit, conflictOutput} = context.options
          if ((conflictExit === undefined) !== (conflictOutput === undefined)) {
            throw new RouteStderrUsageError('--conflict-exit and --conflict-output go together')
          }
          const specs = typeof route === 'string' ? [route] : (route ?? [])
          const plan: RouteStderrPlan = {
            routes: specs.map(parseRoute),
            summary,
            conflict:
              conflictExit === undefined || conflictOutput === undefined
                ? undefined
                : {exitCode: conflictExit, output: conflictOutput},
            // A variadic positional is always an array.
            command: context.positionals.command as readonly string[],
          }
          return runRouteStderr(plan, {env: context.env, replay})
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(routeStderrCli())
}
