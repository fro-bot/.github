/**
 * Pins which `fro-bot/agent` steps load the repository's `.agents/skills/` through the action's `repo-skills`
 * input. The action loads them only on trusted runs and always from the default branch; this file pins who asks.
 *
 * Every `fro-bot/agent` step in `.github/workflows/` must appear in exactly one table: {@link REPO_SKILLS_ON}
 * (`repo-skills: 'true'`) or {@link REPO_SKILLS_OFF} (the input is absent). A new agent step fails here until it
 * is classified.
 */

import {readdirSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

const WORKFLOWS_DIR = resolve(import.meta.dirname, '../.github/workflows')
const AGENT_PREFIX = 'fro-bot/agent@'
const INPUT = 'repo-skills'

interface Step {
  id?: string
  uses?: string
  with?: Record<string, unknown>
}

interface Workflow {
  jobs?: Record<string, {steps?: Step[]}>
}

/** The Fro Bot jobs. The rollout tracker reaches the first one through `workflow_call`. */
const REPO_SKILLS_ON: readonly string[] = [
  'fro-bot.yaml/fro-bot/fro-bot-agent',
  'fro-bot.yaml/fro-bot-remediate/fro-bot-agent',
  'fro-bot.yaml/fro-bot-observe/fro-bot-agent',
]

/** The survey attempts and the capture and draft workflows run on a digest or an older checkout and keep the default. */
const REPO_SKILLS_OFF: readonly string[] = [
  'survey-repo.yaml/survey-repo/survey-agent',
  'survey-repo.yaml/survey-repo/survey-agent-retry-1',
  'survey-repo.yaml/survey-repo/survey-agent-retry-2',
  'capture-learnings.yaml/capture-learnings/agent',
  'capture-patterns.yaml/open/agent',
  'draft-solutions.yaml/draft/agent',
]

function agentSteps(): {key: string; step: Step}[] {
  const found: {key: string; step: Step}[] = []
  for (const file of readdirSync(WORKFLOWS_DIR).filter(name => name.endsWith('.yaml'))) {
    const workflow = parse(readFileSync(resolve(WORKFLOWS_DIR, file), 'utf8')) as Workflow
    for (const [job, body] of Object.entries(workflow.jobs ?? {})) {
      for (const step of body.steps ?? []) {
        if (step.uses?.startsWith(AGENT_PREFIX) === true) {
          found.push({key: `${file}/${job}/${step.id ?? '(no id)'}`, step})
        }
      }
    }
  }
  return found
}

describe('repo skills callers: the classification is total', () => {
  it('puts every fro-bot/agent step in exactly one table', () => {
    expect(
      agentSteps()
        .map(found => found.key)
        .toSorted(),
    ).toStrictEqual([...REPO_SKILLS_ON, ...REPO_SKILLS_OFF].toSorted())
  })
})

describe('repo skills callers: the input value', () => {
  it.each(REPO_SKILLS_ON)("%s sets repo-skills to the quoted string 'true'", key => {
    const found = agentSteps().find(candidate => candidate.key === key)

    expect(found, key).toBeDefined()
    expect(found?.step.with?.[INPUT], key).toBe('true')
  })

  it.each(REPO_SKILLS_OFF)('%s does not pass repo-skills', key => {
    const found = agentSteps().find(candidate => candidate.key === key)

    expect(found, key).toBeDefined()
    expect(found?.step.with ?? {}, key).not.toHaveProperty(INPUT)
  })
})
