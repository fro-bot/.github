/**
 * Surface tier for the dispatch CLIs end to end: each test runs the real `scripts/<name>.ts` shim in a child
 * process, through the goke runner and the production CLI body with its default dependencies, against a fake
 * GitHub API (`@fro-bot/test-kit/fake-github`) that replaces `fetch` in the child. Nothing is mocked inside
 * the CLI, so a broken shim, runner config or default wiring fails here.
 */

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {createFakeGithub, route, type FakeGithub, type FakeRoute} from '@fro-bot/test-kit/fake-github'
import {spawnEntrypoint, type SpawnEntrypointResult} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..')

let root = ''
let fake: FakeGithub | undefined

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dispatch-flows-'))
})

afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})

afterEach(() => {
  fake?.cleanup()
  fake = undefined
})

function checkout(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(root, 'cwd-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), {recursive: true})
    writeFileSync(join(directory, path), content)
  }
  return directory
}

async function run(
  script: string,
  argv: readonly string[],
  routes: readonly FakeRoute[],
  options: {
    readonly cwd?: string
    readonly env?: Readonly<Record<string, string | undefined>>
    readonly githubOutput?: 'file' | 'unset' | 'empty'
  } = {},
): Promise<SpawnEntrypointResult> {
  const github = createFakeGithub(routes)
  fake = github
  return spawnEntrypoint({
    entrypoint: join(repoRoot, 'scripts', `${script}.ts`),
    runtime: 'bun',
    runtimeArgs: github.runtimeArgs('bun'),
    argv,
    cwd: options.cwd ?? checkout({}),
    githubOutput: options.githubOutput,
    env: {FAKE_GH_DIR: github.directory, ...options.env},
  })
}

/** Every request the run made, as logged (`METHOD /path?query auth=<token> body=<json>`), matched or not. */
function requests(): string[] {
  return (fake?.requests() ?? []).map(request => request.line)
}

function requestsTo(prefix: string): string[] {
  return requests().filter(line => line.startsWith(prefix))
}

function unhandledMutations(): string[] {
  return (fake?.unhandledMutations() ?? []).map(request => request.line)
}

describe('dispatch-renovate (bun, dispatch-renovate.yaml)', () => {
  const RENOVATE = 'version: 1\nrepositories:\n  with-renovate:\n    - agent\n    - dashboard\n    - stale-repo\n'
  const installation = route('GET', '/installation/repositories', {
    b: {
      total_count: 3,
      repositories: [
        {name: 'agent', owner: {login: 'fro-bot'}},
        {name: 'dashboard', owner: {login: 'fro-bot'}},
        {name: 'unrelated', owner: {login: 'fro-bot'}},
      ],
    },
  })
  const idle = route('GET', String.raw`~^/repos/fro-bot/[^/]+/actions/workflows/renovate\.yaml/runs$`, {
    b: {total_count: 0, workflow_runs: []},
  })
  const dispatchOk = route('POST', String.raw`~^/repos/fro-bot/[^/]+/actions/workflows/renovate\.yaml/dispatches$`, {
    s: 204,
  })

  it('`plan` writes the reachable repositories to $GITHUB_OUTPUT and dispatches nothing', async () => {
    const cwd = checkout({'metadata/renovate.yaml': RENOVATE})
    const result = await run('dispatch-renovate', ['plan'], [installation], {cwd, env: {GITHUB_TOKEN: 'tok-discovery'}})

    expect(result.exitCode).toBe(0)
    expect(result.githubOutput).toBe('repositories=agent,dashboard\n')
    expect(result.stdout).toBe('dispatch-renovate: planned 2 repositories\n')
    expect(requests()).toStrictEqual(['GET /installation/repositories auth=tok-discovery'])
  })

  it('`plan` throws without $GITHUB_OUTPUT, as the workflow step relies on', async () => {
    const cwd = checkout({'metadata/renovate.yaml': RENOVATE})
    const result = await run('dispatch-renovate', ['plan'], [installation], {
      cwd,
      env: {GITHUB_TOKEN: 'tok-discovery'},
      githubOutput: 'unset',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('GITHUB_OUTPUT is required in plan mode\n')
    expect(result.githubOutput).toBe('')
  })

  it('with no argument it dispatches each planned repository and prints the summary', async () => {
    const result = await run('dispatch-renovate', [], [idle, dispatchOk], {
      env: {GITHUB_TOKEN: 'tok-dispatch', DISPATCH_REPOSITORIES: 'agent,dashboard'},
    })

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toStrictEqual({eligible: 2, dispatched: 2, skippedRunning: 0, failed: 0})
    expect(requestsTo('POST ')).toHaveLength(2)
    expect(requests().every(line => line.includes('auth=tok-dispatch'))).toBe(true)
    expect(unhandledMutations()).toStrictEqual([])
  })

  it('a failed dispatch prints `dispatch-renovate: failed <name>: <error>` and the run still exits 0', async () => {
    const result = await run(
      'dispatch-renovate',
      [],
      [
        idle,
        route('POST', '/repos/fro-bot/dashboard/actions/workflows/renovate.yaml/dispatches', {
          s: 422,
          b: {message: 'Workflow does not have workflow_dispatch trigger'},
        }),
        dispatchOk,
      ],
      {env: {GITHUB_TOKEN: 'tok-dispatch', DISPATCH_REPOSITORIES: 'agent,dashboard'}},
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toMatch(/^dispatch-renovate: failed dashboard: .*workflow_dispatch trigger/mu)
    expect(JSON.parse(result.stdout)).toMatchObject({dispatched: 1, failed: 1})
  })

  it('without DISPATCH_REPOSITORIES it names the variable and exits 1 before any request', async () => {
    const result = await run('dispatch-renovate', [], [idle, dispatchOk], {env: {GITHUB_TOKEN: 'tok-dispatch'}})

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('DISPATCH_REPOSITORIES is required and must name at least one repository\n')
    expect(requests()).toStrictEqual([])
  })

  // Before the runner, anything but the exact `plan` dispatched, so a typo or `--help` wrote to every repository.
  it.each([[['pln']], [['Plan']], [['--help']], [['--bogus']], [['x']], [['plan', 'extra']], [['plan', '--help']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing planned or dispatched',
    async argv => {
      const result = await run('dispatch-renovate', argv, [installation, idle, dispatchOk], {
        cwd: checkout({'metadata/renovate.yaml': RENOVATE}),
        env: {GITHUB_TOKEN: 'tok', DISPATCH_REPOSITORIES: 'agent,dashboard'},
      })

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage:')
      expect(result.githubOutput).toBe('')
      expect(requests()).toStrictEqual([])
    },
  )
})

describe('the shim runs nothing on import', () => {
  it('importing scripts/dispatch-renovate.ts makes no request and sets no exit code', async () => {
    const github = createFakeGithub([])
    fake = github
    const harness = join(root, 'import-dispatch-renovate.ts')
    writeFileSync(
      harness,
      `await import(${JSON.stringify(join(repoRoot, 'scripts', 'dispatch-renovate.ts'))})\nprocess.stdout.write(String(process.exitCode))\n`,
    )
    const result = await spawnEntrypoint({
      entrypoint: harness,
      runtime: 'bun',
      runtimeArgs: github.runtimeArgs('bun'),
      env: {FAKE_GH_DIR: github.directory},
    })

    expect(result).toMatchObject({exitCode: 0, stdout: 'undefined', stderr: '', githubOutput: ''})
    expect(requests()).toStrictEqual([])
  })
})
