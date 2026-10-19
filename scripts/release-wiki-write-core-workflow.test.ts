/**
 * Contract tests for .github/workflows/release-wiki-write-core.yaml: the decide/build/publish split,
 * the credential boundary of each job, the gated semantic-release config the publish job writes, and the
 * validation steps that stand between a `decide` output and the credentialed release step. Style mirrors
 * publish-wiki-workflow.test.ts; the publish job's shell is run under bash.
 */

import {execFileSync} from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import process from 'node:process'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {parse} from 'yaml'

import {parseToolPins, RELEASE_TOOLS} from './wiki-write-core-release.ts'

interface WorkflowStep {
  name?: string
  id?: string
  if?: string
  run?: string
  uses?: string
  env?: Record<string, unknown>
  with?: Record<string, unknown>
}

interface WorkflowJob {
  name?: string
  if?: string
  needs?: string | string[]
  permissions?: Record<string, string>
  environment?: string | {name?: string}
  steps: WorkflowStep[]
}

interface Workflow {
  on: Record<string, unknown>
  permissions?: Record<string, string>
  concurrency?: {group?: string; 'cancel-in-progress'?: boolean}
  env?: Record<string, unknown>
  jobs: Record<string, WorkflowJob>
}

function assertWorkflowShape(value: unknown): asserts value is Workflow {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('jobs' in value) ||
    typeof (value as Record<string, unknown>).jobs !== 'object' ||
    Object.keys((value as {jobs: object}).jobs).length === 0
  ) {
    throw new TypeError('workflow file does not have expected shape: missing or empty jobs object')
  }
}

/** A GitHub Actions expression, `${{ body }}`, built so the source holds no template-looking string literal. */
function expression(body: string): string {
  return ['$', '{{ ', body, ' }}'].join('')
}

/** The semantic-release template variable the exec plugin resolves before running a command. */
const NEXT_RELEASE_VERSION = ['$', '{nextRelease.version}'].join('')

const repositoryRoot = resolve(import.meta.dirname, '..')
// The npm trusted publisher binds to this filename.
const workflowPath = join(repositoryRoot, '.github/workflows/release-wiki-write-core.yaml')
const workflowRaw = readFileSync(workflowPath, 'utf8')
const parsed: unknown = parse(workflowRaw)
assertWorkflowShape(parsed)
const workflow = parsed

const decideJob = workflow.jobs.decide
const buildJob = workflow.jobs.build
const publishJob = workflow.jobs.publish

function stepById(job: WorkflowJob | undefined, id: string): WorkflowStep {
  const step = job?.steps.find(candidate => candidate.id === id)
  if (step === undefined) throw new Error(`step with id "${id}" not found`)
  return step
}

function stepIndexById(job: WorkflowJob | undefined, id: string): number {
  const index = job?.steps.findIndex(candidate => candidate.id === id) ?? -1
  if (index < 0) throw new Error(`step with id "${id}" not found`)
  return index
}

function runOf(step: WorkflowStep): string {
  if (typeof step.run !== 'string') throw new TypeError(`step "${step.name ?? step.id ?? '?'}" has no run script`)
  return step.run
}

function environmentName(job: WorkflowJob | undefined): string | undefined {
  const environment = job?.environment
  return typeof environment === 'string' ? environment : environment?.name
}

function readRaw(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), 'utf8')
}

describe('release-wiki-write-core.yaml structure', () => {
  it('has the decide, build and publish jobs (fails when the file has no jobs)', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['decide', 'build', 'publish'])
  })

  it('has empty workflow-level permissions', () => {
    expect(workflow.permissions).toEqual({})
  })

  it('triggers on push to main with no paths filter, and on dispatch', () => {
    const push = (workflow.on as {push?: {branches?: string[]; paths?: unknown; 'paths-ignore'?: unknown}}).push
    expect(push?.branches).toEqual(['main'])
    expect(push).not.toHaveProperty('paths')
    expect(push).not.toHaveProperty('paths-ignore')
    expect(workflow.on).toHaveProperty('workflow_dispatch')
  })

  it('serializes releases and never cancels one in flight', () => {
    expect(workflow.concurrency?.group).toBe('release-wiki-write-core')
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(false)
  })
})

describe('release-wiki-write-core.yaml permissions and environment', () => {
  it('gives decide and build contents: read and nothing else', () => {
    expect(decideJob?.permissions).toEqual({contents: 'read'})
    expect(buildJob?.permissions).toEqual({contents: 'read'})
  })

  it('gives only publish contents: write and id-token: write', () => {
    expect(publishJob?.permissions).toEqual({contents: 'write', 'id-token': 'write'})
  })

  it('references the release environment from publish alone', () => {
    expect(environmentName(publishJob)).toBe('release')
    expect(environmentName(decideJob)).toBeUndefined()
    expect(environmentName(buildJob)).toBeUndefined()
  })

  it('mints no App token anywhere in the workflow', () => {
    expect(workflowRaw).not.toContain('create-github-app-token')
    expect(workflowRaw).not.toMatch(/APPLICATION_PRIVATE_KEY|RELEASE_APP/u)
  })

  it('does not collide with a required status check context in settings.yml', () => {
    const settings = parse(readRaw('.github/settings.yml')) as {
      branches: {name?: string; protection?: {required_status_checks?: {contexts?: unknown[]}}}[]
    }
    const contexts = settings.branches.find(branch => branch.name === 'main')?.protection?.required_status_checks
      ?.contexts
    expect(Array.isArray(contexts) && contexts.length > 0).toBe(true)
    for (const job of Object.values(workflow.jobs)) {
      expect(contexts).not.toContain(job.name)
    }
  })
})

describe('release-wiki-write-core.yaml gating', () => {
  it('has publish need decide and build', () => {
    expect(publishJob?.needs).toEqual(['decide', 'build'])
  })

  it('requires both jobs to succeed and a releasable decided type before publish runs', () => {
    const condition = String(publishJob?.if ?? '').replaceAll(/\s+/gu, ' ')
    expect(condition).toContain("needs.decide.result == 'success'")
    expect(condition).toContain("needs.build.result == 'success'")
    expect(condition).toContain('needs.decide.outputs.type')
    expect(condition).toContain('["major","minor","patch"]')
    expect(condition).toContain("github.ref == 'refs/heads/main'")
    expect(condition).not.toMatch(/always\(\)|failure\(\)|!\s*cancelled\(\)/u)
  })

  it('has no escape hatch on publish steps', () => {
    for (const step of publishJob?.steps ?? []) {
      expect(step).not.toHaveProperty('continue-on-error')
      expect(String(step.if ?? '')).not.toMatch(/always\(\)|failure\(\)|!\s*cancelled\(\)/u)
    }
  })

  it('exposes the decided type, version and base tag as decide outputs', () => {
    const outputs = (decideJob as WorkflowJob & {outputs?: Record<string, string>}).outputs
    expect(outputs).toEqual({
      type: expression('steps.decision.outputs.type'),
      version: expression('steps.decision.outputs.version'),
      'base-tag': expression('steps.decision.outputs.base-tag'),
    })
  })

  it('runs the real-plugin integration tests against the scratch install before deciding', () => {
    const installIndex = stepIndexById(decideJob, 'decision') - 2
    const steps = decideJob?.steps ?? []
    expect(runOf(steps[installIndex] ?? {})).toBe('node scripts/wiki-write-core-release.ts install')
    expect(runOf(steps[installIndex + 1] ?? {})).toBe('pnpm exec vitest run scripts/wiki-write-core-release.test.ts')
    const prefixes = steps.slice(installIndex, installIndex + 3).map(step => step.env?.WIKI_WRITE_CORE_RELEASE_PREFIX)
    expect(new Set(prefixes)).toEqual(new Set([`${expression('runner.temp')}/wiki-write-core-release`]))
  })

  it('uploads the notes only when a release was decided', () => {
    const upload = (decideJob?.steps ?? []).find(step => step.uses?.startsWith('actions/upload-artifact@') === true)
    expect(upload?.if).toBe("steps.decision.outputs.type != 'none'")
    expect(upload?.with?.name).toBe('release-notes')
    expect(upload?.with?.['if-no-files-found']).toBe('error')
  })

  it('verifies the committed dist in build', () => {
    expect((buildJob?.steps ?? []).map(step => step.run)).toContain('pnpm check:wiki-write-core-dist')
  })
})

describe('release-wiki-write-core.yaml publish job contents', () => {
  const steps = publishJob?.steps ?? []

  it('uses no local action and runs no repository script', () => {
    for (const step of steps) {
      expect(String(step.uses ?? '')).not.toMatch(/^\.\//u)
      const script = step.run ?? ''
      expect(script).not.toMatch(/\bpnpm\b|\bnpx\b|\bnode\s|scripts\//u)
    }
  })

  it('interpolates no expression into a script: decision values reach shell only as environment variables', () => {
    for (const step of steps) {
      expect(step.run ?? '').not.toContain('${{')
    }
  })

  it('installs exactly the four publish tools, at their pins, with lifecycle scripts disabled', () => {
    const script = runOf(stepById(publishJob, 'install'))
    const installed = [...script.matchAll(/"(@?[^"@\s]+)@\$\{([A-Z_]+)\}"/gu)].map(match => [match[1], match[2]])

    expect(installed).toEqual([
      ['semantic-release', 'SEMANTIC_RELEASE_VERSION'],
      ['@semantic-release/exec', 'SEMANTIC_RELEASE_EXEC_VERSION'],
      ['@semantic-release/npm', 'SEMANTIC_RELEASE_NPM_VERSION'],
      ['@semantic-release/github', 'SEMANTIC_RELEASE_GITHUB_VERSION'],
    ])
    expect(script).toContain('--ignore-scripts')
    expect(script).toContain('--no-package-lock')
    expect(script).not.toMatch(/commit-analyzer|release-notes-generator|conventional-changelog/u)
  })

  it('sets up Node without a registry-url', () => {
    const setupNode = steps.find(step => step.uses?.startsWith('actions/setup-node@') === true)
    expect(setupNode).toBeDefined()
    expect(setupNode?.with).not.toHaveProperty('registry-url')
    expect(setupNode?.with?.['node-version']).toBe(24)
  })

  it('checks npm >= 11.5.1, validates the decision, stages the config, then releases, in that order', () => {
    const order = ['npm-gate', 'install', 'validate', 'notes', 'stage', 'release'].map(id =>
      stepIndexById(publishJob, id),
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(runOf(stepById(publishJob, 'npm-gate'))).toContain('11.5.1')
    expect(runOf(stepById(publishJob, 'validate'))).toContain('git merge-base --is-ancestor')
    expect(runOf(stepById(publishJob, 'validate'))).toContain('git rev-list --count')
  })

  it('runs the release tool from the scratch prefix, not from the checkout', () => {
    const release = stepById(publishJob, 'release')
    expect(runOf(release)).toContain('$RUNNER_TEMP/wiki-write-core-release-tools/node_modules/.bin/semantic-release')
    expect(runOf(release)).toContain('--ci')
  })

  it('puts the publish credentials and script policy on the semantic-release step only', () => {
    const guarded = ['GITHUB_TOKEN', 'GH_TOKEN', 'npm_config_ignore_scripts', 'NPM_CONFIG_PROVENANCE']
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.id === 'release') continue
        for (const key of guarded) {
          expect(step.env ?? {}, `${key} on step "${step.name ?? ''}"`).not.toHaveProperty(key)
        }
      }
    }
    expect(stepById(publishJob, 'release').env).toEqual({
      GITHUB_TOKEN: expression('github.token'),
      GH_TOKEN: expression('github.token'),
      NPM_CONFIG_PROVENANCE: 'true',
      npm_config_ignore_scripts: 'true',
    })
  })

  it('holds no secret anywhere but the release step', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.id === 'release') continue
        expect(JSON.stringify(step)).not.toContain('secrets.')
      }
    }
  })
})

describe('release-wiki-write-core.yaml pins and checkouts', () => {
  it('pins every remote action to a 40-hex-char commit SHA', () => {
    const uses = [...workflowRaw.matchAll(/uses:\s*(\S+)/gu)].map(match => match[1] ?? '')
    expect(uses.length).toBeGreaterThan(0)
    for (const value of uses) {
      if (value.startsWith('./')) continue
      expect(value).toMatch(/@[0-9a-f]{40}$/u)
    }
  })

  it('pins the actions to SHAs the repository already uses elsewhere', () => {
    const others = readdirSync(join(repositoryRoot, '.github/workflows'))
      .filter(file => file !== 'release-wiki-write-core.yaml')
      .map(file => readRaw(`.github/workflows/${file}`))
      .join('\n')
    for (const [, action] of workflowRaw.matchAll(/uses:\s*(\S+@[0-9a-f]{40})/gu)) {
      expect(others, `${action ?? ''} is not pinned elsewhere in this repository`).toContain(action ?? '')
    }
  })

  it('disables credential persistence on every checkout', () => {
    const checkouts = Object.values(workflow.jobs)
      .flatMap(job => job.steps)
      .filter(step => step.uses?.startsWith('actions/checkout@') === true)
    expect(checkouts).toHaveLength(3)
    for (const checkout of checkouts) {
      expect(checkout.with?.['persist-credentials']).toBe(false)
      expect(checkout.with?.ref).toBe(expression('github.sha'))
    }
  })

  it('fetches full history and tags in decide and publish', () => {
    for (const job of [decideJob, publishJob]) {
      const checkout = job?.steps.find(step => step.uses?.startsWith('actions/checkout@') === true)
      expect(checkout?.with?.['fetch-depth']).toBe(0)
    }
  })
})

describe('release-wiki-write-core.yaml release tool pins', () => {
  it('declares every tool as an exact workflow-level pin', () => {
    const pins = parseToolPins(workflowRaw, 'release-wiki-write-core.yaml')

    expect(Object.keys(pins).toSorted()).toEqual(RELEASE_TOOLS.map(({name}) => name).toSorted())
    expect(pins).toMatchObject({
      'semantic-release': '25.0.9',
      '@semantic-release/exec': '7.1.0',
      '@semantic-release/npm': '13.2.0',
      '@semantic-release/github': '12.0.10',
      '@semantic-release/commit-analyzer': '13.0.1',
      '@semantic-release/release-notes-generator': '14.1.1',
      'conventional-changelog-conventionalcommits': '10.4.1',
      'conventional-changelog-writer': '9.3.0',
    })
  })

  it('gives every pin a renovate comment naming the tool it tracks', () => {
    for (const {name, versionKey} of RELEASE_TOOLS) {
      const line = workflowRaw.split('\n').find(candidate => candidate.trimStart().startsWith(`${versionKey}:`))
      expect(line, `${versionKey} line`).toBeDefined()
      expect(line).toMatch(
        new RegExp(` # renovate: datasource=npm depName=${name.replaceAll('/', String.raw`\/`)}$`, 'u'),
      )
    }
  })

  it('declares the pins once: main.yaml reads them from this workflow', () => {
    const main = parse(readRaw('.github/workflows/main.yaml')) as {env?: Record<string, unknown>}
    for (const {versionKey} of RELEASE_TOOLS) {
      expect(main.env ?? {}).not.toHaveProperty(versionKey)
    }
  })

  it('re-enables patch updates for exactly these tools in .github/renovate.json5, after the rule that disables them', () => {
    // JSON5 without the comment lines is a YAML flow mapping, which `yaml` parses.
    const text = readRaw('.github/renovate.json5')
      .split('\n')
      .filter(line => !line.trimStart().startsWith('//'))
      .join('\n')
    const config = parse(text) as {
      packageRules: {matchUpdateTypes?: string[]; matchPackageNames?: string[]; enabled?: boolean}[]
    }
    const disableIndex = config.packageRules.findIndex(
      rule => rule.matchUpdateTypes?.includes('patch') === true && rule.enabled === false,
    )
    const enableIndex = config.packageRules.findIndex(
      rule => rule.matchUpdateTypes?.includes('patch') === true && rule.enabled === true,
    )

    expect(disableIndex).toBeGreaterThanOrEqual(0)
    expect(enableIndex).toBeGreaterThan(disableIndex)
    expect(config.packageRules[enableIndex]?.matchPackageNames?.toSorted()).toEqual(
      RELEASE_TOOLS.map(({name}) => name).toSorted(),
    )
  })

  it('leaves no other semantic-release config at the repository root for the gated config to compete with', () => {
    const rootFiles = readdirSync(repositoryRoot)
    expect(rootFiles.filter(file => /^\.releaserc|^release\.config\./u.test(file))).toEqual([])
    const rootManifest = JSON.parse(readRaw('package.json')) as Record<string, unknown>
    expect(rootManifest).not.toHaveProperty('release')
  })
})

// -- running the publish job's shell -------------------------------------------------------------------

interface ShellResult {
  status: number
  stdout: string
  stderr: string
}

function runShell(script: string, cwd: string, env: Record<string, string>): ShellResult {
  const scriptPath = join(cwd, '.step.sh')
  writeFileSync(scriptPath, script)
  try {
    const stdout = execFileSync('bash', ['-Eeuo', 'pipefail', scriptPath], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {PATH: process.env.PATH ?? '', HOME: cwd, ...env},
    })
    return {status: 0, stdout, stderr: ''}
  } catch (error) {
    const failure = error as {status?: number; stdout?: string; stderr?: string}
    return {status: failure.status ?? 1, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? '')}
  } finally {
    rmSync(scriptPath, {force: true})
  }
}

function gitIn(dir: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH ?? '',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  })
}

describe('publish: validate release decision (run under bash against a real repository)', () => {
  const script = runOf(stepById(publishJob, 'validate'))
  let dir: string
  let counter = 0

  function commit(message: string, file: string): void {
    counter += 1
    mkdirSync(dirname(join(dir, file)), {recursive: true})
    writeFileSync(join(dir, file), `change ${counter}\n`)
    gitIn(dir, 'add', '--all')
    gitIn(dir, 'commit', '--quiet', '--message', message)
  }

  function validate(decision: {type: string; version: string; baseTag: string}): ShellResult {
    return runShell(script, dir, {
      DECISION_TYPE: decision.type,
      DECISION_VERSION: decision.version,
      DECISION_BASE_TAG: decision.baseTag,
    })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'release-publish-validate-'))
    counter = 0
    gitIn(dir, 'init', '--quiet', '--initial-branch', 'main')
    commit('chore: seed', 'README.md')
    gitIn(dir, 'tag', 'wiki-write-core-v0.1.0')
    commit('feat: change the package', 'packages/wiki-write-core/src/x.ts')
  })

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true})
  })

  it('accepts a consistent decision that has a package commit since the base tag', () => {
    expect(validate({type: 'minor', version: '0.2.0', baseTag: 'wiki-write-core-v0.1.0'})).toMatchObject({status: 0})
    expect(validate({type: 'patch', version: '0.1.1', baseTag: 'wiki-write-core-v0.1.0'})).toMatchObject({status: 0})
  })

  it('rejects a major release from a 0.x base, even when the version is the recomputed 1.0.0', () => {
    const result = validate({type: 'major', version: '1.0.0', baseTag: 'wiki-write-core-v0.1.0'})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('::error::a 0.x package does not release a major version')
  })

  it('accepts a major release from a base of 1.x or higher', () => {
    gitIn(dir, 'tag', 'wiki-write-core-v1.2.0')
    commit('feat!: break the package', 'packages/wiki-write-core/src/y.ts')

    expect(validate({type: 'major', version: '2.0.0', baseTag: 'wiki-write-core-v1.2.0'})).toMatchObject({status: 0})
  })

  it.each([
    ['an unknown type', 'rc', '0.2.0'],
    ['an empty type', '', '0.2.0'],
    ['a type that is a prefix match', 'minor ', '0.2.0'],
    ['a type that smuggles a command', '$(touch pwned)', '0.2.0'],
    ['a multi-line type', 'minor\nfoo', '0.2.0'],
  ])('rejects %s before semantic-release', (_label, type, version) => {
    const result = validate({type, version, baseTag: 'wiki-write-core-v0.1.0'})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('::error::the decided release type')
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
  })

  it.each([
    ['a two-part version', '0.2'],
    ['a prerelease version', '0.2.0-rc.1'],
    ['a leading-zero version', '0.02.0'],
    ['a version with a suffix', '0.2.0 && echo'],
    ['an empty version', ''],
  ])('rejects %s', (_label, version) => {
    const result = validate({type: 'minor', version, baseTag: 'wiki-write-core-v0.1.0'})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('::error::the decided version is not x.y.z')
  })

  it.each([
    ['an unprefixed tag', 'v0.1.0'],
    ['another package tag', 'other-v0.1.0'],
    ['a prerelease tag', 'wiki-write-core-v0.1.0-rc.1'],
    ['a tag with a ref suffix', 'wiki-write-core-v0.1.0^{commit}'],
    ['an empty tag', ''],
  ])('rejects %s', (_label, baseTag) => {
    const result = validate({type: 'minor', version: '0.2.0', baseTag})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('::error::the decided base tag is not a wiki-write-core-v tag')
  })

  it.each([
    ['a minor version that is the patch increment', 'minor', '0.1.1'],
    ['a patch version that is the minor increment', 'patch', '0.2.0'],
    ['a major version that stays on 0.x', 'major', '0.2.0'],
    ['a version below the base', 'minor', '0.0.1'],
    ['a skipped version', 'minor', '0.3.0'],
  ])('rejects a received version that differs from the recomputed one: %s', (_label, type, version) => {
    const result = validate({type, version, baseTag: 'wiki-write-core-v0.1.0'})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('::error::the decided version is not the base tag version incremented')
  })

  it('rejects a releasable type when no commit since the base tag touches the package', () => {
    gitIn(dir, 'tag', 'wiki-write-core-v0.2.0')
    commit('feat: scripts only', 'scripts/a.ts')

    const result = validate({type: 'minor', version: '0.3.0', baseTag: 'wiki-write-core-v0.2.0'})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('::error::no commit since the base tag changes packages/wiki-write-core/')
  })

  it('rejects a sibling directory that shares the package name as a prefix', () => {
    gitIn(dir, 'tag', 'wiki-write-core-v0.2.0')
    commit('feat: sibling', 'packages/wiki-write-core-extra/src/x.ts')

    const result = validate({type: 'minor', version: '0.3.0', baseTag: 'wiki-write-core-v0.2.0'})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('::error::no commit since the base tag changes')
  })

  it('rejects a well-formed base tag that is not in the checkout', () => {
    const result = validate({type: 'minor', version: '0.6.0', baseTag: 'wiki-write-core-v0.5.0'})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('::error::the decided base tag is not present in this checkout')
  })

  it('rejects a base tag that is not an ancestor of the checked-out commit', () => {
    gitIn(dir, 'switch', '--quiet', '--create', 'side')
    commit('feat: on a side branch', 'packages/wiki-write-core/src/side.ts')
    gitIn(dir, 'tag', 'wiki-write-core-v0.5.0')
    gitIn(dir, 'switch', '--quiet', 'main')

    const result = validate({type: 'minor', version: '0.6.0', baseTag: 'wiki-write-core-v0.5.0'})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('::error::the decided base tag is not an ancestor')
  })

  it('never echoes a decided value', () => {
    const result = validate({type: 'UNIQUE-TYPE-MARKER', version: '0.2.0', baseTag: 'wiki-write-core-v0.1.0'})

    expect(result.stdout + result.stderr).not.toContain('UNIQUE-TYPE-MARKER')
  })
})

describe('publish: stage release config (run under bash)', () => {
  const script = runOf(stepById(publishJob, 'stage'))
  const releaserc = parse(readRaw('packages/wiki-write-core/.releaserc.yaml')) as {
    branches: string[]
    tagFormat: string
  }
  let dir: string
  let runnerTemp: string

  function stage(overrides: Record<string, string> = {}): ShellResult {
    return runShell(script, dir, {
      RUNNER_TEMP: runnerTemp,
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'fro-bot/.github',
      DECISION_TYPE: 'minor',
      DECISION_VERSION: '0.2.0',
      ...overrides,
    })
  }

  function stagedConfig(): {
    branches: string[]
    tagFormat: string
    repositoryUrl: string
    plugins: [string, Record<string, unknown>][]
  } {
    return JSON.parse(readFileSync(join(dir, '.releaserc.json'), 'utf8')) as ReturnType<typeof stagedConfig>
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'release-publish-stage-'))
    runnerTemp = join(dir, 'runner-temp')
    mkdirSync(join(runnerTemp, 'release-notes'), {recursive: true})
    writeFileSync(join(runnerTemp, 'release-notes', 'notes.md'), '## 0.2.0\n\n* a note\n')
    mkdirSync(join(dir, 'packages/wiki-write-core'), {recursive: true})
    writeFileSync(join(dir, 'packages/wiki-write-core/.releaserc.yaml'), 'branches: [main]\n')
  })

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true})
  })

  it('deletes the package config and writes a root config as the only one', () => {
    expect(stage()).toMatchObject({status: 0})

    expect(existsSync(join(dir, 'packages/wiki-write-core/.releaserc.yaml'))).toBe(false)
    expect(readdirSync(dir).filter(file => file.startsWith('.releaserc'))).toEqual(['.releaserc.json'])
  })

  it('lists exec, npm and github, in that order, and no commit analyzer or notes generator', () => {
    stage()

    const config = stagedConfig()
    expect(config.plugins.map(([name]) => name)).toEqual([
      '@semantic-release/exec',
      '@semantic-release/npm',
      '@semantic-release/github',
    ])
    expect(JSON.stringify(config)).not.toMatch(/commit-analyzer|release-notes-generator/u)
  })

  it('takes branches and tagFormat from the package release policy', () => {
    stage()

    const config = stagedConfig()
    expect(config.branches).toEqual(releaserc.branches)
    expect(config.tagFormat).toBe(releaserc.tagFormat)
    expect(config.repositoryUrl).toBe('https://github.com/fro-bot/.github.git')
  })

  it('publishes from the package directory and keeps the GitHub plugin from commenting or labeling', () => {
    stage()

    const [, , github] = stagedConfig().plugins
    const npm = stagedConfig().plugins[1]
    expect(npm?.[1]).toEqual({pkgRoot: 'packages/wiki-write-core'})
    expect(github?.[1]).toEqual({releasedLabels: false, successComment: false, failComment: false, failTitle: false})
  })

  it('gates the release on the approved type, version and notes file', () => {
    stage({DECISION_TYPE: 'patch', DECISION_VERSION: '0.1.1'})

    const exec = stagedConfig().plugins[0]?.[1]
    expect(exec).toEqual({
      analyzeCommitsCmd: 'echo patch',
      verifyReleaseCmd: `test "${NEXT_RELEASE_VERSION}" = "0.1.1"`,
      generateNotesCmd: `cat "${join(runnerTemp, 'release-notes', 'notes.md')}"`,
    })
  })

  it.each([
    ['is missing', (notesDir: string) => rmSync(join(notesDir, 'notes.md'))],
    ['is empty', (notesDir: string) => writeFileSync(join(notesDir, 'notes.md'), '')],
    [
      'is a symlink',
      (notesDir: string) => {
        rmSync(join(notesDir, 'notes.md'))
        writeFileSync(join(notesDir, '..', 'target.md'), 'secret')
        symlinkSync(join(notesDir, '..', 'target.md'), join(notesDir, 'notes.md'))
      },
    ],
    ['sits beside another file', (notesDir: string) => writeFileSync(join(notesDir, 'extra.md'), 'x')],
  ])('rejects a notes artifact that %s, without writing a config', (_label, tamper) => {
    tamper(join(runnerTemp, 'release-notes'))

    const result = stage()

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain(
      '::error::the release notes artifact must contain exactly one non-empty regular file',
    )
    expect(existsSync(join(dir, '.releaserc.json'))).toBe(false)
    expect(existsSync(join(dir, 'packages/wiki-write-core/.releaserc.yaml'))).toBe(true)
  })
})
