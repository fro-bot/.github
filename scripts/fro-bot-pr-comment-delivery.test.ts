/**
 * Prompt contract for a code-change request in a comment on a pull request (fro-bot/.github#4184).
 *
 * The `fro-bot` job runs on `issue_comment` with no persisted credential. The agent action can deliver a
 * commit to the PR branch only through its brokered push, which needs a `trusted-head-sha` input this
 * workflow does not pass; without it the push is bypassed at debug level and the run can end green with
 * nothing pushed. The rule that tells the agent to say so is rendered through the step's DELIVERY_NOTE env
 * (the same shape as PROGRAM_NOTE) for a PR `issue_comment` only. This suite renders the prompt per trigger
 * the way Actions does and pins what the agent is told.
 */

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {evaluateExpressionValue} from '@fro-bot/test-kit/workflow-expression'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface AgentStep {
  id?: string
  uses?: string
  env?: Record<string, unknown>
  with?: Record<string, unknown>
}

interface WorkflowDocument {
  on: {workflow_dispatch: {inputs: Record<string, {default?: string} | undefined>}}
  env: Record<string, string>
  jobs: Record<string, {steps?: AgentStep[]} | undefined>
}

function assertFroBotWorkflow(value: unknown): asserts value is WorkflowDocument {
  const doc = value as Partial<WorkflowDocument> | null
  if (
    typeof doc?.env !== 'object' ||
    doc.env === null ||
    typeof doc.jobs !== 'object' ||
    doc.jobs === null ||
    typeof doc.on !== 'object' ||
    doc.on === null
  ) {
    throw new TypeError('fro-bot.yaml does not have expected shape: missing env blocks, jobs or triggers')
  }
}

const workflowPath = resolve(import.meta.dirname, '../.github/workflows/fro-bot.yaml')

function loadWorkflow(): WorkflowDocument {
  const value: unknown = parse(readFileSync(workflowPath, 'utf8'))
  assertFroBotWorkflow(value)
  return value
}

const workflow = loadWorkflow()

const agentStep = (jobName: string): AgentStep | undefined =>
  workflow.jobs[jobName]?.steps?.find(step => step.id === 'fro-bot-agent')

const flat = (text: string): string => text.replaceAll(/\s+/g, ' ')
const expressionStart = '$' + '{{'
const noteReference = `${expressionStart} env.DELIVERY_NOTE }}`

/** The agent prompt as the `fro-bot` job renders it for one trigger: DELIVERY_NOTE evaluated, then spliced in. */
function renderContentPrompt(eventName: string, issue?: Record<string, unknown>): string {
  const step = agentStep('fro-bot')
  const expression = String(step?.env?.DELIVERY_NOTE ?? '')
  const inner = /\$\{\{([\s\S]*)\}\}/.exec(expression)?.[1]
  if (inner === undefined) throw new TypeError('the fro-bot agent step has no DELIVERY_NOTE env expression')
  const context = {github: {event_name: eventName, event: {issue}}, env: workflow.env}
  const note = String(evaluateExpressionValue(inner, context) ?? '')
  const prompt = String(step?.with?.prompt ?? '')
  if (!prompt.includes(noteReference)) throw new TypeError('agent prompt does not embed env.DELIVERY_NOTE')
  return flat(prompt.replace(noteReference, () => note))
}

const pullRequestIssue = {number: 7, pull_request: {url: 'https://api.github.com/repos/fro-bot/.github/pulls/7'}}
const plainIssue = {number: 8}

/** Each key sentence of the rule, as the agent reads it (line wrapping collapsed). */
const ruleSentences = [
  "This run cannot push commits to this pull request's branch.",
  'say plainly that no change was pushed',
  'give the requested change as a reviewable description or patch in the reply, when that is practical',
  'say the change can be delivered by running the Fro Bot workflow by workflow_dispatch with a prompt that describes it, which opens a branch and a pull request',
  'Never say the change is done, pushed or delivered.',
  'Do not try to work around the missing credential.',
  'Do not dispatch the workflow yourself.',
]
const missingFrom = (text: string): string[] => ruleSentences.filter(sentence => !text.includes(sentence))

describe('fro-bot.yaml: a pull request comment that asks for a change', () => {
  const rendered = (): string => renderContentPrompt('issue_comment', pullRequestIssue)

  it('tells the agent every key sentence of the rule', () => {
    expect(missingFrom(rendered())).toEqual([])
  })

  it.each(ruleSentences)('fails when the sentence is dropped: %s', sentence => {
    // #given the rendered prompt minus one sentence, #then the check names exactly that sentence
    expect(missingFrom(rendered().replace(sentence, ''))).toEqual([sentence])
  })

  it('keeps the rule inside the prompt, after the persona, so the agent reads it', () => {
    const text = rendered()

    expect(text.indexOf(ruleSentences[0] ?? '')).toBeGreaterThan(text.indexOf('</persona>'))
  })

  it('names a delivery route the workflow really has: workflow_dispatch with a prompt, defaulting to branch-pr', () => {
    const inputs = workflow.on.workflow_dispatch.inputs

    expect(inputs.prompt).toBeDefined()
    expect(inputs['output-mode']?.default).toBe('branch-pr')
    expect(agentStep('fro-bot-remediate')?.with?.['output-mode']).toBe('branch-pr')
  })

  it('leaves reviews, analysis, answers and knowledge capture alone', () => {
    const text = rendered()

    expect(text).toContain('A review, analysis, answer or knowledge capture needs no change to this branch')
    expect(text).toContain('<knowledge_persistence>')
  })
})

describe('fro-bot.yaml: triggers that do not get the pull request comment rule', () => {
  it.each([
    ['an issue comment on a plain issue', 'issue_comment', plainIssue],
    ['a pull request review comment', 'pull_request_review_comment', undefined],
    ['a discussion comment', 'discussion_comment', undefined],
    ['a pull request event', 'pull_request', undefined],
    ['an issues event', 'issues', plainIssue],
    // The event name, not the issue shape, decides: an issues event never carries the rule.
    ['an issues event whose payload has a pull_request key', 'issues', pullRequestIssue],
    ['a schedule', 'schedule', undefined],
    ['a workflow_dispatch', 'workflow_dispatch', undefined],
  ])('%s renders none of it', (_name, eventName, issue) => {
    const rendered = renderContentPrompt(eventName, issue)

    expect(rendered).not.toContain('PULL REQUEST COMMENT DELIVERY')
    for (const sentence of ruleSentences) expect(rendered).not.toContain(sentence)
  })

  it.each(['fro-bot-remediate', 'fro-bot-observe'])('the %s prompt never carries or embeds the rule', jobName => {
    const prompt = String(agentStep(jobName)?.with?.prompt ?? '')

    expect(prompt).not.toContain('DELIVERY_NOTE')
    expect(agentStep(jobName)?.env?.DELIVERY_NOTE).toBeUndefined()
  })

  it('keeps the rule text out of every other prompt block, so only DELIVERY_NOTE renders it', () => {
    const others = Object.entries(workflow.env).filter(([name]) => name !== 'PR_COMMENT_DELIVERY_NOTE')

    for (const [name, text] of others) {
      expect(flat(text), name).not.toContain(ruleSentences[0])
    }
  })
})

describe('fro-bot.yaml: the pull request comment rule stands in for a missing brokered push', () => {
  const step = agentStep('fro-bot')

  it('the agent step still passes no trusted-head-sha, so a comment run has no brokered push', () => {
    // Current contract. Wiring trusted-head-sha (with the head resolution it needs) gives a PR comment a
    // delivery path; when that lands, remove PR_COMMENT_DELIVERY_NOTE and this test with it.
    expect(step?.uses).toMatch(/^fro-bot\/agent@/)
    expect(Object.keys(step?.with ?? {})).not.toContain('trusted-head-sha')
    expect(Object.keys(step?.env ?? {})).not.toContain('TRUSTED_HEAD_SHA')
  })

  it('states the rule only for an issue_comment on a pull request', () => {
    const expression = String(step?.env?.DELIVERY_NOTE ?? '')

    expect(expression).toContain("github.event_name == 'issue_comment'")
    expect(expression).toContain('github.event.issue.pull_request')
    expect(expression).toContain('env.PR_COMMENT_DELIVERY_NOTE')
  })
})
