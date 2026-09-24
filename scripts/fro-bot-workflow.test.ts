/**
 * Contract tests for .github/workflows/fro-bot.yaml's daily-pass delivery-mode
 * split: the schedule/workflow_dispatch path runs as two jobs
 * (fro-bot-remediate: categories 1–4, branch-pr; fro-bot-observe: categories
 * 5–8 + daily report, working-dir), a custom prompt resolves to exactly one
 * of them, and the reusable-workflow callers (apply-branding.yaml,
 * gateway-rollout-tracker.yaml) declare the output-mode they need. Style
 * mirrors publish-wiki-workflow.test.ts.
 */

import {execFileSync} from 'node:child_process'
import {chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import process from 'node:process'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface WorkflowStep {
  name?: string
  id?: string
  if?: string
  run?: string
  uses?: string
  shell?: string
  env?: Record<string, unknown>
  with?: Record<string, unknown>
}

interface WorkflowJob {
  name?: string
  steps?: WorkflowStep[]
  needs?: string | string[]
  if?: string
  with?: Record<string, unknown>
}

interface WorkflowInput {
  description?: string
  required?: boolean
  type?: string
  default?: unknown
  options?: string[]
}

function assertWorkflowShape(value: unknown): asserts value is {
  on: Record<string, unknown>
  env?: Record<string, unknown>
  jobs: Record<string, WorkflowJob>
} {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('jobs' in value) ||
    typeof (value as Record<string, unknown>).jobs !== 'object'
  ) {
    throw new TypeError('workflow file does not have expected shape: missing jobs object')
  }
}

const froBotPath = resolve(import.meta.dirname, '../.github/workflows/fro-bot.yaml')
const froBotRaw = readFileSync(froBotPath, 'utf8')
const froBotParsed: unknown = parse(froBotRaw)
assertWorkflowShape(froBotParsed)

const applyBrandingPath = resolve(import.meta.dirname, '../.github/workflows/apply-branding.yaml')
const applyBrandingParsed: unknown = parse(readFileSync(applyBrandingPath, 'utf8'))
assertWorkflowShape(applyBrandingParsed)

const gatewayTrackerPath = resolve(import.meta.dirname, '../.github/workflows/gateway-rollout-tracker.yaml')
const gatewayTrackerParsed: unknown = parse(readFileSync(gatewayTrackerPath, 'utf8'))
assertWorkflowShape(gatewayTrackerParsed)

function findStepIndex(job: WorkflowJob | undefined, predicate: (step: WorkflowStep) => boolean): number {
  return (job?.steps ?? []).findIndex(predicate)
}

describe('fro-bot.yaml daily-pass job split', () => {
  const remediateJob = froBotParsed.jobs['fro-bot-remediate']
  const observeJob = froBotParsed.jobs['fro-bot-observe']
  const contentJob = froBotParsed.jobs['fro-bot']

  it('defines fro-bot-remediate and fro-bot-observe alongside the unchanged content-trigger job', () => {
    expect(contentJob).toBeDefined()
    expect(remediateJob).toBeDefined()
    expect(observeJob).toBeDefined()
  })

  it('fro-bot-remediate sets output-mode: branch-pr on the agent step', () => {
    const agentStep = remediateJob?.steps?.find(step => step.id === 'fro-bot-agent')
    expect(agentStep?.with?.['output-mode']).toBe('branch-pr')
  })

  it('fro-bot-observe sets output-mode: working-dir on the agent step', () => {
    const agentStep = observeJob?.steps?.find(step => step.id === 'fro-bot-agent')
    expect(agentStep?.with?.['output-mode']).toBe('working-dir')
  })

  it('the content-trigger job does not set an output-mode (unaffected by the split)', () => {
    const agentStep = contentJob?.steps?.find(step => step.id === 'fro-bot-agent')
    expect(agentStep?.with?.['output-mode']).toBeUndefined()
  })

  it('fro-bot-observe declares needs: fro-bot-remediate', () => {
    expect(observeJob?.needs).toBe('fro-bot-remediate')
  })

  it('content-trigger job if: still excludes schedule and workflow_dispatch (unchanged path)', () => {
    const contentIf = String(contentJob?.if ?? '')
    expect(contentIf).not.toContain("github.event_name == 'schedule'")
    expect(contentIf).not.toContain("github.event_name == 'workflow_dispatch'")
  })
})

describe('fro-bot.yaml wiki baseline/detect/ingest ordering', () => {
  const observeJob = froBotParsed.jobs['fro-bot-observe']
  const remediateJob = froBotParsed.jobs['fro-bot-remediate']

  it('within fro-bot-observe: Capture wiki baseline precedes the agent step, which precedes Detect/Build handoff', () => {
    const baselineIndex = findStepIndex(observeJob, step => step.name === 'Capture wiki baseline')
    const agentIndex = findStepIndex(observeJob, step => step.id === 'fro-bot-agent')
    const detectIndex = findStepIndex(observeJob, step => step.name === 'Detect wiki insight changes')
    const buildIndex = findStepIndex(observeJob, step => step.name === 'Build wiki handoff artifact')
    const uploadIndex = findStepIndex(observeJob, step => step.name === 'Upload wiki handoff artifact')

    expect(baselineIndex).toBeGreaterThanOrEqual(0)
    expect(agentIndex).toBeGreaterThan(baselineIndex)
    expect(detectIndex).toBeGreaterThan(agentIndex)
    expect(buildIndex).toBeGreaterThan(detectIndex)
    expect(uploadIndex).toBeGreaterThan(buildIndex)
  })

  it('fro-bot-observe never runs wiki-ingest.ts itself — that only happens in the trusted follow-on job', () => {
    expect(findStepIndex(observeJob, step => typeof step.run === 'string' && step.run.includes('wiki-ingest.ts'))).toBe(
      -1,
    )
  })

  it('fro-bot-remediate has no wiki baseline/detect/ingest steps — it cannot commit knowledge/**', () => {
    expect(findStepIndex(remediateJob, step => step.name === 'Capture wiki baseline')).toBe(-1)
    expect(findStepIndex(remediateJob, step => step.name === 'Detect wiki insight changes')).toBe(-1)
    expect(findStepIndex(remediateJob, step => step.name === 'Ingest wiki insight changes')).toBe(-1)
  })

  it('fro-bot-remediate has no daily-report steps — only fro-bot-observe creates/announces the report', () => {
    expect(findStepIndex(remediateJob, step => step.name === '🔍 Discover daily report URL')).toBe(-1)
    expect(findStepIndex(remediateJob, step => step.name === '📊 Derive daily digest counts')).toBe(-1)
    expect(findStepIndex(remediateJob, step => step.name === '📣 Announce daily digest to gateway')).toBe(-1)
  })
})

describe('fro-bot.yaml pre-agent tree cleanliness', () => {
  const remediateJob = froBotParsed.jobs['fro-bot-remediate']
  const observeJob = froBotParsed.jobs['fro-bot-observe']

  it('fro-bot-remediate restores knowledge/ to HEAD after solutions-query and before the agent runs', () => {
    const solutionsIndex = findStepIndex(remediateJob, step => step.id === 'solutions-query')
    const restoreIndex = findStepIndex(
      remediateJob,
      step => typeof step.run === 'string' && step.run.includes('git restore --worktree --source=HEAD -- knowledge'),
    )
    const agentIndex = findStepIndex(remediateJob, step => step.id === 'fro-bot-agent')

    expect(solutionsIndex).toBeGreaterThanOrEqual(0)
    expect(restoreIndex).toBeGreaterThan(solutionsIndex)
    expect(agentIndex).toBeGreaterThan(restoreIndex)
  })

  it('the restore step verifies a clean git status --porcelain -- knowledge, not just the restore command', () => {
    const restoreStep = remediateJob?.steps?.find(
      step => typeof step.run === 'string' && step.run.includes('git restore --worktree --source=HEAD -- knowledge'),
    )
    expect(String(restoreStep?.run ?? '')).toContain('git status --porcelain -- knowledge')
    expect(String(restoreStep?.run ?? '')).toContain('exit 1')
  })

  it('the restore step also removes untracked pages, which git restore cannot touch', () => {
    // `data` may carry a wiki page `main` lacks; the sync writes it untracked, and
    // `git restore` only manages tracked paths. Without the clean, the guard below it
    // fails the job the first time a survey adds a page before the weekly promotion.
    const restoreStep = remediateJob?.steps?.find(
      step => typeof step.run === 'string' && step.run.includes('git restore --worktree --source=HEAD -- knowledge'),
    )
    expect(String(restoreStep?.run ?? '')).toContain('git clean -fd -- knowledge')
    expect(String(restoreStep?.run ?? '')).not.toContain('git clean -fdx')
  })

  it('fro-bot-observe has no such restore step — its dirty tree is load-bearing for wiki-ingest.ts', () => {
    const restoreIndex = findStepIndex(
      observeJob,
      step => typeof step.run === 'string' && step.run.includes('git restore --worktree --source=HEAD -- knowledge'),
    )
    expect(restoreIndex).toBe(-1)
  })
})

describe('fro-bot.yaml custom-prompt single-job resolution', () => {
  const workflowDispatchInputs = (froBotParsed.on as {workflow_dispatch?: {inputs?: Record<string, WorkflowInput>}})
    .workflow_dispatch?.inputs
  const workflowCallInputs = (froBotParsed.on as {workflow_call?: {inputs?: Record<string, WorkflowInput>}})
    .workflow_call?.inputs

  it('workflow_dispatch declares an output-mode choice input defaulting to branch-pr', () => {
    const input = workflowDispatchInputs?.['output-mode']
    expect(input).toBeDefined()
    expect(input?.type).toBe('choice')
    expect(input?.options).toEqual(['branch-pr', 'working-dir'])
    expect(input?.default).toBe('branch-pr')
  })

  it('workflow_call declares an output-mode input defaulting to working-dir (safest for an omitting caller)', () => {
    const input = workflowCallInputs?.['output-mode']
    expect(input).toBeDefined()
    expect(input?.required).toBe(false)
    expect(input?.default).toBe('working-dir')
  })

  it('fro-bot-remediate only runs a custom prompt when output-mode resolves to branch-pr', () => {
    const remediateIf = String(froBotParsed.jobs['fro-bot-remediate']?.if ?? '')
    expect(remediateIf).toContain("inputs.prompt == ''")
    expect(remediateIf).toContain("inputs['output-mode'] == 'branch-pr'")
  })

  it('fro-bot-observe only runs a custom prompt when output-mode resolves to working-dir', () => {
    const observeIf = String(froBotParsed.jobs['fro-bot-observe']?.if ?? '')
    expect(observeIf).toContain("inputs.prompt == ''")
    expect(observeIf).toContain("inputs['output-mode'] == 'working-dir'")
  })

  it('the two jobs gate on mutually exclusive output-mode values, so a custom prompt selects exactly one', () => {
    const remediateIf = String(froBotParsed.jobs['fro-bot-remediate']?.if ?? '')
    const observeIf = String(froBotParsed.jobs['fro-bot-observe']?.if ?? '')
    expect(remediateIf).toContain('branch-pr')
    expect(remediateIf).not.toContain("'working-dir'")
    expect(observeIf).toContain('working-dir')
    expect(observeIf).not.toContain("'branch-pr'")
  })

  it('fro-bot-observe runs regardless of fro-bot-remediate outcome (skipped or failed), only cancellation stops it', () => {
    const observeIf = String(froBotParsed.jobs['fro-bot-observe']?.if ?? '')
    expect(observeIf).toContain('!cancelled()')
    expect(observeIf).not.toContain('success()')
  })
})
describe('fro-bot.yaml: prompt bound to output-mode', () => {
  const remediateJob = froBotParsed.jobs['fro-bot-remediate']
  const observeJob = froBotParsed.jobs['fro-bot-observe']

  it('remediate task prompt references REMEDIATE pieces only', () => {
    const agentStep = remediateJob?.steps?.find(step => step.id === 'fro-bot-agent')
    const taskPrompt = String(agentStep?.env?.TASK_PROMPT ?? '')
    expect(taskPrompt).toContain('env.REMEDIATE_INTRO')
    expect(taskPrompt).toContain('env.REMEDIATE_CATEGORIES')
    expect(taskPrompt).not.toContain('env.OBSERVE_INTRO')
    expect(taskPrompt).not.toContain('env.OBSERVE_CATEGORIES')
    expect(taskPrompt).not.toContain('env.OBSERVE_OUTPUT')
  })

  it('observe task prompt references OBSERVE pieces only', () => {
    const agentStep = observeJob?.steps?.find(step => step.id === 'fro-bot-agent')
    const taskPrompt = String(agentStep?.env?.TASK_PROMPT ?? '')
    expect(taskPrompt).toContain('env.OBSERVE_INTRO')
    expect(taskPrompt).toContain('env.OBSERVE_CATEGORIES')
    expect(taskPrompt).toContain('env.OBSERVE_OUTPUT')
    expect(taskPrompt).not.toContain('env.REMEDIATE_INTRO')
    expect(taskPrompt).not.toContain('env.REMEDIATE_CATEGORIES')
  })

  it('both jobs share HARD_BOUNDARIES, AGENT_NOTES, and SHARED_RULES', () => {
    const remediateAgentStep = remediateJob?.steps?.find(step => step.id === 'fro-bot-agent')
    const observeAgentStep = observeJob?.steps?.find(step => step.id === 'fro-bot-agent')
    const remediateTaskPrompt = String(remediateAgentStep?.env?.TASK_PROMPT ?? '')
    const observeTaskPrompt = String(observeAgentStep?.env?.TASK_PROMPT ?? '')
    const sharedNames = ['env.SHARED_RULES', 'env.HARD_BOUNDARIES', 'env.AGENT_NOTES']
    for (const shared of sharedNames) {
      expect(remediateTaskPrompt).toContain(shared)
      expect(observeTaskPrompt).toContain(shared)
    }
  })
})
describe('reusable-workflow callers declare the output-mode they need', () => {
  it('apply-branding.yaml passes output-mode: branch-pr', () => {
    const job = applyBrandingParsed.jobs['apply-branding']
    expect(job?.with).toBeDefined()
    expect(job?.with?.['output-mode']).toBe('branch-pr')
  })

  it('gateway-rollout-tracker.yaml does not pass output-mode — it relies on the working-dir default', () => {
    const job = gatewayTrackerParsed.jobs['update-rollout-tracker']
    expect(job?.with?.['output-mode']).toBeUndefined()
  })
})

describe('fro-bot.yaml prompt content: delivery-mode instructions land in the right job', () => {
  const env = froBotParsed.env as Record<string, string>

  it('the observe prompt forbids branch/commit/push — it cannot deliver that way', () => {
    const observeIntro = env.OBSERVE_INTRO ?? ''
    expect(observeIntro).toContain('never run `git branch`, `git commit`,')
    expect(observeIntro).toContain('delivers via branch+PR')
    expect(observeIntro.toLowerCase()).toContain('working-dir mode')
  })

  it('the remediate prompt instructs branch/commit/push as the required delivery mechanism', () => {
    const remediateIntro = env.REMEDIATE_INTRO ?? ''
    const remediateCategories = env.REMEDIATE_CATEGORIES ?? ''
    expect(remediateIntro.toLowerCase()).toContain('branch-pr mode')
    expect(remediateIntro).toContain('checking out a')
    expect(remediateCategories).toContain('push to that PR branch')
  })

  it('both the remediate and observe prompts state the guarded-paths boundary explicitly', () => {
    const remediateIntro = env.REMEDIATE_INTRO ?? ''
    const observeIntro = env.OBSERVE_INTRO ?? ''
    expect(remediateIntro).toContain('knowledge/wiki/**')
    expect(remediateIntro).toContain('metadata/*.yaml')
    expect(observeIntro).toContain('metadata/*.yaml')
  })

  it('the observe prompt corrects the dirty-tree requirement for wiki-ingest.ts', () => {
    const observeIntro = env.OBSERVE_INTRO ?? ''
    expect(observeIntro).toContain('git status --porcelain')
    expect(observeIntro).toContain('leave that tree dirty')
  })

  it('the observe output section instructs reading remediate PRs instead of re-analysis', () => {
    const observeOutput = env.OBSERVE_OUTPUT ?? ''
    expect(observeOutput).toContain('Do not re-analyze those')
    expect(observeOutput).toContain('Fro-Bot-authored PRs')
  })
})

describe('fro-bot.yaml content-trigger job: issues-branch trust and checkout credential scope', () => {
  const contentJob = froBotParsed.jobs['fro-bot']
  const contentIf = String(contentJob?.if ?? '')
  const checkoutStep = contentJob?.steps?.find(step => step.name === 'Checkout repository')

  it('configuration contract: full if predicate matches expected condition (whitespace-normalized)', () => {
    // Not redundant with the narrower tests below: only a full-predicate pin catches
    // guard placement drift (right clause text, wrong branch) and an unsafe `|| true`
    // bypass appended to one clause — neither a substring/contains check on a single
    // clause would detect either. This is a static string comparison, not a live GHA evaluation.
    const expectedIf = `
      (
        github.event.pull_request == null ||
        (
          !github.event.pull_request.head.repo.fork &&
          !endsWith(github.event.pull_request.user.login || '', '[bot]')
        )
      ) && (
        (
          github.event_name == 'issues' &&
          !endsWith(github.event.issue.user.login || '', '[bot]') &&
          (github.event.issue.user.login || '') != 'fro-bot' &&
          contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.issue.author_association || '')
        ) ||
        (
          github.event_name == 'pull_request' &&
          !endsWith(github.event.pull_request.user.login || '', '[bot]') &&
          (github.event.pull_request.user.login || '') != 'fro-bot'
        ) ||
        (
          (github.event_name == 'issue_comment' ||
           github.event_name == 'pull_request_review_comment' ||
           github.event_name == 'discussion_comment') &&
          contains(github.event.comment.body || '', '@fro-bot') &&
          (github.event.comment.user.login || '') != 'fro-bot' &&
          contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association || '')
        )
      )
    `

    expect(contentIf.replaceAll(/\s+/g, ' ').trim()).toBe(expectedIf.replaceAll(/\s+/g, ' ').trim())
  })

  it('keeps the issues branch bot exclusions and opened/edited event types unchanged', () => {
    expect(contentIf).toContain(`!endsWith(github.event.issue.user.login || '', '[bot]')`)
    expect(contentIf).toContain(`(github.event.issue.user.login || '') != 'fro-bot'`)
    const issuesTypes = (froBotParsed.on as {issues?: {types?: string[]}}).issues?.types
    expect(issuesTypes).toEqual(['opened', 'edited'])
  })

  it('leaves the comment branch untouched', () => {
    expect(contentIf).toContain(
      `contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association || '')`,
    )
  })

  it('fro-bot-remediate keeps checkout credential persistence effective (its branch-pr push needs it)', () => {
    const remediateCheckout = froBotParsed.jobs['fro-bot-remediate']?.steps?.find(
      step => step.name === 'Checkout repository',
    )
    expect(remediateCheckout).toBeDefined() // guards against a vacuous pass if the step were renamed/removed
    // output-mode: branch-pr commits and pushes from this job, so persist-credentials must
    // stay effective — the actions/checkout default (undefined) or an explicit true; never false.
    expect(remediateCheckout?.with?.['persist-credentials']).not.toBe(false)
  })

  it('sets persist-credentials: false on the content-trigger job checkout while keeping the PAT token', () => {
    const expressionStart = '$' + '{{'
    expect(checkoutStep?.with?.['persist-credentials']).toBe(false)
    expect(checkoutStep?.with?.token).toBe(`${expressionStart} secrets.FRO_BOT_PAT }}`)
    expect(checkoutStep?.with?.['fetch-depth']).toBe(0)
  })

  it('leaves the agent step github-token input unchanged', () => {
    const agentStep = contentJob?.steps?.find(step => step.id === 'fro-bot-agent')
    const expressionStart = '$' + '{{'
    expect(agentStep?.with?.['github-token']).toBe(`${expressionStart} secrets.FRO_BOT_PAT }}`)
  })
})

describe('sync-wiki composite action: wiki sync failure visibility (shell-flow fixtures — fake git in an isolated tmp dir, not a hosted GHA run)', () => {
  const syncWikiActionPath = resolve(import.meta.dirname, '../.github/actions/sync-wiki/action.yaml')
  const syncWikiAction: unknown = parse(readFileSync(syncWikiActionPath, 'utf8'))
  const syncStep = (syncWikiAction as {runs?: {steps?: WorkflowStep[]}}).runs?.steps?.find(
    step => step.name === 'Sync wiki from data branch',
  )
  const runScript = String(syncStep?.run ?? '')

  it('finds the Sync wiki from data branch step in the action file', () => {
    expect(syncStep).toBeDefined() // guards against a vacuous pass if the step were renamed/removed
  })

  it('pins shell: bash on the composite step (composite run steps have no default shell)', () => {
    expect(syncStep?.shell).toBe('bash')
  })

  // Bounded, single-purpose fake `git`: only the three subcommands this step calls
  // are recognized, each exits per an env var the test controls, and each appends its
  // own name to a trace file so tests can assert which subcommands actually ran.
  // ls-remote/fetch also accept a space-separated exit sequence (e.g. FAKE_GIT_FETCH_EXITS="128 128 0")
  // consumed one value per call via a counter file, falling back to the fixed single-value var.
  // Not a git reimplementation.
  const fakeGit = [
    '#!/bin/sh',
    'echo "$1" >> "$FAKE_GIT_TRACE_FILE"',
    'if [ -n "$FAKE_GIT_ECHO" ]; then echo "fake-git-output:$1" >&2; fi',
    'next_from_sequence() {',
    '  seq_var="$1"; counter_file="$2"; fallback_var="$3"',
    String.raw`  eval "sequence=\$$seq_var"`,
    '  if [ -z "$sequence" ]; then',
    String.raw`    eval "exit \$$fallback_var"`,
    '  fi',
    '  count=$(cat "$counter_file" 2>/dev/null || echo 0)',
    '  # shellcheck disable=SC2086',
    '  value=$(echo $sequence | cut -d" " -f$((count + 1)))',
    '  echo $((count + 1)) > "$counter_file"',
    '  exit "$value"',
    '}',
    'case "$1" in',
    '  ls-remote) next_from_sequence FAKE_GIT_LS_REMOTE_EXITS "$FAKE_GIT_TRACE_FILE.ls-remote-count" FAKE_GIT_LS_REMOTE_EXIT ;;',
    '  fetch) next_from_sequence FAKE_GIT_FETCH_EXITS "$FAKE_GIT_TRACE_FILE.fetch-count" FAKE_GIT_FETCH_EXIT ;;',
    '  restore) exit "$FAKE_GIT_RESTORE_EXIT" ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join('\n')

  function runSyncStep(env: Record<string, string>): {
    status: number
    stdout: string
    stderr: string
    trace: string[]
    sleeps: string[]
    pwned: boolean
  } {
    const dir = mkdtempSync(join(tmpdir(), 'fro-bot-wiki-sync-'))
    try {
      const gitPath = join(dir, 'git')
      writeFileSync(gitPath, fakeGit)
      chmodSync(gitPath, 0o755)
      // Fake `sleep` records the requested delay instead of waiting, so backoff assertions cost no wall time.
      const sleepLog = join(dir, 'sleeps')
      writeFileSync(sleepLog, '')
      const sleepPath = join(dir, 'sleep')
      writeFileSync(sleepPath, `#!/bin/sh\necho "$1" >> "${sleepLog}"\n`)
      chmodSync(sleepPath, 0o755)
      const scriptPath = join(dir, 'step.sh')
      writeFileSync(scriptPath, runScript)
      const traceFile = join(dir, 'trace')
      writeFileSync(traceFile, '')
      const runEnv = {
        SYNC_WIKI_RETRY_DELAY_SECONDS: '0',
        ...env,
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        FAKE_GIT_TRACE_FILE: traceFile,
      }
      const stderrFile = join(dir, 'stderr')
      let result: {status: number; stdout: string}
      try {
        const stdout = execFileSync('bash', ['-c', 'bash "$0" 2>"$1"', scriptPath, stderrFile], {
          cwd: dir,
          env: runEnv,
          encoding: 'utf8',
        })
        result = {status: 0, stdout}
      } catch (error) {
        const failure = error as {status?: number; stdout?: string}
        result = {status: failure.status ?? 1, stdout: String(failure.stdout ?? '')}
      }
      const stderr = readFileSync(stderrFile, 'utf8')
      const trace = readFileSync(traceFile, 'utf8').split('\n').filter(Boolean)
      const sleeps = readFileSync(sleepLog, 'utf8').split('\n').filter(Boolean)
      return {...result, stderr, trace, sleeps, pwned: existsSync(join(dir, 'pwned'))}
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  }

  it('branch present, fetch and restore succeed: exits clean with no warning or skip message', () => {
    const result = runSyncStep({FAKE_GIT_LS_REMOTE_EXIT: '0', FAKE_GIT_FETCH_EXIT: '0', FAKE_GIT_RESTORE_EXIT: '0'})
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('::warning::')
    expect(result.stdout).not.toContain('not yet established')
  })

  it('data branch absent (ls-remote exit 2): informational message, no warning, exits clean', () => {
    const result = runSyncStep({FAKE_GIT_LS_REMOTE_EXIT: '2', FAKE_GIT_FETCH_EXIT: '0', FAKE_GIT_RESTORE_EXIT: '0'})
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('::warning::')
    expect(result.stdout.toLowerCase()).toContain('not yet established')
  })

  it('ls-remote probe error (exit 128, distinct from the exit-2 absence case): fails closed after 3 attempts with a byte-identical ::error::, no fetch/restore attempted', () => {
    const result = runSyncStep({FAKE_GIT_LS_REMOTE_EXIT: '128', FAKE_GIT_FETCH_EXIT: '0', FAKE_GIT_RESTORE_EXIT: '0'})
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain(
      '::error::data branch probe failed (exit 128); refusing to run on a possibly stale knowledge/ snapshot.',
    )
    expect(result.stdout.match(/::warning::/g)).toHaveLength(2)
    expect(result.trace).toEqual(['ls-remote', 'ls-remote', 'ls-remote'])
  })

  it('fetch fails after a successful probe: fails closed after 3 attempts with a byte-identical ::error::, no restore attempted', () => {
    const result = runSyncStep({FAKE_GIT_LS_REMOTE_EXIT: '0', FAKE_GIT_FETCH_EXIT: '1', FAKE_GIT_RESTORE_EXIT: '0'})
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain(
      '::error::data branch fetch failed; refusing to run on a possibly stale knowledge/ snapshot.',
    )
    expect(result.stdout.match(/::warning::/g)).toHaveLength(2)
    expect(result.trace).toEqual(['ls-remote', 'fetch', 'fetch', 'fetch'])
  })

  it('restore fails: hard failure is preserved, not swallowed (unchanged from before this fix)', () => {
    const result = runSyncStep({FAKE_GIT_LS_REMOTE_EXIT: '0', FAKE_GIT_FETCH_EXIT: '0', FAKE_GIT_RESTORE_EXIT: '1'})
    expect(result.status).not.toBe(0)
  })

  it('probe fails once, then succeeds: fetch and restore run, exits clean, exactly one ::warning::, no ::error::', () => {
    const result = runSyncStep({
      FAKE_GIT_LS_REMOTE_EXITS: '128 0',
      FAKE_GIT_FETCH_EXIT: '0',
      FAKE_GIT_RESTORE_EXIT: '0',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('::error::')
    expect(result.stdout.match(/::warning::/g)).toHaveLength(1)
    expect(result.trace).toEqual(['ls-remote', 'ls-remote', 'fetch', 'restore'])
  })

  it('fetch fails twice, then succeeds: restore runs, exits clean, exactly two ::warning:: lines', () => {
    const result = runSyncStep({
      FAKE_GIT_LS_REMOTE_EXIT: '0',
      FAKE_GIT_FETCH_EXITS: '1 1 0',
      FAKE_GIT_RESTORE_EXIT: '0',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('::error::')
    expect(result.stdout.match(/::warning::/g)).toHaveLength(2)
    expect(result.trace).toEqual(['ls-remote', 'fetch', 'fetch', 'fetch', 'restore'])
  })

  it('probe exit 2 (branch absent) is never retried: exactly one ls-remote call, no ::warning::', () => {
    const result = runSyncStep({FAKE_GIT_LS_REMOTE_EXIT: '2', FAKE_GIT_FETCH_EXIT: '0', FAKE_GIT_RESTORE_EXIT: '0'})
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('::warning::')
    expect(result.trace).toEqual(['ls-remote'])
  })

  it('probe fails transiently, then reports branch absent: skips the sync but warns that absence followed a failure', () => {
    const result = runSyncStep({
      FAKE_GIT_LS_REMOTE_EXITS: '128 2',
      FAKE_GIT_FETCH_EXIT: '0',
      FAKE_GIT_RESTORE_EXIT: '0',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      '::warning::data branch probe returned exit 2 on attempt 2/3 after earlier failures',
    )
    expect(result.stdout.toLowerCase()).toContain('not yet established')
    expect(result.trace).toEqual(['ls-remote', 'ls-remote'])
  })

  it.each(['', '5s', 'a[$(touch pwned)]'])(
    'falls back to the default delay when SYNC_WIKI_RETRY_DELAY_SECONDS is %j',
    delay => {
      const result = runSyncStep({
        SYNC_WIKI_RETRY_DELAY_SECONDS: delay,
        FAKE_GIT_LS_REMOTE_EXIT: '0',
        FAKE_GIT_FETCH_EXITS: '1 0',
        FAKE_GIT_RESTORE_EXIT: '0',
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('retrying in 5s')
      expect(result.sleeps).toEqual(['5'])
      expect(result.pwned).toBe(false)
    },
  )

  it('backs off linearly at the production default: 5s, then 10s (15s worst case)', () => {
    const result = runSyncStep({
      SYNC_WIKI_RETRY_DELAY_SECONDS: '',
      FAKE_GIT_LS_REMOTE_EXIT: '0',
      FAKE_GIT_FETCH_EXITS: '1 1 1',
      FAKE_GIT_RESTORE_EXIT: '0',
    })
    expect(result.status).toBe(1)
    expect(result.sleeps).toEqual(['5', '10'])
  })

  it('keeps git fetch output in the job log on every attempt while the probe stays silent', () => {
    const result = runSyncStep({
      FAKE_GIT_ECHO: '1',
      FAKE_GIT_LS_REMOTE_EXIT: '0',
      FAKE_GIT_FETCH_EXITS: '1 0',
      FAKE_GIT_RESTORE_EXIT: '0',
    })
    expect(result.status).toBe(0)
    expect(result.stderr.match(/fake-git-output:fetch/g)).toHaveLength(2)
    expect(result.stderr).not.toContain('fake-git-output:ls-remote')
  })
})

describe('fro-bot.yaml: all three jobs delegate wiki sync to the hardened composite action (regression guard against per-job drift)', () => {
  it.each(['fro-bot', 'fro-bot-remediate', 'fro-bot-observe'])(
    '%s has a Sync wiki from data branch step using ./.github/actions/sync-wiki',
    jobName => {
      const syncStep = froBotParsed.jobs[jobName]?.steps?.find(step => step.name === 'Sync wiki from data branch')
      expect(syncStep?.uses).toBe('./.github/actions/sync-wiki')
    },
  )

  it.each(['fro-bot', 'fro-bot-observe'])(
    '%s: Sync wiki from data branch precedes Capture wiki baseline (baseline must hash post-sync content)',
    jobName => {
      const job = froBotParsed.jobs[jobName]
      const syncIndex = findStepIndex(job, step => step.name === 'Sync wiki from data branch')
      const baselineIndex = findStepIndex(job, step => step.name === 'Capture wiki baseline')

      expect(syncIndex).toBeGreaterThanOrEqual(0)
      expect(baselineIndex).toBeGreaterThan(syncIndex)
    },
  )
})

describe('fro-bot.yaml App-token wiki ingest migration', () => {
  const froBotJob = froBotParsed.jobs['fro-bot']
  const observeJob = froBotParsed.jobs['fro-bot-observe']
  const wikiIngestJob = froBotParsed.jobs['fro-bot-wiki-ingest']
  const observeWikiIngestJob = froBotParsed.jobs['fro-bot-observe-wiki-ingest']

  it('declares both trusted writer jobs, each needing its agent job', () => {
    expect(wikiIngestJob).toBeDefined()
    expect(observeWikiIngestJob).toBeDefined()
    expect((wikiIngestJob as {needs?: string}).needs).toBe('fro-bot')
    expect((observeWikiIngestJob as {needs?: string}).needs).toBe('fro-bot-observe')
  })

  it("gates each trusted writer job on the agent job's wiki-changed output", () => {
    expect(String((wikiIngestJob as {if?: string}).if ?? '')).toContain("needs.fro-bot.outputs.wiki-changed == 'true'")
    expect(String((observeWikiIngestJob as {if?: string}).if ?? '')).toContain(
      "needs.fro-bot-observe.outputs.wiki-changed == 'true'",
    )
  })

  it('exposes wiki-changed as a job output on both agent jobs', () => {
    expect((froBotJob as {outputs?: Record<string, string>}).outputs?.['wiki-changed']).toContain(
      'steps.wiki-changes.outputs.changed',
    )
    expect((observeJob as {outputs?: Record<string, string>}).outputs?.['wiki-changed']).toContain(
      'steps.wiki-changes.outputs.changed',
    )
  })

  it.each([
    ['fro-bot-wiki-ingest', wikiIngestJob],
    ['fro-bot-observe-wiki-ingest', observeWikiIngestJob],
  ])('%s has no fro-bot/agent step (trusted-writer invariant)', (_name, job) => {
    const agentStep = findStepIndex(job, step => (step.uses ?? '').startsWith('fro-bot/agent@'))
    expect(agentStep).toBe(-1)
  })

  it.each([
    ['fro-bot-wiki-ingest', wikiIngestJob],
    ['fro-bot-observe-wiki-ingest', observeWikiIngestJob],
  ])('%s checks out the default branch with persist-credentials: false', (_name, job) => {
    const checkoutStep = (job as WorkflowJob)?.steps?.find(step => (step.uses ?? '').startsWith('actions/checkout@'))
    expect(String(checkoutStep?.with?.ref ?? '')).toContain('github.event.repository.default_branch')
    expect(checkoutStep?.with?.['persist-credentials']).toBe(false)
  })

  it.each([
    ['fro-bot-wiki-ingest', wikiIngestJob],
    ['fro-bot-observe-wiki-ingest', observeWikiIngestJob],
  ])('%s runs wiki-ingest.ts with a minted App token, never FRO_BOT_PAT', (_name, job) => {
    const ingestStep = (job as WorkflowJob)?.steps?.find(
      step => typeof step.run === 'string' && step.run.includes('wiki-ingest.ts'),
    )
    const token = String(ingestStep?.env?.GITHUB_TOKEN ?? '')
    expect(token).toContain('steps.app-token.outputs.token')
    expect(token).not.toContain('secrets.FRO_BOT_PAT')

    const mintStep = (job as WorkflowJob)?.steps?.find(step => step.id === 'app-token')
    expect(mintStep?.uses).toContain('actions/create-github-app-token@')
  })

  it.each([
    ['fro-bot-wiki-ingest', wikiIngestJob],
    ['fro-bot-observe-wiki-ingest', observeWikiIngestJob],
  ])('%s mints no App token after any fro-bot/agent step (there is none in this job at all)', (_name, job) => {
    const mintSteps = ((job as WorkflowJob)?.steps ?? []).filter(step =>
      (step.uses ?? '').startsWith('actions/create-github-app-token@'),
    )
    expect(mintSteps).toHaveLength(1)
  })

  it.each([
    ['fro-bot-wiki-ingest', wikiIngestJob],
    ['fro-bot-observe-wiki-ingest', observeWikiIngestJob],
  ])(
    "%s sources WIKI_* env from github.* context and this job's own trusted timestamp — never from an artifact-carried metadata.json",
    (_name, job) => {
      const ingestStep = (job as WorkflowJob)?.steps?.find(
        step => typeof step.run === 'string' && step.run.includes('wiki-ingest.ts'),
      )
      const run = String(ingestStep?.run ?? '')
      expect(run).not.toContain('metadata.json')
      expect(run).not.toContain('jq')

      const env = ingestStep?.env ?? {}
      expect(String(env.WIKI_TARGET ?? '')).toContain('github.repository')
      expect(String(env.WIKI_SUMMARY ?? '')).toContain('github.event_name')
      expect(String(env.WIKI_COMMIT_MESSAGE ?? '')).toContain('github.event_name')
      expect(String(env.WIKI_SOURCES ?? '')).toContain('github.sha')
      expect(String(env.WIKI_SOURCES ?? '')).toContain('steps.ingest-ts.outputs.now')

      const timestampStep = (job as WorkflowJob)?.steps?.find(step => step.id === 'ingest-ts')
      expect(timestampStep?.run).toContain('date -u')
    },
  )

  it.each([
    ['fro-bot', froBotJob],
    ['fro-bot-observe', observeJob],
  ])('%s (agent job): the build step writes no WIKI_* metadata into the handoff artifact', (_name, job) => {
    const buildStep = (job as WorkflowJob)?.steps?.find(step => step.name === 'Build wiki handoff artifact')
    const env = buildStep?.env ?? {}
    expect(Object.keys(env)).toStrictEqual(['WIKI_HANDOFF_DIR'])
  })
})
