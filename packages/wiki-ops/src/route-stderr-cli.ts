/**
 * The `scripts/route-stderr.ts` entrypoint on the goke runner. A workflow step wraps a command with it:
 *
 *     bun scripts/route-stderr.ts --route 'wiki-ingest:warning:=Wiki ingest warnings' --summary filtered \
 *       bun scripts/wiki-ingest.ts
 *
 * The router's own flags come first and the command is the trailing variadic positional, with no `--` (the runner
 * rejects one). The wrapped commands take no flags of their own. The runner reads the router's flags wherever they
 * appear, so `main` first refuses any dash-led token after the command (`hasFlagAfterCommand`, on the raw argv); a
 * caller that drives `routeStderrCli` through `runCli` directly does not get that check. Usage exits 1, so a
 * misconfigured step fails instead of skipping the command. It runs an arbitrary command, so it is not read-only.
 *
 * The command's stderr is replayed to the process stderr as bytes, not through the runner's sink: the sink strips
 * ANSI colour sequences, and a replay has to be verbatim. The command's stdout is inherited.
 */

import process from 'node:process'
import {defineCommand, runCliMain, z, type CliConfig} from '@fro-bot/core/cli'
import {
  hasFlagAfterCommand,
  parseRoute,
  RouteStderrUsageError,
  runRouteStderr,
  type RouteStderrPlan,
} from './route-stderr.ts'

export interface RouteStderrCliOptions {
  /** Where the command's stderr goes. Defaults to the process stderr. A test passes a collector. */
  readonly replay?: (stderr: Uint8Array) => void
}

/** Printed for `--help` and after a usage error; one complete example, then each part of the syntax. */
function usageText(): string {
  return `${[
    'Usage:',
    '  bun scripts/route-stderr.ts --route <prefix>=<heading> [--route ...] [--summary filtered|all] \\',
    '    [--conflict-exit <code> --conflict-output <name>] <command> [<argument> ...]',
    '',
    'Example:',
    "  bun scripts/route-stderr.ts --route 'wiki-ingest:warning:=Wiki ingest warnings' --summary filtered \\",
    '    --conflict-exit 3 --conflict-output conflict bun scripts/wiki-ingest.ts',
    '',
    'Runs the command with no shell, replays its stderr unchanged and returns its exit code.',
    '',
    '  --route <prefix>=<heading>   A stderr line that starts with <prefix> goes under "### <heading>" in the job',
    '                               summary. Repeat the flag for more routes. At least one is required.',
    '  --summary filtered|all       filtered (default): the matching lines as bullets, one section per route.',
    '                               all: the heading and the whole stderr; takes exactly one --route.',
    '  --conflict-exit <code>       Together with --conflict-output: on this exit code (1-255) append',
    '  --conflict-output <name>     <name>=true to $GITHUB_OUTPUT. The two flags go together.',
    '',
    "The command follows the router's flags with no `--` between them, and takes no flags of its own: a token",
    'that starts with a dash after the command is a usage error, and the command is not started.',
  ].join('\n')}\n`
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
    usageText: usageText(),
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
  // The runner reads the router's own flags wherever they appear, so a flag after the command is refused here,
  // on the raw argv, before the runner or the command sees it.
  if (hasFlagAfterCommand(process.argv.slice(2))) {
    process.stderr.write(
      "route-stderr: a flag after the command is not allowed: the command follows the router's flags and takes no flags of its own\n",
    )
    process.exitCode = 1
    return
  }
  await runCliMain(routeStderrCli())
}
