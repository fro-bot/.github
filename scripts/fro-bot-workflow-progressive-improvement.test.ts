import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface WorkflowDocument {
  env: Record<string, string>
  jobs: {
    'fro-bot-observe': {steps: {id?: string; env?: {TASK_PROMPT?: string}}[]}
  }
}

// The daily-pass prompt used to be one monolithic SCHEDULE_PROMPT env entry.
// It is now split across fro-bot-remediate (categories 1–4) and
// fro-bot-observe (categories 5–8 + the daily report). The observe agent step
// renders six env blocks through format(); this suite composes all six, in the
// order that template names them, so no block it asserts on can be missing.
function assertFroBotWorkflow(value: unknown): asserts value is WorkflowDocument {
  const doc = value as Partial<WorkflowDocument> | null
  const env: unknown = doc?.env
  const steps: unknown = doc?.jobs?.['fro-bot-observe']?.steps
  if (
    typeof env !== 'object' ||
    env === null ||
    !Object.values(env).every(entry => typeof entry === 'string') ||
    !Array.isArray(steps)
  ) {
    throw new TypeError('fro-bot.yaml does not have expected shape: missing env blocks or the fro-bot-observe steps')
  }
}

function composeObserveBlocks(doc: WorkflowDocument): string {
  const taskPrompt = doc.jobs['fro-bot-observe'].steps.find(step => step.id === 'fro-bot-agent')?.env?.TASK_PROMPT
  const names = /format\('[^']*',([^)]*)\)/.exec(taskPrompt ?? '')?.[1]
  if (names === undefined) throw new TypeError('observe TASK_PROMPT has no format() call')
  return names
    .split(',')
    .map(arg => {
      const name = arg.trim().replace(/^env\./, '')
      const block = doc.env[name]
      if (block === undefined) throw new TypeError(`env.${name} is not defined`)
      return block
    })
    .join('')
}

describe('fro-bot.yaml progressive improvement prompt', () => {
  // #given the fro-bot workflow file parsed as a YAML document
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/fro-bot.yaml')
  const raw = readFileSync(workflowPath, 'utf8')
  const parsed: unknown = parse(raw)
  assertFroBotWorkflow(parsed)
  const prompt = composeObserveBlocks(parsed)

  it('composes all six production blocks and carries the report-wide public-only rule', () => {
    // #then every block the agent step renders is present, and the rule sits in the composed text
    for (const heading of [
      'EXECUTION MODEL',
      'DEDUPLICATION',
      'CATEGORIES (work in order)',
      'HARD BOUNDARIES',
      'AGENT NOTES',
      'OUTPUT — ONE PERPETUAL SUMMARY ISSUE',
    ]) {
      expect(prompt).toContain(heading)
    }
    const normalized = prompt.replaceAll(/\s+/g, ' ')
    expect(normalized).toContain('PUBLIC-ONLY REPORT RULE')
    expect(normalized).toContain('gh repo view <owner/repo> --json visibility')
    expect(normalized).toContain('Any other result, including an error, means not public')
  })

  it('flags stalled learning proposals', () => {
    // #then category 7 names the intake, expected authoring action, thresholds,
    // and the Improvement Metrics false-green warning
    expect(prompt).toContain('open issues labeled `learning-proposal`')
    expect(prompt).toContain('authoring the learning into `docs/solutions/`')
    expect(prompt).toContain('older than 14')
    expect(prompt).toContain('two or more open at once')
    expect(prompt).toContain('Improvement Metrics report (#3674)')
  })

  it('points at the open drafted solution-doc PR instead of calling covered proposals stalled', () => {
    // #then category 7 names the drafted head, author, and body line, reports the PR and its
    // age, and keeps the stall rule for proposals the PR does not cover
    const normalized = prompt.replaceAll(/\s+/g, ' ')
    expect(normalized).toContain('an open PR on head `docs/drafted-solutions` authored by `fro-bot[bot]`')
    expect(normalized).toContain('open proposals named in the `Closes #N` line of its body')
    expect(normalized).toContain('report that PR and its age instead of calling those proposals stalled')
    expect(normalized).toContain('Proposals it does not cover keep the 14-day and two-or-more rule')
  })

  it('distinguishes verified-clean from could-not-check', () => {
    expect(prompt).toContain('✅ = verified-clean')
    expect(prompt).toContain('❔ =')
    expect(prompt).toContain('name the affected source and reason')
    expect(prompt).toMatch(/Never\s+render ✅ for could-not-check/)
  })

  it('requires bounded methods for daily report detections', () => {
    expect(prompt).toContain('✅/⚠️/❌/❔')
    expect(prompt).toContain('paginated repository listing')
    expect(prompt).toMatch(/at least read\s+access/)
    expect(prompt).toContain('could not be enumerated')
    expect(prompt).toContain('top three repo hotspots')
    expect(prompt).toMatch(/qualifying finding count in the\s+current daily snapshot/)
    expect(prompt).toContain('at least one linked finding required')
    expect(prompt).toContain('current-version truth comes from')
    expect(prompt).toMatch(/authoritative\s+registry or upstream release source/)
    expect(prompt).toMatch(/whether major\s+drift was included/)
    expect(prompt).toContain('measure aging from creation time')
    expect(prompt).toMatch(/staleness from the most recent update\s+activity/)
    expect(prompt).toContain('metadata/repos.yaml (not an example list)')
    expect(prompt).toContain('mark coverage partial')
    expect(prompt).toContain('For each program in program-trackers.json, compare')
    expect(prompt).toContain("its tracker issue's checklist/status claims")
    expect(prompt).toContain('corresponding items on its GitHub Project')
    expect(prompt).toContain('report any mismatch with both values')
    expect(prompt).not.toContain('#3512')
    expect(prompt).not.toContain('Project 1')
  })
})
