/**
 * Surface tier for the registry CLIs end to end: each test runs the real `scripts/<name>.ts` shim in a child
 * process, through the goke runner and the production CLI body with its default dependencies, against a fake
 * GitHub API (`@fro-bot/test-kit/fake-github`) that replaces `fetch` in the child. Nothing is mocked inside
 * the CLI, so a broken shim, runner config or default wiring fails here.
 *
 * `registry-entrypoints.test.ts` covers the inputs that fail before any request; this file covers the runs
 * that reach GitHub: the `DATA_BRANCH_TAMPER` variants, and the success outputs a workflow reads.
 */

import {Buffer} from 'node:buffer'
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {createFakeGithub, route, type FakeGithub, type FakeRoute} from '@fro-bot/test-kit/fake-github'
import {spawnEntrypoint, type SpawnEntrypointResult} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..')
const CONTROL = '/repos/fro-bot/.github'

const REPOS_YAML = `version: 1
repos:
  - owner: fro-bot
    name: dashboard
    added: 2026-06-15
    onboarding_status: onboarded
    last_survey_at: 2026-10-01
    last_survey_status: success
    has_fro_bot_workflow: true
    has_renovate: false
    next_survey_eligible_at: 2026-11-01
    discovery_channel: owned
    private: false
    node_id: R_kgDOPUBLIC1
    database_id: 111
`

const EMPTY_REPOS = 'version: 1\nrepos: []\n'

const ALLOWLIST_YAML = `version: 1
approved_inviters:
  - username: marcusrbrown
    added: 2026-04-15
    role: owner
`

const REQUIRED_RULES = ['update', 'non_fast_forward', 'creation', 'deletion']

let root = ''
let fake: FakeGithub | undefined

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'registry-flows-'))
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

function dataBranch(author = 'fro-bot[bot]'): FakeRoute {
  return route('GET', `${CONTROL}/branches/data`, {
    b: {name: 'data', protected: false, commit: {sha: 'a'.repeat(40), author: {login: author}}},
  })
}

function branchRules(types: readonly string[] = REQUIRED_RULES, answer: {s?: number; b?: unknown} = {}): FakeRoute {
  return route('GET', `${CONTROL}/rules/branches/data`, {b: types.map(type => ({type})), ...answer})
}

function contentsGet(path: string, text: string): FakeRoute {
  return route('GET', `${CONTROL}/contents/${path}`, {
    b: {
      type: 'file',
      encoding: 'base64',
      name: path.split('/').at(-1),
      path,
      sha: 'filesha1',
      size: text.length,
      content: Buffer.from(text).toString('base64'),
    },
  })
}

function contentsPut(): FakeRoute {
  return route('PUT', String.raw`~^/repos/fro-bot/\.github/contents/`, {
    b: {content: {sha: 'newfilesha'}, commit: {sha: 'c'.repeat(40)}},
  })
}

async function run(
  name: string,
  routes: readonly FakeRoute[],
  options: {
    readonly cwd?: string
    readonly env?: Readonly<Record<string, string | undefined>>
    readonly githubOutput?: 'file' | 'unset'
  } = {},
): Promise<SpawnEntrypointResult> {
  const github = createFakeGithub(routes)
  fake = github
  return spawnEntrypoint({
    entrypoint: join(repoRoot, 'scripts', `${name}.ts`),
    runtime: 'bun',
    runtimeArgs: github.runtimeArgs('bun'),
    cwd: options.cwd ?? checkout({}),
    githubOutput: options.githubOutput,
    env: {FAKE_GH_DIR: github.directory, ...options.env},
  })
}

function calls(): string[] {
  return fake?.calls() ?? []
}

/** The calls with a method and a path prefix, so a test asserts a request happened without matching dated bodies. */
function callsTo(prefix: string): string[] {
  return calls().filter(call => call.startsWith(prefix))
}

describe('reconcile-repos (bun, reconcile-repos.yaml: no argv)', () => {
  const env = {
    FRO_BOT_POLL_PAT: 'tok-user',
    RECONCILE_DISCOVERY_TOKEN: 'tok-disc',
    RECONCILE_WRITER_TOKEN: 'tok-writer',
    GITHUB_REPOSITORY: 'fro-bot/.github',
    RECONCILE_DISPATCH_STAGGER_MS: '0',
  }
  const files = {'metadata/repos.yaml': EMPTY_REPOS, 'metadata/allowlist.yaml': ALLOWLIST_YAML}
  const collaborator = {
    owner: {login: 'marcusrbrown'},
    name: 'newrepo',
    archived: false,
    private: false,
    node_id: 'R_kgDONEW111',
  }
  const issuesList = route('GET', `${CONTROL}/issues`, {b: []})
  const installation = route('GET', '/installation/repositories', {b: {total_count: 0, repositories: []}})
  const alertIssue = route('POST', `${CONTROL}/issues`, {
    s: 201,
    b: {number: 9, html_url: 'https://github.com/x/y/issues/9'},
  })

  /** The reads of a run that tracks one new public collaborator repo and writes it to `data`. */
  function newCollaboratorRoutes(): FakeRoute[] {
    return [
      dataBranch(),
      route('GET', '/user/repos', {b: [collaborator]}),
      installation,
      branchRules(),
      issuesList,
      route('GET', '/repos/marcusrbrown/newrepo', {
        b: {
          id: 999,
          node_id: 'R_kgDONEW111',
          name: 'newrepo',
          owner: {login: 'marcusrbrown'},
          private: false,
          archived: false,
          full_name: 'marcusrbrown/newrepo',
        },
      }),
      route('GET', '~/repos/marcusrbrown/newrepo/contents/', {s: 404, b: {message: 'Not Found'}}),
      contentsGet('metadata/repos.yaml', EMPTY_REPOS),
      contentsPut(),
      route('POST', '~/actions/workflows/', {s: 204}),
      route('PUT', '~/user/starred/', {s: 204}),
      route('GET', '/user/starred', {b: []}),
    ]
  }

  describe('DATA_BRANCH_TAMPER', () => {
    const baseReads = [route('GET', '/user/repos', {b: []}), installation, issuesList, alertIssue]

    const variants: {
      name: string
      routes: () => FakeRoute[]
      stderr: string
      alertText: string
    }[] = [
      {
        name: 'an unexpected tip author',
        routes: () => [dataBranch('someone-else'), ...baseReads, branchRules()],
        stderr: `Unexpected author on data branch tip commit: someone-else (sha: ${'a'.repeat(40)})`,
        alertText: 'Unexpected author on `data` branch',
      },
      {
        name: 'required rules missing',
        routes: () => [dataBranch(), ...baseReads, branchRules(['update', 'creation'])],
        stderr: `Required rules missing on data branch: non_fast_forward, deletion (tip sha: ${'a'.repeat(40)})`,
        alertText: 'Required rules are not in effect on',
      },
      {
        name: 'unreadable rules',
        routes: () => [
          dataBranch(),
          ...baseReads,
          route('GET', `${CONTROL}/rules/branches/data`, {s: 500, b: {message: 'boom'}}),
        ],
        stderr: `Could not read the effective rules for the data branch: boom (status 500) (tip sha: ${'a'.repeat(40)})`,
        alertText: 'The effective rules for the `data` branch could not be read',
      },
      {
        name: 'rules that change during the commit retry',
        routes: () => [
          ...newCollaboratorRoutes().filter(candidate => candidate.p !== `${CONTROL}/rules/branches/data`),
          alertIssue,
          route('GET', `${CONTROL}/rules/branches/data`, {
            seq: [{b: REQUIRED_RULES.map(type => ({type}))}, {b: [{type: 'update'}]}],
          }),
        ],
        stderr: `Required rules missing on data branch: non_fast_forward, creation, deletion (tip sha: ${'a'.repeat(40)}) (during commit retry)`,
        alertText: 'Required rules are not in effect on',
      },
    ]

    it.each(variants)('$name exits 1 with the diagnostic on stderr and nothing on stdout', async variant => {
      const result = await run('reconcile-repos', variant.routes(), {cwd: checkout(files), env})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.githubOutput).toBe('')
      expect(result.stderr).toContain(variant.stderr)
      // The alert is filed before the run stops, and nothing is written to `data` or dispatched.
      const alerts = callsTo(`POST ${CONTROL}/issues auth=tok-writer`)
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toContain(variant.alertText)
      expect(callsTo('PUT /repos/fro-bot/.github/contents')).toHaveLength(0)
      expect(callsTo('POST /repos/fro-bot/.github/actions')).toHaveLength(0)
    })

    it('reports a failed alert as a stderr line and still exits 1 with the tamper diagnostic', async () => {
      const result = await run(
        'reconcile-repos',
        [dataBranch('someone-else'), ...baseReads.slice(0, 3), branchRules()],
        {
          cwd: checkout(files),
          env,
        },
      )
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('reconcile: failed to file integrity alert issue (status=404).')
      expect(result.stderr).toContain('Unexpected author on data branch tip commit: someone-else')
    })
  })

  describe('a run that tracks a new collaborator repo', () => {
    // The 27 `jq` expressions the "Write step summary" step reads, taken from the workflow itself.
    const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'reconcile-repos.yaml'), 'utf8')
    const expressions = [...workflow.matchAll(/jq '\.([A-Za-z][\w.]*) \/\/ (0|false)'/gu)].map(match => ({
      path: match[1] ?? '',
      fallback: match[2] === 'false' ? false : 0,
    }))

    it('reads 27 distinct step-summary expressions from the workflow', () => {
      expect(expressions).toHaveLength(27)
      expect(new Set(expressions.map(expression => expression.path)).size).toBe(27)
    })

    it('prints one JSON object on stdout whose every summary path is present with the type its fallback has', async () => {
      const result = await run('reconcile-repos', newCollaboratorRoutes(), {cwd: checkout(files), env})
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('reconcile: star sync complete (starsAdded=1)')
      expect(result.githubOutput).toBe('')
      expect(result.stdout.endsWith('\n')).toBe(true)
      expect(result.stdout.trimEnd().split('\n')).toHaveLength(1)

      const output = JSON.parse(result.stdout) as Record<string, unknown>
      for (const {path, fallback} of expressions) {
        let value: unknown = output
        for (const segment of path.split('.')) {
          expect(value, path).toBeTypeOf('object')
          expect(Object.keys(value as object), `${path} is missing at ${segment}`).toContain(segment)
          value = (value as Record<string, unknown>)[segment]
        }
        // `// 0` would turn a missing field into the fallback: the value must exist and have its type.
        expect(typeof value, path).toBe(typeof fallback)
      }
      // The shape is non-empty, so the fallbacks are not what the assertions above read.
      expect(output).toMatchObject({dispatches: 1, committed: true, starsAdded: 1, integrityCheck: 'ok'})
      expect(output.summary).toMatchObject({added: 1, byChannel: {collab: {tracked: 1, dispatched: 1}}})
    })

    it('writes the new row to data and dispatches the survey, with the writer token', async () => {
      await run('reconcile-repos', newCollaboratorRoutes(), {cwd: checkout(files), env})
      const writes = callsTo('PUT /repos/fro-bot/.github/contents/metadata/repos.yaml auth=tok-writer')
      expect(writes).toHaveLength(1)
      expect(writes[0]).toContain('name: newrepo')
      expect(
        callsTo('POST /repos/fro-bot/.github/actions/workflows/survey-repo.yaml/dispatches auth=tok-writer'),
      ).toHaveLength(1)
      expect(callsTo('PUT /user/starred/marcusrbrown/newrepo auth=tok-user')).toHaveLength(1)
    })
  })
})

describe('handle-invitation (bun, poll-invitations.yaml: no argv)', () => {
  const env = {GITHUB_TOKEN: 'tok-poll', METADATA_WRITE_TOKEN: 'tok-meta'}
  const files = {'metadata/repos.yaml': REPOS_YAML, 'metadata/allowlist.yaml': ALLOWLIST_YAML}
  const invitation = {
    id: 11,
    repository: {owner: {login: 'marcusrbrown'}, name: 'newrepo', private: false, node_id: 'R_kgDONEW111', id: 999},
    inviter: {login: 'marcusrbrown'},
  }

  function acceptRoutes(): FakeRoute[] {
    return [
      dataBranch(),
      route('GET', '/user/repository_invitations', {b: [invitation]}),
      route('PATCH', '/user/repository_invitations/11', {s: 204}),
      route('GET', '/repos/marcusrbrown/newrepo', {
        b: {private: false, node_id: 'R_kgDONEW111', id: 999, owner: {login: 'marcusrbrown'}, name: 'newrepo'},
      }),
      route('PUT', '/user/starred/marcusrbrown/newrepo', {s: 204}),
      contentsGet('metadata/repos.yaml', REPOS_YAML),
      contentsPut(),
      route('POST', '~/actions/workflows/', {s: 204}),
    ]
  }

  it('accepts a public invitation, prints the result and writes both $GITHUB_OUTPUT keys', async () => {
    const result = await run('handle-invitation', acceptRoutes(), {cwd: checkout(files), env})
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(
      '{"processed":[{"invitationId":11,"inviter":"marcusrbrown","owner":"marcusrbrown","repo":"newrepo","status":"accepted"}]}\n',
    )
    expect(result.githubOutput).toBe(
      'public_invitations_accepted=1\npublic_invitations_accepted_repos=[{"owner":"marcusrbrown","name":"newrepo"}]\n',
    )
    expect(callsTo('PATCH /user/repository_invitations/11 auth=tok-poll')).toHaveLength(1)
    expect(callsTo('PUT /repos/fro-bot/.github/contents/metadata/repos.yaml auth=tok-meta')).toHaveLength(1)
  })

  it('writes both keys as zero and an empty list when there is nothing to accept', async () => {
    const result = await run(
      'handle-invitation',
      [dataBranch(), route('GET', '/user/repository_invitations', {b: []})],
      {cwd: checkout(files), env},
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"processed":[]}\n')
    expect(result.githubOutput).toBe('public_invitations_accepted=0\npublic_invitations_accepted_repos=[]\n')
  })

  it('writes nothing to a file when GITHUB_OUTPUT is unset, and still prints the result', async () => {
    const cwd = checkout(files)
    const result = await run('handle-invitation', acceptRoutes(), {cwd, env, githubOutput: 'unset'})
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('"status":"accepted"')
    expect(result.githubOutput).toBe('')
    expect(readdirSync(cwd)).toEqual(['metadata'])
  })

  it('writes nothing to a file when GITHUB_OUTPUT is empty', async () => {
    const cwd = checkout(files)
    const result = await run('handle-invitation', acceptRoutes(), {
      cwd,
      env: {...env, GITHUB_OUTPUT: ''},
      githubOutput: 'unset',
    })
    expect(result.exitCode).toBe(0)
    expect(result.githubOutput).toBe('')
    expect(readdirSync(cwd)).toEqual(['metadata'])
  })

  it('exits 1 with the API message and no output keys when polling is rejected', async () => {
    const result = await run(
      'handle-invitation',
      [dataBranch(), route('GET', '/user/repository_invitations', {s: 401, b: {message: 'Bad credentials'}})],
      {cwd: checkout(files), env},
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.githubOutput).toBe('')
    expect(result.stderr).toContain('GitHub rejected invitation polling credentials')
  })
})

describe('record-survey-result (bun, survey-repo.yaml: no argv)', () => {
  const env = {
    GITHUB_REPOSITORY: 'fro-bot/.github',
    GITHUB_TOKEN: 'tok-app',
    REPO_OWNER: 'fro-bot',
    REPO_NAME: 'dashboard',
    REPO_NODE_ID: 'R_kgDOPUBLIC1',
    SURVEY_STATUS: 'success',
    SURVEY_AT: '2026-10-30T00:00:00Z',
  }
  const reads = [dataBranch(), contentsGet('metadata/repos.yaml', REPOS_YAML), contentsPut()]

  it('records the survey on the matching row and prints the commit as one JSON line', async () => {
    const result = await run('record-survey-result', reads, {env})
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(
      `{"committed":true,"sha":"${'c'.repeat(40)}","attempts":1,"target":"fro-bot/dashboard","status":"success"}\n`,
    )
    const writes = callsTo('PUT /repos/fro-bot/.github/contents/metadata/repos.yaml auth=tok-app')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain('last_survey_status: success')
  })

  it('skips with exit 0 and a stderr line when the survey target has no entry, and writes nothing', async () => {
    const result = await run('record-survey-result', reads, {
      env: {...env, REPO_NODE_ID: 'R_kgDOUNKNOWN1', REPO_NAME: 'ghost'},
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      'record-survey-result: metadata/repos.yaml has no entry for fro-bot/ghost; skipping (non-fatal)\n',
    )
    expect(callsTo('PUT ')).toHaveLength(0)
  })

  it('exits 1 with the conflict message when the write keeps conflicting', async () => {
    const result = await run(
      'record-survey-result',
      [
        dataBranch(),
        contentsGet('metadata/repos.yaml', REPOS_YAML),
        route('PUT', '~/contents/', {s: 409, b: {message: 'conflict'}}),
      ],
      {env},
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('record-survey-result: ')
    expect(result.stderr).toContain('commitMetadata exhausted 3 attempt(s) updating metadata/repos.yaml')
  })
})

describe('reset-survey-status (bun, reset-survey-status.yaml: no argv)', () => {
  const env = {GITHUB_TOKEN: 'tok-app', GITHUB_REPOSITORY: 'fro-bot/.github', TARGETS: 'fro-bot/dashboard'}
  const reads = [dataBranch(), contentsGet('metadata/repos.yaml', REPOS_YAML), contentsPut()]

  it('prints the result as JSON indented by two spaces, the only indented output of the registry CLIs', async () => {
    const result = await run('reset-survey-status', reads, {env})
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(`{
  "targets": 1,
  "results": [
    {
      "target": "fro-bot/dashboard",
      "committed": true,
      "attempts": 1,
      "sha": "${'c'.repeat(40)}"
    }
  ]
}
`)
    const writes = callsTo('PUT /repos/fro-bot/.github/contents/metadata/repos.yaml auth=tok-app')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain('last_survey_status: null')
  })

  it('prints the script name and the message and exits 1 for a target that is not in the registry', async () => {
    const result = await run('reset-survey-status', reads, {env: {...env, TARGETS: 'fro-bot/ghost'}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^reset-survey-status: /u)
    expect(result.stderr).toContain('fro-bot/ghost')
  })
})
