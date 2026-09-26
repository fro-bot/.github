import {execFileSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import process from 'node:process'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface WorkflowStep {
  name?: string
  id?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
  env?: Record<string, unknown>
  if?: string
  'timeout-minutes'?: number
  'continue-on-error'?: boolean
}

interface WorkflowJob {
  steps: WorkflowStep[]
  needs?: string | string[]
  if?: string
  permissions?: Record<string, string>
  outputs?: Record<string, string>
  'timeout-minutes'?: number
}

function assertWorkflowShape(value: unknown): asserts value is {jobs: Record<string, WorkflowJob>} {
  if (typeof value !== 'object' || value === null || !('jobs' in value)) {
    throw new TypeError('workflow file does not have expected jobs shape')
  }
}

const workflowPath = resolve(import.meta.dirname, '../.github/workflows/survey-repo.yaml')
const workflowRaw = readFileSync(workflowPath, 'utf8')
const workflowParsed: unknown = parse(workflowRaw)
assertWorkflowShape(workflowParsed)

function findStepIndex(job: WorkflowJob | undefined, predicate: (step: WorkflowStep) => boolean): number {
  return (job?.steps ?? []).findIndex(predicate)
}

/** Only status function this repo's retry/detect conditions may use, per KTD4/KTD8. */
const STATUS_FUNCTION_PATTERN = /\b(success|failure|cancelled|always)\s*\(/g

/**
 * Extracts a step's `run:` block and executes it as a real bash script (no mocking of
 * the shell itself), feeding `env` as the step's `env:` would and capturing whatever it
 * appends to `GITHUB_OUTPUT` — mirrors the extract-and-execute pattern in
 * fro-bot-workflow.test.ts.
 */
function runShellStep(
  script: string,
  env: Record<string, string>,
): {status: number; stdout: string; outputs: Record<string, string>} {
  const dir = mkdtempSync(join(tmpdir(), 'survey-repo-step-'))
  try {
    const outputPath = join(dir, 'github-output')
    writeFileSync(outputPath, '')
    const scriptPath = join(dir, 'step.sh')
    writeFileSync(scriptPath, script)
    let status = 0
    let stdout = ''
    try {
      stdout = execFileSync('bash', [scriptPath], {
        env: {...process.env, ...env, GITHUB_OUTPUT: outputPath},
        encoding: 'utf8',
      })
    } catch (error) {
      const failure = error as {status?: number; stdout?: string}
      status = failure.status ?? 1
      stdout = String(failure.stdout ?? '')
    }
    const outputRaw = readFileSync(outputPath, 'utf8')
    const outputs: Record<string, string> = {}
    for (const line of outputRaw.split('\n')) {
      const eq = line.indexOf('=')
      if (eq === -1) continue
      outputs[line.slice(0, eq)] = line.slice(eq + 1)
    }
    return {status, stdout, outputs}
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
}

/**
 * Minimal GitHub Actions expression evaluator (Unit 4). Parses the *actual* `${{ }}`
 * strings read from the workflow YAML rather than restating them as hard-coded terms,
 * so these tests exercise the real expressions. Supports `==`, `!=`, `&&`, `||`, `!`,
 * parentheses, single-quoted string literals, the `a && 'x' || 'y'` idiom, and the four
 * status functions as fixture inputs. Any `needs.*`/`steps.*` identifier missing from the
 * fixture evaluates to `''`, matching Actions' own behavior for unset context values.
 */
type ExprValue = {kind: 'bool'; value: boolean} | {kind: 'str'; value: string}

interface ExprFixture {
  context?: Record<string, string>
  status?: Partial<Record<'always' | 'cancelled' | 'failure' | 'success', boolean>>
}

type ExprToken =
  {type: 'and' | 'eq' | 'lparen' | 'neq' | 'not' | 'or' | 'rparen'} | {type: 'call' | 'ident' | 'string'; value: string}

function stripExpressionWrapper(raw: string): string {
  // Folded YAML scalars are already collapsed to single-line strings by the `yaml`
  // parser's plain/folded-scalar handling, but normalize defensively in case a caller
  // passes a raw multi-line block.
  const folded = raw.replaceAll(/\s+/g, ' ').trim()
  if (!folded.startsWith('${{') || !folded.endsWith('}}')) {
    throw new Error(`expected a \${{ }} expression, got: ${raw}`)
  }
  return folded.slice(3, -2).trim()
}

function tokenizeExpression(expr: string): ExprToken[] {
  const tokens: ExprToken[] = []
  let i = 0
  while (i < expr.length) {
    const c = expr[i]
    if (c === undefined) break
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '(') {
      tokens.push({type: 'lparen'})
      i++
      continue
    }
    if (c === ')') {
      tokens.push({type: 'rparen'})
      i++
      continue
    }
    if (expr.startsWith('&&', i)) {
      tokens.push({type: 'and'})
      i += 2
      continue
    }
    if (expr.startsWith('||', i)) {
      tokens.push({type: 'or'})
      i += 2
      continue
    }
    if (expr.startsWith('==', i)) {
      tokens.push({type: 'eq'})
      i += 2
      continue
    }
    if (expr.startsWith('!=', i)) {
      tokens.push({type: 'neq'})
      i += 2
      continue
    }
    if (c === '!') {
      tokens.push({type: 'not'})
      i++
      continue
    }
    if (c === "'") {
      const end = expr.indexOf("'", i + 1)
      if (end === -1) throw new Error(`unterminated string literal in expression: ${expr}`)
      tokens.push({type: 'string', value: expr.slice(i + 1, end)})
      i = end + 1
      continue
    }
    const identMatch = /^[A-Z_][\w.-]*/i.exec(expr.slice(i))
    if (identMatch) {
      const name = identMatch[0]
      i += name.length
      let j = i
      while (j < expr.length && /\s/.test(expr[j] ?? '')) j++
      if (expr[j] === '(') {
        let k = j + 1
        while (k < expr.length && /\s/.test(expr[k] ?? '')) k++
        if (expr[k] !== ')') throw new Error(`unsupported function call with arguments: ${name} in ${expr}`)
        tokens.push({type: 'call', value: name})
        i = k + 1
        continue
      }
      tokens.push({type: 'ident', value: name})
      continue
    }
    throw new Error(`unexpected character '${c}' at position ${i} in expression: ${expr}`)
  }
  return tokens
}

function exprTruthy(value: ExprValue): boolean {
  return value.kind === 'bool' ? value.value : value.value !== ''
}

function exprStringify(value: ExprValue): string {
  return value.kind === 'bool' ? String(value.value) : value.value
}

const STATUS_FUNCTION_NAMES = ['always', 'cancelled', 'failure', 'success'] as const

function evaluateExpression(rawIf: string, fixture: ExprFixture): ExprValue {
  const tokens = tokenizeExpression(stripExpressionWrapper(rawIf))
  let pos = 0
  const peek = (): ExprToken | undefined => tokens[pos]
  const advance = (): ExprToken | undefined => tokens[pos++]

  function parseOr(): ExprValue {
    let left = parseAnd()
    while (peek()?.type === 'or') {
      advance()
      const right = parseAnd()
      left = exprTruthy(left) ? left : right
    }
    return left
  }

  function parseAnd(): ExprValue {
    let left = parseEquality()
    while (peek()?.type === 'and') {
      advance()
      const right = parseEquality()
      left = exprTruthy(left) ? right : left
    }
    return left
  }

  function parseEquality(): ExprValue {
    let left = parseUnary()
    while (peek()?.type === 'eq' || peek()?.type === 'neq') {
      const op = advance()
      const right = parseUnary()
      const equal = exprStringify(left) === exprStringify(right)
      left = {kind: 'bool', value: op?.type === 'eq' ? equal : !equal}
    }
    return left
  }

  function parseUnary(): ExprValue {
    if (peek()?.type === 'not') {
      advance()
      const operand = parseUnary()
      return {kind: 'bool', value: !exprTruthy(operand)}
    }
    return parsePrimary()
  }

  function parsePrimary(): ExprValue {
    const token = advance()
    if (!token) throw new Error(`unexpected end of expression: ${rawIf}`)
    if (token.type === 'lparen') {
      const inner = parseOr()
      const close = advance()
      if (close?.type !== 'rparen') throw new Error(`expected ')' in expression: ${rawIf}`)
      return inner
    }
    if (token.type === 'string') return {kind: 'str', value: token.value}
    if (token.type === 'call') {
      const name = token.value
      if (!(STATUS_FUNCTION_NAMES as readonly string[]).includes(name)) {
        throw new Error(`unsupported status function '${name}' in expression: ${rawIf}`)
      }
      return {kind: 'bool', value: fixture.status?.[name as (typeof STATUS_FUNCTION_NAMES)[number]] ?? false}
    }
    if (token.type === 'ident') {
      return {kind: 'str', value: fixture.context?.[token.value] ?? ''}
    }
    throw new Error(`unexpected token in expression: ${rawIf}`)
  }

  const result = parseOr()
  if (pos !== tokens.length) throw new Error(`unexpected trailing tokens in expression: ${rawIf}`)
  return result
}

function evaluateCondition(rawIf: string, fixture: ExprFixture): boolean {
  return exprTruthy(evaluateExpression(rawIf, fixture))
}

describe('survey-repo correction injection contract', () => {
  const steps = workflowParsed.jobs['survey-repo']?.steps ?? []

  it('assembles corrections between prompt resolution and the survey agent', () => {
    const names = steps.map(step => step.name ?? '')
    const resolveIndex = names.indexOf('Resolve ingest prompt')
    const correctionsIndex = names.indexOf('Load correction context')
    const agentIndex = names.indexOf('Run Fro Bot survey ingest')

    expect(resolveIndex).toBeGreaterThanOrEqual(0)
    expect(correctionsIndex).toBeGreaterThan(resolveIndex)
    expect(agentIndex).toBeGreaterThan(correctionsIndex)
  })

  it('passes corrections through a file instead of a forgeable workflow output', () => {
    const correctionStep = steps.find(step => step.name === 'Load correction context')
    const run = correctionStep?.run ?? ''

    expect(run).toContain('node scripts/render-corrections-context.ts')
    expect(run).not.toContain('GITHUB_OUTPUT')
    expect(run).not.toContain('client_payload')
    expect(run).toContain('exit "$status"')
  })

  it('passes the correction context through the agent prompt contract', () => {
    const agentStep = steps.find(step => step.name === 'Run Fro Bot survey ingest')
    const prompt = String(agentStep?.with?.prompt ?? '')

    expect(prompt).toContain('corrections-data')
    expect(prompt).toContain('data to preserve')
    expect(prompt).toContain('not instructions')
    expect(prompt).toContain('.github/corrections-context.json')
  })

  it('surfaces ingest findings in the survey-persist job step summary', () => {
    const persistSteps = workflowParsed.jobs['survey-persist']?.steps ?? []
    const commitStep = persistSteps.find(step => step.name === 'Commit wiki ingest to data branch')
    const run = commitStep?.run ?? ''

    expect(run).toContain("grep '^wiki-ingest:finding:'")
    expect(run).toContain("echo '### Wiki ingest findings'")
  })

  it('delegates wiki sync to the hardened composite action (regression guard against per-job drift)', () => {
    const syncStep = steps.find(step => step.name === 'Sync wiki from data branch')
    expect(syncStep?.uses).toBe('./.github/actions/sync-wiki')
  })

  it('Sync wiki from data branch precedes Capture wiki baseline (baseline must hash post-sync content)', () => {
    const names = steps.map(step => step.name ?? '')
    const syncIndex = names.indexOf('Sync wiki from data branch')
    const baselineIndex = names.indexOf('Capture wiki baseline')

    expect(syncIndex).toBeGreaterThanOrEqual(0)
    expect(baselineIndex).toBeGreaterThan(syncIndex)
  })
})

describe('survey-repo.yaml App-token persistence migration', () => {
  const surveyJob = workflowParsed.jobs['survey-repo']
  const persistJob = workflowParsed.jobs['survey-persist']

  it('declares survey-persist needing survey-resolve and survey-repo, running with if: always()', () => {
    expect(persistJob).toBeDefined()
    expect(persistJob?.needs).toStrictEqual(['survey-resolve', 'survey-repo'])
    expect(String(persistJob?.if ?? '')).toContain('always()')
  })

  it('survey-persist has no fro-bot/agent step (trusted-writer invariant)', () => {
    const agentStep = persistJob?.steps.find(step => (step.uses ?? '').startsWith('fro-bot/agent@'))
    expect(agentStep).toBeUndefined()
  })

  it('survey-persist checks out the default branch with persist-credentials: false', () => {
    const checkoutStep = persistJob?.steps.find(step => (step.uses ?? '').startsWith('actions/checkout@'))
    expect(String(checkoutStep?.with?.ref ?? '')).toContain('github.event.repository.default_branch')
    expect(checkoutStep?.with?.['persist-credentials']).toBe(false)
  })

  it('survey-persist mints its own App token, distinct from the gate token minted in survey-resolve (a separate job with no agent step)', () => {
    const mintStep = persistJob?.steps.find(step => step.id === 'app-token')
    expect(mintStep?.uses).toContain('actions/create-github-app-token@')
  })

  // Review (P1): actions/create-github-app-token has a post: phase that re-reads its own
  // inputs from runner state after every main step in the job, including the agent step.
  // A pre-agent mint is exposed exactly like a post-agent one, so survey-repo (the agent
  // job) must mint no App token at all, anywhere — not just after the agent step.
  it('survey-repo (the agent job) mints no App token anywhere — the gate mint moved to survey-resolve, a job with no agent step', () => {
    const agentIndex = surveyJob?.steps.findIndex(step => step.id === 'survey-agent') ?? -1
    expect(agentIndex).toBeGreaterThanOrEqual(0)
    expect(
      surveyJob?.steps.find(step => (step.uses ?? '').startsWith('actions/create-github-app-token@')),
    ).toBeUndefined()
  })

  it.each([
    'Commit wiki ingest to data branch',
    'Record survey result',
    'Record survey result (cancelled/timeout fallback)',
  ])('%s uses the minted App token, never FRO_BOT_PAT', stepName => {
    const step = persistJob?.steps.find(s => s.name === stepName)
    const token = String(step?.env?.GITHUB_TOKEN ?? '')
    expect(token).toContain('steps.app-token.outputs.token')
  })

  it('survey-repo builds a wiki handoff artifact instead of committing to data directly', () => {
    const buildStep = surveyJob?.steps.find(step => step.name === 'Build wiki handoff artifact')
    const uploadStep = surveyJob?.steps.find(step => step.name === 'Upload wiki handoff artifact')
    expect(buildStep?.run).toBe('node scripts/wiki-handoff-build.ts')
    expect(uploadStep?.uses).toContain('actions/upload-artifact@')
    expect(surveyJob?.steps.find(step => step.name === 'Commit wiki ingest to data branch')).toBeUndefined()
  })

  it('survey-repo has no record-survey-result.ts invocation left (moved to survey-persist)', () => {
    const leftoverStep = surveyJob?.steps.find(
      step => typeof step.run === 'string' && step.run.includes('record-survey-result.ts'),
    )
    expect(leftoverStep).toBeUndefined()
  })

  it('survey-repo has no visibility recheck step at all — it moved to survey-persist', () => {
    expect(surveyJob?.steps.find(step => step.name === '🔒 Recheck visibility')).toBeUndefined()
    expect(surveyJob?.steps.find(step => step.id === 'recheck-token')).toBeUndefined()
  })

  it('exposes the job outputs survey-persist depends on for gating (no recheck outputs — those are local to survey-persist now)', () => {
    const outputs = surveyJob?.outputs ?? {}
    for (const key of ['wiki-artifact-ready', 'agent-conclusion', 'onboarded', 'target-repository', 'target-slug']) {
      expect(outputs[key], `missing job output: ${key}`).toBeDefined()
    }
    // Moved off survey-repo entirely — survey-resolve is a separate, pre-agent-mint-only
    // job now (review: an App-token mint must never share a job with fro-bot/agent).
    expect(outputs['resolve-outcome']).toBeUndefined()
    expect(outputs['resolve-owner']).toBeUndefined()
    expect(outputs['resolve-repo']).toBeUndefined()
    expect(outputs['recheck-conclusion']).toBeUndefined()
    expect(outputs['recheck-private']).toBeUndefined()
    expect(outputs['ts-now']).toBeUndefined()
  })
})

describe('survey-repo.yaml: survey-resolve — pre-agent App-token mint isolated from every agent job', () => {
  const resolveJob = workflowParsed.jobs['survey-resolve']
  const surveyJob = workflowParsed.jobs['survey-repo']

  it('declares survey-resolve with no agent step and no checkout — it only mints and resolves', () => {
    expect(resolveJob).toBeDefined()
    expect(resolveJob?.steps.find(step => (step.uses ?? '').startsWith('fro-bot/agent@'))).toBeUndefined()
    expect(resolveJob?.steps.find(step => (step.uses ?? '').startsWith('actions/checkout@'))).toBeUndefined()
  })

  it('exposes resolve-outcome/resolve-owner/resolve-repo as survey-resolve job outputs', () => {
    const outputs = resolveJob?.outputs ?? {}
    expect(outputs['resolve-outcome']).toContain('steps.resolve.outcome')
    expect(outputs['resolve-owner']).toContain('steps.resolve.outputs.owner')
    expect(outputs['resolve-repo']).toContain('steps.resolve.outputs.repo')
  })

  it('survey-repo needs survey-resolve and reads owner/repo from it, never from its own steps.resolve', () => {
    expect(surveyJob?.needs).toBe('survey-resolve')
    for (const step of surveyJob?.steps ?? []) {
      const text = JSON.stringify(step.env ?? {})
      expect(text).not.toContain('steps.resolve.')
    }
    const onboardedStep = surveyJob?.steps.find(step => step.name === 'Check repo onboarded')
    expect(String(onboardedStep?.env?.REPO_OWNER ?? '')).toContain('needs.survey-resolve.outputs.resolve-owner')
    expect(String(onboardedStep?.env?.REPO_NAME ?? '')).toContain('needs.survey-resolve.outputs.resolve-repo')
    const ingestPromptStep = surveyJob?.steps.find(step => step.name === 'Resolve ingest prompt')
    expect(String(ingestPromptStep?.env?.TARGET_OWNER ?? '')).toContain('needs.survey-resolve.outputs.resolve-owner')
    expect(String(ingestPromptStep?.env?.TARGET_REPO ?? '')).toContain('needs.survey-resolve.outputs.resolve-repo')
  })

  it('the gate-token mint is narrowed to permission-metadata: read — it is only used for a public-node GraphQL visibility read', () => {
    const gateTokenStep = resolveJob?.steps.find(step => step.id === 'gate-token')
    expect(gateTokenStep).toBeDefined()
    expect(String(gateTokenStep?.with?.owner ?? '')).toContain('github.repository_owner')
    expect(gateTokenStep?.with?.['permission-metadata']).toBe('read')
    expect(gateTokenStep?.with?.repositories).toBeUndefined()
  })
})

describe('survey-repo.yaml wiki change detection: shared script, no inline git-diff hashing', () => {
  const surveyJob = workflowParsed.jobs['survey-repo']

  it('Capture wiki baseline and Detect wiki survey changes both invoke wiki-change-detect.ts', () => {
    const baselineStep = surveyJob?.steps.find(step => step.id === 'wiki-baseline')
    const detectStep = surveyJob?.steps.find(step => step.id === 'wiki-changes')

    expect(String(baselineStep?.run ?? '')).toBe('node scripts/wiki-change-detect.ts baseline')
    expect(String(detectStep?.run ?? '')).toBe('node scripts/wiki-change-detect.ts detect')
  })

  it('Detect wiki survey changes feeds the baseline hash through env, not a re-read of the diff', () => {
    const detectStep = surveyJob?.steps.find(step => step.id === 'wiki-changes')
    expect(String(detectStep?.env?.WIKI_CHANGE_BASELINE_HASH ?? '')).toContain('steps.wiki-baseline.outputs.hash')
  })

  it('preserves the wiki-baseline/wiki-changes step ids and the wiki-changes !cancelled() condition', () => {
    const baselineStep = surveyJob?.steps.find(step => step.id === 'wiki-baseline')
    const detectStep = surveyJob?.steps.find(step => step.id === 'wiki-changes')
    expect(baselineStep).toBeDefined()
    expect(detectStep).toBeDefined()
    expect(String(detectStep?.if ?? '')).toContain('!cancelled()')
  })

  it('leaves no inline git diff hashing in survey-repo.yaml (moved to scripts/wiki-change-detect.ts)', () => {
    for (const step of surveyJob?.steps ?? []) {
      const run = String(step.run ?? '')
      expect(run, `${step.name ?? step.id ?? '<unnamed step>'} must not inline-hash a git diff`).not.toMatch(
        /git diff .*shasum/s,
      )
      expect(run).not.toContain('wiki-baseline.diff')
      expect(run).not.toContain('wiki-current.diff')
    }
  })
})

describe('survey-repo.yaml/survey-persist.yaml A2: trusted-job privacy recheck', () => {
  const surveyJob = workflowParsed.jobs['survey-repo']
  const persistJob = workflowParsed.jobs['survey-persist']

  it('survey-persist mints its App token, then rechecks visibility, before any sync/download/apply/commit/record/announce step', () => {
    const names = (persistJob?.steps ?? []).map(step => step.name ?? '')
    const mintIndex = names.indexOf('🔑 Mint App token for data writes')
    const recheckIndex = names.indexOf('🔒 Recheck visibility')
    const persistenceStepNames = [
      'Sync wiki from data branch',
      'Download wiki handoff artifact',
      'Validate and apply wiki handoff',
      'Commit wiki ingest to data branch',
      'Record survey result',
      '📣 Announce survey to gateway',
      'Record survey result (cancelled/timeout fallback)',
    ]

    expect(mintIndex).toBeGreaterThanOrEqual(0)
    expect(recheckIndex).toBeGreaterThan(mintIndex)
    for (const stepName of persistenceStepNames) {
      const index = names.indexOf(stepName)
      expect(index, `missing persistence step: ${stepName}`).toBeGreaterThanOrEqual(0)
      expect(index, `${stepName} must run after the trusted recheck`).toBeGreaterThan(recheckIndex)
    }
  })

  it("every persistence step gates on this job's own steps.recheck, not a needs.survey-repo recheck output", () => {
    const persistenceStepNames = [
      'Sync wiki from data branch',
      'Download wiki handoff artifact',
      'Validate and apply wiki handoff',
      'Commit wiki ingest to data branch',
      'Record survey result',
      '📣 Announce survey to gateway',
    ]
    for (const stepName of persistenceStepNames) {
      const step = persistJob?.steps.find(s => s.name === stepName)
      const condition = String(step?.if ?? '')
      expect(condition, `${stepName} if: must reference steps.recheck`).toContain('steps.recheck.')
      expect(condition, `${stepName} if: must not reference a needs.survey-repo recheck output`).not.toContain(
        'needs.survey-repo.outputs.recheck',
      )
    }
  })

  it('the recheck step uses its own dedicated recheck-token (not the data-write app-token), and REPO_PRIVATE downstream reads the local recheck output', () => {
    const recheckStep = persistJob?.steps.find(step => step.name === '🔒 Recheck visibility')
    expect(String(recheckStep?.env?.GH_TOKEN ?? '')).toContain('steps.recheck-token.outputs.token')
    expect(String(recheckStep?.env?.NODE_ID ?? '')).toContain('inputs.node_id')

    for (const stepName of ['Record survey result', 'Record survey result (cancelled/timeout fallback)']) {
      const step = persistJob?.steps.find(s => s.name === stepName)
      expect(String(step?.env?.REPO_PRIVATE ?? '')).toContain('steps.recheck.outputs.private')
    }
  })

  it("the recheck token is a dedicated mint scoped like main's pre-A2 recheck token: owner:, no repositories:/permission-contents:write, narrowed to permission-metadata: read", () => {
    const recheckTokenStep = persistJob?.steps.find(step => step.id === 'recheck-token')
    expect(recheckTokenStep).toBeDefined()
    expect(recheckTokenStep?.uses).toContain('actions/create-github-app-token@')
    expect(String(recheckTokenStep?.with?.owner ?? '')).toContain('github.repository_owner')
    expect(recheckTokenStep?.with?.repositories).toBeUndefined()
    expect(recheckTokenStep?.with?.['permission-contents']).toBeUndefined()
    expect(recheckTokenStep?.with?.['permission-metadata']).toBe('read')
  })

  it('the recheck token is a distinct step from the repo-scoped data-write app-token', () => {
    const recheckTokenStep = persistJob?.steps.find(step => step.id === 'recheck-token')
    const dataWriteTokenStep = persistJob?.steps.find(step => step.id === 'app-token')
    expect(dataWriteTokenStep).toBeDefined()
    expect(dataWriteTokenStep?.id).not.toBe(recheckTokenStep?.id)
    expect(String(dataWriteTokenStep?.with?.repositories ?? '')).toContain('github.event.repository.name')
    expect(dataWriteTokenStep?.with?.['permission-contents']).toBe('write')
  })

  it("the recheck-token mint's if: matches the recheck step's if:, gated on resolve-outcome (not agent-conclusion) so both run even when survey-repo fails or is cancelled before the agent step", () => {
    const recheckTokenStep = persistJob?.steps.find(step => step.id === 'recheck-token')
    const recheckStep = persistJob?.steps.find(step => step.name === '🔒 Recheck visibility')
    expect(String(recheckTokenStep?.if ?? '')).toBe(String(recheckStep?.if ?? ''))
    expect(String(recheckStep?.if ?? '')).toContain('always()')
    expect(String(recheckStep?.if ?? '')).toContain("needs.survey-resolve.outputs.resolve-outcome == 'success'")
    expect(String(recheckStep?.if ?? '')).not.toContain('agent-conclusion')
  })

  it('the fallback can still run (with a trusted recheck) when survey-repo fails between resolve and the agent step', () => {
    // Simulate: resolve succeeded, but survey-repo failed/was cancelled before the agent ran
    // (sync-wiki/persona/setup failure). agent-conclusion would be empty in that case, not
    // 'skipped' — the recheck must not depend on it.
    const recheckStep = persistJob?.steps.find(step => step.name === '🔒 Recheck visibility')
    const recheckCondition = String(recheckStep?.if ?? '')
    // The recheck's gate is satisfiable purely from resolve-outcome + always(); it does not
    // require agent-conclusion to be any particular value, so a pre-agent failure still lets
    // it run.
    expect(recheckCondition).toMatch(/always\(\)/)
    expect(recheckCondition).toContain("needs.survey-resolve.outputs.resolve-outcome == 'success'")

    const fallbackStep = persistJob?.steps.find(
      step => step.name === 'Record survey result (cancelled/timeout fallback)',
    )
    const fallbackCondition = String(fallbackStep?.if ?? '')
    expect(fallbackCondition).toContain("needs.survey-resolve.outputs.resolve-outcome == 'success'")
    expect(fallbackCondition).toContain("steps.recheck.conclusion == 'success'")
  })

  it('the fallback record step also requires a successful trusted recheck (fail-closed, not just the primary record step)', () => {
    const fallbackStep = persistJob?.steps.find(
      step => step.name === 'Record survey result (cancelled/timeout fallback)',
    )
    expect(String(fallbackStep?.if ?? '')).toContain("steps.recheck.conclusion == 'success'")
  })

  it("every step in survey-persist that runs record-survey-result.ts or wiki-ingest.ts is gated on steps.recheck.conclusion == 'success' (non-vacuous)", () => {
    const writerSteps = (persistJob?.steps ?? []).filter(
      step =>
        typeof step.run === 'string' &&
        (step.run.includes('record-survey-result.ts') || step.run.includes('wiki-ingest.ts')),
    )
    // Commit wiki ingest (wiki-ingest.ts), Record survey result, and the cancelled/timeout
    // fallback (both record-survey-result.ts) = 3 writer steps.
    expect(writerSteps).toHaveLength(3)
    for (const step of writerSteps) {
      expect(String(step.if ?? ''), `${step.name} must gate on steps.recheck.conclusion == 'success'`).toContain(
        "steps.recheck.conclusion == 'success'",
      )
    }
  })

  it("Record survey result requires resolve-outcome == 'success', guarding against an empty REPO_OWNER/REPO_NAME when survey-repo ends before the agent runs", () => {
    const recordStep = persistJob?.steps.find(step => step.name === 'Record survey result')
    const condition = String(recordStep?.if ?? '')
    expect(condition).toContain("needs.survey-resolve.outputs.resolve-outcome == 'success'")
    expect(condition).toContain("needs.survey-repo.outputs.agent-conclusion != 'skipped'")
    expect(condition).toContain("steps.recheck.conclusion == 'success'")
  })

  it('WIKI_* env in the trusted commit step is sourced from needs.survey-repo pre-agent outputs and inputs.*, never metadata.json', () => {
    const commitStep = persistJob?.steps.find(step => step.name === 'Commit wiki ingest to data branch')
    const run = String(commitStep?.run ?? '')
    expect(run).not.toContain('metadata.json')
    expect(run).not.toContain('jq')

    const env = commitStep?.env ?? {}
    expect(String(env.WIKI_TARGET ?? '')).toContain('needs.survey-repo.outputs.target-repository')
    expect(String(env.WIKI_SUMMARY ?? '')).toContain('needs.survey-repo.outputs.target-repository')
    expect(String(env.WIKI_COMMIT_MESSAGE ?? '')).toContain('needs.survey-repo.outputs.target-repository')
    expect(String(env.WIKI_SOURCES ?? '')).toContain('needs.survey-repo.outputs.target-repository')
    expect(String(env.WIKI_SOURCES ?? '')).toContain('steps.ts.outputs.now')
    expect(String(env.REPO_NODE_ID ?? '')).toContain('inputs.node_id')
  })

  it('survey-repo builds the artifact without recheck gating (privacy is enforced entirely in survey-persist now)', () => {
    const buildStep = surveyJob?.steps.find(step => step.name === 'Build wiki handoff artifact')
    const condition = String(buildStep?.if ?? '')
    expect(condition).toContain("steps.final-attempt.outputs.conclusion == 'success'")
    expect(condition).toContain("steps.final-attempt.outputs.changed == 'true'")
    expect(condition).toContain("steps.onboarded.outputs.onboarded == 'true'")
    expect(condition).not.toContain('recheck')
    expect(Object.keys(buildStep?.env ?? {}).sort()).toStrictEqual(['WIKI_HANDOFF_BASELINE_PATH', 'WIKI_HANDOFF_DIR'])
    expect(String(buildStep?.env?.WIKI_HANDOFF_DIR ?? '')).toContain('runner.temp')
  })

  it('survey-repo captures a wiki content baseline before the agent step, wired to the build step', () => {
    const steps = surveyJob?.steps ?? []
    const baselineIndex = steps.findIndex(step => step.name === 'Capture wiki content baseline')
    const agentIndex = steps.findIndex(step => step.id === 'survey-agent')
    const buildIndex = steps.findIndex(step => step.name === 'Build wiki handoff artifact')

    expect(baselineIndex).toBeGreaterThanOrEqual(0)
    expect(agentIndex).toBeGreaterThan(baselineIndex)
    expect(buildIndex).toBeGreaterThan(agentIndex)

    const baselineStep = steps[baselineIndex]
    const buildStep = steps[buildIndex]
    expect(String(baselineStep?.run ?? '')).toContain('wiki-handoff-baseline.ts')
    expect(baselineStep?.env?.WIKI_HANDOFF_BASELINE_PATH).toBe(buildStep?.env?.WIKI_HANDOFF_BASELINE_PATH)
  })

  it("survey-repo's upload step requires the build step's own non-empty-manifest signal, not just success", () => {
    const uploadStep = surveyJob?.steps.find(step => step.name === 'Upload wiki handoff artifact')
    const condition = String(uploadStep?.if ?? '')
    expect(condition).toContain("steps.wiki-handoff-build.outcome == 'success'")
    expect(condition).toContain("steps.wiki-handoff-build.outputs.changed == 'true'")
  })
})

describe('survey-repo.yaml Unit 3: bounded retries, final-attempt selection, and exhaustion', () => {
  const surveyJob = workflowParsed.jobs['survey-repo']
  const steps = surveyJob?.steps ?? []

  const attempt1 = steps.find(step => step.id === 'survey-agent')
  const detect1 = steps.find(step => step.id === 'wiki-changes')
  const retry1 = steps.find(step => step.id === 'survey-agent-retry-1')
  const detect2 = steps.find(step => step.id === 'wiki-changes-retry-1')
  const retry2 = steps.find(step => step.id === 'survey-agent-retry-2')
  const detect3 = steps.find(step => step.id === 'wiki-changes-retry-2')
  const finalAttempt = steps.find(step => step.id === 'final-attempt')
  const exhaustion = steps.find(step => step.name === 'Fail on survey exhaustion')
  const handoffBuild = steps.find(step => step.id === 'wiki-handoff-build')
  const handoffUpload = steps.find(step => step.id === 'wiki-handoff-upload')

  it('declares every step in the retry chain', () => {
    for (const [label, step] of [
      ['attempt 1', attempt1],
      ['detect 1', detect1],
      ['retry 1', retry1],
      ['detect 2', detect2],
      ['retry 2', retry2],
      ['detect 3', detect3],
      ['final-attempt', finalAttempt],
      ['exhaustion', exhaustion],
      ['handoff build', handoffBuild],
      ['handoff upload', handoffUpload],
    ] as const) {
      expect(step, `missing step: ${label}`).toBeDefined()
    }
  })

  it('orders attempt 1 < detect 1 < retry 1 < detect 2 < retry 2 < detect 3 < selection < exhaustion < handoff build < upload', () => {
    const order = [
      findStepIndex(surveyJob, s => s.id === 'survey-agent'),
      findStepIndex(surveyJob, s => s.id === 'wiki-changes'),
      findStepIndex(surveyJob, s => s.id === 'survey-agent-retry-1'),
      findStepIndex(surveyJob, s => s.id === 'wiki-changes-retry-1'),
      findStepIndex(surveyJob, s => s.id === 'survey-agent-retry-2'),
      findStepIndex(surveyJob, s => s.id === 'wiki-changes-retry-2'),
      findStepIndex(surveyJob, s => s.id === 'final-attempt'),
      findStepIndex(surveyJob, s => s.name === 'Fail on survey exhaustion'),
      findStepIndex(surveyJob, s => s.id === 'wiki-handoff-build'),
      findStepIndex(surveyJob, s => s.id === 'wiki-handoff-upload'),
    ]
    for (const index of order) expect(index).toBeGreaterThanOrEqual(0)
    for (let i = 1; i < order.length; i++) {
      const previous = order[i - 1] ?? -1
      expect(order[i], `step at position ${i} must come after position ${i - 1}`).toBeGreaterThan(previous)
    }
  })

  describe('retry gating: each retry names the previous attempt success and the previous detect no-op, with no status function other than success()', () => {
    it.each([
      ['retry 1', retry1, 'steps.survey-agent.conclusion', 'steps.wiki-changes.outputs.changed'],
      ['retry 2', retry2, 'steps.survey-agent-retry-1.conclusion', 'steps.wiki-changes-retry-1.outputs.changed'],
    ] as const)('%s', (_label, step, prevAgentConclusion, prevDetectChanged) => {
      const condition = String(step?.if ?? '')
      expect(condition).toContain(`${prevAgentConclusion} == 'success'`)
      expect(condition).toContain(`${prevDetectChanged} == 'false'`)
      const statusFunctions = [...condition.matchAll(STATUS_FUNCTION_PATTERN)].map(m => m[1])
      expect(statusFunctions).toStrictEqual(['success'])
    })
  })

  describe('detect gating: each detect step requires its own attempt to have concluded success', () => {
    it.each([
      ['detect 1', detect1, 'steps.survey-agent.conclusion'],
      ['detect 2', detect2, 'steps.survey-agent-retry-1.conclusion'],
      ['detect 3', detect3, 'steps.survey-agent-retry-2.conclusion'],
    ] as const)('%s', (_label, step, agentConclusion) => {
      const condition = String(step?.if ?? '')
      expect(condition).toContain(`${agentConclusion} == 'success'`)
    })
  })

  describe('retry uses:/with: mirror attempt 1 exactly except prompt and timeout', () => {
    it.each([
      ['retry 1', retry1],
      ['retry 2', retry2],
    ] as const)("%s's uses: is byte-identical to attempt 1's", (_label, step) => {
      expect(step?.uses).toBe(attempt1?.uses)
    })

    it.each([
      ['retry 1', retry1],
      ['retry 2', retry2],
    ] as const)("%s's with: matches attempt 1's for every key except prompt and timeout", (_label, step) => {
      const attempt1With = attempt1?.with ?? {}
      const stepWith = step?.with ?? {}
      const keysToCompare = Object.keys(attempt1With).filter(key => key !== 'prompt' && key !== 'timeout')
      expect(
        Object.keys(stepWith)
          .filter(key => key !== 'prompt' && key !== 'timeout')
          .sort(),
      ).toStrictEqual(keysToCompare.sort())
      for (const key of keysToCompare) {
        expect(stepWith[key], `with.${key}`).toBe(attempt1With[key])
      }
      expect(stepWith.prompt).not.toBe(attempt1With.prompt)
    })
  })

  describe('retry prompt: only steps.ingest-prompt.outputs.* plus static text — no attempt output leakage', () => {
    it.each([
      ['retry 1', retry1],
      ['retry 2', retry2],
    ] as const)('%s', (_label, step) => {
      const prompt = String(step?.with?.prompt ?? '')
      expect(prompt).toContain('steps.ingest-prompt.outputs.prompt')
      expect(prompt).not.toContain('steps.survey-agent')
      expect(prompt).not.toMatch(/steps\.[\w-]*retry[\w-]*\.outputs/)
      expect(prompt.toLowerCase()).toContain('mandatory')
      // A "just log why you couldn't finish" instruction would itself be a wiki change
      // (log.md), so `changed=true`, recording the very false success this plan fixes.
      expect(prompt.toLowerCase()).toContain('make no wiki changes')
      expect(prompt.toLowerCase()).not.toContain('append a log entry')
    })
  })

  describe('final-attempt selection (KTD8): !cancelled(), picks the last non-skipped attempt, pairs it with its own detect', () => {
    // Split to dodge eslint's no-template-curly-in-string rule (literal GH Actions
    // expression syntax, not a stray JS interpolation).
    const CANCELLED_ONLY_EXPR = '$' + '{{ !cancelled() }}'

    it('runs under !cancelled() only', () => {
      expect(String(finalAttempt?.if ?? '')).toBe(CANCELLED_ONLY_EXPR)
    })

    const baseSkipped = {
      ATTEMPT_1_CONCLUSION: 'success',
      DETECT_1_CONCLUSION: 'skipped',
      DETECT_1_CHANGED: '',
      RETRY_1_CONCLUSION: 'skipped',
      DETECT_2_CONCLUSION: 'skipped',
      DETECT_2_CHANGED: '',
      RETRY_2_CONCLUSION: 'skipped',
      DETECT_3_CONCLUSION: 'skipped',
      DETECT_3_CHANGED: '',
    }

    const scenarios: [string, Record<string, string>, {conclusion: string; changed: string}][] = [
      [
        'attempt 1 succeeds and changed',
        {...baseSkipped, DETECT_1_CONCLUSION: 'success', DETECT_1_CHANGED: 'true'},
        {conclusion: 'success', changed: 'true'},
      ],
      [
        'attempt 1 no-op, retry 1 succeeds and changed',
        {
          ...baseSkipped,
          DETECT_1_CONCLUSION: 'success',
          DETECT_1_CHANGED: 'false',
          RETRY_1_CONCLUSION: 'success',
          DETECT_2_CONCLUSION: 'success',
          DETECT_2_CHANGED: 'true',
        },
        {conclusion: 'success', changed: 'true'},
      ],
      [
        'all three attempts succeed with no changes (exhaustion case)',
        {
          ATTEMPT_1_CONCLUSION: 'success',
          DETECT_1_CONCLUSION: 'success',
          DETECT_1_CHANGED: 'false',
          RETRY_1_CONCLUSION: 'success',
          DETECT_2_CONCLUSION: 'success',
          DETECT_2_CHANGED: 'false',
          RETRY_2_CONCLUSION: 'success',
          DETECT_3_CONCLUSION: 'success',
          DETECT_3_CHANGED: 'false',
        },
        {conclusion: 'success', changed: 'false'},
      ],
      [
        'attempt 1 fails outright (retries never run)',
        {...baseSkipped, ATTEMPT_1_CONCLUSION: 'failure'},
        {conclusion: 'failure', changed: 'false'},
      ],
      [
        'retry 1 fails after attempt 1 no-op',
        {
          ...baseSkipped,
          DETECT_1_CONCLUSION: 'success',
          DETECT_1_CHANGED: 'false',
          RETRY_1_CONCLUSION: 'failure',
        },
        {conclusion: 'failure', changed: 'false'},
      ],
      [
        "final attempt succeeds but its own detect fails — changed must not fall back to 'true'",
        {...baseSkipped, DETECT_1_CONCLUSION: 'failure', DETECT_1_CHANGED: ''},
        {conclusion: 'success', changed: 'false'},
      ],
    ]

    it.each(scenarios)('%s', (_label, env, expected) => {
      const result = runShellStep(String(finalAttempt?.run ?? ''), env)
      expect(result.status).toBe(0)
      expect(result.outputs.conclusion).toBe(expected.conclusion)
      expect(result.outputs.changed).toBe(expected.changed)
    })
  })

  describe('exhaustion: fails loudly only when the final attempt was a clean no-op', () => {
    it("if: requires the final attempt's conclusion == 'success' and changed == 'false'", () => {
      const condition = String(exhaustion?.if ?? '')
      expect(condition).toContain("steps.final-attempt.outputs.conclusion == 'success'")
      expect(condition).toContain("steps.final-attempt.outputs.changed == 'false'")
    })

    it('run: emits ::error:: naming the attempt count and exits non-zero', () => {
      const result = runShellStep(String(exhaustion?.run ?? ''), {})
      expect(result.status).not.toBe(0)
      expect(result.stdout).toContain('::error::survey agent completed 3 attempts without the required wiki changes')
    })
  })

  it('handoff build is gated on the final-attempt outputs plus onboarded, and appears exactly once', () => {
    const condition = String(handoffBuild?.if ?? '')
    expect(condition).toContain("steps.final-attempt.outputs.conclusion == 'success'")
    expect(condition).toContain("steps.final-attempt.outputs.changed == 'true'")
    expect(condition).toContain("steps.onboarded.outputs.onboarded == 'true'")
    expect(steps.filter(s => s.id === 'wiki-handoff-build')).toHaveLength(1)
  })

  it('no step in survey-repo sets continue-on-error', () => {
    for (const step of steps) {
      expect(
        step['continue-on-error'],
        `${step.name ?? step.id ?? '(unnamed step)'} must not set continue-on-error`,
      ).toBeUndefined()
    }
  })

  it('job timeout-minutes is at least 3x the per-attempt step timeout-minutes plus headroom, and every agent step sets an explicit timeout', () => {
    const perAttemptTimeoutMinutes = attempt1?.['timeout-minutes']
    expect(perAttemptTimeoutMinutes).toBeTypeOf('number')
    expect(surveyJob?.['timeout-minutes']).toBeGreaterThanOrEqual((perAttemptTimeoutMinutes ?? 0) * 3 + 5)

    for (const [label, step] of [
      ['attempt 1', attempt1],
      ['retry 1', retry1],
      ['retry 2', retry2],
    ] as const) {
      expect(step?.['timeout-minutes'], `${label} timeout-minutes`).toBe(perAttemptTimeoutMinutes)
      expect(String(step?.with?.timeout ?? ''), `${label} with.timeout`).not.toBe('')
    }
  })

  it('job outputs: agent-conclusion and wiki-changed read from final-attempt; the rest are unchanged', () => {
    const outputs = surveyJob?.outputs ?? {}
    expect(outputs['agent-conclusion']).toContain('steps.final-attempt.outputs.conclusion')
    expect(outputs['wiki-changed']).toContain('steps.final-attempt.outputs.changed')
    expect(outputs['wiki-artifact-ready']).toContain('steps.wiki-handoff-upload.outcome')
    expect(outputs.onboarded).toContain('steps.onboarded.outputs.onboarded')
    expect(outputs['target-repository']).toContain('steps.ingest-prompt.outputs.target-repository')
    expect(outputs['target-slug']).toContain('steps.ingest-prompt.outputs.target-slug')
  })
})

describe('survey-repo.yaml Unit 4: success gate in survey-persist (KTD2)', () => {
  const persistJob = workflowParsed.jobs['survey-persist']
  const recordStep = persistJob?.steps.find(step => step.name === 'Record survey result')
  const announceStep = persistJob?.steps.find(step => step.name === '📣 Announce survey to gateway')
  const fallbackStep = persistJob?.steps.find(step => step.name === 'Record survey result (cancelled/timeout fallback)')

  const SURVEY_STATUS_EXPR = String(recordStep?.env?.SURVEY_STATUS ?? '')
  const RECORD_IF = String(recordStep?.if ?? '')
  const ANNOUNCE_IF = String(announceStep?.if ?? '')
  const FALLBACK_IF = String(fallbackStep?.if ?? '')

  it('reads non-empty expressions for all four conditions from the real workflow file', () => {
    expect(SURVEY_STATUS_EXPR).not.toBe('')
    expect(RECORD_IF).not.toBe('')
    expect(ANNOUNCE_IF).not.toBe('')
    expect(FALLBACK_IF).not.toBe('')
  })

  // Context keys referenced by SURVEY_STATUS/record-if/announce-if/fallback-if. Any key
  // omitted from a fixture row below defaults to '' via evaluateExpression, matching how
  // Actions treats an unset needs./steps. reference.
  const BASE_CONTEXT = {
    'needs.survey-repo.outputs.agent-conclusion': '',
    'needs.survey-repo.outputs.wiki-changed': '',
    'needs.survey-repo.result': '',
    'steps.recheck.conclusion': '',
    'needs.survey-repo.outputs.onboarded': '',
    'steps.wiki-commit.conclusion': '',
    'needs.survey-resolve.outputs.resolve-outcome': '',
    'steps.record-result.outcome': '',
  } as const satisfies Record<string, string>

  interface Row {
    label: string
    context: Partial<Record<keyof typeof BASE_CONTEXT, string>>
    status?: ExprFixture['status']
    expectedStatus?: 'failure' | 'success'
    record: boolean
    announce: boolean
    fallback: boolean
  }

  const rows: Row[] = [
    {
      label: 'success, changes, onboarded, commit success',
      context: {
        'needs.survey-repo.outputs.agent-conclusion': 'success',
        'needs.survey-repo.outputs.wiki-changed': 'true',
        'needs.survey-repo.result': 'success',
        'steps.recheck.conclusion': 'success',
        'needs.survey-repo.outputs.onboarded': 'true',
        'steps.wiki-commit.conclusion': 'success',
        'needs.survey-resolve.outputs.resolve-outcome': 'success',
        'steps.record-result.outcome': 'success',
      },
      expectedStatus: 'success',
      record: true,
      announce: true,
      fallback: false,
    },
    {
      label: '3× no-op exhaustion (agent success, wiki-changed false, survey-repo result failure, commit skipped)',
      context: {
        'needs.survey-repo.outputs.agent-conclusion': 'success',
        'needs.survey-repo.outputs.wiki-changed': 'false',
        'needs.survey-repo.result': 'failure',
        'steps.recheck.conclusion': 'success',
        'needs.survey-repo.outputs.onboarded': 'false',
        'steps.wiki-commit.conclusion': 'skipped',
        'needs.survey-resolve.outputs.resolve-outcome': 'success',
        'steps.record-result.outcome': 'success',
      },
      expectedStatus: 'failure',
      record: true,
      announce: false,
      fallback: false,
    },
    {
      label: 'hard failure at an attempt (agent-conclusion failure, result failure)',
      context: {
        'needs.survey-repo.outputs.agent-conclusion': 'failure',
        'needs.survey-repo.outputs.wiki-changed': 'false',
        'needs.survey-repo.result': 'failure',
        'steps.recheck.conclusion': 'success',
        'needs.survey-repo.outputs.onboarded': 'false',
        'steps.wiki-commit.conclusion': 'skipped',
        'needs.survey-resolve.outputs.resolve-outcome': 'success',
        'steps.record-result.outcome': 'success',
      },
      expectedStatus: 'failure',
      record: true,
      announce: false,
      fallback: false,
    },
    {
      label: 'detect failed after a successful attempt (agent success, wiki-changed false, result failure)',
      context: {
        'needs.survey-repo.outputs.agent-conclusion': 'success',
        'needs.survey-repo.outputs.wiki-changed': 'false',
        'needs.survey-repo.result': 'failure',
        'steps.recheck.conclusion': 'success',
        'needs.survey-repo.outputs.onboarded': 'false',
        'steps.wiki-commit.conclusion': 'skipped',
        'needs.survey-resolve.outputs.resolve-outcome': 'success',
        'steps.record-result.outcome': 'success',
      },
      expectedStatus: 'failure',
      record: true,
      announce: false,
      fallback: false,
    },
    {
      label: 'handoff build/upload failed (agent success, wiki-changed true, result failure, commit skipped)',
      context: {
        'needs.survey-repo.outputs.agent-conclusion': 'success',
        'needs.survey-repo.outputs.wiki-changed': 'true',
        'needs.survey-repo.result': 'failure',
        'steps.recheck.conclusion': 'success',
        'needs.survey-repo.outputs.onboarded': 'true',
        'steps.wiki-commit.conclusion': 'skipped',
        'needs.survey-resolve.outputs.resolve-outcome': 'success',
        'steps.record-result.outcome': 'success',
      },
      expectedStatus: 'failure',
      record: true,
      announce: false,
      fallback: false,
    },
    {
      label: 'not onboarded, with changes, commit skipped, result success',
      context: {
        'needs.survey-repo.outputs.agent-conclusion': 'success',
        'needs.survey-repo.outputs.wiki-changed': 'true',
        'needs.survey-repo.result': 'success',
        'steps.recheck.conclusion': 'success',
        'needs.survey-repo.outputs.onboarded': 'false',
        'steps.wiki-commit.conclusion': 'skipped',
        'needs.survey-resolve.outputs.resolve-outcome': 'success',
        'steps.record-result.outcome': 'success',
      },
      expectedStatus: 'success',
      record: true,
      announce: false,
      fallback: false,
    },
    {
      label: 'recheck failed → no record, no announce',
      context: {
        'needs.survey-repo.outputs.agent-conclusion': 'success',
        'needs.survey-repo.outputs.wiki-changed': 'true',
        'needs.survey-repo.result': 'success',
        'steps.recheck.conclusion': 'failure',
        'needs.survey-repo.outputs.onboarded': 'true',
        'steps.wiki-commit.conclusion': '',
        'needs.survey-resolve.outputs.resolve-outcome': 'success',
        'steps.record-result.outcome': 'skipped',
      },
      record: false,
      announce: false,
      fallback: false,
    },
    {
      label: 'survey-repo cancelled (result cancelled, cancelled() true)',
      context: {
        'needs.survey-repo.outputs.agent-conclusion': '',
        'needs.survey-repo.outputs.wiki-changed': '',
        'needs.survey-repo.result': 'cancelled',
        'steps.recheck.conclusion': 'success',
        'needs.survey-repo.outputs.onboarded': '',
        'steps.wiki-commit.conclusion': '',
        'needs.survey-resolve.outputs.resolve-outcome': 'success',
        'steps.record-result.outcome': 'skipped',
      },
      status: {cancelled: true, failure: false},
      record: false,
      announce: false,
      fallback: true,
    },
    {
      // Defense-in-depth isolation for the wiki-changed term: given Unit 3's exhaustion
      // step, this exact combination (agent success, wiki-changed false, yet the job
      // result is still success) should never occur in production — the exhaustion step
      // deterministically fails the job whenever the final attempt succeeds with no
      // changes, so `needs.survey-repo.result == 'success'` alone already rejects the
      // realistic "3× no-op exhaustion" row below. This synthetic row isolates the
      // wiki-changed term itself so a regression in Unit 3 (or a future edit that drops
      // that coupling) doesn't silently start recording false successes.
      label: 'wiki-changed false in isolation (would be unreachable if Unit 3 holds; defense-in-depth)',
      context: {
        'needs.survey-repo.outputs.agent-conclusion': 'success',
        'needs.survey-repo.outputs.wiki-changed': 'false',
        'needs.survey-repo.result': 'success',
        'steps.recheck.conclusion': 'success',
        'needs.survey-repo.outputs.onboarded': 'false',
        'steps.wiki-commit.conclusion': 'skipped',
        'needs.survey-resolve.outputs.resolve-outcome': 'success',
        'steps.record-result.outcome': 'success',
      },
      expectedStatus: 'failure',
      record: true,
      announce: false,
      fallback: false,
    },
    {
      label: "survey-repo died before final-attempt (agent-conclusion '', result failure)",
      context: {
        'needs.survey-repo.outputs.agent-conclusion': '',
        'needs.survey-repo.outputs.wiki-changed': '',
        'needs.survey-repo.result': 'failure',
        'steps.recheck.conclusion': 'success',
        'needs.survey-repo.outputs.onboarded': '',
        'steps.wiki-commit.conclusion': 'skipped',
        'needs.survey-resolve.outputs.resolve-outcome': 'success',
        'steps.record-result.outcome': 'success',
      },
      expectedStatus: 'failure',
      record: true,
      announce: false,
      fallback: false,
    },
  ]

  describe.each(rows)('$label', ({context, status, expectedStatus, record, announce, fallback}) => {
    const fixture: ExprFixture = {context: {...BASE_CONTEXT, ...context}, status}

    it('record if: matches expected run/skip', () => {
      expect(evaluateCondition(RECORD_IF, fixture)).toBe(record)
    })

    it('announce if: matches expected run/skip', () => {
      expect(evaluateCondition(ANNOUNCE_IF, fixture)).toBe(announce)
    })

    it('fallback if: matches expected run/skip', () => {
      expect(evaluateCondition(FALLBACK_IF, fixture)).toBe(fallback)
    })

    if (expectedStatus !== undefined) {
      it(`SURVEY_STATUS evaluates to '${expectedStatus}'`, () => {
        expect(exprStringify(evaluateExpression(SURVEY_STATUS_EXPR, fixture))).toBe(expectedStatus)
      })
    }
  })

  it('SURVEY_STATUS references the final conclusion, wiki-changed, job result, and the onboarded-commit condition (non-vacuity via term removal below)', () => {
    expect(SURVEY_STATUS_EXPR).toContain("needs.survey-repo.outputs.agent-conclusion == 'success'")
    expect(SURVEY_STATUS_EXPR).toContain("needs.survey-repo.outputs.wiki-changed == 'true'")
    expect(SURVEY_STATUS_EXPR).toContain("needs.survey-repo.result == 'success'")
    expect(SURVEY_STATUS_EXPR).toContain("steps.recheck.conclusion == 'success'")
    expect(SURVEY_STATUS_EXPR).toContain("needs.survey-repo.outputs.onboarded != 'true'")
    expect(SURVEY_STATUS_EXPR).toContain("steps.wiki-commit.conclusion == 'success'")
  })

  it('announce if: has the same terms as SURVEY_STATUS plus onboarded == true (no skipped-commit exemption)', () => {
    expect(ANNOUNCE_IF).toContain("needs.survey-repo.outputs.agent-conclusion == 'success'")
    expect(ANNOUNCE_IF).toContain("needs.survey-repo.outputs.wiki-changed == 'true'")
    expect(ANNOUNCE_IF).toContain("needs.survey-repo.result == 'success'")
    expect(ANNOUNCE_IF).toContain("steps.recheck.conclusion == 'success'")
    expect(ANNOUNCE_IF).toContain("needs.survey-repo.outputs.onboarded == 'true'")
    expect(ANNOUNCE_IF).toContain("steps.wiki-commit.conclusion == 'success'")
  })

  it('the record if: and fallback if: are unchanged by this unit (still gated on resolve-outcome/recheck, not on wiki-changed)', () => {
    expect(RECORD_IF).toContain("needs.survey-repo.outputs.agent-conclusion != 'skipped'")
    expect(RECORD_IF).toContain("needs.survey-resolve.outputs.resolve-outcome == 'success'")
    expect(RECORD_IF).toContain("steps.recheck.conclusion == 'success'")
    expect(RECORD_IF).not.toContain('wiki-changed')

    expect(FALLBACK_IF).toContain("steps.record-result.outcome != 'success'")
    expect(FALLBACK_IF).toContain("needs.survey-resolve.outputs.resolve-outcome == 'success'")
    expect(FALLBACK_IF).toContain("steps.recheck.conclusion == 'success'")
  })
})
