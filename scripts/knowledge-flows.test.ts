/**
 * Surface tier for the `@fro-bot/knowledge` CLIs end to end: each test runs the real `scripts/<name>.ts`
 * shim in a child process under Bun, the callers' runtime, through the goke runner and the production
 * module with its default dependencies, against the fake GitHub API. Nothing inside the CLI is mocked, so
 * a broken shim, runner config, env wiring or output path fails here.
 *
 * The workflows read these from the CLIs: the harvest digest files and `.telemetry.*` stdout keys
 * (`capture-learnings.yaml`), the detect and open result keys (`capture-patterns.yaml`), the learnings
 * result file, `has_work`, `draft_base_sha` and `main_sha` (`draft-solutions.yaml` job outputs and job
 * ifs), the handoff artifact and `changed=`, and the publish result file's `.mode` and `.prNumber`. The
 * drafting agent reads the exact stdout, stderr and exit code of `drafted-solutions-validate-rows`. The
 * tests pin each of those, the `| tee` exit code under `pipefail`, and the usage code of every CLI.
 *
 * Every test runs in a test-owned temp checkout that is both the working directory and the target of
 * every write. The last test checks the real checkout is untouched, with a positive control that proves
 * the check can see a write.
 */

import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, relative, resolve} from 'node:path'
import process from 'node:process'
import {createFakeGithub, route, type FakeGithub, type FakeRoute} from '@fro-bot/test-kit/fake-github'
import {spawnEntrypoint, type SpawnEntrypointResult} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..')

let root = ''
let fake: FakeGithub | undefined

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'knowledge-flows-'))
})

afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})

afterEach(() => {
  fake?.cleanup()
  fake = undefined
})

/** The real checkout, listed before any test runs: the final test compares it with the tree after every flow. */
const realCheckoutBefore = snapshotTree(repoRoot, ['docs/solutions', 'metadata', '.drafted-solutions', 'knowledge'])

/** A map of every file under `paths` (relative to `base`) to its digest. A missing path contributes nothing. */
function snapshotTree(base: string, paths: readonly string[]): Map<string, string> {
  const files = new Map<string, string>()
  const visit = (absolute: string): void => {
    if (!existsSync(absolute)) return
    for (const entry of readdirSync(absolute, {withFileTypes: true})) {
      const child = join(absolute, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile()) {
        files.set(relative(base, child), createHash('sha256').update(readFileSync(child)).digest('hex'))
      }
    }
  }
  for (const path of paths) visit(join(base, path))
  return files
}

/** A test-owned directory holding `files`. */
function checkout(files: Readonly<Record<string, string>> = {}): string {
  const directory = mkdtempSync(join(root, 'cwd-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), {recursive: true})
    writeFileSync(join(directory, path), content)
  }
  return directory
}

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    {cwd, stdio: 'ignore'},
  )
}

interface RunOptions {
  readonly argv?: readonly string[]
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly cwd?: string
  readonly githubOutput?: 'file' | 'unset' | 'empty'
  readonly routes?: readonly FakeRoute[]
}

async function run(script: string, options: RunOptions = {}): Promise<SpawnEntrypointResult> {
  const github = options.routes === undefined ? undefined : createFakeGithub(options.routes)
  fake = github ?? fake
  return spawnEntrypoint({
    entrypoint: resolve(repoRoot, 'scripts', `${script}.ts`),
    runtime: 'bun',
    runtimeArgs: github === undefined ? ['--no-install', '--no-env-file'] : github.runtimeArgs('bun'),
    argv: options.argv,
    cwd: options.cwd ?? checkout(),
    env: {...(github === undefined ? {} : {FAKE_GH_DIR: github.directory}), ...options.env},
    githubOutput: options.githubOutput,
  })
}

/** Reads `$GITHUB_OUTPUT` the way the runner does: `name=value` lines. */
function parseOutputs(text: string): Record<string, string> {
  const outputs: Record<string, string> = {}
  for (const line of text.split('\n')) {
    if (line === '') continue
    const equals = line.indexOf('=')
    outputs[line.slice(0, equals)] = line.slice(equals + 1)
  }
  return outputs
}

function unhandledMutations(): string[] {
  return (fake?.unhandledMutations() ?? []).map(request => request.line)
}

function requests(): string[] {
  return (fake?.requests() ?? []).map(request => request.line)
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

const REPOS_YAML = `version: 1
repos:
  - owner: acme
    name: widgets
    added: 2026-04-17
    onboarding_status: onboarded
    last_survey_at: 2026-10-20
    last_survey_status: success
    has_fro_bot_workflow: false
    has_renovate: true
    next_survey_eligible_at: 2026-11-19
    discovery_channel: collab
    private: false
    node_id: R_kgDOAAAAAA
    database_id: 100
  - owner: secretco
    name: vault
    added: 2026-04-17
    onboarding_status: onboarded
    last_survey_at: 2026-10-20
    last_survey_status: success
    has_fro_bot_workflow: false
    has_renovate: false
    next_survey_eligible_at: 2026-11-19
    discovery_channel: collab
    private: true
    node_id: R_kgDOCCCCCC
    database_id: 987654
`

const BASE = '/repos/fro-bot/.github'
const SHA_A = 'a1'.repeat(20)
const SHA_B = 'b2'.repeat(20)
const SHA_MAIN = '1'.repeat(40)
const BOT = 'fro-bot[bot]'

const DOC = (title: string, tags: string[], problemType: string) =>
  `---\ntitle: ${title}\nmodule: ci/workflows\ndate: 2026-09-01\nproblem_type: ${problemType}\ntags: [${tags.join(', ')}]\n---\n\n# ${title}\n`

const HARVEST_KEYS = [
  'closedPrsFetched',
  'mergedPrsInLookback',
  'excludedAutomation',
  'multiRoundCandidates',
  'ciFixPrsExamined',
  'ciFixCandidates',
  'afterSeenDedup',
  'afterSolutionsDedup',
  'emitted',
  'dualTriggerCandidates',
  'enrichmentBlocked',
  'enrichmentBlockedBySecret',
]

// ---------------------------------------------------------------------------------------------------------------
// capture-learnings-harvest
// ---------------------------------------------------------------------------------------------------------------
describe('capture-learnings-harvest through scripts/capture-learnings-harvest.ts', () => {
  const emptyRepo = [
    route('GET', `${BASE}/pulls`, {b: []}),
    route('GET', `${BASE}/issues`, {b: []}),
    route('GET', `${BASE}/branches/main/protection`, {s: 404, b: {message: 'Not Found'}}),
  ]

  it('prints the digest with the twelve telemetry keys and writes the same bytes to the digest file', async () => {
    const cwd = checkout({'metadata/repos.yaml': REPOS_YAML})
    const digestPath = join(cwd, 'out', 'capture-learnings-digest.json')
    mkdirSync(dirname(digestPath))
    const result = await run('capture-learnings-harvest', {
      cwd,
      routes: emptyRepo,
      env: {GITHUB_TOKEN: 'tok', CAPTURE_LEARNINGS_DIGEST_PATH: digestPath},
    })
    expect(result.exitCode).toBe(0)
    const digest = JSON.parse(result.stdout) as {candidates: unknown[]; telemetry: Record<string, number>}
    expect(digest.candidates).toEqual([])
    expect(Object.keys(digest.telemetry)).toEqual(HARVEST_KEYS)
    expect(readFileSync(digestPath, 'utf8')).toBe(result.stdout)
    expect(result.stderr).toContain('capture-learnings-privacy: loaded private token set')
    expect(unhandledMutations()).toEqual([])
  })

  describe('when the private-token load fails', () => {
    // A CI-fix candidate: PR 102 merged after its check "CHECK" failed and then passed. Its check name could
    // carry a private identifier, and the scan that would catch it needs the very file that failed to load.
    const CHECK = 'synthetic-private-name-lint'
    const FAILING = 'f1'.repeat(20)
    const PASSING = 'e5'.repeat(20)

    /** A `gh` on PATH that answers the GraphQL rollup query: the fake GitHub fetch never sees a child process. */
    function fakeGh(directory: string): string {
      const bin = join(directory, 'bin')
      mkdirSync(bin)
      const rollup = {
        data: {
          repository: {
            pullRequest: {
              commits: {
                pageInfo: {hasNextPage: false, endCursor: null},
                nodes: [
                  {
                    commit: {
                      oid: FAILING,
                      statusCheckRollup: {
                        contexts: {nodes: [{__typename: 'CheckRun', name: CHECK, conclusion: 'FAILURE'}]},
                      },
                    },
                  },
                  {
                    commit: {
                      oid: PASSING,
                      statusCheckRollup: {
                        contexts: {nodes: [{__typename: 'CheckRun', name: CHECK, conclusion: 'SUCCESS'}]},
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      }
      writeFileSync(
        join(bin, 'gh'),
        `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(rollup))})\n`,
        {mode: 0o755},
      )
      return bin
    }

    const ciFixRoutes = [
      route('GET', `${BASE}/pulls`, {
        b: [
          {
            number: 102,
            title: 'Fix flaky lint step',
            merged_at: '2026-10-22T10:00:00Z',
            merge_commit_sha: SHA_B,
            labels: [],
            user: {login: 'marcusrbrown'},
            state: 'closed',
          },
        ],
      }),
      route('GET', `${BASE}/pulls/102/reviews`, {b: []}),
      route('GET', `${BASE}/issues`, {b: []}),
      route('GET', `${BASE}/branches/main/protection`, {s: 404, b: {message: 'Not Found'}}),
      route('GET', `~^${BASE}/compare/`, {b: {files: [{filename: 'src/lint.ts', patch: '@@ -1 +1 @@\n-a\n+b\n'}]}}),
    ]

    async function harvest(files: Record<string, string>) {
      const cwd = checkout(files)
      const digestPath = join(cwd, 'out', 'capture-learnings-digest.json')
      mkdirSync(dirname(digestPath))
      const result = await run('capture-learnings-harvest', {
        cwd,
        routes: ciFixRoutes,
        env: {
          GITHUB_TOKEN: 'tok',
          CAPTURE_LEARNINGS_DIGEST_PATH: digestPath,
          PATH: `${fakeGh(cwd)}:${process.env.PATH ?? ''}`,
        },
      })
      return {result, digest: readFileSync(digestPath, 'utf8')}
    }

    it('positive control: with the token set loaded, the CI-fix candidate carries its check name', async () => {
      const {result, digest} = await harvest({'metadata/repos.yaml': REPOS_YAML})
      expect(result.exitCode).toBe(0)
      const candidates = (JSON.parse(result.stdout) as {candidates: {trigger: string; failingCheckName?: string}[]})
        .candidates
      expect(candidates.map(candidate => candidate.trigger)).toEqual(['ci-fail-then-pass'])
      expect(candidates[0]?.failingCheckName).toBe(CHECK)
      expect(digest).toBe(result.stdout)
    })

    it('the digest file and stdout carry the fixed marker and never the check name', async () => {
      const {result, digest} = await harvest({})
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('private token load failed')
      const candidates = (
        JSON.parse(result.stdout) as {candidates: {trigger: string; failingCheckName?: string; diffExcerpt?: string}[]}
      ).candidates
      // The candidate is still emitted (title-only), so the check above could have failed on the name alone.
      expect(candidates).toHaveLength(1)
      expect(candidates[0]).toMatchObject({
        trigger: 'ci-fail-then-pass',
        failingCheckName: '[REDACTED]',
        diffExcerpt: '',
      })
      expect(result.stdout).not.toContain(CHECK)
      expect(digest).not.toContain(CHECK)
      expect(digest).toBe(result.stdout)
    })
  })

  it('without a token still exits 0 with an empty digest, so the workflow summary has something to read', async () => {
    const cwd = checkout()
    const digestPath = join(cwd, 'digest.json')
    const result = await run('capture-learnings-harvest', {cwd, env: {CAPTURE_LEARNINGS_DIGEST_PATH: digestPath}})
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('capture-learnings-harvest: unexpected error (Error), falling back to empty digest')
    expect((JSON.parse(readFileSync(digestPath, 'utf8')) as {candidates: unknown[]}).candidates).toEqual([])
  })

  it('is a usage error for argv no caller sends: exit 1, usage on stderr, no API call, no digest', async () => {
    const cwd = checkout({'metadata/repos.yaml': REPOS_YAML})
    const digestPath = join(cwd, 'digest.json')
    for (const argv of [['--help'], ['--help=false'], ['--bogus'], ['stray']]) {
      const result = await run('capture-learnings-harvest', {
        cwd,
        argv,
        routes: emptyRepo,
        env: {GITHUB_TOKEN: 'tok', CAPTURE_LEARNINGS_DIGEST_PATH: digestPath},
      })
      expect(result.exitCode, argv.join(' ')).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(requests()).toEqual([])
    }
    expect(existsSync(digestPath)).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// capture-learnings-open
// ---------------------------------------------------------------------------------------------------------------
describe('capture-learnings-open through scripts/capture-learnings-open.ts', () => {
  const candidate = (sha: string) => ({
    trigger: 'review-heavy',
    mergeSha: sha,
    reviewRounds: 2,
    signals: {titleTokens: ['retry'], labels: []},
    reviewExcerpts: [],
  })

  function openFixture(bodies: Record<string, string>) {
    const telemetry = Object.fromEntries(HARVEST_KEYS.map(key => [key, 0]))
    const cwd = checkout({
      'metadata/repos.yaml': REPOS_YAML,
      'in/digest.json': JSON.stringify({
        candidates: [candidate(SHA_A), candidate(SHA_B)],
        telemetry: {...telemetry, multiRoundCandidates: 2},
      }),
      'in/bodies.json': JSON.stringify(bodies),
    })
    return {
      cwd,
      resultPath: join(cwd, 'out', 'capture-learnings-result.json'),
      env: {
        GITHUB_TOKEN: 'tok',
        CAPTURE_LEARNINGS_DIGEST_PATH: join(cwd, 'in', 'digest.json'),
        CAPTURE_LEARNINGS_BODIES_PATH: join(cwd, 'in', 'bodies.json'),
        CAPTURE_LEARNINGS_RESULT_PATH: join(cwd, 'out', 'capture-learnings-result.json'),
      },
    }
  }

  const routes = [
    route('GET', `${BASE}/labels/learning-proposal`, {b: {name: 'learning-proposal'}}),
    route('POST', `${BASE}/issues`, {s: 201, b: {number: 301}}),
  ]

  it('opens an issue per clean body and writes the four result keys the summary reads', async () => {
    const {cwd, resultPath, env} = openFixture({[SHA_A]: 'Back off on retries.\n', [SHA_B]: 'Fix the lint ordering.\n'})
    mkdirSync(dirname(resultPath))
    const result = await run('capture-learnings-open', {cwd, routes, env})
    expect(result.exitCode).toBe(0)
    const written = JSON.parse(readFileSync(resultPath, 'utf8')) as Record<string, number>
    expect(readFileSync(resultPath, 'utf8')).toBe(result.stdout)
    expect(written).toMatchObject({learningsOpened: 2, blockedOnPrivacy: 0, skippedDuplicate: 0, failed: 0})
    expect(requests().filter(line => line.startsWith('POST'))).toHaveLength(2)
    expect(unhandledMutations()).toEqual([])
    // The privacy token set is read from the test checkout, never from this repository.
    expect(result.stderr).toContain('private-repo count=1')
  })

  it('blocks a body that names a private repository and opens only the clean one', async () => {
    const {cwd, resultPath, env} = openFixture({[SHA_A]: 'Copy secretco/vault.\n', [SHA_B]: 'Fix the lint ordering.\n'})
    mkdirSync(dirname(resultPath))
    const result = await run('capture-learnings-open', {cwd, routes, env})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({learningsOpened: 1, blockedOnPrivacy: 1})
    const posts = (fake?.requests() ?? []).filter(request => request.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.line).not.toContain('secretco')
  })

  it('fails closed when metadata/repos.yaml cannot be read: exit 1, a message, no label call, no issue', async () => {
    const {cwd, env} = openFixture({[SHA_A]: 'x\n'})
    rmSync(join(cwd, 'metadata'), {recursive: true})
    const result = await run('capture-learnings-open', {cwd, routes, env})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('privacy gate cannot operate')
    expect(requests()).toEqual([])
  })

  it('reports a missing input as a message-only error', async () => {
    const result = await run('capture-learnings-open', {env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('capture-learnings-open: CAPTURE_LEARNINGS_DIGEST_PATH is required\n')
  })

  it('is a usage error for argv no caller sends and opens nothing', async () => {
    const {cwd, resultPath, env} = openFixture({[SHA_A]: 'x\n'})
    for (const argv of [['--help'], ['--help=false'], ['--bogus'], ['stray']]) {
      const result = await run('capture-learnings-open', {cwd, argv, routes, env})
      expect(result.exitCode, argv.join(' ')).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(requests()).toEqual([])
    }
    expect(existsSync(resultPath)).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// capture-patterns-cluster and capture-patterns-open
// ---------------------------------------------------------------------------------------------------------------
const DETECT_KEYS = [
  'sourcesLoaded',
  'invalidSources',
  'candidatesScanned',
  'lowSignalSkipped',
  'duplicateOpenOverlap',
  'hardSuppressed',
  'softSuppressed',
  'unsafe',
  'capped',
  'candidatesEmitted',
  'tokenLoadFailure',
  'scanFailure',
  'qualitySuppressed',
]

const OPEN_KEYS = [
  'candidatesExamined',
  'drafted',
  'agentSkipped',
  'missingBody',
  'invalidBody',
  'blockedOnPrivacy',
  'skippedDuplicateSameRun',
  'skippedDuplicateExisting',
  'proposalsOpened',
  'failed',
  'skippedLabelUnavailable',
  'skippedOverCap',
  'tokenLoadFailed',
  'bodyFileReadFailed',
]

const PATTERN_DOCS = {
  'docs/solutions/best-practices/pin-workflow-actions-2026-09-01.md': DOC(
    'Pin workflow actions by digest',
    ['actions', 'pinning'],
    'best_practice',
  ),
  'docs/solutions/best-practices/pin-container-images-2026-09-02.md': DOC(
    'Pin container images by digest',
    ['actions', 'pinning'],
    'best_practice',
  ),
}

const patternRoutes = (open: unknown[] = []) => [
  route('GET', `${BASE}/issues`, {q: 'labels=learning-proposal', b: []}),
  route('GET', `${BASE}/issues`, {q: 'labels=pattern-proposal&state=open', b: open}),
  route('GET', `${BASE}/issues`, {q: 'labels=pattern-proposal&state=closed', b: []}),
]

describe('capture-patterns-cluster through scripts/capture-patterns-cluster.ts', () => {
  it('writes the digest file and prints the thirteen result keys the detect summary reads', async () => {
    const cwd = checkout({'metadata/repos.yaml': REPOS_YAML, ...PATTERN_DOCS})
    const digestPath = join(cwd, 'out', 'capture-patterns-digest.json')
    mkdirSync(dirname(digestPath))
    const result = await run('capture-patterns-cluster', {
      cwd,
      routes: patternRoutes(),
      env: {GITHUB_TOKEN: 'tok', GITHUB_SHA: SHA_MAIN, CAPTURE_PATTERNS_DIGEST_PATH: digestPath},
    })
    expect(result.exitCode).toBe(0)
    const summary = JSON.parse(result.stdout) as Record<string, unknown>
    expect(Object.keys(summary).toSorted()).toEqual([...DETECT_KEYS].toSorted())
    expect(summary).toMatchObject({sourcesLoaded: 2, candidatesEmitted: 1, tokenLoadFailure: false, scanFailure: false})
    const digest = JSON.parse(readFileSync(digestPath, 'utf8')) as {sourceIds: string[]; sourceLinks: string[]}[]
    expect(digest).toHaveLength(1)
    expect(digest[0]?.sourceIds).toEqual(['pin-container-images-2026-09-02', 'pin-workflow-actions-2026-09-01'])
    // Source links are SHA-pinned to the checked-out head.
    expect(digest[0]?.sourceLinks.every(link => link.includes(SHA_MAIN))).toBe(true)
    expect(unhandledMutations()).toEqual([])
  })

  it('writes an empty digest and flags the token-load failure without any API call when metadata is missing', async () => {
    const cwd = checkout(PATTERN_DOCS)
    const digestPath = join(cwd, 'digest.json')
    const result = await run('capture-patterns-cluster', {
      cwd,
      routes: patternRoutes(),
      env: {GITHUB_TOKEN: 'tok', CAPTURE_PATTERNS_DIGEST_PATH: digestPath},
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({tokenLoadFailure: true, scanFailure: false, candidatesEmitted: 0})
    expect(readFileSync(digestPath, 'utf8')).toBe('[]\n')
    expect(requests()).toEqual([])
  })

  it('is a usage error for argv no caller sends and writes no digest', async () => {
    const cwd = checkout({'metadata/repos.yaml': REPOS_YAML, ...PATTERN_DOCS})
    const digestPath = join(cwd, 'digest.json')
    for (const argv of [['--help'], ['--help=false'], ['--bogus'], ['stray']]) {
      const result = await run('capture-patterns-cluster', {
        cwd,
        argv,
        routes: patternRoutes(),
        env: {GITHUB_TOKEN: 'tok', CAPTURE_PATTERNS_DIGEST_PATH: digestPath},
      })
      expect(result.exitCode, argv.join(' ')).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(requests()).toEqual([])
    }
    expect(existsSync(digestPath)).toBe(false)
  })
})

describe('capture-patterns-open through scripts/capture-patterns-open.ts', () => {
  const FINGERPRINT = 'f'.repeat(64)
  const digestEntry = {
    fingerprint: FINGERPRINT,
    sourceIds: ['a-doc', 'b-doc'],
    sourceLinks: ['https://example.invalid/a', 'https://example.invalid/b'],
    sourceTitles: ['A', 'B'],
    evidenceCount: 2,
    scoreBucket: 'strong',
    suggestedNextAction: 'draft-proposal',
    runCount: 1,
  }
  const drafted = (statement: string) => ({
    outcome: 'drafted',
    patternStatement: statement,
    rationale: 'Digest pins stop silent drift.',
    sourceReferences: ['https://example.invalid/a'],
    evidenceCount: 2,
    suggestedNextAction: 'Add a lint rule.',
  })
  const labelNames = [
    'pattern-proposal',
    'pattern-proposal:accepted',
    'pattern-proposal:deferred',
    'pattern-proposal:rejected',
    'pattern-proposal:superseded',
  ]
  const routes = [
    ...labelNames.map(name => route('GET', `${BASE}/labels/${name}`, {b: {name}})),
    route('POST', `${BASE}/issues`, {s: 201, b: {number: 401}}),
    route('GET', `${BASE}/issues`, {b: []}),
  ]

  function openFixture(statement: string) {
    const cwd = checkout({
      'metadata/repos.yaml': REPOS_YAML,
      'in/digest.json': JSON.stringify([digestEntry]),
      'in/bodies.json': JSON.stringify({schemaVersion: 1, bodies: {[FINGERPRINT]: drafted(statement)}}),
    })
    return {
      cwd,
      resultPath: join(cwd, 'out', 'capture-patterns-result.json'),
      env: {
        GITHUB_TOKEN: 'tok',
        CAPTURE_PATTERNS_DIGEST_PATH: join(cwd, 'in', 'digest.json'),
        CAPTURE_PATTERNS_BODIES_PATH: join(cwd, 'in', 'bodies.json'),
        CAPTURE_PATTERNS_RESULT_PATH: join(cwd, 'out', 'capture-patterns-result.json'),
      },
    }
  }

  it('opens the proposal, confirms the five labels first, and writes the fourteen result keys', async () => {
    const {cwd, resultPath, env} = openFixture('Pin every external reference by digest')
    mkdirSync(dirname(resultPath))
    const result = await run('capture-patterns-open', {cwd, routes, env})
    expect(result.exitCode).toBe(0)
    const written = JSON.parse(readFileSync(resultPath, 'utf8')) as Record<string, unknown>
    expect(readFileSync(resultPath, 'utf8')).toBe(result.stdout)
    expect(Object.keys(written).toSorted()).toEqual([...OPEN_KEYS].toSorted())
    expect(written).toMatchObject({drafted: 1, proposalsOpened: 1, blockedOnPrivacy: 0, tokenLoadFailed: false})
    const lines = requests()
    const firstPost = lines.findIndex(line => line.startsWith('POST'))
    expect(lines.slice(0, firstPost).filter(line => line.includes('/labels/'))).toHaveLength(5)
    expect(lines[firstPost]).toContain(`<!-- pattern-proposal:fingerprint=${FINGERPRINT} -->`)
    expect(unhandledMutations()).toEqual([])
  })

  it('blocks a statement that names a private repository: counted, nothing opened', async () => {
    const {cwd, resultPath, env} = openFixture('Mirror the secretco/vault guard')
    mkdirSync(dirname(resultPath))
    const result = await run('capture-patterns-open', {cwd, routes, env})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({blockedOnPrivacy: 1, proposalsOpened: 0})
    expect((fake?.requests() ?? []).filter(request => request.method === 'POST')).toEqual([])
  })

  it('treats an unreadable metadata/repos.yaml as a token-load failure and opens nothing', async () => {
    const {cwd, resultPath, env} = openFixture('Pin every external reference by digest')
    rmSync(join(cwd, 'metadata'), {recursive: true})
    mkdirSync(dirname(resultPath))
    const result = await run('capture-patterns-open', {cwd, routes, env})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({tokenLoadFailed: true, proposalsOpened: 0})
    expect((fake?.requests() ?? []).filter(request => request.method === 'POST')).toEqual([])
  })

  it('reports a missing input as a message-only error', async () => {
    const result = await run('capture-patterns-open', {env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('capture-patterns-open: CAPTURE_PATTERNS_DIGEST_PATH is required\n')
  })

  it('is a usage error for argv no caller sends and opens nothing', async () => {
    const {cwd, resultPath, env} = openFixture('Pin every external reference by digest')
    for (const argv of [['--help'], ['--help=false'], ['--bogus'], ['stray']]) {
      const result = await run('capture-patterns-open', {cwd, argv, routes, env})
      expect(result.exitCode, argv.join(' ')).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(requests()).toEqual([])
    }
    expect(existsSync(resultPath)).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// drafted-solutions
// ---------------------------------------------------------------------------------------------------------------
const PROPOSAL_BODIES: Record<number, string> = {
  21: 'Learned: pin the setup action by digest.\n',
  22: 'Learned: keep cache keys stable across jobs.\n',
}

const proposalIssue = (number: number, body: string, overrides: Record<string, unknown> = {}) => ({
  number,
  title: `Learning proposal: (${number})`,
  state: 'open',
  body,
  user: {login: BOT},
  labels: [{name: 'learning-proposal'}],
  created_at: `2026-10-0${number % 9}T00:00:00Z`,
  ...overrides,
})

const digestOf = (issues: readonly number[]) => ({
  version: 1,
  draftBaseSha: SHA_MAIN,
  mainSha: SHA_MAIN,
  proposals: issues.map(issue => ({
    issue,
    title: `Learning proposal: (${issue})`,
    body: PROPOSAL_BODIES[issue] ?? '',
    bodyHash: sha256(PROPOSAL_BODIES[issue] ?? ''),
    mergeSha: null,
    createdAt: `2026-10-0${issue % 9}T00:00:00Z`,
  })),
  pr: {state: 'none'},
})

const unverifiedRow = (issue: number, extra: Record<string, unknown> = {}) => ({
  issue,
  outcome: 'unverified',
  targetDoc: null,
  sourceSha: SHA_MAIN,
  evidence: [],
  droppedClaims: [],
  reason: 'Could not verify the claim.',
  ...extra,
})

const NEW_DOC = 'docs/solutions/best-practices/new-doc.md'
const newDocRow = (issue: number) => ({
  issue,
  outcome: 'new-doc',
  targetDoc: NEW_DOC,
  sourceSha: SHA_MAIN,
  evidence: [{kind: 'file', ref: `${SHA_MAIN}:scripts/a.ts`}],
  droppedClaims: [],
  reason: '',
})

function harvestEnv(cwd: string) {
  return {
    GITHUB_TOKEN: 'tok',
    GITHUB_REPOSITORY: 'fro-bot/.github',
    DRAFTED_SOLUTIONS_DIGEST_PATH: join(cwd, 'drafted-solutions-digest.json'),
  }
}

describe('drafted-solutions-harvest through scripts/drafted-solutions-harvest.ts', () => {
  const routes = [
    route('GET', `${BASE}/issues`, {
      q: 'labels=learning-proposal',
      b: [21, 22].map(n => proposalIssue(n, PROPOSAL_BODIES[n] ?? '')),
    }),
    route('GET', `${BASE}/pulls`, {q: 'state=open', b: []}),
    route('GET', `${BASE}/git/ref/heads/main`, {b: {ref: 'refs/heads/main', object: {sha: SHA_MAIN, type: 'commit'}}}),
  ]

  it('writes the digest, the three job outputs the job-ifs read, and the counts line', async () => {
    const cwd = checkout()
    const result = await run('drafted-solutions-harvest', {cwd, routes, env: harvestEnv(cwd)})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({hasWork: true, proposals: 2, prState: 'none'})
    expect(parseOutputs(result.githubOutput)).toEqual({
      has_work: 'true',
      draft_base_sha: SHA_MAIN,
      main_sha: SHA_MAIN,
    })
    const digest = JSON.parse(readFileSync(join(cwd, 'drafted-solutions-digest.json'), 'utf8')) as {
      proposals: unknown[]
    }
    expect(digest.proposals).toHaveLength(2)
    expect(unhandledMutations()).toEqual([])
  })

  it('writes has_work=false and an empty digest when no proposal is open', async () => {
    const cwd = checkout()
    const result = await run('drafted-solutions-harvest', {
      cwd,
      env: harvestEnv(cwd),
      routes: [
        route('GET', `${BASE}/issues`, {b: []}),
        route('GET', `${BASE}/pulls`, {b: []}),
        route('GET', `${BASE}/git/ref/heads/main`, {
          b: {ref: 'refs/heads/main', object: {sha: SHA_MAIN, type: 'commit'}},
        }),
      ],
    })
    expect(result.exitCode).toBe(0)
    expect(parseOutputs(result.githubOutput).has_work).toBe('false')
    expect(JSON.parse(result.stdout)).toEqual({hasWork: false, proposals: 0, prState: 'none'})
  })

  it('prints ::error::drafted-solutions-harvest: and exits 1 on a fail-closed condition, with no output written', async () => {
    const cwd = checkout()
    const result = await run('drafted-solutions-harvest', {
      cwd,
      env: {...harvestEnv(cwd), GITHUB_REPOSITORY: 'only-one'},
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('::error::drafted-solutions-harvest: GITHUB_REPOSITORY must be "owner/repo"\n')
    expect(result.githubOutput).toBe('')
  })

  it('names each missing variable', async () => {
    for (const name of ['DRAFTED_SOLUTIONS_DIGEST_PATH', 'GITHUB_REPOSITORY', 'GITHUB_TOKEN'] as const) {
      const cwd = checkout()
      const result = await run('drafted-solutions-harvest', {cwd, env: {...harvestEnv(cwd), [name]: undefined}})
      expect(result.exitCode, name).toBe(1)
      expect(result.stderr, name).toBe(`::error::drafted-solutions-harvest: ${name} is required\n`)
    }
  })

  it('is a usage error for argv no caller sends: nothing is read, written or output', async () => {
    const cwd = checkout()
    for (const argv of [['--help'], ['--help=false'], ['--bogus'], ['stray']]) {
      const result = await run('drafted-solutions-harvest', {cwd, argv, routes, env: harvestEnv(cwd)})
      expect(result.exitCode, argv.join(' ')).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(result.githubOutput).toBe('')
      expect(requests()).toEqual([])
    }
    expect(existsSync(join(cwd, 'drafted-solutions-digest.json'))).toBe(false)
  })
})

function rowsCheckout(rows: unknown, issues: readonly number[] = [21, 22]) {
  return checkout({
    '.drafted-solutions/drafted-solutions-digest.json': JSON.stringify(digestOf(issues)),
    '.drafted-solutions/rows.json': typeof rows === 'string' ? rows : JSON.stringify(rows),
  })
}

describe('drafted-solutions-validate-rows through scripts/drafted-solutions-validate-rows.ts', () => {
  it('prints rows valid on stdout and exits 0 for valid rows, reading the default paths', async () => {
    const result = await run('drafted-solutions-validate-rows', {
      cwd: rowsCheckout([unverifiedRow(21), unverifiedRow(22)]),
    })
    expect(result).toMatchObject({exitCode: 0, stdout: 'rows valid: 2 row(s), one per digest proposal\n', stderr: ''})
  })

  it('prints one error per line, then the count line, on stderr and exits 1 for invalid rows', async () => {
    const result = await run('drafted-solutions-validate-rows', {cwd: rowsCheckout([unverifiedRow(21)])})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('no evidence row for proposal #22\n1 error(s): fix rows.json and run this again.\n')
  })

  it('prints a bare message for an unreadable or non-JSON input and exits 1', async () => {
    const notJson = await run('drafted-solutions-validate-rows', {cwd: rowsCheckout('{nope')})
    expect(notJson).toMatchObject({exitCode: 1, stdout: '', stderr: 'rows file is not valid JSON\n'})
    const missing = await run('drafted-solutions-validate-rows', {cwd: checkout()})
    expect(missing).toMatchObject({
      exitCode: 1,
      stdout: '',
      stderr: 'digest could not be read at .drafted-solutions/drafted-solutions-digest.json\n',
    })
  })

  it('reads the two override paths when they are set', async () => {
    const cwd = checkout({
      'other/digest.json': JSON.stringify(digestOf([21])),
      'other/rows.json': JSON.stringify([unverifiedRow(21)]),
    })
    const result = await run('drafted-solutions-validate-rows', {
      cwd,
      env: {DRAFTED_SOLUTIONS_DIGEST_PATH: 'other/digest.json', DRAFTED_SOLUTIONS_ROWS_PATH: 'other/rows.json'},
    })
    expect(result).toMatchObject({exitCode: 0, stdout: 'rows valid: 1 row(s), one per digest proposal\n'})
  })

  it('is a usage error for argv no caller sends, even when the rows are valid', async () => {
    const cwd = rowsCheckout([unverifiedRow(21), unverifiedRow(22)])
    for (const argv of [['--help'], ['--help=false'], ['--bogus'], ['stray']]) {
      const result = await run('drafted-solutions-validate-rows', {cwd, argv})
      expect(result.exitCode, argv.join(' ')).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
    }
  })
})

/** A committed checkout with one tracked solution doc. The handoff is written beside it, in the same temp root. */
function gitRepository() {
  const directory = checkout({
    'docs/solutions/best-practices/base.md': 'base\n',
    'docs/solutions/workflow-issues/keep.md': 'keep\n',
    'README.md': 'readme\n',
  })
  git(directory, 'init', '-q', '-b', 'main')
  git(directory, 'add', '-A')
  git(directory, 'commit', '-q', '-m', 'init')
  return {directory, handoff: `${directory}-handoff`}
}

describe('drafted-solutions-handoff-build through scripts/drafted-solutions-handoff-build.ts', () => {
  it('builds the manifest and files from the staged delta, appends changed=true and prints the count', async () => {
    const {directory, handoff} = gitRepository()
    writeFileSync(join(directory, NEW_DOC), 'new doc\n')
    writeFileSync(join(directory, 'docs/solutions/best-practices/base.md'), 'base, extended\n')
    const result = await run('drafted-solutions-handoff-build', {
      cwd: directory,
      env: {DRAFTED_SOLUTIONS_HANDOFF_DIR: handoff},
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"changed":2}\n')
    expect(parseOutputs(result.githubOutput)).toEqual({changed: 'true'})
    expect(JSON.parse(readFileSync(join(handoff, 'manifest.json'), 'utf8'))).toEqual({
      changed: ['docs/solutions/best-practices/base.md', NEW_DOC],
      deleted: [],
    })
    expect(readFileSync(join(handoff, 'files', NEW_DOC), 'utf8')).toBe('new doc\n')
    rmSync(handoff, {recursive: true, force: true})
  })

  it('appends changed=false when the agent changed nothing under docs/solutions', async () => {
    const {directory, handoff} = gitRepository()
    writeFileSync(join(directory, 'README.md'), 'readme, edited\n')
    const result = await run('drafted-solutions-handoff-build', {
      cwd: directory,
      env: {DRAFTED_SOLUTIONS_HANDOFF_DIR: handoff},
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"changed":0}\n')
    expect(parseOutputs(result.githubOutput)).toEqual({changed: 'false'})
    rmSync(handoff, {recursive: true, force: true})
  })

  it('honours the working directory: the repository it reads is the one it runs in, not this checkout', async () => {
    const {directory, handoff} = gitRepository()
    writeFileSync(join(directory, NEW_DOC), 'only in the temp checkout\n')
    const result = await run('drafted-solutions-handoff-build', {
      cwd: directory,
      env: {DRAFTED_SOLUTIONS_HANDOFF_DIR: handoff},
    })
    expect(result.exitCode).toBe(0)
    expect(readFileSync(join(handoff, 'files', NEW_DOC), 'utf8')).toBe('only in the temp checkout\n')
    expect(existsSync(join(repoRoot, NEW_DOC))).toBe(false)
    rmSync(handoff, {recursive: true, force: true})
  })

  it('fails the job with a bare ::error:: line on an out-of-scope path and writes no handoff', async () => {
    const {directory, handoff} = gitRepository()
    mkdirSync(join(directory, 'docs/solutions/new-category'))
    writeFileSync(join(directory, 'docs/solutions/new-category/x.md'), 'x\n')
    const result = await run('drafted-solutions-handoff-build', {
      cwd: directory,
      env: {DRAFTED_SOLUTIONS_HANDOFF_DIR: handoff},
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^::error::drafted-solutions handoff path is outside the allowed/u)
    expect(result.githubOutput).toBe('')
    expect(existsSync(handoff)).toBe(false)
  })

  it('names a missing handoff directory', async () => {
    const {directory} = gitRepository()
    const result = await run('drafted-solutions-handoff-build', {cwd: directory})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('::error::DRAFTED_SOLUTIONS_HANDOFF_DIR is required\n')
  })

  it('is a usage error for argv no caller sends and builds nothing', async () => {
    const {directory, handoff} = gitRepository()
    writeFileSync(join(directory, NEW_DOC), 'new doc\n')
    for (const argv of [['--help'], ['--help=false'], ['--bogus'], ['stray']]) {
      const result = await run('drafted-solutions-handoff-build', {
        cwd: directory,
        argv,
        env: {DRAFTED_SOLUTIONS_HANDOFF_DIR: handoff},
      })
      expect(result.exitCode, argv.join(' ')).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.githubOutput).toBe('')
    }
    expect(existsSync(handoff)).toBe(false)
  })
})

function publishFixture(rows: unknown, changed: readonly string[] = []) {
  const cwd = checkout({
    'metadata/repos.yaml': REPOS_YAML,
    'work/digest.json': JSON.stringify(digestOf([21, 22])),
    'work/rows.json': JSON.stringify(rows),
    'work/handoff/manifest.json': JSON.stringify({changed, deleted: []}),
    ...Object.fromEntries(changed.map(path => [`work/handoff/files/${path}`, '# New doc\n\nBody.\n'])),
  })
  return {
    cwd,
    resultPath: join(cwd, 'out', 'drafted-solutions-result.json'),
    env: {
      GITHUB_TOKEN: 'tok',
      GITHUB_REPOSITORY: 'fro-bot/.github',
      DRAFTED_SOLUTIONS_DIGEST_PATH: join(cwd, 'work', 'digest.json'),
      DRAFTED_SOLUTIONS_HANDOFF_DIR: join(cwd, 'work', 'handoff'),
      DRAFTED_SOLUTIONS_ROWS_PATH: join(cwd, 'work', 'rows.json'),
      DRAFTED_SOLUTIONS_RESULT_PATH: join(cwd, 'out', 'drafted-solutions-result.json'),
      TMPDIR: join(cwd, 'tmp'),
    },
  }
}

describe('drafted-solutions-publish through scripts/drafted-solutions-publish.ts', () => {
  const issueRoutes = [21, 22].map(n =>
    route('GET', `${BASE}/issues/${n}`, {b: proposalIssue(n, PROPOSAL_BODIES[n] ?? '')}),
  )
  const closeRoutes = (numbers: readonly number[]) =>
    numbers.flatMap(n => [
      route('GET', `${BASE}/issues/${n}/comments`, {b: []}),
      route('POST', `${BASE}/issues/${n}/comments`, {s: 201, b: {id: 9}}),
      route('PATCH', `${BASE}/issues/${n}`, {b: {number: n}}),
    ])
  const noPulls = route('GET', `${BASE}/pulls`, {q: 'state=open', b: []})
  const mainRef = route('GET', `${BASE}/git/ref/heads/main`, {
    b: {ref: 'refs/heads/main', object: {sha: SHA_MAIN, type: 'commit'}},
  })
  const noDraftRef = route('GET', `${BASE}/git/ref/heads/docs/drafted-solutions`, {s: 404, b: {message: 'Not Found'}})
  const writes = [
    route('GET', `${BASE}/git/commits/${SHA_MAIN}`, {b: {sha: SHA_MAIN, tree: {sha: 't'.repeat(40)}}}),
    route('POST', `${BASE}/git/blobs`, {s: 201, b: {sha: 'b'.repeat(40)}}),
    route('POST', `${BASE}/git/trees`, {s: 201, b: {sha: 'c'.repeat(40)}}),
    route('POST', `${BASE}/git/commits`, {s: 201, b: {sha: 'd'.repeat(40)}}),
    route('POST', `${BASE}/git/refs`, {s: 201, b: {ref: 'refs/heads/docs/drafted-solutions'}}),
    route('POST', `${BASE}/pulls`, {s: 201, b: {number: 70}}),
  ]

  it('closes unverified proposals directly and writes the result file with .mode', async () => {
    const {cwd, resultPath, env} = publishFixture([unverifiedRow(21), unverifiedRow(22)])
    mkdirSync(dirname(resultPath))
    mkdirSync(env.TMPDIR)
    const result = await run('drafted-solutions-publish', {
      cwd,
      env,
      routes: [...issueRoutes, noPulls, ...closeRoutes([21, 22])],
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({mode: 'closed-proposals', closed: [21, 22], skipped: []})
    expect(readFileSync(resultPath, 'utf8')).toBe(result.stdout)
    expect(requests().filter(line => line.startsWith('PATCH'))).toHaveLength(2)
    expect(unhandledMutations()).toEqual([])
  })

  it('creates the drafted PR for a new doc and returns its number in the result file', async () => {
    const {cwd, resultPath, env} = publishFixture([newDocRow(21), unverifiedRow(22)], [NEW_DOC])
    mkdirSync(dirname(resultPath))
    mkdirSync(env.TMPDIR)
    const result = await run('drafted-solutions-publish', {
      cwd,
      env,
      routes: [...issueRoutes, noPulls, mainRef, noDraftRef, ...writes, ...closeRoutes([22])],
    })
    expect(result.exitCode).toBe(0)
    const written = JSON.parse(readFileSync(resultPath, 'utf8')) as Record<string, unknown>
    expect(written).toMatchObject({mode: 'created-pr', prNumber: 70, closed: [22]})
    const pull = (fake?.requests() ?? []).find(request => request.line.startsWith('POST /repos/fro-bot/.github/pulls'))
    expect(pull?.line).toContain('Closes #21')
    expect(unhandledMutations()).toEqual([])
  })

  it('fails closed on a document that names a private repository: exit 1, an ::error:: line, no write', async () => {
    const {cwd, env} = publishFixture([newDocRow(21), unverifiedRow(22)], [NEW_DOC])
    writeFileSync(join(cwd, 'work/handoff/files', NEW_DOC), 'Mirrors secretco/vault.\n')
    mkdirSync(env.TMPDIR)
    const result = await run('drafted-solutions-publish', {
      cwd,
      env,
      routes: [...issueRoutes, noPulls, mainRef, noDraftRef, ...writes, ...closeRoutes([22])],
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('::error::drafted-solutions-publish: privacy gate blocked file #1 content')
    expect(result.stderr).not.toContain('secretco')
    expect((fake?.requests() ?? []).filter(request => request.method !== 'GET')).toEqual([])
  })

  it('refuses a handoff path outside the drafted-solutions policy', async () => {
    const {cwd, env} = publishFixture([unverifiedRow(21), unverifiedRow(22)])
    writeFileSync(
      join(cwd, 'work/handoff/manifest.json'),
      JSON.stringify({changed: ['docs/other/x.md', '../escape.md'], deleted: []}),
    )
    mkdirSync(env.TMPDIR)
    const result = await run('drafted-solutions-publish', {cwd, env, routes: [...issueRoutes, noPulls]})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('::error::drafted-solutions-publish: handoff rejected: ')
    expect((fake?.requests() ?? []).filter(request => request.method !== 'GET')).toEqual([])
  })

  it('names each missing variable', async () => {
    const {cwd, env} = publishFixture([unverifiedRow(21), unverifiedRow(22)])
    for (const name of [
      'GITHUB_REPOSITORY',
      'GITHUB_TOKEN',
      'DRAFTED_SOLUTIONS_DIGEST_PATH',
      'DRAFTED_SOLUTIONS_HANDOFF_DIR',
      'DRAFTED_SOLUTIONS_ROWS_PATH',
    ] as const) {
      const result = await run('drafted-solutions-publish', {cwd, env: {...env, [name]: undefined}})
      expect(result.exitCode, name).toBe(1)
      expect(result.stderr, name).toBe(`::error::drafted-solutions-publish: ${name} is required\n`)
    }
  })

  it('is a usage error for argv no caller sends: no API call, no result file', async () => {
    const {cwd, resultPath, env} = publishFixture([unverifiedRow(21), unverifiedRow(22)])
    for (const argv of [['--help'], ['--help=false'], ['--bogus'], ['stray']]) {
      const result = await run('drafted-solutions-publish', {
        cwd,
        argv,
        env,
        routes: [...issueRoutes, noPulls, ...closeRoutes([21, 22])],
      })
      expect(result.exitCode, argv.join(' ')).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(requests()).toEqual([])
    }
    expect(existsSync(resultPath)).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The shims
// ---------------------------------------------------------------------------------------------------------------
describe('importing a shim runs nothing', () => {
  it.each([
    'capture-learnings-harvest',
    'capture-learnings-open',
    'capture-patterns-cluster',
    'capture-patterns-open',
    'drafted-solutions-handoff-build',
    'drafted-solutions-harvest',
    'drafted-solutions-publish',
    'drafted-solutions-validate-rows',
  ])('%s', async script => {
    const cwd = checkout()
    const runner = join(root, 'import-shim.ts')
    // The shim path is data: it arrives as argv and is never interpolated into code.
    writeFileSync(runner, "await import(process.argv[2] ?? '')\nprocess.stdout.write('imported')\n")
    const result = await spawnEntrypoint({
      entrypoint: runner,
      argv: [resolve(repoRoot, 'scripts', `${script}.ts`)],
      runtime: 'bun',
      runtimeArgs: ['--no-install', '--no-env-file'],
      cwd,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('imported')
    expect(result.stderr).toBe('')
    expect(result.githubOutput).toBe('')
    expect(readdirSync(cwd)).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The callers' `| tee` pipelines
// ---------------------------------------------------------------------------------------------------------------
/**
 * Runs `bun <shim> | tee <file>` the way a GitHub step does, under the shell the workflow declares. The shim and
 * the tee file are positional arguments of the shell script, quoted as "$1" and "$2", so no path is ever
 * interpolated into the command text.
 */
async function runPipeline(
  shell: readonly string[],
  script: string,
  options: {readonly env?: Record<string, string | undefined>; readonly cwd?: string} = {},
) {
  const cwd = options.cwd ?? checkout()
  const teeFile = join(cwd, 'tee.json')
  const result = await spawnEntrypoint({
    entrypoint: 'bun --no-install --no-env-file "$1" | tee "$2"',
    argv: ['_', resolve(repoRoot, 'scripts', `${script}.ts`), teeFile],
    executable: 'bash',
    runtimeArgs: [...shell, '-c'],
    cwd,
    env: options.env ?? {},
  })
  return {...result, tee: existsSync(teeFile) ? readFileSync(teeFile, 'utf8') : undefined}
}

describe('a | tee pipeline returns the CLI exit code under pipefail', () => {
  // `shell: bash` is `bash --noprofile --norc -eo pipefail {0}`; capture-patterns declares `bash -Eeuo pipefail {0}`.
  const SHELLS = {
    'shell: bash': ['--noprofile', '--norc', '-eo', 'pipefail'],
    'bash -Eeuo pipefail': ['-Eeuo', 'pipefail'],
  } as const

  it.each(Object.entries(SHELLS))(
    '%s: a failing CLI fails the step and tee still receives its stderr-free stdout',
    async (_name, shell) => {
      const failing = await runPipeline(shell, 'capture-learnings-open')
      expect(failing.exitCode).toBe(1)
      expect(failing.stderr).toBe('capture-learnings-open: CAPTURE_LEARNINGS_DIGEST_PATH is required\n')
      expect(failing.tee).toBe('')

      const failingPatterns = await runPipeline(shell, 'capture-patterns-open')
      expect(failingPatterns.exitCode).toBe(1)

      const failingDrafted = await runPipeline(shell, 'drafted-solutions-harvest')
      expect(failingDrafted.exitCode).toBe(1)
      expect(failingDrafted.stderr).toBe(
        '::error::drafted-solutions-harvest: DRAFTED_SOLUTIONS_DIGEST_PATH is required\n',
      )
    },
  )

  it.each(Object.entries(SHELLS))(
    '%s: a succeeding CLI passes the step and tee holds exactly its stdout',
    async (_name, shell) => {
      const cwd = checkout({'metadata/repos.yaml': REPOS_YAML})
      const digestPath = join(cwd, 'digest.json')
      // No token: the harvest falls back to an empty digest and exits 0 without a network call.
      const result = await runPipeline(shell, 'capture-learnings-harvest', {
        cwd,
        env: {CAPTURE_LEARNINGS_DIGEST_PATH: digestPath},
      })
      expect(result.exitCode).toBe(0)
      expect(result.tee).toBe(result.stdout)
      expect(readFileSync(digestPath, 'utf8')).toBe(result.stdout)
    },
  )

  it('without pipefail the same failing pipeline exits 0: the exit code is the CLI, not tee, only because of pipefail', async () => {
    const result = await runPipeline(['--noprofile', '--norc'], 'capture-learnings-open')
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('CAPTURE_LEARNINGS_DIGEST_PATH is required')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The real checkout
// ---------------------------------------------------------------------------------------------------------------
describe('the real checkout', () => {
  it('has the same files under docs/solutions, metadata, .drafted-solutions and knowledge as before the flows ran', () => {
    const after = snapshotTree(repoRoot, ['docs/solutions', 'metadata', '.drafted-solutions', 'knowledge'])
    expect(after).toEqual(realCheckoutBefore)
  })

  it('positive control: the same check sees a file written under a snapshotted path', () => {
    const scratch = checkout({'docs/solutions/a.md': 'a\n'})
    const before = snapshotTree(scratch, ['docs/solutions'])
    writeFileSync(join(scratch, 'docs/solutions/b.md'), 'b\n')
    writeFileSync(join(scratch, 'docs/solutions/a.md'), 'a, changed\n')
    const after = snapshotTree(scratch, ['docs/solutions'])
    expect(after).not.toEqual(before)
    expect([...after.keys()].toSorted()).toEqual(['docs/solutions/a.md', 'docs/solutions/b.md'])
  })
})
