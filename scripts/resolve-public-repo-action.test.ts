/**
 * Contract tests for `.github/actions/resolve-public-repo`, the one definition of the survey privacy
 * gate. The shell cases run the action's `run:` text under bash with a stubbed `gh`
 * (`@fro-bot/test-kit/workflow-step`) and the real `jq`, so they cost no network. The workflow cases
 * pin how `survey-repo.yaml` calls the action from `survey-resolve` and `survey-persist`.
 */

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {runStepWithStubs} from '@fro-bot/test-kit/workflow-step'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface ActionStep {
  name?: string
  id?: string
  run?: string
  shell?: string
  env?: Record<string, unknown>
}

interface ActionFile {
  inputs?: Record<string, {description?: string; required?: boolean; default?: unknown}>
  outputs?: Record<string, {description?: string; value?: string}>
  runs?: {using?: string; steps?: ActionStep[]}
}

interface WorkflowStep {
  name?: string
  id?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
  env?: Record<string, unknown>
  if?: string
}

interface WorkflowJob {
  steps: WorkflowStep[]
}

const actionPath = resolve(import.meta.dirname, '../.github/actions/resolve-public-repo/action.yaml')
const actionSource = readFileSync(actionPath, 'utf8')
const action = parse(actionSource) as ActionFile
const gateStep = action.runs?.steps?.find(step => step.id === 'gate')
const runScript = String(gateStep?.run ?? '')
const expressionStart = '$' + '{{'

const workflow = parse(readFileSync(resolve(import.meta.dirname, '../.github/workflows/survey-repo.yaml'), 'utf8')) as {
  jobs: Record<string, WorkflowJob>
}

const NODE_ID = 'R_kgDOExample-1='
const TOKEN = 'ghs_synthetic_token_value'

/** `gh` as a shell function: logs the call, replays the configured stderr and stdout, returns the configured exit. */
const GH_STUB = [
  'gh() {',
  '  echo "gh $*" >> "$STUB_TRACE"',
  '  if [ -n "$STUB_GH_STDERR" ]; then echo "$STUB_GH_STDERR" >&2; fi',
  '  printf "%s" "$STUB_GH_STDOUT"',
  '  return "$STUB_GH_EXIT"',
  '}',
  '',
].join('\n')

interface GateOptions {
  nodeId?: string
  ghStdout?: string
  ghStderr?: string
  ghExit?: number
}

function runGate(options: GateOptions = {}) {
  return runStepWithStubs(GH_STUB + runScript, {
    env: {
      GATE_NODE_ID: options.nodeId ?? NODE_ID,
      GH_TOKEN: TOKEN,
      STUB_GH_STDOUT: options.ghStdout ?? '',
      STUB_GH_STDERR: options.ghStderr ?? '',
      STUB_GH_EXIT: String(options.ghExit ?? 0),
    },
  })
}

const node = (value: unknown): string => JSON.stringify({data: {node: value}})
const publicRepo = node({nameWithOwner: 'acme-org/widgets.js', isPrivate: false})

describe('resolve-public-repo action: shape', () => {
  it('finds the gate step', () => {
    expect(gateStep).toBeDefined() // guards against a vacuous pass if the step were renamed or removed
  })

  it('is a composite action whose run step pins shell: bash', () => {
    expect(action.runs?.using).toBe('composite')
    expect(gateStep?.shell).toBe('bash')
  })

  it('takes two required inputs, node-id and token', () => {
    expect(Object.keys(action.inputs ?? {}).toSorted()).toStrictEqual(['node-id', 'token'])
    expect(action.inputs?.['node-id']?.required).toBe(true)
    expect(action.inputs?.token?.required).toBe(true)
  })

  it('declares owner, repo, node_id and private, sourced from the gate step', () => {
    expect(Object.keys(action.outputs ?? {}).toSorted()).toStrictEqual(['node_id', 'owner', 'private', 'repo'])
    for (const name of ['owner', 'repo', 'node_id', 'private']) {
      expect(action.outputs?.[name]?.value).toBe(`${expressionStart} steps.gate.outputs.${name} }}`)
    }
  })

  it('reaches the shell through env: only, so no expression sits inside any run:', () => {
    expect(gateStep?.env).toStrictEqual({
      GATE_NODE_ID: `${expressionStart} inputs.node-id }}`,
      GH_TOKEN: `${expressionStart} inputs.token }}`,
    })
    for (const step of action.runs?.steps ?? []) {
      expect(String(step.run ?? '')).not.toContain(expressionStart)
    }
  })

  it('checks the node ID shape before it calls gh', () => {
    const shapeAt = runScript.indexOf('=~')
    const callAt = runScript.indexOf('gh api graphql')
    expect(shapeAt).toBeGreaterThanOrEqual(0)
    expect(callAt).toBeGreaterThan(shapeAt)
  })

  it('never replays gh stderr', () => {
    expect(runScript).not.toMatch(/cat\s+"?\$/)
    expect(runScript).not.toContain('gh stderr')
    expect(runScript).toMatch(/gh api graphql[^\n]*2>\/dev\/null/)
  })

  it('writes its outputs once, after every check', () => {
    expect(runScript.match(/GITHUB_OUTPUT/g)).toHaveLength(1)
    expect(runScript.indexOf('>> "$GITHUB_OUTPUT"')).toBeGreaterThan(runScript.indexOf('gh api graphql'))
  })
})

describe('resolve-public-repo action: a public repository passes', () => {
  it('writes owner, repo, node_id and private, and exits 0', () => {
    const result = runGate({ghStdout: publicRepo})

    expect(result.status).toBe(0)
    expect(result.outputs).toStrictEqual({
      owner: 'acme-org',
      repo: 'widgets.js',
      node_id: NODE_ID,
      private: 'false',
    })
  })

  it('asks for the one node by ID and selects only nameWithOwner and isPrivate', () => {
    const result = runGate({ghStdout: publicRepo})
    const call = result.trace.find(line => line.startsWith('gh '))

    expect(result.trace.filter(line => line.startsWith('gh '))).toHaveLength(1)
    expect(call).toContain('api graphql')
    expect(call).toContain(`id=${NODE_ID}`)
    expect(call).toContain('nameWithOwner isPrivate')
  })

  it('keeps the token out of every stream', () => {
    const result = runGate({ghStdout: publicRepo})

    expect(result.stdout + result.stderr + result.githubOutput).not.toContain(TOKEN)
  })
})

describe('resolve-public-repo action: anything not definitively public is refused', () => {
  const refusals: readonly [string, string][] = [
    ['a private repository', node({nameWithOwner: 'secret-org/hidden-repo', isPrivate: true})],
    ['a null node', node(null)],
    ['a node that is not a repository', node({})],
    ['an empty nameWithOwner', node({nameWithOwner: '', isPrivate: false})],
    ['a missing nameWithOwner', node({isPrivate: false})],
    ['a non-string nameWithOwner', node({nameWithOwner: 7, isPrivate: false})],
    ['a nameWithOwner with no owner', node({nameWithOwner: 'hidden-repo', isPrivate: false})],
    ['a nameWithOwner carrying a newline', node({nameWithOwner: 'a/b\nprivate=true', isPrivate: false})],
    ['an absent isPrivate', node({nameWithOwner: 'secret-org/hidden-repo'})],
    ['a null isPrivate', node({nameWithOwner: 'secret-org/hidden-repo', isPrivate: null})],
    ['a string "false" isPrivate', node({nameWithOwner: 'secret-org/hidden-repo', isPrivate: 'false'})],
    ['malformed JSON', '{"data": {"node": {"nameWithOwner": "secret-org/hidden-repo", "isPri'],
    ['an empty response', ''],
  ]

  it.each(refusals)('%s: non-zero, no outputs, and no owner or repo in any stream', (_label, ghStdout) => {
    const result = runGate({ghStdout})

    expect(result.status).not.toBe(0)
    expect(result.githubOutput).toBe('')
    expect(result.stdout + result.stderr).not.toMatch(/secret-org|hidden-repo|private=true/)
  })

  it('prints a fixed reason and the node ID for a refusal', () => {
    const result = runGate({ghStdout: node({nameWithOwner: 'secret-org/hidden-repo', isPrivate: true})})

    expect(result.stderr).toBe(`Aborting: ${NODE_ID} is not definitively public\n`)
  })

  it('refuses when gh exits non-zero, and does not replay the stderr that names a repository', () => {
    const result = runGate({
      ghExit: 1,
      ghStderr: 'GraphQL: Could not resolve to a Repository with the name secret-org/hidden-repo.',
      ghStdout: node({nameWithOwner: 'secret-org/hidden-repo', isPrivate: false}),
    })

    expect(result.status).not.toBe(0)
    expect(result.githubOutput).toBe('')
    expect(result.stdout + result.stderr).not.toMatch(/secret-org|hidden-repo|Could not resolve/)
    expect(result.stderr).toBe(`GraphQL lookup failed for node_id: ${NODE_ID}\n`)
  })

  it('decides a partial-errors payload with the same allowlist (errors beside a private node)', () => {
    const payload = JSON.stringify({
      data: {node: {nameWithOwner: 'secret-org/hidden-repo', isPrivate: true}},
      errors: [{message: 'partial failure'}],
    })
    const result = runGate({ghStdout: payload})

    expect(result.status).not.toBe(0)
    expect(result.githubOutput).toBe('')
  })

  it('decides a partial-errors payload with the same allowlist (errors beside a public node pass)', () => {
    const payload = JSON.stringify({
      data: {node: {nameWithOwner: 'acme-org/widgets', isPrivate: false}},
      errors: [{message: 'partial failure'}],
    })
    const result = runGate({ghStdout: payload})

    expect(result.status).toBe(0)
    expect(result.outputs.private).toBe('false')
  })

  it('refuses a data-less errors payload', () => {
    const result = runGate({ghStdout: JSON.stringify({data: null, errors: [{message: 'secret-org/hidden-repo'}]})})

    expect(result.status).not.toBe(0)
    expect(result.githubOutput).toBe('')
    expect(result.stdout + result.stderr).not.toContain('hidden-repo')
  })
})

describe('resolve-public-repo action: a malformed node ID is refused before gh runs', () => {
  const malformed: readonly [string, string][] = [
    ['empty', ''],
    ['a space', 'R_kg DO'],
    ['a slash', 'owner/repo'],
    ['a shell metacharacter', 'R_kg$(id)'],
    ['a multi-line value whose second line is valid', '@x\nR_kgDOValid'],
    ['a multi-line value whose first line is valid', 'R_kgDOValid\n@x'],
    ['a valid value with a trailing newline', 'R_kgDOValid\n'],
    ['a valid value with a leading newline', '\nR_kgDOValid'],
  ]

  it.each(malformed)('%s: non-zero, no gh call, no outputs', (_label, nodeId) => {
    const result = runGate({nodeId, ghStdout: publicRepo})

    expect(result.status).not.toBe(0)
    expect(result.trace.filter(line => line.startsWith('gh '))).toStrictEqual([])
    expect(result.githubOutput).toBe('')
    expect(result.stderr).toBe('Aborting: dispatch input shape invalid\n')
  })
})

describe('survey-repo.yaml: the gate steps call the action', () => {
  const resolveJob = workflow.jobs['survey-resolve']
  const persistJob = workflow.jobs['survey-persist']
  const gateUses = './.github/actions/resolve-public-repo'

  it('survey-resolve passes node-id and token through with: only, on the step id resolve', () => {
    const step = resolveJob?.steps.find(s => s.id === 'resolve')

    expect(step?.uses).toBe(gateUses)
    expect(step?.run).toBeUndefined()
    expect(step?.env).toBeUndefined()
    expect(step?.with).toStrictEqual({
      'node-id': `${expressionStart} inputs.node_id }}`,
      token: `${expressionStart} steps.gate-token.outputs.token }}`,
    })
  })

  it('survey-persist passes node-id and token through with: only, on the step id recheck, keeping its if:', () => {
    const step = persistJob?.steps.find(s => s.id === 'recheck')

    expect(step?.uses).toBe(gateUses)
    expect(step?.run).toBeUndefined()
    expect(step?.env).toBeUndefined()
    expect(step?.with).toStrictEqual({
      'node-id': `${expressionStart} inputs.node_id }}`,
      token: `${expressionStart} steps.recheck-token.outputs.token }}`,
    })
    expect(step?.if).toBe(`${expressionStart} always() && needs.survey-resolve.outputs.resolve-outcome == 'success' }}`)
  })

  it('exactly the two gate steps use the action, and no workflow step inlines the allowlist', () => {
    const users = Object.entries(workflow.jobs).flatMap(([jobId, job]) =>
      job.steps.filter(step => step.uses === gateUses).map(step => `${jobId}/${step.id}`),
    )

    expect(users.toSorted()).toStrictEqual(['survey-persist/recheck', 'survey-resolve/resolve'])
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        expect(String(step.run ?? '')).not.toContain('isPrivate')
      }
    }
  })

  it('no run: in the workflow carries an expression', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        expect(String(step.run ?? '')).not.toContain(expressionStart)
      }
    }
  })
})
