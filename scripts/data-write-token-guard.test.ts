/**
 * Repo-wide guard: no workflow step that runs `wiki-ingest.ts`, `record-survey-result.ts`,
 * or invokes `commit-metadata` directly may source its write credential from
 * `secrets.FRO_BOT_PAT` or `secrets.FRO_BOT_POLL_PAT`. Every `data`-branch write must go
 * through a GitHub App installation token (see the Group 1/Group 2 migration in
 * docs/plans — fro-bot.yaml, survey-repo.yaml, poll-invitations.yaml).
 *
 * Non-vacuity: the test asserts the exact number of writer steps found, so a future
 * refactor that accidentally stops matching any step (e.g. renaming the script, or
 * removing the `run:` invocation entirely) fails loudly instead of silently passing an
 * empty guard.
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

const WRITER_SCRIPT_MARKERS = ['wiki-ingest.ts', 'record-survey-result.ts', 'commit-metadata']
const FORBIDDEN_TOKEN_EXPRESSIONS = ['secrets.FRO_BOT_PAT', 'secrets.FRO_BOT_POLL_PAT']

const workflowsDir = resolve(import.meta.dirname, '../.github/workflows')
const workflowFiles = readdirSync(workflowsDir).filter(name => name.endsWith('.yaml') || name.endsWith('.yml'))

interface WriterStepRef {
  file: string
  job: string
  step: string
  env: Record<string, unknown>
}

function findWriterSteps(): WriterStepRef[] {
  const found: WriterStepRef[] = []

  for (const file of workflowFiles) {
    const raw = readFileSync(resolve(workflowsDir, file), 'utf8')
    const parsed: unknown = parse(raw)
    assertWorkflowShape(parsed)

    for (const [jobName, job] of Object.entries(parsed.jobs)) {
      for (const step of job.steps ?? []) {
        const run = step.run ?? ''
        if (WRITER_SCRIPT_MARKERS.some(marker => run.includes(marker))) {
          found.push({file, job: jobName, step: step.name ?? step.id ?? '(unnamed step)', env: step.env ?? {}})
        }
      }
    }
  }

  return found
}

describe('data-branch write-token guard', () => {
  const writerSteps = findWriterSteps()

  it('finds the expected number of data-branch writer steps (non-vacuity check)', () => {
    // wiki-ingest.ts: fro-bot.yaml (fro-bot-wiki-ingest, fro-bot-observe-wiki-ingest) +
    // survey-repo.yaml (survey-persist) = 3. record-survey-result.ts: survey-repo.yaml
    // survey-persist's "Record survey result" + its cancelled/timeout fallback = 2.
    expect(writerSteps).toHaveLength(5)
  })

  it.each(writerSteps.length > 0 ? writerSteps.map(ref => [ref] as const) : [])(
    'writer step %o never sources its token from FRO_BOT_PAT or FRO_BOT_POLL_PAT',
    ref => {
      const envValues = Object.values(ref.env).map(value => String(value))
      for (const forbidden of FORBIDDEN_TOKEN_EXPRESSIONS) {
        for (const value of envValues) {
          expect(value, `${ref.file} > ${ref.job} > ${ref.step} env references ${forbidden}`).not.toContain(forbidden)
        }
      }
    },
  )
})
