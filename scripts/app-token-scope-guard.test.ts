/**
 * Repo-wide contract: every `actions/create-github-app-token` mint in `.github/workflows/` is
 * pinned to an expected (permissions, repository reach) row, keyed by `(workflow file, job id,
 * step id)`.
 *
 * Why: a mint with no `permission-*` input carries every permission of the App installation, and
 * an `owner` with no `repositories` reaches every repo the installation covers. Per-workflow tests
 * can't see a new mint added to an unrelated workflow; this scan can. See
 * docs/plans/2026-10-09-003-fix-app-token-least-privilege-plan.md.
 *
 * Three reach kinds:
 *   - `repo`:          `repositories: ${{ github.event.repository.name }}`, no `owner`
 *                      (a row may pin an explicit `owner` where the workflow already sets one).
 *   - `computed list`: a fixed `owner`, the exact `repositories:` expression, and the exact
 *                      non-empty `if:` guard on both the mint and its consuming step.
 *   - `owner-wide`:    `owner` and no `repositories`. Exemption rows only, each with a recorded
 *                      justification. Read-only, except the pinned cross-repo dispatch targets.
 *
 * Every rule fails closed and reads parsed `with` keys, never workflow text, so a comment that
 * mentions a permission counts for nothing.
 */

import {readdirSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

/** Builds a GitHub Actions expression without tripping no-template-curly-in-string. */
const gh = (inner: string): string => `$${'{{'} ${inner} }}`

/**
 * Every spelling of `steps.<id>.outputs.token` other than the canonical dot form that GitHub's
 * expression parser accepts: bracket notation with either quote style, mixed notation, extra
 * whitespace and any letter case (contexts are case-insensitive).
 */
const BRACKET_TOKEN_FORMS = (id: string): [string, string][] =>
  [
    `steps['${id}'].outputs.token`,
    `steps["${id}"].outputs.token`,
    `steps['${id}']['outputs']['token']`,
    `steps["${id}"]["outputs"]["token"]`,
    `steps.${id}['outputs'].token`,
    `steps.${id}.outputs["token"]`,
    `steps['${id}'].outputs['token']`,
    `steps [ '${id}' ] . outputs [ "token" ]`,
    `STEPS.${id.toUpperCase()}.OUTPUTS.TOKEN`,
  ].map(expression => [expression, expression])

/** Leaks that are not the `token` output but still read a mint's outputs. */
const OTHER_OUTPUT_FORMS = (id: string): [string, string][] =>
  [`toJSON(steps['${id}'].outputs)`, `steps['${id}'].outputs.other`, `toJSON(steps.${id}.outputs)`].map(expression => [
    expression,
    expression,
  ])

const LEAK_FORMS = (id: string): [string, string][] => [...BRACKET_TOKEN_FORMS(id), ...OTHER_OUTPUT_FORMS(id)]

const MINT_USES_PREFIX = 'actions/create-github-app-token@'
const PERMISSION_PREFIX = 'permission-'
const FORBIDDEN_PERMISSIONS = new Set(['workflows', 'administration'])
const REPO_EXPRESSION = gh('github.event.repository.name')
const REPOSITORY_OWNER = gh('github.repository_owner')

// ─── Expected-scope table (TARGET state, including the post-split mints) ────

type Permissions = Readonly<Record<string, 'read' | 'write'>>

type Reach =
  | {readonly kind: 'repo'; readonly owner?: string}
  | {
      readonly kind: 'computed list'
      readonly owner: string
      readonly repositories: string
      /** Exact non-empty `if:` expression required on the mint and on its consuming step. */
      readonly guard: string
      /** Step id of the step that consumes this mint's token. */
      readonly consumer: string
    }
  | {readonly kind: 'owner-wide'; readonly owner: string; readonly justification: string}

type Row = Reach & {
  readonly file: string
  readonly job: string
  readonly id: string
  readonly permissions: Permissions
}

const CROSS_REPO_DISPATCH_TARGET =
  'Target repos are arbitrary registry entries under a fixed owner. The dispatch job runs only after the dispatch-approved label is added by marcusrbrown, the token is minted after that gate, the script rechecks the sender, and targets are checked against the metadata/repos.yaml registry. Re-evaluate if target selection stops being operator-approved and registry-gated, or the owner set grows.'
const CROSS_REPO_TRACK_TARGET =
  'Reads workflow-run status in the same operator-approved dispatch targets under a fixed owner. Read-only (actions: read).'
const SURVEY_VISIBILITY_LOOKUP =
  'The node-ID visibility lookup targets arbitrary repos the App is installed on. Read-only (metadata: read).'
const INSTALLATION_DISCOVERY =
  'GET /installation/repositories returns only repos the token can access, so installation discovery needs an owner-wide token. Read-only; contents are read only at fixed probe paths.'
const RENOVATE_DISCOVERY =
  'GET /installation/repositories returns only repos the token can access, so listing the installation needs an owner-wide token. Read-only (metadata: read); the dispatch token is minted afterwards, scoped to the intersection.'

const EXPECTED_ROWS: readonly Row[] = [
  {
    file: 'capture-learnings.yaml',
    job: 'capture-learnings-publish',
    id: 'get-workflow-app-token',
    kind: 'repo',
    permissions: {issues: 'write', contents: 'read'},
  },
  {
    file: 'capture-patterns.yaml',
    job: 'open-publish',
    id: 'app-token',
    kind: 'repo',
    permissions: {issues: 'write', contents: 'read'},
  },
  // Control-plane tokens already name an explicit owner; the row pins it.
  {
    file: 'cross-repo-dispatch.yaml',
    job: 'dispatch',
    id: 'control-plane-token',
    kind: 'repo',
    owner: REPOSITORY_OWNER,
    permissions: {issues: 'write'},
  },
  {
    file: 'cross-repo-dispatch.yaml',
    job: 'dispatch',
    id: 'dispatch-token-fro-bot',
    kind: 'owner-wide',
    owner: 'fro-bot',
    justification: CROSS_REPO_DISPATCH_TARGET,
    permissions: {actions: 'write'},
  },
  {
    file: 'cross-repo-dispatch.yaml',
    job: 'dispatch',
    id: 'dispatch-token-marcusrbrown',
    kind: 'owner-wide',
    owner: 'marcusrbrown',
    justification: CROSS_REPO_DISPATCH_TARGET,
    permissions: {actions: 'write'},
  },
  {
    file: 'cross-repo-dispatch.yaml',
    job: 'track',
    id: 'control-plane-token',
    kind: 'repo',
    owner: REPOSITORY_OWNER,
    permissions: {issues: 'write'},
  },
  {
    file: 'cross-repo-dispatch.yaml',
    job: 'track',
    id: 'track-token-fro-bot',
    kind: 'owner-wide',
    owner: 'fro-bot',
    justification: CROSS_REPO_TRACK_TARGET,
    permissions: {actions: 'read'},
  },
  {
    file: 'cross-repo-dispatch.yaml',
    job: 'track',
    id: 'track-token-marcusrbrown',
    kind: 'owner-wide',
    owner: 'marcusrbrown',
    justification: CROSS_REPO_TRACK_TARGET,
    permissions: {actions: 'read'},
  },
  {
    file: 'dispatch-renovate.yaml',
    job: 'dispatch-renovate',
    id: 'discovery-token',
    kind: 'owner-wide',
    owner: 'fro-bot',
    justification: RENOVATE_DISCOVERY,
    permissions: {metadata: 'read'},
  },
  {
    file: 'dispatch-renovate.yaml',
    job: 'dispatch-renovate',
    id: 'dispatch-token',
    kind: 'computed list',
    owner: 'fro-bot',
    repositories: gh('steps.plan.outputs.repositories'),
    guard: "steps.plan.outputs.repositories != ''",
    consumer: 'dispatch',
    permissions: {actions: 'write'},
  },
  {
    file: 'draft-solutions.yaml',
    job: 'publish',
    id: 'get-workflow-app-token',
    kind: 'repo',
    permissions: {contents: 'write', 'pull-requests': 'write', issues: 'write'},
  },
  {
    file: 'draft-solutions.yaml',
    job: 'publish',
    id: 'get-review-app-token',
    kind: 'repo',
    permissions: {'pull-requests': 'write'},
  },
  {
    file: 'fro-bot.yaml',
    job: 'fro-bot-wiki-ingest',
    id: 'app-token',
    kind: 'repo',
    permissions: {contents: 'write'},
  },
  {
    file: 'fro-bot.yaml',
    job: 'fro-bot-observe-announce',
    id: 'report-token',
    kind: 'repo',
    permissions: {issues: 'read'},
  },
  {
    file: 'fro-bot.yaml',
    job: 'fro-bot-observe-wiki-ingest',
    id: 'app-token',
    kind: 'repo',
    permissions: {contents: 'write'},
  },
  {
    file: 'improvement-metrics.yaml',
    job: 'report',
    id: 'app-token',
    kind: 'repo',
    permissions: {issues: 'write', contents: 'read'},
  },
  // manage-cache: `gh cache list` / `gh cache delete` need Actions read/write.
  {
    file: 'manage-cache.yaml',
    job: 'cleanup-cache',
    id: 'get-workflow-app-token',
    kind: 'repo',
    permissions: {actions: 'write'},
  },
  // close-automated-reports: `gh issue list` / `gh issue close --comment`.
  {
    file: 'manage-issues.yaml',
    job: 'close-automated-reports',
    id: 'get-workflow-app-token',
    kind: 'repo',
    permissions: {issues: 'write'},
  },
  // actions/stale without delete-branch: no contents write.
  {
    file: 'manage-issues.yaml',
    job: 'stale',
    id: 'get-workflow-app-token',
    kind: 'repo',
    permissions: {actions: 'write', issues: 'write', 'pull-requests': 'write'},
  },
  // merge-data: pulls.updateBranch needs contents write on the head repo; labels and the conflict journal need issues write.
  {
    file: 'merge-data.yaml',
    job: 'merge-data',
    id: 'get-workflow-app-token',
    kind: 'repo',
    permissions: {contents: 'write', 'pull-requests': 'write', issues: 'write'},
  },
  {
    file: 'poll-invitations.yaml',
    job: 'poll-invitations',
    id: 'metadata-token',
    kind: 'repo',
    permissions: {contents: 'write'},
  },
  // reconcile-repos (post-split): ids are `discovery-token` / `writer-token`.
  {
    file: 'reconcile-repos.yaml',
    job: 'reconcile-repos',
    id: 'discovery-token',
    kind: 'owner-wide',
    owner: REPOSITORY_OWNER,
    justification: INSTALLATION_DISCOVERY,
    permissions: {metadata: 'read', contents: 'read'},
  },
  {
    file: 'reconcile-repos.yaml',
    job: 'reconcile-repos',
    id: 'writer-token',
    kind: 'repo',
    permissions: {contents: 'write', issues: 'write', actions: 'write'},
  },
  {
    file: 'reset-survey-status.yaml',
    job: 'reset-survey-status',
    id: 'get-workflow-app-token',
    kind: 'repo',
    permissions: {contents: 'write'},
  },
  {
    file: 'status-truth.yaml',
    job: 'open',
    id: 'app-token',
    kind: 'repo',
    permissions: {issues: 'write', contents: 'read'},
  },
  {
    file: 'status-truth.yaml',
    job: 'prs',
    id: 'app-token',
    kind: 'repo',
    permissions: {contents: 'write', 'pull-requests': 'write', issues: 'write'},
  },
  {
    file: 'status-truth.yaml',
    job: 'prs',
    id: 'fetch-token',
    kind: 'repo',
    permissions: {contents: 'read', 'pull-requests': 'read', issues: 'read'},
  },
  {
    file: 'survey-repo.yaml',
    job: 'survey-resolve',
    id: 'gate-token',
    kind: 'owner-wide',
    owner: REPOSITORY_OWNER,
    justification: SURVEY_VISIBILITY_LOOKUP,
    permissions: {metadata: 'read'},
  },
  {
    file: 'survey-repo.yaml',
    job: 'survey-persist',
    id: 'app-token',
    kind: 'repo',
    permissions: {contents: 'write'},
  },
  {
    file: 'survey-repo.yaml',
    job: 'survey-persist',
    id: 'recheck-token',
    kind: 'owner-wide',
    owner: REPOSITORY_OWNER,
    justification: SURVEY_VISIBILITY_LOOKUP,
    permissions: {metadata: 'read'},
  },
  // update-metadata (post-split): ids are `discovery-token` / `writer-token`.
  {
    file: 'update-metadata.yaml',
    job: 'update-metadata',
    id: 'discovery-token',
    kind: 'owner-wide',
    owner: REPOSITORY_OWNER,
    justification: INSTALLATION_DISCOVERY,
    permissions: {metadata: 'read', contents: 'read'},
  },
  {
    file: 'update-metadata.yaml',
    job: 'update-metadata',
    id: 'writer-token',
    kind: 'repo',
    permissions: {contents: 'write'},
  },
  // wiki-lint issue sync: wiki-lint-issues.ts makes issues.* calls only, no contents calls.
  {
    file: 'wiki-lint.yaml',
    job: 'wiki-lint-issue-sync',
    id: 'app-token',
    kind: 'repo',
    permissions: {issues: 'write'},
  },
  {
    file: 'wiki-lint.yaml',
    job: 'wiki-repair',
    id: 'app-token',
    kind: 'repo',
    permissions: {contents: 'write'},
  },
]

/**
 * The only owner-wide mints allowed to hold a write permission: the cross-repo dispatch targets,
 * pinned by exact key AND owner. Independent of the table so a table edit alone can't widen it.
 */
const OWNER_WIDE_WRITE_ALLOWED: readonly {readonly key: string; readonly owner: string}[] = [
  {key: 'cross-repo-dispatch.yaml#dispatch#dispatch-token-fro-bot', owner: 'fro-bot'},
  {key: 'cross-repo-dispatch.yaml#dispatch#dispatch-token-marcusrbrown', owner: 'marcusrbrown'},
]

/** Row count and file count the scan must cover; a refactor that stops matching mints fails loudly. */
const EXPECTED_ROW_COUNT = 34
const EXPECTED_MINT_FILE_COUNT = 17
/** Mint census before this change (31); the tree must never scan fewer. */
const MINT_CENSUS_FLOOR = 31

// ─── Scanner ────────────────────────────────────────────────────────────────

interface Mint {
  readonly key: string
  readonly file: string
  readonly job: string
  readonly id: string | undefined
  readonly stepIndex: number
  readonly steps: readonly unknown[]
  readonly owner: unknown
  readonly hasOwner: boolean
  readonly repositories: unknown
  readonly hasRepositories: boolean
  readonly ifExpression: unknown
  readonly permissions: Readonly<Record<string, unknown>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ─── Step-output references (dot and bracket notation) ──────────────────────

const escapeRegExp = (text: string): string => text.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`)

/** One property access in a GitHub expression: `.name`, `['name']` or `["name"]`, whitespace-tolerant. */
const accessor = (name: string): string => {
  const escaped = escapeRegExp(name)
  return String.raw`(?:\s*\.\s*${escaped}|\s*\[\s*(?:'${escaped}'|"${escaped}")\s*\])`
}

/**
 * Matches `steps.<stepId>.outputs` (and, when `output` is given, `.<output>`) in every notation
 * GitHub's expression parser accepts: dot or bracket access with either quote style, mixed
 * notation, spaces, and any letter case. Without `output`, any property of `outputs` (or the
 * `outputs` object itself) matches. Matches the identifier exactly, never a prefix of a longer id.
 */
function stepOutputPattern(stepId: string, output?: string): RegExp {
  const tail = output === undefined ? String.raw`(?![\w-])` : `${accessor(output)}(?![\w-])`
  return new RegExp(String.raw`(?<![\w.-])steps${accessor(stepId)}${accessor('outputs')}${tail}`, 'gi')
}

/** Every string (keys and leaves) in a parsed YAML value, unescaped; JSON.stringify would escape quotes. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(item => stringsIn(item))
  if (isRecord(value)) return Object.entries(value).flatMap(([key, item]) => [key, ...stringsIn(item)])
  return []
}

/** How many times `value` references a step's outputs, in any notation. */
function countStepOutputRefs(value: unknown, stepId: string, output?: string): number {
  const pattern = stepOutputPattern(stepId, output)
  return stringsIn(value).reduce((total, text) => total + [...text.matchAll(pattern)].length, 0)
}

const keyOf = (file: string, job: string, id: string | undefined): string => `${file}#${job}#${id ?? '(no step id)'}`

/** Collects every create-github-app-token step from already-parsed workflows, keyed by file name. */
function collectMints(workflows: Readonly<Record<string, unknown>>): Mint[] {
  const mints: Mint[] = []
  for (const [file, workflow] of Object.entries(workflows)) {
    if (!isRecord(workflow) || !isRecord(workflow.jobs)) {
      throw new TypeError(`${file}: workflow does not have the expected jobs shape`)
    }
    for (const [job, jobValue] of Object.entries(workflow.jobs)) {
      if (!isRecord(jobValue) || !Array.isArray(jobValue.steps)) continue
      const steps: unknown[] = jobValue.steps
      for (const [stepIndex, step] of steps.entries()) {
        if (!isRecord(step) || typeof step.uses !== 'string' || !step.uses.startsWith(MINT_USES_PREFIX)) continue
        const withBlock = isRecord(step.with) ? step.with : {}
        const permissions: Record<string, unknown> = {}
        for (const [name, value] of Object.entries(withBlock)) {
          if (name.startsWith(PERMISSION_PREFIX)) permissions[name.slice(PERMISSION_PREFIX.length)] = value
        }
        const id = typeof step.id === 'string' && step.id !== '' ? step.id : undefined
        mints.push({
          key: keyOf(file, job, id),
          file,
          job,
          id,
          stepIndex,
          steps,
          owner: withBlock.owner,
          hasOwner: 'owner' in withBlock,
          repositories: withBlock.repositories,
          hasRepositories: 'repositories' in withBlock,
          ifExpression: step.if,
          permissions,
        })
      }
    }
  }
  return mints
}

const workflowsDir = resolve(import.meta.dirname, '../.github/workflows')

function loadWorkflows(): Record<string, unknown> {
  const workflows: Record<string, unknown> = {}
  for (const name of readdirSync(workflowsDir)) {
    if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue
    workflows[name] = parse(readFileSync(resolve(workflowsDir, name), 'utf8'))
  }
  return workflows
}

// ─── Rules ──────────────────────────────────────────────────────────────────

/** Rules that hold for any mint regardless of the table. */
function intrinsicViolations(mint: Mint): string[] {
  const violations: string[] = []
  const {key} = mint

  if (mint.id === undefined) violations.push(`${key}: mint has no step id`)

  const entries = Object.entries(mint.permissions)
  if (entries.length === 0) violations.push(`${key}: mint has no permission-* input`)
  for (const [name, value] of entries) {
    if (FORBIDDEN_PERMISSIONS.has(name)) violations.push(`${key}: permission-${name} is forbidden`)
    if (value !== 'read' && value !== 'write') {
      violations.push(`${key}: permission-${name} must be the string read or write`)
    }
  }

  if (mint.hasRepositories && (typeof mint.repositories !== 'string' || mint.repositories.trim() === '')) {
    violations.push(`${key}: repositories is empty, whitespace or not a string`)
  }
  if (mint.hasOwner && (typeof mint.owner !== 'string' || mint.owner.trim() === '')) {
    violations.push(`${key}: owner is empty, whitespace or not a string`)
  }
  if (!mint.hasOwner && !mint.hasRepositories) {
    violations.push(`${key}: mint sets neither owner nor repositories (reach must be explicit)`)
  }

  const ownerWide = mint.hasOwner && !mint.hasRepositories
  if (ownerWide) {
    const writes = entries.filter(([, value]) => value === 'write').map(([name]) => name)
    const allowed = OWNER_WIDE_WRITE_ALLOWED.some(entry => entry.key === mint.key && entry.owner === mint.owner)
    if (writes.length > 0 && !allowed) {
      violations.push(`${key}: owner-wide mint holds write permission(s): ${writes.join(', ')}`)
    }
  }

  return violations
}

function samePermissions(actual: Readonly<Record<string, unknown>>, expected: Permissions): boolean {
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expected).sort()
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((name, index) => name === expectedKeys[index] && actual[name] === expected[name])
  )
}

function consumerViolations(mint: Mint, row: Extract<Row, {kind: 'computed list'}>): string[] {
  const violations: string[] = []
  const consumerIndex = mint.steps.findIndex(step => isRecord(step) && step.id === row.consumer)
  const consumer = consumerIndex === -1 ? undefined : mint.steps[consumerIndex]
  if (!isRecord(consumer)) {
    violations.push(`${mint.key}: consuming step ${row.consumer} not found in job`)
    return violations
  }
  if (consumerIndex <= mint.stepIndex) {
    violations.push(`${mint.key}: consuming step ${row.consumer} must come after the mint`)
  }
  if (consumer.if !== row.guard) {
    violations.push(`${mint.key}: consuming step ${row.consumer} lacks the non-empty guard ${row.guard}`)
  }
  const tokenRef = `steps.${mint.id}.outputs.token`
  if (mint.id === undefined || countStepOutputRefs(consumer, mint.id, 'token') === 0) {
    violations.push(`${mint.key}: consuming step ${row.consumer} does not use ${tokenRef}`)
  }
  for (const other of mint.steps) {
    if (!isRecord(other) || typeof other.uses !== 'string' || !other.uses.startsWith(MINT_USES_PREFIX)) continue
    if (typeof other.id !== 'string' || other.id === mint.id) continue
    if (countStepOutputRefs(consumer, other.id) > 0) {
      violations.push(`${mint.key}: consuming step ${row.consumer} also uses another mint's token (${other.id})`)
    }
  }
  return violations
}

/** Compares one mint against its table row: exact permissions and exact reach. */
function rowViolations(mint: Mint, row: Row): string[] {
  const violations: string[] = []
  const {key} = mint

  if (!samePermissions(mint.permissions, row.permissions)) {
    violations.push(
      `${key}: permissions ${JSON.stringify(mint.permissions)} differ from expected ${JSON.stringify(row.permissions)}`,
    )
  }

  switch (row.kind) {
    case 'repo': {
      if (mint.repositories !== REPO_EXPRESSION) {
        violations.push(`${key}: repositories must be exactly ${REPO_EXPRESSION}`)
      }
      if (row.owner === undefined ? mint.hasOwner : mint.owner !== row.owner) {
        violations.push(`${key}: owner must be ${row.owner === undefined ? 'absent' : row.owner}`)
      }
      break
    }
    case 'computed list': {
      if (mint.owner !== row.owner) violations.push(`${key}: owner must be exactly ${row.owner}`)
      if (mint.repositories !== row.repositories) {
        violations.push(`${key}: repositories must be exactly ${row.repositories}`)
      }
      if (row.guard.trim() === '') violations.push(`${key}: table row has an empty guard`)
      if (mint.ifExpression !== row.guard) violations.push(`${key}: mint lacks the non-empty guard ${row.guard}`)
      violations.push(...consumerViolations(mint, row))
      break
    }
    case 'owner-wide': {
      if (row.justification.trim() === '') violations.push(`${key}: owner-wide row has no justification`)
      if (mint.owner !== row.owner) violations.push(`${key}: owner must be exactly ${row.owner}`)
      if (mint.hasRepositories) violations.push(`${key}: owner-wide mint must not set repositories`)
      break
    }
  }
  return violations
}

const rowKey = (row: Row): string => keyOf(row.file, row.job, row.id)

/** Mints in the tree that no table row covers (includes mints with no step id). */
function unexpectedMintViolations(mints: readonly Mint[], rows: readonly Row[]): string[] {
  const known = new Set(rows.map(row => rowKey(row)))
  return mints
    .filter(mint => mint.id === undefined || !known.has(mint.key))
    .map(mint => `${mint.key}: mint is not in the expected-scope table`)
}

/** Violations for one table row: it must exist in the tree and match exactly. */
function checkRow(row: Row, mints: readonly Mint[]): string[] {
  const key = rowKey(row)
  const matches = mints.filter(mint => mint.key === key)
  if (matches.length === 0) return [`${key}: table row has no mint in the workflow tree`]
  if (matches.length > 1) return [`${key}: ${matches.length} mints share this key`]
  return rowViolations(matches[0] as Mint, row)
}

/** Every rule, over a whole tree. */
function findViolations(mints: readonly Mint[], rows: readonly Row[]): string[] {
  return [
    ...mints.flatMap(mint => intrinsicViolations(mint)),
    ...unexpectedMintViolations(mints, rows),
    ...rows.flatMap(row => checkRow(row, mints)),
  ]
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const MINT_USES = `${MINT_USES_PREFIX}bcd2ba49218906704ab6c1aa796996da409d3eb1`

interface FixtureStep {
  readonly [key: string]: unknown
}

function mintStep(id: string | undefined, withBlock: Record<string, unknown>, extra: FixtureStep = {}): FixtureStep {
  return {...(id === undefined ? {} : {id}), uses: MINT_USES, with: {...withBlock}, ...extra}
}

function fixtureWorkflow(...steps: FixtureStep[]): Record<string, unknown> {
  return {'a.yaml': {jobs: {job: {steps}}}}
}

function fixtureRow(overrides: Partial<Row> & {kind: Row['kind']}): Row {
  const base = {file: 'a.yaml', job: 'job', id: 'mint', permissions: {issues: 'write'} as Permissions}
  return {...base, ...overrides} as Row
}

const REPO_ROW = fixtureRow({kind: 'repo'})
const REPO_WITH = {repositories: REPO_EXPRESSION, 'permission-issues': 'write'}

function violationsFor(workflows: Record<string, unknown>, rows: readonly Row[]): string[] {
  return findViolations(collectMints(workflows), rows)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('app-token scope guard: the real workflow tree', () => {
  const mints = collectMints(loadWorkflows())

  it('is not vacuous: the table, the scanned files and the mint census meet their floors', () => {
    expect(EXPECTED_ROWS).toHaveLength(EXPECTED_ROW_COUNT)
    expect(new Set(EXPECTED_ROWS.map(row => row.file)).size).toBe(EXPECTED_MINT_FILE_COUNT)
    expect(new Set(mints.map(mint => mint.file)).size).toBe(EXPECTED_MINT_FILE_COUNT)
    expect(mints.length).toBeGreaterThanOrEqual(MINT_CENSUS_FLOOR)
  })

  it('has unique table keys', () => {
    const keys = EXPECTED_ROWS.map(row => rowKey(row))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every owner-wide row carries a justification and no forbidden permission', () => {
    for (const row of EXPECTED_ROWS) {
      if (row.kind === 'owner-wide') expect(row.justification.trim(), rowKey(row)).not.toBe('')
      for (const name of Object.keys(row.permissions)) {
        expect(FORBIDDEN_PERMISSIONS.has(name), `${rowKey(row)} permission-${name}`).toBe(false)
      }
    }
  })

  it('only the pinned cross-repo dispatch targets are owner-wide with a write permission', () => {
    const writeOwnerWide = EXPECTED_ROWS.filter(
      row => row.kind === 'owner-wide' && Object.values(row.permissions).includes('write'),
    ).map(row => rowKey(row))
    expect(writeOwnerWide.sort()).toStrictEqual(OWNER_WIDE_WRITE_ALLOWED.map(entry => entry.key).sort())
  })

  it('every mint in the tree is covered by the table', () => {
    expect(unexpectedMintViolations(mints, EXPECTED_ROWS)).toStrictEqual([])
  })

  it.each(mints.map(mint => [mint.key, mint] as const))('mint %s satisfies the intrinsic rules', (_key, mint) => {
    expect(intrinsicViolations(mint)).toStrictEqual([])
  })

  it.each(EXPECTED_ROWS.map(row => [rowKey(row), row] as const))('row %s matches the tree exactly', (_key, row) => {
    expect(checkRow(row, mints)).toStrictEqual([])
  })
})

describe('app-token scope guard: each rule fails against an in-memory fixture', () => {
  it('passes a clean repo-scoped fixture', () => {
    expect(violationsFor(fixtureWorkflow(mintStep('mint', REPO_WITH)), [REPO_ROW])).toStrictEqual([])
  })

  it('fails a mint with no permission-* input', () => {
    const violations = violationsFor(fixtureWorkflow(mintStep('mint', {repositories: REPO_EXPRESSION})), [REPO_ROW])
    expect(violations.join('\n')).toContain('a.yaml#job#mint: mint has no permission-* input')
  })

  it.each(['workflows', 'administration'])('fails permission-%s', name => {
    const violations = violationsFor(
      fixtureWorkflow(mintStep('mint', {...REPO_WITH, [`permission-${name}`]: 'write'})),
      [REPO_ROW],
    )
    expect(violations.join('\n')).toContain(`permission-${name} is forbidden`)
  })

  it('fails a permission value that is not the string read or write', () => {
    const violations = violationsFor(
      fixtureWorkflow(mintStep('mint', {...REPO_WITH, 'permission-contents': ['read']})),
      [fixtureRow({kind: 'repo', permissions: {issues: 'write', contents: 'read'}})],
    )
    expect(violations.join('\n')).toContain('permission-contents must be the string read or write')
  })

  it('fails a mint missing from the table, naming its key', () => {
    const violations = violationsFor(fixtureWorkflow(mintStep('mint', REPO_WITH), mintStep('extra', REPO_WITH)), [
      REPO_ROW,
    ])
    expect(violations).toContain('a.yaml#job#extra: mint is not in the expected-scope table')
  })

  it('fails a table row whose mint is missing from the tree, naming its key', () => {
    const violations = violationsFor(fixtureWorkflow(mintStep('mint', REPO_WITH)), [
      REPO_ROW,
      fixtureRow({kind: 'repo', id: 'ghost'}),
    ])
    expect(violations).toContain('a.yaml#job#ghost: table row has no mint in the workflow tree')
  })

  it('fails a mint without a step id', () => {
    const violations = violationsFor(fixtureWorkflow(mintStep(undefined, REPO_WITH)), [REPO_ROW])
    expect(violations).toContain('a.yaml#job#(no step id): mint has no step id')
  })

  it('fails exact permission-map equality in both directions', () => {
    const extra = violationsFor(fixtureWorkflow(mintStep('mint', {...REPO_WITH, 'permission-contents': 'read'})), [
      REPO_ROW,
    ])
    expect(extra.join('\n')).toContain('differ from expected')

    const widened = violationsFor(fixtureWorkflow(mintStep('mint', {...REPO_WITH, 'permission-issues': 'read'})), [
      REPO_ROW,
    ])
    expect(widened.join('\n')).toContain('differ from expected')

    const missing = violationsFor(fixtureWorkflow(mintStep('mint', REPO_WITH)), [
      fixtureRow({kind: 'repo', permissions: {issues: 'write', contents: 'read'}}),
    ])
    expect(missing.join('\n')).toContain('differ from expected')
  })

  it('fails a mint that sets neither owner nor repositories', () => {
    const violations = violationsFor(fixtureWorkflow(mintStep('mint', {'permission-issues': 'write'})), [REPO_ROW])
    expect(violations.join('\n')).toContain('sets neither owner nor repositories')
  })

  it('fails a repo row whose mint sets a different repositories expression or an unpinned owner', () => {
    const other = violationsFor(
      fixtureWorkflow(mintStep('mint', {repositories: 'fro-bot/other', 'permission-issues': 'write'})),
      [REPO_ROW],
    )
    expect(other.join('\n')).toContain(`repositories must be exactly ${REPO_EXPRESSION}`)

    const ownerSet = violationsFor(fixtureWorkflow(mintStep('mint', {...REPO_WITH, owner: 'fro-bot'})), [REPO_ROW])
    expect(ownerSet.join('\n')).toContain('owner must be absent')
  })

  it('fails an owner without repositories when the row is not owner-wide', () => {
    const violations = violationsFor(
      fixtureWorkflow(mintStep('mint', {owner: 'fro-bot', 'permission-issues': 'write'})),
      [REPO_ROW],
    )
    expect(violations.join('\n')).toContain(`repositories must be exactly ${REPO_EXPRESSION}`)
  })

  it('allows an owner without repositories only on an owner-wide exemption row', () => {
    const row = fixtureRow({
      kind: 'owner-wide',
      owner: 'fro-bot',
      justification: 'discovery',
      permissions: {metadata: 'read'},
    })
    const workflow = fixtureWorkflow(mintStep('mint', {owner: 'fro-bot', 'permission-metadata': 'read'}))
    expect(violationsFor(workflow, [row])).toStrictEqual([])
  })

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['null', null],
    ['an array decoy', [REPO_EXPRESSION]],
  ])('fails a %s repositories literal', (_label, literal) => {
    const violations = violationsFor(
      fixtureWorkflow(mintStep('mint', {owner: 'fro-bot', repositories: literal, 'permission-issues': 'write'})),
      [REPO_ROW],
    )
    expect(violations.join('\n')).toContain('repositories is empty, whitespace or not a string')
  })

  it('fails an owner that is not a non-empty string', () => {
    const violations = violationsFor(
      fixtureWorkflow(mintStep('mint', {owner: ['fro-bot'], 'permission-metadata': 'read'})),
      [
        fixtureRow({
          kind: 'owner-wide',
          owner: 'fro-bot',
          justification: 'discovery',
          permissions: {metadata: 'read'},
        }),
      ],
    )
    expect(violations.join('\n')).toContain('owner is empty, whitespace or not a string')
  })

  it('fails an owner-wide mint carrying a write permission outside the pinned dispatch targets', () => {
    const row = fixtureRow({
      kind: 'owner-wide',
      owner: 'fro-bot',
      justification: 'discovery',
      permissions: {contents: 'write'},
    })
    const workflow = fixtureWorkflow(mintStep('mint', {owner: 'fro-bot', 'permission-contents': 'write'}))
    expect(violationsFor(workflow, [row]).join('\n')).toContain('owner-wide mint holds write permission(s): contents')
  })

  it('keeps the owner-wide write exemption pinned to exact key and owner', () => {
    const pinned = OWNER_WIDE_WRITE_ALLOWED[0]
    if (pinned === undefined) throw new TypeError('exemption list is empty')
    const [file, job, id] = pinned.key.split('#') as [string, string, string]
    const row = (owner: string): Row =>
      ({
        file,
        job,
        id,
        kind: 'owner-wide',
        owner,
        justification: 'target',
        permissions: {actions: 'write'},
      }) satisfies Row
    const tree = (owner: string): Record<string, unknown> => ({
      [file]: {jobs: {[job]: {steps: [mintStep(id, {owner, 'permission-actions': 'write'})]}}},
    })

    // The exact key + owner is allowed.
    expect(violationsFor(tree(pinned.owner), [row(pinned.owner)])).toStrictEqual([])
    // Same key, different owner: not allowed.
    expect(violationsFor(tree('someone-else'), [row('someone-else')]).join('\n')).toContain('holds write permission')
    // Same owner, different key: not allowed.
    const renamed: Record<string, unknown> = {
      [file]: {jobs: {[job]: {steps: [mintStep('renamed', {owner: pinned.owner, 'permission-actions': 'write'})]}}},
    }
    expect(violationsFor(renamed, [{...row(pinned.owner), id: 'renamed'}]).join('\n')).toContain(
      'holds write permission',
    )
  })

  describe('computed list reach', () => {
    const listExpression = gh('steps.plan.outputs.repositories')
    const guard = "steps.plan.outputs.repositories != ''"
    const row = fixtureRow({
      kind: 'computed list',
      owner: 'fro-bot',
      repositories: listExpression,
      guard,
      consumer: 'use',
      permissions: {actions: 'write'},
    })
    const mintWith = {owner: 'fro-bot', repositories: listExpression, 'permission-actions': 'write'}
    const consumer = (extra: FixtureStep = {}): FixtureStep => ({
      id: 'use',
      if: guard,
      env: {GITHUB_TOKEN: gh('steps.mint.outputs.token')},
      ...extra,
    })

    it('passes when the mint and its consumer carry the exact guard', () => {
      expect(violationsFor(fixtureWorkflow(mintStep('mint', mintWith, {if: guard}), consumer()), [row])).toStrictEqual(
        [],
      )
    })

    it('fails when the mint lacks the guard', () => {
      const violations = violationsFor(fixtureWorkflow(mintStep('mint', mintWith), consumer()), [row])
      expect(violations.join('\n')).toContain('mint lacks the non-empty guard')
    })

    it('fails when the mint guard is a one-element-array decoy', () => {
      const violations = violationsFor(fixtureWorkflow(mintStep('mint', mintWith, {if: [guard]}), consumer()), [row])
      expect(violations.join('\n')).toContain('mint lacks the non-empty guard')
    })

    it('fails when the consuming step lacks the guard', () => {
      const violations = violationsFor(
        fixtureWorkflow(mintStep('mint', mintWith, {if: guard}), consumer({if: undefined})),
        [row],
      )
      expect(violations.join('\n')).toContain('consuming step use lacks the non-empty guard')
    })

    it('fails when the guard is weakened on the consumer', () => {
      const violations = violationsFor(
        fixtureWorkflow(mintStep('mint', mintWith, {if: guard}), consumer({if: 'always()'})),
        [row],
      )
      expect(violations.join('\n')).toContain('consuming step use lacks the non-empty guard')
    })

    it('fails when the consuming step is missing or precedes the mint', () => {
      const missing = violationsFor(fixtureWorkflow(mintStep('mint', mintWith, {if: guard})), [row])
      expect(missing.join('\n')).toContain('consuming step use not found in job')

      const early = violationsFor(fixtureWorkflow(consumer(), mintStep('mint', mintWith, {if: guard})), [row])
      expect(early.join('\n')).toContain('must come after the mint')
    })

    it('fails when the consumer does not use the mint token, or also uses a sibling mint token', () => {
      const unused = violationsFor(
        fixtureWorkflow(mintStep('mint', mintWith, {if: guard}), consumer({env: {GITHUB_TOKEN: 'x'}})),
        [row],
      )
      expect(unused.join('\n')).toContain('does not use steps.mint.outputs.token')

      const sibling = violationsFor(
        fixtureWorkflow(
          mintStep('discovery', {owner: 'fro-bot', 'permission-metadata': 'read'}),
          mintStep('mint', mintWith, {if: guard}),
          consumer({env: {GITHUB_TOKEN: gh('steps.mint.outputs.token'), OTHER: gh('steps.discovery.outputs.token')}}),
        ),
        [row],
      )
      expect(sibling.join('\n')).toContain("also uses another mint's token (discovery)")
    })

    it.each(LEAK_FORMS('discovery'))(
      'fails when the consumer also uses a sibling mint token written as %s',
      (_label, expression) => {
        const violations = violationsFor(
          fixtureWorkflow(
            mintStep('discovery', {owner: 'fro-bot', 'permission-metadata': 'read'}),
            mintStep('mint', mintWith, {if: guard}),
            consumer({env: {GITHUB_TOKEN: gh('steps.mint.outputs.token'), OTHER: gh(expression)}}),
          ),
          [row],
        )
        expect(violations.join('\n')).toContain("also uses another mint's token (discovery)")
      },
    )

    it.each(BRACKET_TOKEN_FORMS('mint'))(
      'counts the mint token as used when the consumer writes it as %s',
      (_label, expression) => {
        const violations = violationsFor(
          fixtureWorkflow(mintStep('mint', mintWith, {if: guard}), consumer({env: {GITHUB_TOKEN: gh(expression)}})),
          [row],
        )
        expect(violations).toStrictEqual([])
      },
    )

    it('fails a wrong repositories expression or owner', () => {
      const wrongList = violationsFor(
        fixtureWorkflow(mintStep('mint', {...mintWith, repositories: 'a,b'}, {if: guard}), consumer()),
        [row],
      )
      expect(wrongList.join('\n')).toContain(`repositories must be exactly ${listExpression}`)

      const wrongOwner = violationsFor(
        fixtureWorkflow(mintStep('mint', {...mintWith, owner: 'other'}, {if: guard}), consumer()),
        [row],
      )
      expect(wrongOwner.join('\n')).toContain('owner must be exactly fro-bot')
    })
  })

  it('reads parsed with-keys: a comment that mentions a permission does not count', () => {
    const text = [
      'jobs:',
      '  job:',
      '    steps:',
      '      - id: mint',
      `        uses: ${MINT_USES}`,
      '        with:',
      `          repositories: ${REPO_EXPRESSION}`,
      '          # permission-contents: write',
      '          permission-issues: write',
      '',
    ].join('\n')
    const parsedText: unknown = parse(text)
    const mints = collectMints({'a.yaml': parsedText})
    expect(mints[0]?.permissions).toStrictEqual({issues: 'write'})
    expect(findViolations(mints, [REPO_ROW])).toStrictEqual([])

    const onlyComment = text.replace('permission-issues: write', '# permission-issues: write')
    const parsedComment: unknown = parse(onlyComment)
    const commentOnly = collectMints({'a.yaml': parsedComment})
    expect(findViolations(commentOnly, [REPO_ROW]).join('\n')).toContain('mint has no permission-* input')
  })

  it('fails closed on a workflow without the expected jobs shape', () => {
    expect(() => collectMints({'a.yaml': 'not a workflow'})).toThrow(TypeError)
  })
})

// ─── Split-token bindings (discovery vs writer) ─────────────────────────────

/**
 * The discovery and writer mints are only least-privilege if each token reaches only its own
 * client. These rules pin the wiring from mint step to script env var, by parsed `env` keys.
 */
interface TokenBinding {
  /** Env var the script reads. */
  readonly env: string
  /** Step id of the mint that must feed it. */
  readonly mintId: string
}

interface BindingSpec {
  readonly file: string
  readonly job: string
  readonly bindings: readonly TokenBinding[]
}

const tokenOutput = (mintId: string): string => gh(`steps.${mintId}.outputs.token`)

const BINDING_SPECS: readonly BindingSpec[] = [
  {
    file: 'reconcile-repos.yaml',
    job: 'reconcile-repos',
    bindings: [
      {env: 'RECONCILE_DISCOVERY_TOKEN', mintId: 'discovery-token'},
      {env: 'RECONCILE_WRITER_TOKEN', mintId: 'writer-token'},
    ],
  },
  {
    file: 'update-metadata.yaml',
    job: 'update-metadata',
    bindings: [
      {env: 'UPDATE_METADATA_DISCOVERY_TOKEN', mintId: 'discovery-token'},
      {env: 'UPDATE_METADATA_WRITER_TOKEN', mintId: 'writer-token'},
    ],
  },
]

function bindingViolations(workflow: unknown, spec: BindingSpec): string[] {
  const where = `${spec.file}#${spec.job}`
  if (!isRecord(workflow) || !isRecord(workflow.jobs))
    return [`${where}: workflow does not have the expected jobs shape`]
  const job = workflow.jobs[spec.job]
  if (!isRecord(job) || !Array.isArray(job.steps)) return [`${where}: job has no steps`]
  const steps: unknown[] = job.steps

  const violations: string[] = []
  const envNames = new Set(spec.bindings.map(binding => binding.env))
  const consumers = steps.filter(
    step => isRecord(step) && isRecord(step.env) && Object.keys(step.env).some(name => envNames.has(name)),
  )
  if (consumers.length !== 1) {
    violations.push(`${where}: expected exactly one step to set the token env vars, found ${consumers.length}`)
  }

  for (const binding of spec.bindings) {
    const holders = consumers.filter(step => isRecord(step) && isRecord(step.env) && binding.env in step.env)
    if (holders.length !== 1) {
      violations.push(`${where}: ${binding.env} must be set by exactly one step, found ${holders.length}`)
      continue
    }
    const holder = holders[0]
    const actual = isRecord(holder) && isRecord(holder.env) ? holder.env[binding.env] : undefined
    if (actual !== tokenOutput(binding.mintId)) {
      violations.push(
        `${where}: ${binding.env} must be exactly ${tokenOutput(binding.mintId)}, found ${String(actual)}`,
      )
    }
  }

  // Each token output is referenced exactly once in the whole job (its env binding) and nowhere
  // else: not in another step's env/with/run/if, not in job-level env or outputs, not in the
  // workflow-level env.
  const without = (record: Record<string, unknown>, key: string): Record<string, unknown> =>
    Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))
  const workflowRest = without(workflow, 'jobs')
  const jobRest = without(job, 'steps')
  const scopes: [string, unknown][] = [
    ['workflow-level fields', workflowRest],
    ['job-level fields', jobRest],
    ...steps.map((step, index): [string, unknown] => [`step #${index}`, step]),
  ]
  for (const {mintId} of spec.bindings) {
    const ref = `steps.${mintId}.outputs`
    const referencing = scopes.filter(([, scope]) => countStepOutputRefs(scope, mintId) > 0).map(([name]) => name)
    if (referencing.length !== 1 || !referencing[0]?.startsWith('step #')) {
      violations.push(
        `${where}: ${ref} must be referenced only by the consuming step, found in [${referencing.join(', ')}]`,
      )
    } else if (countStepOutputRefs(consumers[0], mintId) !== 1) {
      violations.push(`${where}: ${ref} must be referenced once in the consuming step`)
    }
  }
  return violations
}

describe('app-token scope guard: discovery and writer token bindings', () => {
  const workflows = loadWorkflows()

  it.each(BINDING_SPECS.map(spec => [spec.file, spec] as const))(
    '%s feeds each client only its own token and nothing else consumes either',
    (file, spec) => {
      expect(bindingViolations(workflows[file], spec)).toStrictEqual([])
    },
  )

  describe('rules fail against an in-memory fixture', () => {
    const spec: BindingSpec = {
      file: 'f.yaml',
      job: 'j',
      bindings: [
        {env: 'D', mintId: 'discovery-token'},
        {env: 'W', mintId: 'writer-token'},
      ],
    }
    const workflowOf = (consumerEnv: Record<string, unknown>, extraSteps: unknown[] = [], jobRest = {}) => ({
      jobs: {
        j: {
          ...jobRest,
          steps: [
            {id: 'discovery-token', uses: 'x'},
            {id: 'writer-token', uses: 'x'},
            {name: 'consume', env: consumerEnv},
            ...extraSteps,
          ],
        },
      },
    })
    const good = {D: tokenOutput('discovery-token'), W: tokenOutput('writer-token')}

    it('passes the correct wiring', () => {
      expect(bindingViolations(workflowOf(good), spec)).toStrictEqual([])
    })

    it('fails when the two expressions are swapped', () => {
      const swapped = {D: tokenOutput('writer-token'), W: tokenOutput('discovery-token')}
      const violations = bindingViolations(workflowOf(swapped), spec)
      expect(violations.join('\n')).toContain('D must be exactly')
      expect(violations.join('\n')).toContain('W must be exactly')
    })

    it('fails when the expression is not exactly the token output (extra text)', () => {
      const padded = {...good, D: `${tokenOutput('discovery-token')} `}
      expect(bindingViolations(workflowOf(padded), spec).join('\n')).toContain('D must be exactly')
    })

    it('fails when an env var is missing', () => {
      expect(bindingViolations(workflowOf({D: good.D}), spec).join('\n')).toContain('W must be set by exactly one step')
    })

    it('fails when another step consumes a token', () => {
      const extra = {name: 'leak', env: {GH_TOKEN: tokenOutput('writer-token')}}
      expect(bindingViolations(workflowOf(good, [extra]), spec).join('\n')).toContain(
        'must be referenced only by the consuming step',
      )
    })

    it.each(LEAK_FORMS('writer-token'))(
      'fails when another step references the writer token as %s',
      (_label, expression) => {
        const leak = {name: 'leak', env: {GH_TOKEN: gh(expression)}}
        expect(bindingViolations(workflowOf(good, [leak]), spec).join('\n')).toContain(
          'steps.writer-token.outputs must be referenced only by the consuming step',
        )
      },
    )

    it.each(LEAK_FORMS('discovery-token'))(
      'fails when another step references the discovery token as %s (with, run and if)',
      (_label, expression) => {
        for (const leak of [
          {uses: 'y', with: {token: gh(expression)}},
          {run: `echo ${gh(expression)}`},
          {if: expression, run: 'true'},
        ]) {
          expect(bindingViolations(workflowOf(good, [leak]), spec).join('\n')).toContain(
            'steps.discovery-token.outputs must be referenced only by the consuming step',
          )
        }
      },
    )

    it.each(LEAK_FORMS('writer-token'))(
      'fails when the consuming step references the writer token a second time as %s',
      (_label, expression) => {
        const doubled = {...good, EXTRA: gh(expression)}
        expect(bindingViolations(workflowOf(doubled), spec).join('\n')).toContain(
          'steps.writer-token.outputs must be referenced once in the consuming step',
        )
      },
    )

    it.each(LEAK_FORMS('writer-token'))(
      'fails when job-level env references the writer token as %s',
      (_label, expression) => {
        const withJobEnv = workflowOf(good, [], {env: {X: gh(expression)}})
        expect(bindingViolations(withJobEnv, spec).join('\n')).toContain('job-level fields')
      },
    )

    it('keeps the exact binding strict: a bracket-form env value is not the canonical dot form', () => {
      const bracketBinding = {D: gh("steps['discovery-token'].outputs.token"), W: good.W}
      const violations = bindingViolations(workflowOf(bracketBinding), spec)
      expect(violations.join('\n')).toContain('D must be exactly')
    })

    it('does not flag references to other steps, other step fields or lookalike ids', () => {
      const benign = [
        {name: 'a', if: "steps.writer-token.outcome == 'success'", run: 'true'},
        {name: 'b', env: {X: gh('steps.writer-token2.outputs.token')}},
        {name: 'c', env: {X: gh("steps['writer'].outputs.token")}},
        {name: 'd', env: {X: gh('mysteps.writer-token.outputs.token')}},
        {name: 'e', env: {X: gh('steps.writer-token.outputsx.token')}},
        {name: 'f', env: {X: gh('steps.other.outputs.token')}},
      ]
      expect(bindingViolations(workflowOf(good, benign), spec)).toStrictEqual([])
    })

    it('fails when another step passes a token via with or run', () => {
      const viaWith = {uses: 'y', with: {token: tokenOutput('discovery-token')}}
      const viaRun = {run: `echo ${tokenOutput('writer-token')}`}
      expect(bindingViolations(workflowOf(good, [viaWith]), spec).join('\n')).toContain('steps.discovery-token.outputs')
      expect(bindingViolations(workflowOf(good, [viaRun]), spec).join('\n')).toContain('steps.writer-token.outputs')
    })

    it('fails when a token also reaches job-level env', () => {
      const withJobEnv = workflowOf(good, [], {env: {X: tokenOutput('writer-token')}})
      expect(bindingViolations(withJobEnv, spec).join('\n')).toContain('job-level fields')
    })

    it('fails when a second step sets the same env var', () => {
      const dup = {name: 'dup', env: {D: tokenOutput('discovery-token')}}
      expect(bindingViolations(workflowOf(good, [dup]), spec).join('\n')).toContain('exactly one step')
    })

    it('fails closed on a missing job and a non-workflow', () => {
      expect(bindingViolations({jobs: {}}, spec).join('\n')).toContain('job has no steps')
      expect(bindingViolations('nope', spec).join('\n')).toContain('expected jobs shape')
    })
  })
})
