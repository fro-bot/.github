/**
 * Surface tier for the CLIs whose logic lives in `@fro-bot/core` and `@fro-bot/registry`: each runs
 * its real `scripts/<name>.ts` entrypoint in a child process, the way a workflow does, with a fake `gh`
 * first on `PATH` and no network. The assertions are what a step sees: the exit code, stdout, the
 * stderr prefix, and `$GITHUB_OUTPUT`.
 *
 * The in-process tests live beside the code in `packages/`. This file is the parity authority for the
 * shims, because a module that writes straight to `process.stdout` or `process.stderr` bypasses the
 * runner's sinks.
 */

import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import process from 'node:process'
import {spawnEntrypoint, type Runtime, type SpawnEntrypointResult} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..')

/** Serves the `gh` calls `check-wiki-authority` makes from `$FAKE_GH_DIR`, and logs each call. */
const FAKE_GH = String.raw`#!/usr/bin/env bash
d="\${FAKE_GH_DIR:?}"
printf '%s\n' "$*" >> "$d/calls.log"
case "$*" in
  "repo view"*) cat "$d/repo" ;;
  "api --paginate /repos/"*"/pulls/"*"/files"*) cat "$d/files.txt" ;;
  *) echo "fake gh: unhandled: $*" >&2; exit 1 ;;
esac
`.replaceAll(String.raw`\${`, '${')

let root = ''
let binDirectory = ''
let counter = 0

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'registry-entrypoints-'))
  binDirectory = join(root, 'bin')
  mkdirSync(binDirectory)
  writeFileSync(join(binDirectory, 'gh'), FAKE_GH)
  chmodSync(join(binDirectory, 'gh'), 0o755)
})

afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})

function scratch(name: string): string {
  counter += 1
  const directory = join(root, `${name}-${String(counter)}`)
  mkdirSync(directory, {recursive: true})
  return directory
}

function entrypoint(name: string): string {
  return join(repoRoot, 'scripts', `${name}.ts`)
}

async function run(
  name: string,
  options: {
    readonly runtime: Runtime
    readonly argv?: readonly string[]
    readonly env?: Readonly<Record<string, string | undefined>>
    readonly cwd?: string
  },
): Promise<SpawnEntrypointResult> {
  return spawnEntrypoint({
    entrypoint: entrypoint(name),
    cwd: options.cwd ?? repoRoot,
    ...options,
    env: {PATH: `${binDirectory}:${process.env.PATH ?? ''}`, ...options.env},
  })
}

function ghCalls(directory: string): string[] {
  const log = join(directory, 'calls.log')
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []
}

function writeEvent(payload: unknown): string {
  const path = join(scratch('event'), 'event.json')
  writeFileSync(path, JSON.stringify(payload))
  return path
}

function pullRequestEvent(author: string, headRef: string): unknown {
  return {
    pull_request: {
      number: 5,
      user: {login: author},
      head: {ref: headRef, repo: {full_name: 'fro-bot/.github'}},
      base: {repo: {full_name: 'fro-bot/.github'}},
    },
  }
}

function ghFixtures(files: string): string {
  const directory = scratch('gh')
  writeFileSync(join(directory, 'repo'), 'fro-bot/.github\n')
  writeFileSync(join(directory, 'files.txt'), files)
  return directory
}

describe('check-wiki-authority (bun, main.yaml: no argv)', () => {
  const check = async (directory: string, event: unknown, argv: string[] = []) =>
    run('check-wiki-authority', {
      runtime: 'bun',
      argv,
      env: {FAKE_GH_DIR: directory, GITHUB_EVENT_PATH: writeEvent(event)},
    })

  it('exits 0 and prints the ok summary for a PR that touches no Fro Bot-only path', async () => {
    const directory = ghFixtures('README.md\nscripts/x.ts\n')
    const result = await check(directory, pullRequestEvent('marcusrbrown', 'feat/x'))
    expect(result).toEqual({
      exitCode: 0,
      stdout: 'check-wiki-authority: ok (author=marcusrbrown, files_checked=2)\n',
      stderr: '',
      githubOutput: '',
    })
    expect(ghCalls(directory)).toEqual(['api --paginate /repos/fro-bot/.github/pulls/5/files --jq .[].filename'])
  })

  it('exits 1 and names the path when a human PR touches a Fro Bot-only path', async () => {
    const result = await check(ghFixtures('knowledge/wiki/repos/x.md\n'), pullRequestEvent('marcusrbrown', 'feat/x'))
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('knowledge/wiki/repos/x.md')
    expect(result.githubOutput).toBe('')
  })

  it('exits 1 with the GITHUB_EVENT_PATH diagnostic when the variable is unset', async () => {
    const result = await run('check-wiki-authority', {runtime: 'bun', env: {GITHUB_EVENT_PATH: undefined}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      'check-wiki-authority: GITHUB_EVENT_PATH not set. This script must run inside a GitHub Actions pull_request event.\n',
    )
  })

  it('exits 1 with the message when the event payload is malformed', async () => {
    const result = await check(ghFixtures(''), {pull_request: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(
      'check-wiki-authority: event payload missing pull_request.number or pull_request.user.login',
    )
  })

  it.each([[['--help']], [['--bogus']], [['stray']], [['--help=false']]])(
    '%j is a usage error and checks nothing',
    async argv => {
      const directory = ghFixtures('knowledge/wiki/repos/x.md\n')
      const result = await check(directory, pullRequestEvent('marcusrbrown', 'feat/x'), argv)
      expect(result.exitCode, JSON.stringify(argv)).toBe(1)
      expect(result.stdout, JSON.stringify(argv)).toBe('')
      expect(result.stderr, JSON.stringify(argv)).toContain('check-wiki-authority')
      expect(ghCalls(directory), JSON.stringify(argv)).toEqual([])
    },
  )
})

// The remaining shims fail closed before any network call when their inputs are missing, so the
// spawned runs below need no fake server: they pin the exit code, the stderr prefix a workflow greps
// for, and that argv which matches nothing declared stops before the CLI body runs.
const REPOS_FILE = `version: 1
repos:
  - owner: fro-bot
    name: dashboard
    added: 2026-06-15
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: true
    has_renovate: false
    discovery_channel: owned
    next_survey_eligible_at: null
    private: false
    node_id: R_kgDOPUBLIC1
`

const NO_TOKENS = {
  GITHUB_TOKEN: undefined,
  METADATA_WRITE_TOKEN: undefined,
  RENAME_WRITER_TOKEN: undefined,
  UPDATE_METADATA_DISCOVERY_TOKEN: undefined,
  UPDATE_METADATA_WRITER_TOKEN: undefined,
  GITHUB_REPOSITORY: undefined,
  TARGETS: undefined,
  NODE_ID: undefined,
}

function checkout(): string {
  const directory = scratch('onboarded')
  mkdirSync(join(directory, 'metadata'))
  writeFileSync(join(directory, 'metadata', 'repos.yaml'), REPOS_FILE)
  return directory
}

describe('check-repo-onboarded (bun, survey-repo.yaml: no argv)', () => {
  it('prints the verdict and appends onboarded=true for a public entry', async () => {
    const result = await run('check-repo-onboarded', {
      runtime: 'bun',
      cwd: checkout(),
      env: {REPO_OWNER: 'fro-bot', REPO_NAME: 'dashboard'},
    })
    expect(result).toEqual({
      exitCode: 0,
      stdout: '{"onboarded":true,"target":"fro-bot/dashboard"}\n',
      stderr: '',
      githubOutput: 'onboarded=true\n',
    })
  })

  it('appends onboarded=false, explains why on stderr and still exits 0 for a repo that is not listed', async () => {
    const result = await run('check-repo-onboarded', {
      runtime: 'bun',
      cwd: checkout(),
      env: {REPO_OWNER: 'fro-bot', REPO_NAME: 'ghost'},
    })
    expect(result.exitCode).toBe(0)
    expect(result.githubOutput).toBe('onboarded=false\n')
    expect(result.stderr).toBe('check-repo-onboarded: fro-bot/ghost has no public entry in metadata/repos.yaml\n')
  })
})

describe('the Octokit-backed shims fail closed on missing input', () => {
  const cases: {name: string; env: Record<string, string | undefined>; stderr: string | RegExp}[] = [
    {name: 'merge-back-data', env: {}, stderr: '::error::merge-back-data: MISSING_TOKEN\n'},
    {name: 'merge-data-pr', env: {}, stderr: /mergeDataPr requires params\.octokit or GITHUB_TOKEN/u},
    {
      name: 'rename-tracked-repo',
      env: {},
      stderr: '::error::rename-tracked-repo: INVALID_INPUT (field=node_id)\n',
    },
    {name: 'reset-survey-status', env: {}, stderr: 'reset-survey-status: TARGETS is required\n'},
    {
      name: 'record-survey-result',
      env: {REPO_OWNER: 'fro-bot', REPO_NAME: 'dashboard', SURVEY_STATUS: 'success', REPO_NODE_ID: undefined},
      stderr: 'record-survey-result: REPO_NODE_ID is required\n',
    },
    {name: 'update-metadata', env: {}, stderr: /UPDATE_METADATA_DISCOVERY_TOKEN/u},
  ]

  it.each(cases)('$name exits 1 with its stderr prefix and writes nothing to stdout', async ({name, env, stderr}) => {
    const result = await run(name, {runtime: 'bun', env: {...NO_TOKENS, ...env}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.githubOutput).toBe('')
    if (typeof stderr === 'string') expect(result.stderr).toBe(stderr)
    else expect(result.stderr).toMatch(stderr)
  })

  it('handle-invitation exits 1 when the poll token is missing', async () => {
    const directory = scratch('invitations')
    mkdirSync(join(directory, 'metadata'))
    writeFileSync(join(directory, 'metadata', 'repos.yaml'), REPOS_FILE)
    writeFileSync(join(directory, 'metadata', 'allowlist.yaml'), 'version: 1\napproved_inviters: []\n')
    const result = await run('handle-invitation', {runtime: 'bun', cwd: directory, env: NO_TOKENS})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.githubOutput).toBe('')
    expect(result.stderr).toContain('handleInvitations requires params.octokit or GITHUB_TOKEN')
  })
})

describe('argv that matches nothing declared stops before the CLI body runs', () => {
  const shims = [
    'check-repo-onboarded',
    'handle-invitation',
    'merge-back-data',
    'merge-data-pr',
    'record-survey-result',
    'rename-tracked-repo',
    'reset-survey-status',
    'update-metadata',
  ]
  const argvs = [['--help'], ['--bogus'], ['stray'], ['--help=false']]

  it.each(shims.flatMap(name => argvs.map(argv => [name, argv] as const)))(
    '%s %j is a usage error',
    async (name, argv) => {
      const result = await run(name, {runtime: 'bun', argv, env: NO_TOKENS})
      expect(result.exitCode, `${name} ${JSON.stringify(argv)}`).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.githubOutput).toBe('')
      expect(result.stderr).toContain(name)
      expect(result.stderr).not.toContain('MISSING_TOKEN')
      expect(result.stderr).not.toContain('is required')
    },
  )
})

describe('importing a shim runs nothing', () => {
  // The entry guard compares import.meta.url with process.argv[1]; an import from another module
  // (a test, Test Scripts Load) must not check, print, write $GITHUB_OUTPUT or set an exit code.
  const shims = [
    'check-repo-onboarded',
    'check-wiki-authority',
    'handle-invitation',
    'merge-back-data',
    'merge-data-pr',
    'record-survey-result',
    'rename-tracked-repo',
    'reset-survey-status',
    'update-metadata',
  ]

  it.each(shims)('scripts/%s.ts imported as a library does nothing', async name => {
    const directory = scratch('import-only')
    const outputPath = join(directory, 'github-output')
    const harness = join(directory, 'import-shim.ts')
    writeFileSync(
      harness,
      `import {pathToFileURL} from 'node:url'
await import(pathToFileURL(${JSON.stringify(entrypoint(name))}).href)
process.stdout.write('imported:' + String(process.exitCode ?? 'unset'))
`,
    )
    const result = await spawnEntrypoint({
      entrypoint: harness,
      runtime: 'node',
      cwd: directory,
      env: {PATH: `${binDirectory}:${process.env.PATH ?? ''}`, FAKE_GH_DIR: ghFixtures('')},
    })
    expect(result).toEqual({exitCode: 0, stdout: 'imported:unset', stderr: '', githubOutput: ''})
    expect(existsSync(outputPath)).toBe(false)
  })
})
