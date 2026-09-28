/**
 * Repo-wide guard: every trusted ingest/persist job (one that runs `wiki-ingest.ts` or
 * `record-survey-result.ts`) must never read `metadata.json` from an artifact, and every
 * `WIKI_*` env value in that job must resolve from a trusted source only:
 *
 *   - `github.*` context (repository/event/sha — fixed by the platform, not the agent)
 *   - `inputs.*` (workflow_dispatch input, operator-supplied)
 *   - `steps.*` of the SAME job (this job has no agent step, so its own step outputs
 *     — e.g. a locally-computed timestamp — are trustworthy)
 *   - `needs.<job>.outputs.<name>` where `<name>` is on an explicit allowlist of
 *     PRE-agent outputs (produced by steps that run before that job's own agent step)
 *
 * This is the regression guard for the A2 fix: before it, `WIKI_OPERATION`/`WIKI_TARGET`/
 * etc. were `jq`-extracted from an artifact-carried `metadata.json` written by a script
 * running in the agent's own (potentially tampered) checkout — a forgeable commit
 * message, target, or sources, including a private repo name reaching `WIKI_TARGET` on
 * the public `data` branch.
 *
 * Non-vacuity: asserts the exact number of trusted jobs found, and that at least one
 * WIKI_* expression was actually checked, so a future refactor that stops matching any
 * job/env fails loudly instead of silently passing an empty guard.
 */

import {readdirSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface WorkflowStep {
  name?: string
  id?: string
  run?: string
  env?: Record<string, unknown>
}

interface WorkflowJob {
  steps?: WorkflowStep[]
}

function assertWorkflowShape(value: unknown): asserts value is {jobs: Record<string, WorkflowJob>} {
  if (typeof value !== 'object' || value === null || !('jobs' in value)) {
    throw new TypeError('workflow file does not have expected jobs shape')
  }
}

/**
 * Pre-agent `needs.<job>.outputs.<name>` names a trusted job's `WIKI_*` env may
 * reference. Each of these is produced by a step that runs BEFORE that job's own agent
 * step (or is a runner-computed conclusion/outcome value the agent cannot forge), per
 * the A1/A2 job designs in fro-bot.yaml and survey-repo.yaml.
 */
const ALLOWED_PRE_AGENT_NEEDS_OUTPUTS = new Set([
  'resolve-owner',
  'resolve-repo',
  'resolve-outcome',
  'target-repository',
  'target-slug',
  'onboarded',
  'agent-conclusion',
  'wiki-artifact-ready',
  'wiki-changed',
])

const WRITER_SCRIPT_MARKERS = ['wiki-ingest.ts', 'record-survey-result.ts']

/**
 * The ingest-metadata env keys this guard cares about — NOT every `WIKI_*`-prefixed
 * var. `WIKI_HANDOFF_DIR` (a runner.temp path) is a legitimate exception outside this
 * guard's concern (it carries no forgeable ingest metadata).
 */
const WIKI_METADATA_ENV_KEYS = new Set([
  'WIKI_OPERATION',
  'WIKI_TARGET',
  'WIKI_SUMMARY',
  'WIKI_COMMIT_MESSAGE',
  'WIKI_SOURCES',
])

const workflowsDir = resolve(import.meta.dirname, '../.github/workflows')
const workflowFiles = readdirSync(workflowsDir).filter(name => name.endsWith('.yaml') || name.endsWith('.yml'))

interface TrustedJobRef {
  file: string
  job: string
  steps: WorkflowStep[]
}

function findTrustedJobs(): TrustedJobRef[] {
  const found: TrustedJobRef[] = []

  for (const file of workflowFiles) {
    const raw = readFileSync(resolve(workflowsDir, file), 'utf8')
    const parsed: unknown = parse(raw)
    assertWorkflowShape(parsed)

    for (const [jobName, job] of Object.entries(parsed.jobs)) {
      const steps = job.steps ?? []
      const isTrustedJob = steps.some(
        step => typeof step.run === 'string' && WRITER_SCRIPT_MARKERS.some(marker => step.run?.includes(marker)),
      )
      if (isTrustedJob) found.push({file, job: jobName, steps})
    }
  }

  return found
}

/** Extract every `${{ ... }}` expression body from a string env value. */
function extractExpressions(value: string): string[] {
  return [...value.matchAll(/\$\{\{([^{}]*)\}\}/g)].map(match => (match[1] ?? '').trim())
}

function isAllowedExpression(expr: string): boolean {
  if (expr.startsWith('github.') || expr.startsWith('inputs.') || expr.startsWith('steps.')) return true
  const needsMatch = /^needs\.[\w-]+\.outputs\.([\w-]+)$/.exec(expr)
  return needsMatch !== null && ALLOWED_PRE_AGENT_NEEDS_OUTPUTS.has(needsMatch[1] ?? '')
}

describe('trusted wiki-ingest env-source guard', () => {
  const trustedJobs = findTrustedJobs()

  it('finds the expected number of trusted ingest/persist jobs (non-vacuity check)', () => {
    // fro-bot.yaml: fro-bot-wiki-ingest, fro-bot-observe-wiki-ingest (2).
    // survey-repo.yaml: survey-persist (1). Total: 3.
    expect(trustedJobs).toHaveLength(3)
  })

  it('no trusted job reads metadata.json (the A1 artifact metadata channel is gone)', () => {
    for (const job of trustedJobs) {
      for (const step of job.steps) {
        if (typeof step.run !== 'string') continue
        expect(
          step.run,
          `${job.file} > ${job.job} > ${step.name ?? step.id ?? '(unnamed)'} references metadata.json`,
        ).not.toContain('metadata.json')
      }
    }
  })

  it('every ingest-metadata WIKI_* env value in a trusted job resolves from github.*/inputs.*/steps.* (same job) or an allowlisted pre-agent needs.* output', () => {
    let expressionsChecked = 0

    for (const job of trustedJobs) {
      for (const step of job.steps) {
        for (const [key, rawValue] of Object.entries(step.env ?? {})) {
          if (!WIKI_METADATA_ENV_KEYS.has(key)) continue

          const expressions = extractExpressions(String(rawValue))
          for (const expr of expressions) {
            expressionsChecked += 1
            expect(
              isAllowedExpression(expr),
              `${job.file} > ${job.job} > ${key} expression "${expr}" is not from an allowed trusted source`,
            ).toBe(true)
          }
        }
      }
    }

    expect(expressionsChecked).toBeGreaterThan(0)
  })
})
