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

describe('importing a shim runs nothing', () => {
  // The entry guard compares import.meta.url with process.argv[1]; an import from another module
  // (a test, Test Scripts Load) must not check, print, write $GITHUB_OUTPUT or set an exit code.
  const shims = ['check-wiki-authority']

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
