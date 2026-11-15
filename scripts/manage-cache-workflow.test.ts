/**
 * Contract tests for the `Deleting workflow caches on …` step of `.github/workflows/manage-cache.yaml`.
 * The cases run the step's real `run:` text under bash (`@fro-bot/test-kit/workflow-step`) with a `gh` shell
 * function in front of it: `gh cache list` prints a fixture, `gh cache delete` is recorded in the trace and
 * can be made to fail. Nothing reaches the network.
 */

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {runStepWithStubs} from '@fro-bot/test-kit/workflow-step'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface WorkflowStep {
  name?: string
  if?: string
  env?: Record<string, unknown>
  run?: string
}

interface WorkflowFile {
  jobs?: Record<string, {steps?: WorkflowStep[]}>
}

const workflowPath = resolve(import.meta.dirname, '../.github/workflows/manage-cache.yaml')
const workflow = parse(readFileSync(workflowPath, 'utf8')) as WorkflowFile
const cleanupStep = workflow.jobs?.['cleanup-cache']?.steps?.find(step =>
  step.name?.startsWith('Deleting workflow caches'),
)
const runScript = String(cleanupStep?.run ?? '')
const expressionStart = '$' + '{{'

const REPOSITORY = 'fro-bot/.github'
const DEFAULT_REF = 'refs/heads/main'
const PR_REF = 'refs/pull/123/merge'
const BENIGN = 'Could not find a cache matching'

// `gh` as a shell function so it wins over any real binary. `cache list` prints the fixture, `cache delete`
// fails for one chosen key. Both are traced the way the test kit's tool stubs are. `set -e` matches the
// runner's default `bash -e {0}`.
const GH_STUB = [
  'set -e',
  'gh() {',
  '  echo "gh $*" >> "$STUB_TRACE"',
  '  case "$1 $2" in',
  '    "cache list") printf "%s" "$STUB_CACHE_LIST" ;;',
  '    "cache delete")',
  '      if [ "$3" = "$STUB_DELETE_FAIL_KEY" ]; then',
  String.raw`        printf "%s\n" "$STUB_DELETE_FAIL_TEXT" >&2`,
  '        return 1',
  '      fi',
  '      ;;',
  '  esac',
  '}',
  '',
].join('\n')

interface CleanupOptions {
  readonly ref: string
  readonly keys: readonly string[]
  readonly failKey?: string
  readonly failText?: string
}

function runCleanup(options: CleanupOptions) {
  // `gh cache list` output is tab-separated: id, key, size, created, last accessed.
  const list = options.keys.map((key, index) => `${index + 1}\t${key}\t1 KiB\t1 day ago\t1 day ago\n`).join('')
  const result = runStepWithStubs(`${GH_STUB}${runScript}`, {
    env: {
      REF: options.ref,
      REPOSITORY,
      DEFAULT_BRANCH: 'main',
      GH_TOKEN: 'not-a-real-token',
      STUB_CACHE_LIST: list,
      STUB_DELETE_FAIL_KEY: options.failKey ?? '',
      STUB_DELETE_FAIL_TEXT: options.failText ?? '',
    },
  })
  const deletes = result.trace.filter(line => line.startsWith('gh cache delete '))
  return {...result, deletes}
}

const deletedKeys = (deletes: readonly string[]): string[] =>
  deletes.map(line => (/^gh cache delete (\S+) /u.exec(line) ?? [])[1] ?? '')

const STORAGE_KEYS = [
  'opencode-storage-a',
  'opencode-v2-storage-github-fro-bot-.github-main-Linux-1-1-fro-bot-observe',
  'opencode-v3-storage-x',
] as const
const OTHER_KEYS = ['opencode-tools-v2-Linux-oc-2.3.0', 'mise-v1-linux', 'fro-bot-dedup-v1-x'] as const

describe('manage-cache workflow: cleanup step shape', () => {
  it('finds the cleanup step', () => {
    expect(cleanupStep).toBeDefined() // guards against a vacuous pass if the step were renamed or removed
    expect(runScript).not.toBe('')
  })

  it('reaches the shell through env: only, so no expression sits inside run:', () => {
    expect(runScript).not.toContain(expressionStart)
    expect(cleanupStep?.env).toMatchObject({
      REPOSITORY: `${expressionStart} github.repository }}`,
      DEFAULT_BRANCH: `${expressionStart} github.event.repository.default_branch }}`,
    })
  })
})

describe('manage-cache workflow: default branch', () => {
  const result = runCleanup({ref: DEFAULT_REF, keys: [...STORAGE_KEYS, ...OTHER_KEYS]})

  it('succeeds', () => {
    expect(result.status).toBe(0)
  })

  it.each(STORAGE_KEYS)('keeps %s with a notice and never deletes it', key => {
    expect(result.stdout).toContain(`::notice::keeping agent session cache: ${key}`)
    expect(deletedKeys(result.deletes)).not.toContain(key)
  })

  it('deletes the other keys and only those', () => {
    expect(deletedKeys(result.deletes)).toStrictEqual([...OTHER_KEYS])
  })
})

describe('manage-cache workflow: pull-request ref', () => {
  const keys = ['opencode-v2-storage-github-fro-bot-.github-123/merge-Linux-1-1-fro-bot', 'mise-v1-linux']
  const result = runCleanup({ref: PR_REF, keys})

  it('deletes session caches and the others alike', () => {
    expect(result.status).toBe(0)
    expect(deletedKeys(result.deletes)).toStrictEqual(keys)
    expect(result.stdout).not.toContain('keeping agent session cache')
  })
})

describe('manage-cache workflow: what a delete carries', () => {
  it.each([
    ['the default branch', DEFAULT_REF],
    ['a pull-request ref', PR_REF],
  ] as const)('passes the repository and the ref for %s', (_label, ref) => {
    const result = runCleanup({ref, keys: ['mise-v1-linux', 'fro-bot-dedup-v1-x']})

    expect(result.deletes).toStrictEqual([
      `gh cache delete mise-v1-linux -R ${REPOSITORY} --ref ${ref}`,
      `gh cache delete fro-bot-dedup-v1-x -R ${REPOSITORY} --ref ${ref}`,
    ])
  })

  it('lists with the same repository and ref', () => {
    const result = runCleanup({ref: PR_REF, keys: []})

    expect(result.trace).toStrictEqual([
      `gh cache list -R ${REPOSITORY} --ref ${PR_REF} --limit 100 --order asc --sort last_accessed_at`,
    ])
  })

  it('prints one line for each deleted key', () => {
    const result = runCleanup({ref: DEFAULT_REF, keys: [...STORAGE_KEYS, ...OTHER_KEYS]})

    for (const key of OTHER_KEYS) expect(result.stdout).toContain(`deleted cache: ${key}\n`)
    for (const key of STORAGE_KEYS) expect(result.stdout).not.toContain(`deleted cache: ${key}`)
    expect(result.stdout.split('\n').filter(line => line.startsWith('deleted cache: '))).toHaveLength(OTHER_KEYS.length)
  })
})

describe('manage-cache workflow: delete failures', () => {
  const keys = ['mise-v1-linux', 'fro-bot-dedup-v1-x', 'opencode-tools-v2-Linux-oc-2.3.0']

  it('skips a cache that was evicted before the delete and carries on', () => {
    const result = runCleanup({
      ref: DEFAULT_REF,
      keys,
      failKey: 'fro-bot-dedup-v1-x',
      failText: `${BENIGN} key: fro-bot-dedup-v1-x`,
    })

    expect(result.status).toBe(0)
    expect(deletedKeys(result.deletes)).toStrictEqual(keys)
    expect(result.stdout).toContain('::notice::cache key already evicted, skipping: fro-bot-dedup-v1-x')
    expect(result.stdout).toContain('deleted cache: mise-v1-linux\n')
    expect(result.stdout).toContain('deleted cache: opencode-tools-v2-Linux-oc-2.3.0\n')
    expect(result.stdout).not.toContain('deleted cache: fro-bot-dedup-v1-x')
  })

  it('fails the step on any other error and stops', () => {
    const result = runCleanup({
      ref: DEFAULT_REF,
      keys,
      failKey: 'fro-bot-dedup-v1-x',
      failText: 'HTTP 403: Resource not accessible by integration',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('HTTP 403: Resource not accessible by integration')
    expect(result.stdout).toContain('::error::unexpected failure deleting cache key: fro-bot-dedup-v1-x')
    expect(deletedKeys(result.deletes)).toStrictEqual(['mise-v1-linux', 'fro-bot-dedup-v1-x'])
    expect(result.stdout).not.toContain('deleted cache: fro-bot-dedup-v1-x')
  })
})

describe('manage-cache workflow: nothing to delete', () => {
  it('does nothing and exits zero for an empty list', () => {
    const result = runCleanup({ref: DEFAULT_REF, keys: []})

    expect(result.status).toBe(0)
    expect(result.deletes).toStrictEqual([])
    expect(result.stdout).toBe('')
  })
})
