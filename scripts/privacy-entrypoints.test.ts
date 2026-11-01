/**
 * Surface tier for the four privacy CLIs: each runs its real `scripts/<name>.ts` entrypoint in a child
 * process, the way a workflow or an operator does, with a fake `gh` first on `PATH` and no network. The
 * assertions are what a step sees: the exit code, stdout, the stderr prefix, and `$GITHUB_OUTPUT`.
 *
 * The in-process tests live beside the code in `packages/privacy/src/`. This file is the parity
 * authority for the shims, because a module that writes straight to `process.stdout` or `process.stderr`
 * bypasses the runner's sinks.
 */

import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import process from 'node:process'
import {spawnEntrypoint, type Runtime, type SpawnEntrypointResult} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..')
const HEAD_SHA = 'a'.repeat(40)

/** Serves the GitHub responses a scan reads from `$FAKE_GH_DIR`, and logs each call. */
const FAKE_GH = String.raw`#!/usr/bin/env bash
d="\${FAKE_GH_DIR:?}"
printf '%s\n' "$*" >> "$d/calls.log"
case "$*" in
  "repo view"*) cat "$d/repo" ;;
  "api graphql"*)
    id=""
    for a in "$@"; do case "$a" in id=*) id="\${a#id=}" ;; esac; done
    if [ -f "$d/graphql-$id.json" ]; then cat "$d/graphql-$id.json"; elif [ -f "$d/graphql-default.json" ]; then cat "$d/graphql-default.json"; else echo "gh: boom (HTTP 500)" >&2; exit 1; fi ;;
  "api repos/{owner}/{repo}/pulls/"*) cat "$d/pr.json" ;;
  "api repos/{owner}/{repo}/commits/"*"/pulls"*) cat "$d/pulls-by-sha.json" ;;
  "api repos/"*"/branches/data"*) echo '{}' ;;
  "api repos/"*"/contents/metadata/repos.yaml?ref=data"*) cat "$d/content.b64" ;;
  "api repos/{owner}/{repo}/compare/"*"Accept: application/vnd.github.v3.diff"*) cat "$d/diff.txt" ;;
  "api repos/{owner}/{repo}/compare/"*) cat "$d/compare.json" ;;
  "api /repos/fro-bot/.github/actions/workflows/survey-repo.yaml/runs"*) cat "$d/runs.ndjson" 2>/dev/null || true ;;
  *) echo "fake gh: unhandled: $*" >&2; exit 1 ;;
esac
`.replaceAll(String.raw`\${`, '${')

const PRIVATE_NODE_ID = 'R_kgDOAAAAAA'
const PRIVATE_NAME = 'secret-owner/secret-repo'

const REPOS_WITH_PRIVATE = `version: 1
repos:
  - owner: fro-bot
    name: dashboard
    added: 2026-06-15
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: true
    has_renovate: false
    private: false
  - owner: '[REDACTED]'
    name: ${PRIVATE_NODE_ID}
    added: 2026-06-01
    onboarding_status: pending
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: true
    has_renovate: false
    private: true
    node_id: ${PRIVATE_NODE_ID}
`

const REPOS_PUBLIC_ONLY = `version: 1
repos:
  - owner: fro-bot
    name: dashboard
    added: 2026-06-15
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: true
    has_renovate: false
    private: false
`

let root = ''
let binDirectory = ''
let counter = 0

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'privacy-entrypoints-'))
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

/** A directory of fake `gh` responses for one run. */
function ghFixtures(overrides: Readonly<Record<string, string>> = {}): string {
  const directory = scratch('gh')
  const files: Record<string, string> = {
    repo: 'fro-bot/.github\n',
    'pr.json': JSON.stringify({
      number: 7,
      title: 'chore: tidy',
      user: {login: 'someone'},
      head: {sha: HEAD_SHA},
      base: {ref: 'main', repo: {full_name: 'fro-bot/.github'}},
    }),
    'pulls-by-sha.json': '[{"number":7}]',
    'compare.json': JSON.stringify({files: [{filename: 'a.md'}]}),
    'diff.txt': 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new line\n',
    'content.b64': Buffer.from(REPOS_WITH_PRIVATE).toString('base64'),
    'graphql-default.json': JSON.stringify({data: {node: {nameWithOwner: PRIVATE_NAME}}}),
    ...overrides,
  }
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content)
  return directory
}

function writeEvent(): string {
  const path = join(scratch('event'), 'event.json')
  writeFileSync(
    path,
    JSON.stringify({
      workflow_run: {event: 'pull_request', head_sha: HEAD_SHA, pull_requests: [{number: 7}]},
    }),
  )
  return path
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
    readonly runtimeArgs?: readonly string[]
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
  try {
    return execFileSync('cat', [join(directory, 'calls.log')], {encoding: 'utf8'})
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

describe('check-private-leak (node, check-private-leak.yaml: no argv)', () => {
  const scan = async (directory: string, env: Record<string, string | undefined> = {}, argv: string[] = []) =>
    run('check-private-leak', {
      runtime: 'node',
      argv,
      env: {FAKE_GH_DIR: directory, GITHUB_EVENT_PATH: writeEvent(), FRO_BOT_POLL_PAT: 'pat', ...env},
    })

  it('writes scan_result=success and exits 0 for a clean diff', async () => {
    const result = await scan(ghFixtures())
    expect(result).toEqual({
      exitCode: 0,
      stdout: 'check-private-leak: ok (scanned 1 private name(s))\n',
      stderr: '',
      githubOutput: 'scan_result=success\n',
    })
  })

  it('writes scan_result=detection and exits 1 when the diff names a private repo, without echoing the name', async () => {
    const result = await scan(
      ghFixtures({
        'diff.txt': `diff --git a/x.md b/x.md\n--- a/x.md\n+++ b/x.md\n@@ -1 +1 @@\n-a\n+see ${PRIVATE_NAME} here\n`,
      }),
    )
    expect(result.exitCode).toBe(1)
    expect(result.githubOutput).toBe('scan_result=detection\n')
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^check-private-leak: FAILED — private repository name\(s\) detected in PR diff\n/u)
    expect(result.stderr).toContain('  - x.md\n')
    expect(result.stderr).not.toContain(PRIVATE_NAME)
  })

  it('writes scan_result=success when the data branch lists no private entries', async () => {
    const result = await scan(ghFixtures({'content.b64': Buffer.from(REPOS_PUBLIC_ONLY).toString('base64')}))
    expect(result.exitCode).toBe(0)
    expect(result.githubOutput).toBe('scan_result=success\n')
    expect(result.stdout).toBe('check-private-leak: no private entries found in metadata/repos.yaml — skipping scan\n')
  })

  it.each([
    ['GITHUB_EVENT_PATH is unset', {GITHUB_EVENT_PATH: undefined}, 'check-private-leak: GITHUB_EVENT_PATH not set.'],
    ['FRO_BOT_POLL_PAT is unset', {FRO_BOT_POLL_PAT: undefined}, 'check-private-leak: FRO_BOT_POLL_PAT not set.'],
    ['the event file is missing', {GITHUB_EVENT_PATH: '/nonexistent/event.json'}, 'check-private-leak: ENOENT'],
  ])('writes scan_result=error and exits 1 when %s', async (_label, env, prefix) => {
    const result = await scan(ghFixtures(), env)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.githubOutput).toBe('scan_result=error\n')
    expect(result.stderr.startsWith(prefix)).toBe(true)
  })

  it('writes scan_result=error and exits 1 when a private node_id cannot be resolved', async () => {
    const directory = ghFixtures({'graphql-default.json': '{"data":{"node":null}}'})
    const result = await scan(directory)
    expect(result.exitCode).toBe(1)
    expect(result.githubOutput).toBe('scan_result=error\n')
    expect(result.stderr).toContain(`node_id=${PRIVATE_NODE_ID} access-lost`)
    expect(result.stderr).not.toContain(PRIVATE_NAME)
  })

  it('exits 1 with the error as the message and no scan_result when gh itself fails', async () => {
    const directory = ghFixtures()
    rmSync(join(directory, 'repo'))
    const result = await scan(directory)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Command failed: gh repo view')
  })

  it.each([['--help'], ['--bogus'], ['stray'], ['-h']])(
    '%s is a usage error: exit 1, scan_result=error, and gh is never called',
    async argv => {
      const directory = ghFixtures()
      const result = await scan(directory, {}, [argv])
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.githubOutput).toBe('scan_result=error\n')
      expect(result.stderr).toContain('check-private-leak')
      expect(result.stderr).toContain('--promotion')
      expect(ghCalls(directory)).toEqual([])
    },
  )
})

/** A repo whose `origin/data` differs from `origin/main` by one added line. */
function promotionCheckout(addedLine: string, reposYaml = REPOS_WITH_PRIVATE): string {
  const directory = scratch('promotion')
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: directory,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
      encoding: 'utf8',
    })
  git('init', '-q', '-b', 'main')
  git('config', 'commit.gpgsign', 'false')
  mkdirSync(join(directory, 'metadata'))
  writeFileSync(join(directory, 'metadata', 'repos.yaml'), reposYaml)
  writeFileSync(join(directory, 'README.md'), 'base\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  git('checkout', '-q', '-b', 'data')
  writeFileSync(join(directory, 'README.md'), `base\n${addedLine}\n`)
  git('add', '-A')
  git('commit', '-q', '-m', 'data')
  git('update-ref', 'refs/remotes/origin/data', 'HEAD')
  git('checkout', '-q', 'main')
  return directory
}

describe('check-private-leak --promotion (node, merge-data.yaml)', () => {
  const promote = async (cwd: string, env: Record<string, string | undefined> = {}, argv: string[] = ['--promotion']) =>
    run('check-private-leak', {
      runtime: 'node',
      argv,
      cwd,
      env: {FAKE_GH_DIR: ghFixtures(), FRO_BOT_POLL_PAT: 'pat', ...env},
    })

  it('exits 0 and writes no scan_result for a clean promotion diff', async () => {
    const result = await promote(promotionCheckout('plain note'))
    expect(result).toEqual({
      exitCode: 0,
      stdout: 'check-private-leak [promotion]: ok (scanned 1 private node_id(s))\n',
      stderr: '',
      githubOutput: '',
    })
  })

  it('exits 1 for a diff that names a private repo, listing the file with the name redacted', async () => {
    const result = await promote(promotionCheckout(`mentions ${PRIVATE_NAME}`))
    expect(result.exitCode).toBe(1)
    expect(result.githubOutput).toBe('')
    expect(result.stderr).toMatch(
      /^check-private-leak \[promotion\]: FAILED — private repository name\(s\) detected in promotion diff\n/u,
    )
    expect(result.stderr).toContain('  - README.md\n')
    expect(result.stderr).not.toContain(PRIVATE_NAME)
  })

  it('fails closed when FRO_BOT_POLL_PAT is unset', async () => {
    const result = await promote(promotionCheckout('plain note'), {FRO_BOT_POLL_PAT: undefined})
    expect(result.exitCode).toBe(1)
    expect(
      result.stderr.startsWith('check-private-leak: FRO_BOT_POLL_PAT not set. This is required for promotion mode'),
    ).toBe(true)
  })

  it('fails closed when PROMOTION_REPOS_YAML_PATH points at a missing file', async () => {
    const result = await promote(promotionCheckout('plain note'), {
      PROMOTION_REPOS_YAML_PATH: '/nonexistent/repos.yaml',
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(
      /^check-private-leak: could not read repos\.yaml at \/nonexistent\/repos\.yaml: ENOENT/u,
    )
  })

  it('fails closed when the private node_id cannot be resolved', async () => {
    const result = await promote(promotionCheckout('plain note'), {
      FAKE_GH_DIR: ghFixtures({'graphql-default.json': '{"data":{"node":null}}'}),
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('FAILED — could not resolve 1 private node_id(s)')
  })

  it.each([[['--promotion', '--bogus']], [['--promotion', 'stray']], [['--promotion', '--help']]])(
    '%j is a usage error: exit 1, scan_result=error, nothing scanned',
    async argv => {
      const directory = ghFixtures()
      const result = await promote(promotionCheckout('plain note'), {FAKE_GH_DIR: directory}, argv)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.githubOutput).toBe('scan_result=error\n')
      expect(ghCalls(directory)).toEqual([])
    },
  )
})

function wikiCheckout(extraPages: Readonly<Record<string, string>> = {}): {cwd: string; grandfather: string} {
  const base = scratch('wiki')
  const cwd = join(base, 'data-branch-check')
  const wikiDirectory = join(cwd, 'knowledge', 'wiki', 'repos')
  const grandfather = join(base, 'main-wiki')
  mkdirSync(join(cwd, 'metadata'), {recursive: true})
  mkdirSync(wikiDirectory, {recursive: true})
  mkdirSync(grandfather)
  writeFileSync(join(cwd, 'metadata', 'repos.yaml'), REPOS_PUBLIC_ONLY)
  const page = `---\ntype: repo\ntitle: fro-bot/dashboard\nsources:\n  - url: https://github.com/fro-bot/dashboard\n---\nbody\n`
  writeFileSync(join(wikiDirectory, 'fro-bot--dashboard.md'), page)
  for (const [name, content] of Object.entries(extraPages)) writeFileSync(join(wikiDirectory, name), content)
  return {cwd, grandfather}
}

describe('check-wiki-private-presence (bun, merge-data.yaml: --no-install --no-env-file from a foreign cwd)', () => {
  const check = async (
    cwd: string,
    env: Record<string, string | undefined>,
    argv: string[] = [],
    runtime: Runtime = 'bun',
  ) =>
    run('check-wiki-private-presence', {
      runtime,
      argv,
      cwd,
      runtimeArgs: runtime === 'bun' ? ['--no-install', '--no-env-file'] : [],
      env,
    })

  it('exits 0 and prints the clean message from a cwd outside the checkout', async () => {
    const {cwd, grandfather} = wikiCheckout()
    const result = await check(cwd, {GRANDFATHER_WIKI_REPOS_DIR: grandfather})
    expect(result).toEqual({exitCode: 0, stdout: 'no private wiki leaks detected\n', stderr: '', githubOutput: ''})
  })

  it('loads under Node too', async () => {
    const {cwd, grandfather} = wikiCheckout()
    const result = await check(cwd, {GRANDFATHER_WIKI_REPOS_DIR: grandfather}, [], 'node')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('no private wiki leaks detected\n')
  })

  it('exits 1 with a redacted report for a page that no public repo accounts for', async () => {
    const {cwd, grandfather} = wikiCheckout({'hidden-owner--hidden-repo.md': '---\ntype: repo\n---\nbody\n'})
    const result = await check(cwd, {GRANDFATHER_WIKI_REPOS_DIR: grandfather})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      [
        'check-wiki-private-presence: BLOCKED — unattributable wiki repo pages detected.',
        '  - leak-1: unattributable-page',
        '',
        'Leak count: 1',
        'Identifiers are redacted from this public log. To map them to repositories,',
        'run `bun scripts/resolve-private.ts` locally with operator credentials and',
        'inspect the data branch wiki pages directly.',
        '',
      ].join('\n'),
    )
    expect(result.stderr).not.toContain('hidden')
  })

  it('refuses --operator-report in CI with exit 2', async () => {
    const {cwd, grandfather} = wikiCheckout()
    const result = await check(cwd, {GRANDFATHER_WIKI_REPOS_DIR: grandfather, GITHUB_ACTIONS: 'true'}, [
      '--operator-report',
    ])
    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: 'check-wiki-private-presence: --operator-report is local-only; refusing to run in CI\n',
      githubOutput: '',
    })
  })

  it('exits 1 with the missing-variable message when GRANDFATHER_WIKI_REPOS_DIR is unset', async () => {
    const {cwd} = wikiCheckout()
    const result = await check(cwd, {})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('GRANDFATHER_WIKI_REPOS_DIR env var is required but not set.')
  })

  it.each([[['--help']], [['--bogus']], [['stray']]])('%j is a usage error and runs no detection', async argv => {
    const {cwd, grandfather} = wikiCheckout({'hidden-owner--hidden-repo.md': '---\ntype: repo\n---\nbody\n'})
    const result = await check(cwd, {GRANDFATHER_WIKI_REPOS_DIR: grandfather}, argv)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('check-wiki-private-presence')
    expect(result.stderr).not.toContain('BLOCKED')
  })
})

function enumerateCheckout(): string {
  const directory = scratch('enumerate')
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: directory,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
      encoding: 'utf8',
    })
  git('init', '-q', '-b', 'main')
  git('config', 'commit.gpgsign', 'false')
  mkdirSync(join(directory, 'metadata'))
  writeFileSync(join(directory, 'metadata', 'repos.yaml'), REPOS_WITH_PRIVATE)
  git('add', '-A')
  git('commit', '-q', '-m', `Onboard ${PRIVATE_NAME}`)
  return directory
}

describe('enumerate-existing-leaks (node, operator)', () => {
  const enumerate = async (argv: string[], cwd = enumerateCheckout()) =>
    run('enumerate-existing-leaks', {runtime: 'node', argv, cwd, env: {FAKE_GH_DIR: ghFixtures()}})

  it('prints the usage text on stdout and exits 1 with no argv', async () => {
    const result = await enumerate([])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('')
    expect(result.stdout.startsWith('Usage: bun scripts/enumerate-existing-leaks.ts --private <node_id>:')).toBe(true)
  })

  it('prints the same usage text on stdout and exits 0 for --help', async () => {
    const [help, none] = await Promise.all([enumerate(['--help']), enumerate([])])
    expect(help.exitCode).toBe(0)
    expect(help.stderr).toBe('')
    expect(help.stdout).toBe(none.stdout)
  })

  it('reports the surfaces that name a supplied private repo', async () => {
    const result = await enumerate(['--private', `${PRIVATE_NODE_ID}:${PRIVATE_NAME}`])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toMatch(/^Found \d+ leak surface\(s\):\n/u)
    expect(result.stdout).toContain(`commit subject names ${PRIVATE_NAME}`)
  })

  it('exits 1 with the no-mapping message when only --branch is given', async () => {
    const result = await enumerate(['--branch', 'origin/data'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('enumerate-existing-leaks: no --private mappings supplied\n')
  })

  it('exits 1 for an unknown flag, with the usage text on stdout', async () => {
    const result = await enumerate(['--bogus'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout.startsWith('Usage: bun scripts/enumerate-existing-leaks.ts')).toBe(true)
    expect(result.stderr).toContain('--bogus')
  })
})

function resolveCheckout(): string {
  const directory = scratch('resolve')
  mkdirSync(join(directory, 'metadata'))
  writeFileSync(join(directory, 'metadata', 'repos.yaml'), REPOS_WITH_PRIVATE)
  return directory
}

describe('resolve-private (bun, operator)', () => {
  const resolvePrivate = async (argv: string[], env: Record<string, string | undefined> = {GH_TOKEN: 'tok'}) =>
    run('resolve-private', {runtime: 'bun', argv, cwd: resolveCheckout(), env: {FAKE_GH_DIR: ghFixtures(), ...env}})

  it('prints the table for the repos path given', async () => {
    const result = await resolvePrivate(['metadata/repos.yaml'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(
      [
        `${'node_id'.padEnd(40)}  owner/name or status`,
        '-'.repeat(72),
        `${PRIVATE_NODE_ID.padEnd(40)}  ${PRIVATE_NAME}`,
        '',
      ].join('\n'),
    )
  })

  it('reads metadata/repos.yaml when no path is given', async () => {
    const [withPath, withoutPath] = await Promise.all([resolvePrivate(['metadata/repos.yaml']), resolvePrivate([])])
    expect(withoutPath.exitCode).toBe(0)
    expect(withoutPath.stdout).toBe(withPath.stdout)
  })

  it('exits 1 with the missing-token message before any gh call', async () => {
    const result = await resolvePrivate(['metadata/repos.yaml'], {GH_TOKEN: undefined})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      'resolve-private: GH_TOKEN is not set. Set GH_TOKEN to an operator PAT before running this script.\n',
    )
  })

  it('exits 1 with the read error for a missing file', async () => {
    const result = await resolvePrivate(['nope.yaml'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("ENOENT: no such file or directory, open 'nope.yaml'")
  })

  it.each([[['--help']], [['--bogus']], [['metadata/repos.yaml', 'extra']]])('%j is a usage error', async argv => {
    const result = await resolvePrivate(argv)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('resolve-private')
  })
})
