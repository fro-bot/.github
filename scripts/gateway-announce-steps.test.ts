/**
 * The three announce steps (`fro-bot.yaml`, `poll-invitations.yaml`, `survey-repo.yaml`) call
 * `gateway-announce --event <name>` with env only. Each builder reads a fixed set of env names, and a step that
 * sets a different set announces nothing, quietly: the CLI exits 0 on an invalid context. So the step's env
 * names are compared with the names the real builder reads, recorded through a Proxy over its env.
 */

import {readdirSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import process from 'node:process'
import {runCli, type EventType} from '@fro-bot/reports/gateway-announce'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {parse} from 'yaml'

interface WorkflowStep {
  name?: string
  run?: string
  env?: Record<string, unknown>
}

interface Workflow {
  jobs: Record<string, {steps?: WorkflowStep[]}>
}

const workflowsDir = resolve(import.meta.dirname, '../.github/workflows')

function loadWorkflow(file: string): Workflow {
  const parsed: unknown = parse(readFileSync(resolve(workflowsDir, file), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('jobs' in parsed)) {
    throw new TypeError(`${file} does not have the expected jobs shape`)
  }
  return parsed as Workflow
}

function stepsOf(workflow: Workflow): WorkflowStep[] {
  return Object.values(workflow.jobs).flatMap(job => job.steps ?? [])
}

/** Every env name `runCli` reads for `event`, in a run whose inputs are all missing. */
async function namesReadBy(event: EventType): Promise<string[]> {
  const read = new Set<string>()
  const env = new Proxy<Record<string, string | undefined>>(
    {},
    {
      get: (_target, key) => {
        if (typeof key === 'string') read.add(key)
        return undefined
      },
    },
  )
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  await runCli(env, {event, announceImpl: vi.fn()})
  return [...read].sort()
}

const ANNOUNCE_STEPS = [
  {file: 'fro-bot.yaml', name: '📣 Announce daily digest to gateway', event: 'daily_digest'},
  {file: 'poll-invitations.yaml', name: '📣 Announce invitations to gateway', event: 'invitation_accepted'},
  {file: 'survey-repo.yaml', name: '📣 Announce survey to gateway', event: 'survey_completed'},
] as const

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each(ANNOUNCE_STEPS)('$file: $name', ({file, name, event}) => {
  const step = stepsOf(loadWorkflow(file)).find(candidate => candidate.name === name)

  it('exists once', () => {
    expect(stepsOf(loadWorkflow(file)).filter(candidate => candidate.name === name)).toHaveLength(1)
  })

  it('passes --event and env only: no jq, no shell assembly of the context', () => {
    expect(step?.run?.trim()).toBe(`bun scripts/gateway-announce.ts --event ${event}`)
    expect(step?.run).not.toContain('jq')
    expect(step?.run).not.toContain('EVENT_CONTEXT_JSON')
  })

  it('sets neither EVENT_TYPE nor EVENT_CONTEXT_JSON', () => {
    expect(Object.keys(step?.env ?? {})).not.toContain('EVENT_TYPE')
    expect(Object.keys(step?.env ?? {})).not.toContain('EVENT_CONTEXT_JSON')
  })

  it('sets exactly the env names its builder reads, plus the three gateway settings', async () => {
    // A run with no inputs stops at the builder, before the gateway settings are read, so those are added here.
    const gatewaySettings = ['GATEWAY_ANNOUNCE_DISABLED', 'GATEWAY_PRESENCE_URL', 'GATEWAY_WEBHOOK_SECRET']
    const builderReads = (await namesReadBy(event)).filter(
      key => key !== 'EVENT_TYPE' && key !== 'EVENT_CONTEXT_JSON' && !gatewaySettings.includes(key),
    )
    expect(builderReads.length).toBeGreaterThan(0)
    expect(Object.keys(step?.env ?? {}).sort()).toEqual([...builderReads, ...gatewaySettings].sort())
  })
})

describe('every workflow step that runs gateway-announce', () => {
  it('is one of the three covered above', () => {
    const callers = readdirSync(workflowsDir)
      .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'))
      .flatMap(file =>
        stepsOf(loadWorkflow(file))
          .filter(step => (step.run ?? '').includes('gateway-announce'))
          .map(step => `${file}: ${step.name ?? ''}`),
      )
      .sort()
    expect(callers).toEqual(ANNOUNCE_STEPS.map(({file, name}) => `${file}: ${name}`).sort())
  })
})
