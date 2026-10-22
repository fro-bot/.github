// Import types from the module under test
import type {
  CommentDecision,
  ExternalSignals,
  IssueState,
  MarkerData,
  ProjectItem,
  RolloutSnapshot,
  TrackerComment,
} from './rollout-tracker-snapshot.ts'
import {execFileSync} from 'node:child_process'
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import process from 'node:process'
import {describe, expect, it, vi} from 'vitest'
import {parse} from 'yaml'

import {
  buildSnapshot,
  decideComment,
  extractPreviousMarker,
  hashSnapshot,
  hasPendingOperatorMention,
  MARKER_PREFIX,
  normaliseIssueState,
  normaliseRawProjectItem,
  selectLatestMarkerCommentBody,
} from './rollout-tracker-snapshot.ts'
import {evaluateExpression} from './workflow-expression-test-helper.ts'
import {runStepWithStubs} from './workflow-step-test-helper.ts'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/** Minimal tracked issue state fixture */
function makeIssueState(overrides: Partial<IssueState> = {}): IssueState {
  return {
    number: 907,
    repo: 'fro-bot/agent',
    state: 'open',
    title: 'Test issue',
    closed_at: null,
    labels: [],
    ...overrides,
  }
}

/** Minimal project item fixture */
function makeProjectItem(overrides: Partial<ProjectItem> = {}): ProjectItem {
  return {
    id: 'PVTI_1',
    content_number: 907,
    content_repo: 'fro-bot/agent',
    status: 'In Progress',
    readiness: null,
    gate: null,
    ...overrides,
  }
}

function successRuns(id: number, headSha: string): {workflow_runs: {id: number; head_sha: string}[]} {
  return {workflow_runs: [{id, head_sha: headSha}]}
}

/** API-shaped fixtures for the external signals; `EXTERNAL` is what they parse to. */
const SIGNAL_FIXTURES = {
  releases: {agent: {tag_name: 'v0.125.2'}, dashboard: {tag_name: '2026.10.68'}},
  deploys: {
    gateway: successRuns(38698076821, '3453e7a0'),
    dashboard: successRuns(39739344361, '9d1c2b4f'),
    router: successRuns(39700000001, '7a6b5c4d'),
  },
  health: {ok: true, contractVersion: '1.13.0'},
}

const EXTERNAL: ExternalSignals = {
  agent_release: 'v0.125.2',
  dashboard_release: '2026.10.68',
  deploy_gateway: {run_id: 38698076821, head_sha: '3453e7a0'},
  deploy_dashboard: {run_id: 39739344361, head_sha: '9d1c2b4f'},
  deploy_router: {run_id: 39700000001, head_sha: '7a6b5c4d'},
  contract_version: '1.13.0',
}

interface CliResult {
  status: number
  stdout: string
  stderr: string
}

function runCliRaw(env: Record<string, string | undefined>): CliResult {
  const scriptPath = resolve(import.meta.dirname, './rollout-tracker-snapshot.ts')
  try {
    const stdout = execFileSync('node', [scriptPath], {
      encoding: 'utf8',
      env: {...process.env, ...env},
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return {status: 0, stdout, stderr: ''}
  } catch (error) {
    const failure = error as {status?: number; stdout?: string; stderr?: string}
    return {status: failure.status ?? 1, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? '')}
  }
}

interface FixtureParams {
  items: ProjectItem[]
  issues: IssueState[]
  commentBody?: string
  comments?: TrackerComment[]
  signals?: Partial<typeof SIGNAL_FIXTURES>
}

function fixtureEnv(params: FixtureParams): Record<string, string | undefined> {
  const signals = {...SIGNAL_FIXTURES, ...params.signals}
  return {
    ROLLOUT_TRACKER_COMMENT_BODY: params.commentBody ?? '',
    ROLLOUT_TRACKER_COMMENTS_JSON: params.comments === undefined ? undefined : JSON.stringify(params.comments),
    ROLLOUT_TRACKER_ISSUES_JSON: JSON.stringify(params.issues),
    ROLLOUT_TRACKER_ITEMS_JSON: JSON.stringify(params.items),
    ROLLOUT_TRACKER_RELEASES_JSON: JSON.stringify(signals.releases),
    ROLLOUT_TRACKER_DEPLOYS_JSON: JSON.stringify(signals.deploys),
    ROLLOUT_TRACKER_HEALTH_JSON: JSON.stringify(signals.health),
  }
}

function runCliFixture(params: FixtureParams): CommentDecision {
  const result = runCliRaw(fixtureEnv(params))
  if (result.status !== 0) throw new Error(`fixture run failed (${result.status}): ${result.stderr}`)
  return JSON.parse(result.stdout) as CommentDecision
}

function markerFor(decision: CommentDecision): string {
  return `<!-- ${MARKER_PREFIX}${JSON.stringify({hash: decision.hash, snapshot: decision.snapshot})} -->`
}

// ─── buildSnapshot ────────────────────────────────────────────────────────────

describe('buildSnapshot', () => {
  it('constructs a normalized snapshot from project items and issue states', () => {
    const items: ProjectItem[] = [makeProjectItem()]
    const issues: IssueState[] = [makeIssueState()]

    const snapshot = buildSnapshot(items, issues, EXTERNAL)

    expect(snapshot).toBeDefined()
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]).toMatchObject({
      content_number: 907,
      content_repo: 'fro-bot/agent',
      status: 'In Progress',
    })
  })

  it('merges issue state (closed_at, labels) into snapshot items', () => {
    const items: ProjectItem[] = [makeProjectItem({content_number: 929, content_repo: 'fro-bot/agent'})]
    const issues: IssueState[] = [
      makeIssueState({
        number: 929,
        repo: 'fro-bot/agent',
        state: 'closed',
        closed_at: '2026-06-01T00:00:00Z',
        labels: ['deployed'],
      }),
    ]

    const snapshot = buildSnapshot(items, issues, EXTERNAL)

    expect(snapshot.items[0]).toMatchObject({
      content_number: 929,
      issue_state: 'closed',
      issue_closed_at: '2026-06-01T00:00:00Z',
      issue_labels: ['deployed'],
    })
  })

  it('sorts items deterministically by repo+number', () => {
    const items: ProjectItem[] = [
      makeProjectItem({content_number: 929, content_repo: 'fro-bot/agent'}),
      makeProjectItem({content_number: 907, content_repo: 'fro-bot/agent'}),
      makeProjectItem({content_number: 24, content_repo: 'fro-bot/dashboard'}),
    ]
    const issues: IssueState[] = []

    const snapshot = buildSnapshot(items, issues, EXTERNAL)

    expect(snapshot.items[0]?.content_number).toBe(907)
    expect(snapshot.items[1]?.content_number).toBe(929)
    expect(snapshot.items[2]?.content_number).toBe(24)
  })

  it('excludes volatile fields (timestamps, prose) from snapshot items', () => {
    const items: ProjectItem[] = [makeProjectItem()]
    const issues: IssueState[] = [makeIssueState({title: 'Some prose title that changes'})]

    const snapshot = buildSnapshot(items, issues, EXTERNAL)

    // title should NOT appear in snapshot items (volatile prose)
    expect(JSON.stringify(snapshot)).not.toContain('Some prose title that changes')
  })
})

// ─── hashSnapshot ─────────────────────────────────────────────────────────────

describe('hashSnapshot', () => {
  it('produces a stable hex string for the same snapshot', () => {
    const snapshot: RolloutSnapshot = {
      external: EXTERNAL,
      items: [
        {
          content_number: 907,
          content_repo: 'fro-bot/agent',
          status: 'In Progress',
          readiness: null,
          gate: null,
          issue_state: 'open',
          issue_closed_at: null,
          issue_labels: [],
        },
      ],
    }

    const h1 = hashSnapshot(snapshot)
    const h2 = hashSnapshot(snapshot)

    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/) // SHA-256 hex
  })

  it('produces different hashes for different issue states', () => {
    const base: RolloutSnapshot = {
      external: EXTERNAL,
      items: [
        {
          content_number: 907,
          content_repo: 'fro-bot/agent',
          status: 'In Progress',
          readiness: null,
          gate: null,
          issue_state: 'open',
          issue_closed_at: null,
          issue_labels: [],
        },
      ],
    }
    const baseItem = base.items[0] ?? {
      content_number: 907,
      content_repo: 'fro-bot/agent',
      status: 'In Progress',
      readiness: null,
      gate: null,
      issue_state: 'open' as const,
      issue_closed_at: null,
      issue_labels: [],
    }
    const changed: RolloutSnapshot = {
      external: EXTERNAL,
      items: [
        {
          ...baseItem,
          issue_state: 'closed',
        },
      ],
    }

    expect(hashSnapshot(base)).not.toBe(hashSnapshot(changed))
  })

  it('is stable regardless of object key insertion order (sorted keys)', () => {
    const a: RolloutSnapshot = {
      external: EXTERNAL,
      items: [
        {
          content_number: 907,
          content_repo: 'fro-bot/agent',
          status: 'In Progress',
          readiness: null,
          gate: null,
          issue_state: 'open',
          issue_closed_at: null,
          issue_labels: [],
        },
      ],
    }
    // Same data, different key order in the object literal
    const b: RolloutSnapshot = {
      external: EXTERNAL,
      items: [
        {
          issue_state: 'open',
          gate: null,
          readiness: null,
          status: 'In Progress',
          content_repo: 'fro-bot/agent',
          content_number: 907,
          issue_closed_at: null,
          issue_labels: [],
        },
      ],
    }

    expect(hashSnapshot(a)).toBe(hashSnapshot(b))
  })

  it('closure/state change affects hash', () => {
    const open: RolloutSnapshot = {
      external: EXTERNAL,
      items: [
        {
          content_number: 907,
          content_repo: 'fro-bot/agent',
          status: 'In Progress',
          readiness: null,
          gate: null,
          issue_state: 'open',
          issue_closed_at: null,
          issue_labels: [],
        },
      ],
    }
    const openItem = open.items[0] ?? {
      content_number: 907,
      content_repo: 'fro-bot/agent',
      status: 'In Progress',
      readiness: null,
      gate: null,
      issue_state: 'open' as const,
      issue_closed_at: null,
      issue_labels: [],
    }
    const closed: RolloutSnapshot = {
      external: EXTERNAL,
      items: [
        {
          ...openItem,
          issue_state: 'closed',
          issue_closed_at: '2026-06-01T00:00:00Z',
        },
      ],
    }

    expect(hashSnapshot(open)).not.toBe(hashSnapshot(closed))
  })

  it('does not change hash for Project field-only drift', () => {
    const base: RolloutSnapshot = {
      external: EXTERNAL,
      items: [
        {
          content_number: 24,
          content_repo: 'fro-bot/dashboard',
          status: 'Todo',
          readiness: 'ready now',
          gate: 'Gateway stage 3',
          issue_state: 'open',
          issue_closed_at: null,
          issue_labels: [],
        },
      ],
    }
    const baseItem = base.items[0]
    if (baseItem === undefined) throw new Error('missing base item')
    const fieldOnlyDrift: RolloutSnapshot = {
      external: EXTERNAL,
      items: [
        {
          ...baseItem,
          status: 'In Progress',
          readiness: 'blocked',
          gate: 'Gateway stage 4',
        },
      ],
    }

    expect(hashSnapshot(base)).toBe(hashSnapshot(fieldOnlyDrift))
  })

  it('does not change hash for issue label-only drift', () => {
    const base: RolloutSnapshot = {
      external: EXTERNAL,
      items: [
        {
          content_number: 24,
          content_repo: 'fro-bot/dashboard',
          status: 'Todo',
          readiness: 'ready now',
          gate: 'Gateway stage 3',
          issue_state: 'open',
          issue_closed_at: null,
          issue_labels: [],
        },
      ],
    }
    const baseItem = base.items[0]
    if (baseItem === undefined) throw new Error('missing base item')
    const labelOnlyDrift: RolloutSnapshot = {
      external: EXTERNAL,
      items: [
        {
          ...baseItem,
          issue_labels: ['tracking', 'triaged'],
        },
      ],
    }

    expect(hashSnapshot(base)).toBe(hashSnapshot(labelOnlyDrift))
  })
})

// ─── extractPreviousMarker ────────────────────────────────────────────────────

describe('extractPreviousMarker', () => {
  it('returns null when no marker is present', () => {
    const body = 'Some comment body with no marker here.'
    expect(extractPreviousMarker(body)).toBeNull()
  })

  it('extracts marker data from an HTML comment', () => {
    const markerData: MarkerData = {hash: 'abc123', snapshot: {items: []}}
    const body = `Some text\n<!-- ${MARKER_PREFIX}${JSON.stringify(markerData)} -->\nMore text`

    const result = extractPreviousMarker(body)

    expect(result).not.toBeNull()
    expect(result?.hash).toBe('abc123')
    expect(result?.snapshot).toEqual({items: []})
  })

  it('returns null for malformed marker JSON', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const body = `<!-- ${MARKER_PREFIX}not-valid-json -->`

    const result = extractPreviousMarker(body)

    expect(result).toBeNull()
    expect(stderrSpy).toHaveBeenCalled()
    stderrSpy.mockRestore()
  })

  it('returns null for empty string input', () => {
    expect(extractPreviousMarker('')).toBeNull()
  })

  it('extracts the LAST marker when multiple are present (latest wins)', () => {
    const first: MarkerData = {hash: 'first', snapshot: {items: []}}
    const second: MarkerData = {hash: 'second', snapshot: {items: []}}
    const body = [
      `<!-- ${MARKER_PREFIX}${JSON.stringify(first)} -->`,
      'Some prose in between',
      `<!-- ${MARKER_PREFIX}${JSON.stringify(second)} -->`,
    ].join('\n')

    const result = extractPreviousMarker(body)

    expect(result?.hash).toBe('second')
  })
})

describe('selectLatestMarkerCommentBody', () => {
  it('uses the latest fro-bot comment with a tracker marker', () => {
    const first = `@fro-bot first\n<!-- ${MARKER_PREFIX}${JSON.stringify({hash: 'one', snapshot: {items: []}})} -->`
    const second = `@fro-bot second\n<!-- ${MARKER_PREFIX}${JSON.stringify({hash: 'two', snapshot: {items: []}})} -->`

    expect(
      selectLatestMarkerCommentBody([
        {author: {login: 'fro-bot'}, body: first},
        {author: {login: 'fro-bot'}, body: '@fro-bot prose-only follow-up'},
        {author: {login: 'marcusrbrown'}, body: second},
        {author: {login: 'fro-bot'}, body: second},
      ]),
    ).toBe(second)
  })

  it('selects a marker comment authored by fro-bot[bot] (GitHub App identity)', () => {
    const markerBody = `<!-- ${MARKER_PREFIX}${JSON.stringify({hash: 'bot-hash', snapshot: {items: []}})} -->`

    expect(selectLatestMarkerCommentBody([{author: {login: 'fro-bot[bot]'}, body: markerBody}])).toBe(markerBody)
  })

  it('prefers the latest marker across both fro-bot and fro-bot[bot] identities', () => {
    const patMarker = `<!-- ${MARKER_PREFIX}${JSON.stringify({hash: 'pat', snapshot: {items: []}})} -->`
    const appMarker = `<!-- ${MARKER_PREFIX}${JSON.stringify({hash: 'app', snapshot: {items: []}})} -->`

    expect(
      selectLatestMarkerCommentBody([
        {author: {login: 'fro-bot'}, body: patMarker},
        {author: {login: 'fro-bot[bot]'}, body: appMarker},
      ]),
    ).toBe(appMarker)
  })

  it('returns an empty body when no fro-bot marker exists', () => {
    expect(
      selectLatestMarkerCommentBody([
        {author: {login: 'fro-bot'}, body: '@fro-bot prose-only'},
        {author: {login: 'marcusrbrown'}, body: `<!-- ${MARKER_PREFIX}{"hash":"x","snapshot":{"items":[]}} -->`},
      ]),
    ).toBe('')
  })
})

// ─── decideComment ────────────────────────────────────────────────────────────

describe('decideComment', () => {
  const baseSnapshot: RolloutSnapshot = {
    external: EXTERNAL,
    items: [
      {
        content_number: 907,
        content_repo: 'fro-bot/agent',
        status: 'In Progress',
        readiness: null,
        gate: null,
        issue_state: 'open',
        issue_closed_at: null,
        issue_labels: [],
      },
    ],
  }

  it('cold start (no prior marker) => should_comment:true to seed state', () => {
    const hash = hashSnapshot(baseSnapshot)
    const result = decideComment(baseSnapshot, hash, null, false)

    expect(result.should_comment).toBe(true)
    expect(result.reason).toMatch(/cold start/i)
    expect(result.hash).toBe(hash)
    expect(result.snapshot).toEqual(baseSnapshot)
  })

  it('same hash as previous marker => should_comment:false with no gating transition reason', () => {
    const hash = hashSnapshot(baseSnapshot)
    const previousMarker: MarkerData = {hash, snapshot: baseSnapshot}

    const result = decideComment(baseSnapshot, hash, previousMarker, false)

    expect(result.should_comment).toBe(false)
    expect(result.reason).toMatch(/no gating transition/i)
    expect(result.hash).toBe(hash)
  })

  it('different hash from previous marker => should_comment:true', () => {
    const oldSnapshot: RolloutSnapshot = {
      external: EXTERNAL,
      items: [
        {
          content_number: 907,
          content_repo: 'fro-bot/agent',
          status: 'In Progress',
          readiness: null,
          gate: null,
          issue_state: 'open',
          issue_closed_at: null,
          issue_labels: [],
        },
      ],
    }
    const oldItem = oldSnapshot.items[0] ?? {
      content_number: 907,
      content_repo: 'fro-bot/agent',
      status: 'In Progress',
      readiness: null,
      gate: null,
      issue_state: 'open' as const,
      issue_closed_at: null,
      issue_labels: [],
    }
    const newSnapshot: RolloutSnapshot = {
      external: EXTERNAL,
      items: [
        {
          ...oldItem,
          status: 'Done',
          issue_state: 'closed',
          issue_closed_at: '2026-06-10T00:00:00Z',
        },
      ],
    }
    const oldHash = hashSnapshot(oldSnapshot)
    const newHash = hashSnapshot(newSnapshot)
    const previousMarker: MarkerData = {hash: oldHash, snapshot: oldSnapshot}

    const result = decideComment(newSnapshot, newHash, previousMarker, false)

    expect(result.should_comment).toBe(true)
    expect(result.hash).toBe(newHash)
    expect(result.snapshot).toEqual(newSnapshot)
  })

  it('returns hash and snapshot in result regardless of should_comment value', () => {
    const hash = hashSnapshot(baseSnapshot)
    const previousMarker: MarkerData = {hash, snapshot: baseSnapshot}

    const result = decideComment(baseSnapshot, hash, previousMarker, false)

    expect(result.hash).toBeDefined()
    expect(result.snapshot).toBeDefined()
  })
})

describe('rollout-tracker-snapshot CLI fixture path', () => {
  it('gates comments only on tracked identity or issue-state transitions', () => {
    const items = [makeProjectItem({content_number: 24, content_repo: 'fro-bot/dashboard', gate: 'Gateway stage 3'})]
    const issues = [makeIssueState({number: 24, repo: 'fro-bot/dashboard', state: 'open'})]

    const first = runCliFixture({items, issues})
    expect(first.should_comment).toBe(true)

    const marker = `@fro-bot seeded\n<!-- ${MARKER_PREFIX}${JSON.stringify({
      hash: first.hash,
      snapshot: first.snapshot,
    })} -->`

    const unchanged = runCliFixture({items, issues, commentBody: marker})
    expect(unchanged.should_comment).toBe(false)
    expect(unchanged.reason).toContain('no gating transition')

    const projectFieldAndLabelDrift = runCliFixture({
      commentBody: marker,
      issues: [makeIssueState({number: 24, repo: 'fro-bot/dashboard', labels: ['tracking']})],
      items: [
        makeProjectItem({
          content_number: 24,
          content_repo: 'fro-bot/dashboard',
          gate: 'Units 4-6',
          readiness: 'blocked',
          status: 'In Progress',
        }),
      ],
    })
    expect(projectFieldAndLabelDrift.should_comment).toBe(false)

    const issueStateTransition = runCliFixture({
      commentBody: marker,
      issues: [makeIssueState({number: 24, repo: 'fro-bot/dashboard', state: 'closed'})],
      items,
    })
    expect(issueStateTransition.should_comment).toBe(true)

    const existingItem = items[0]
    if (existingItem === undefined) throw new Error('missing existing item')
    const addedItemTransition = runCliFixture({
      commentBody: marker,
      issues,
      items: [existingItem, makeProjectItem({content_number: 25, content_repo: 'fro-bot/dashboard'})],
    })
    expect(addedItemTransition.should_comment).toBe(true)
  })
})

// ─── Live comment fetch through gh ────────────────────────────────────────────────────

// Fake `gh` that enforces the real CLI's rule rejecting `--comments` with `--json`, serves a
// fixture file for comment reads, and answers `gh api` by endpoint so the live signal reads run
// for real. An endpoint the preflight is not expected to read fails the call.
const FAKE_GH = [
  '#!/bin/sh',
  'if [ "$1" = api ]; then',
  '  [ -n "$FAKE_GH_API_FAIL" ] && { echo "HTTP 502" >&2; exit 1; }',
  '  case "$2" in',
  '    repos/fro-bot/agent/releases/latest) printf "%s" "$FAKE_GH_AGENT_RELEASE" ;;',
  '    repos/fro-bot/dashboard/releases/latest) printf "%s" "$FAKE_GH_DASHBOARD_RELEASE" ;;',
  '    repos/marcusrbrown/infra/actions/workflows/deploy-gateway.yaml/runs*) printf "%s" "$FAKE_GH_GATEWAY_RUNS" ;;',
  '    repos/marcusrbrown/infra/actions/workflows/deploy-dashboard.yaml/runs*) printf "%s" "$FAKE_GH_DASHBOARD_RUNS" ;;',
  '    repos/marcusrbrown/infra/actions/workflows/deploy.yaml/runs*) printf "%s" "$FAKE_GH_ROUTER_RUNS" ;;',
  '    *) echo "unexpected endpoint: $2" >&2; exit 1 ;;',
  '  esac',
  '  exit 0',
  'fi',
  'case " $* " in *" --comments "*" --json "*|*" --json "*" --comments "*)',
  '  echo "specify only one of --comments or --json" >&2; exit 1 ;;',
  'esac',
  '[ -n "$FAKE_GH_FAIL" ] && { echo "HTTP 502" >&2; exit 1; }',
  'cat "$FAKE_GH_COMMENTS_FILE"',
].join('\n')

interface FakeGhParams {
  items: ProjectItem[]
  issues: IssueState[]
  commentsJson: string
  fail?: boolean
  apiFail?: boolean
  agentRelease?: unknown
  gatewayRuns?: unknown
}

function runCliWithFakeGh(params: FakeGhParams): CliResult {
  const dir = mkdtempSync(join(tmpdir(), 'rollout-tracker-gh-'))
  try {
    writeFileSync(join(dir, 'gh'), FAKE_GH)
    chmodSync(join(dir, 'gh'), 0o755)
    const commentsFile = join(dir, 'comments.json')
    writeFileSync(commentsFile, params.commentsJson)
    return runCliRaw({
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      FAKE_GH_COMMENTS_FILE: commentsFile,
      FAKE_GH_FAIL: params.fail === true ? '1' : '',
      FAKE_GH_API_FAIL: params.apiFail === true ? '1' : '',
      FAKE_GH_AGENT_RELEASE: JSON.stringify(params.agentRelease ?? SIGNAL_FIXTURES.releases.agent),
      FAKE_GH_DASHBOARD_RELEASE: JSON.stringify(SIGNAL_FIXTURES.releases.dashboard),
      FAKE_GH_GATEWAY_RUNS: JSON.stringify(params.gatewayRuns ?? SIGNAL_FIXTURES.deploys.gateway),
      FAKE_GH_DASHBOARD_RUNS: JSON.stringify(SIGNAL_FIXTURES.deploys.dashboard),
      FAKE_GH_ROUTER_RUNS: JSON.stringify(SIGNAL_FIXTURES.deploys.router),
      ROLLOUT_TRACKER_COMMENT_BODY: undefined,
      ROLLOUT_TRACKER_COMMENTS_JSON: undefined,
      ROLLOUT_TRACKER_ISSUES_JSON: JSON.stringify(params.issues),
      ROLLOUT_TRACKER_ITEMS_JSON: JSON.stringify(params.items),
      // Health is the only read that is not served through `gh`; the fixture keeps the run offline.
      ROLLOUT_TRACKER_HEALTH_JSON: JSON.stringify(SIGNAL_FIXTURES.health),
    })
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
}

describe('rollout-tracker-snapshot live external signal reads', () => {
  const items = [makeProjectItem({content_number: 24, content_repo: 'fro-bot/dashboard'})]
  const issues = [makeIssueState({number: 24, repo: 'fro-bot/dashboard', state: 'open'})]
  const commentsJson = '{"comments":[]}'

  it('reads releases and deploy runs through gh api and records them in the snapshot', () => {
    const result = runCliWithFakeGh({items, issues, commentsJson})

    expect(result.status).toBe(0)
    const decision = JSON.parse(result.stdout) as CommentDecision
    expect(decision.snapshot.external).toEqual(EXTERNAL)
  })

  it('exits non-zero with empty stdout when gh api fails', () => {
    const result = runCliWithFakeGh({items, issues, commentsJson, apiFail: true})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('FATAL')
    expect(result.stderr).toContain('external signals')
  })

  it('exits non-zero when no successful deploy run exists', () => {
    const result = runCliWithFakeGh({items, issues, commentsJson, gatewayRuns: {workflow_runs: []}})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('deploy-gateway.yaml has no successful run')
  })

  it('exits non-zero when a release has an empty tag', () => {
    const result = runCliWithFakeGh({items, issues, commentsJson, agentRelease: {tag_name: ''}})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('fro-bot/agent latest release tag_name is missing or empty')
  })
})

// ─── External signals: hash and fail-closed reads ─────────────────────────────

describe('external signals in the hash', () => {
  const items = [makeProjectItem({content_number: 24, content_repo: 'fro-bot/dashboard'})]
  const issues = [makeIssueState({number: 24, repo: 'fro-bot/dashboard', state: 'open'})]
  const baseHash = hashSnapshot(buildSnapshot(items, issues, EXTERNAL))

  it('hashes the same inputs to the same value', () => {
    expect(hashSnapshot(buildSnapshot(items, issues, {...EXTERNAL}))).toBe(baseHash)
  })

  it.each<[string, Partial<ExternalSignals>]>([
    ['agent release', {agent_release: 'v0.126.0'}],
    ['dashboard release', {dashboard_release: '2026.10.69'}],
    ['gateway deploy run id', {deploy_gateway: {run_id: 38698076822, head_sha: '3453e7a0'}}],
    ['gateway deploy head sha', {deploy_gateway: {run_id: 38698076821, head_sha: 'ffffffff'}}],
    ['dashboard deploy run id', {deploy_dashboard: {run_id: 39739344362, head_sha: '9d1c2b4f'}}],
    ['router deploy run id', {deploy_router: {run_id: 39700000002, head_sha: '7a6b5c4d'}}],
    ['contract version', {contract_version: '1.14.0'}],
  ])('changes the hash when the %s changes', (_name, change) => {
    expect(hashSnapshot(buildSnapshot(items, issues, {...EXTERNAL, ...change}))).not.toBe(baseHash)
  })

  it('leaves the hash unchanged for a Project field change on its own', () => {
    const drifted = [
      makeProjectItem({
        content_number: 24,
        content_repo: 'fro-bot/dashboard',
        status: 'Done',
        readiness: 'blocked',
        gate: 'Gateway stage 9',
      }),
    ]

    expect(hashSnapshot(buildSnapshot(drifted, issues, EXTERNAL))).toBe(baseHash)
  })

  it('wakes on a marker written before external signals existed', () => {
    const legacyMarker: MarkerData = {hash: 'a'.repeat(64), snapshot: {items: []}}
    const body = `<!-- ${MARKER_PREFIX}${JSON.stringify(legacyMarker)} -->`
    const previous = extractPreviousMarker(body)
    const snapshot = buildSnapshot(items, issues, EXTERNAL)

    const decision = decideComment(snapshot, hashSnapshot(snapshot), previous, false)

    expect(previous).not.toBeNull()
    expect(decision.should_comment).toBe(true)
    expect(decision.reason).toContain('gating transition detected')
  })

  it('wakes through the CLI when a deploy run moves after the last marker', () => {
    const seeded = runCliFixture({items, issues})
    const marker = markerFor(seeded)

    const unchanged = runCliFixture({items, issues, commentBody: marker})
    expect(unchanged.should_comment).toBe(false)

    const redeployed = runCliFixture({
      items,
      issues,
      commentBody: marker,
      signals: {deploys: {...SIGNAL_FIXTURES.deploys, dashboard: successRuns(39739344999, 'abcdef01')}},
    })
    expect(redeployed.should_comment).toBe(true)
    expect(redeployed.hash).not.toBe(seeded.hash)
  })

  it('prints the full snapshot as JSON from fixtures alone', () => {
    // A `gh` that always fails proves no read leaves the fixtures.
    const dir = mkdtempSync(join(tmpdir(), 'rollout-tracker-nogh-'))
    try {
      writeFileSync(join(dir, 'gh'), '#!/bin/sh\necho "network disabled" >&2\nexit 1\n')
      chmodSync(join(dir, 'gh'), 0o755)

      const result = runCliRaw({...fixtureEnv({items, issues}), PATH: `${dir}:${process.env.PATH ?? ''}`})

      expect(result.status).toBe(0)
      const decision = JSON.parse(result.stdout) as CommentDecision
      expect(decision.snapshot.external).toEqual(EXTERNAL)
      expect(decision.hash).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })
})

describe('external signal reads fail closed', () => {
  const items = [makeProjectItem({content_number: 24, content_repo: 'fro-bot/dashboard'})]
  const issues = [makeIssueState({number: 24, repo: 'fro-bot/dashboard', state: 'open'})]

  const cases: [string, Record<string, string>][] = [
    [
      'an agent release with no tag',
      {ROLLOUT_TRACKER_RELEASES_JSON: JSON.stringify({agent: {}, dashboard: {tag_name: 'x'}})},
    ],
    [
      'a dashboard release with an empty tag',
      {ROLLOUT_TRACKER_RELEASES_JSON: JSON.stringify({agent: {tag_name: 'x'}, dashboard: {tag_name: ' '}})},
    ],
    [
      'a deploy workflow with no successful run',
      {ROLLOUT_TRACKER_DEPLOYS_JSON: JSON.stringify({...SIGNAL_FIXTURES.deploys, router: {workflow_runs: []}})},
    ],
    [
      'a deploy run with no head sha',
      {ROLLOUT_TRACKER_DEPLOYS_JSON: JSON.stringify({...SIGNAL_FIXTURES.deploys, gateway: {workflow_runs: [{id: 1}]}})},
    ],
    ['a health response with no contractVersion', {ROLLOUT_TRACKER_HEALTH_JSON: JSON.stringify({ok: true})}],
    ['a health response with an empty contractVersion', {ROLLOUT_TRACKER_HEALTH_JSON: '{"contractVersion":""}'}],
    ['an unparseable release fixture', {ROLLOUT_TRACKER_RELEASES_JSON: 'not json'}],
  ]

  it.each(cases)('ends with empty stdout and a non-zero exit for %s', (_name, override) => {
    const result = runCliRaw({...fixtureEnv({items, issues}), ...override})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('rollout-tracker-snapshot:')
  })
})

// ─── Pending operator mention ─────────────────────────────────────────────────

describe('hasPendingOperatorMention', () => {
  const marker = `reply\n<!-- ${MARKER_PREFIX}${JSON.stringify({hash: 'h', snapshot: {items: []}})} -->`
  const reply: TrackerComment = {author: {login: 'fro-bot'}, body: marker}
  const mention: TrackerComment = {author: {login: 'marcusrbrown'}, body: '@fro-bot gateway v0.125.2 is deployed'}

  it('is pending for an operator @fro-bot comment newer than the latest marker comment', () => {
    expect(hasPendingOperatorMention([reply, mention])).toBe(true)
  })

  it('is pending when no marker comment exists yet', () => {
    expect(hasPendingOperatorMention([mention])).toBe(true)
  })

  it('is not pending for an operator mention older than the marker comment', () => {
    expect(hasPendingOperatorMention([mention, reply])).toBe(false)
  })

  it('is not pending for an operator comment without @fro-bot', () => {
    expect(hasPendingOperatorMention([reply, {author: {login: 'marcusrbrown'}, body: 'acceptance run green'}])).toBe(
      false,
    )
  })

  it('is not pending for an @fro-bot comment by another author', () => {
    expect(hasPendingOperatorMention([reply, {author: {login: 'octocat'}, body: '@fro-bot please look'}])).toBe(false)
  })

  it('is not pending for a fro-bot reply that has no marker', () => {
    expect(
      hasPendingOperatorMention([reply, {author: {login: 'fro-bot'}, body: '@fro-bot prose-only follow-up'}]),
    ).toBe(false)
  })

  it('anchors on the latest marker comment from either bot identity', () => {
    const appReply: TrackerComment = {author: {login: 'fro-bot[bot]'}, body: marker}
    expect(hasPendingOperatorMention([reply, mention, appReply])).toBe(false)
    expect(hasPendingOperatorMention([reply, mention, appReply, mention])).toBe(true)
  })
})

describe('decideComment with a pending operator mention', () => {
  const snapshot = buildSnapshot([makeProjectItem()], [makeIssueState()], EXTERNAL)
  const hash = hashSnapshot(snapshot)
  const previous: MarkerData = {hash, snapshot}

  it('wakes with an unchanged hash and says why', () => {
    const decision = decideComment(snapshot, hash, previous, true)

    expect(decision.should_comment).toBe(true)
    expect(decision.reason).toContain('operator mention pending')
    expect(decision.hash).toBe(hash)
  })

  it('names the pending mention when the hash also changed', () => {
    const decision = decideComment(snapshot, hash, {hash: 'b'.repeat(64), snapshot}, true)

    expect(decision.should_comment).toBe(true)
    expect(decision.reason).toContain('hash changed')
    expect(decision.reason).toContain('operator mention pending')
  })

  it('stays quiet when nothing changed and nothing is pending', () => {
    expect(decideComment(snapshot, hash, previous, false).should_comment).toBe(false)
  })
})

describe('pending operator mention through the CLI', () => {
  const items = [makeProjectItem({content_number: 24, content_repo: 'fro-bot/dashboard'})]
  const issues = [makeIssueState({number: 24, repo: 'fro-bot/dashboard', state: 'open'})]
  const mention: TrackerComment = {author: {login: 'marcusrbrown'}, body: '@fro-bot dashboard 2026.10.68 is live'}

  it('wakes on an unanswered mention, then goes quiet once a reply carries a new marker', () => {
    const seeded = runCliFixture({items, issues})
    const reply: TrackerComment = {author: {login: 'fro-bot'}, body: `@fro-bot seeded\n${markerFor(seeded)}`}

    const quiet = runCliFixture({items, issues, comments: [reply]})
    expect(quiet.should_comment).toBe(false)

    const pending = runCliFixture({items, issues, comments: [reply, mention]})
    expect(pending.should_comment).toBe(true)
    expect(pending.reason).toContain('operator mention pending')
    expect(pending.hash).toBe(seeded.hash)

    const answered = runCliFixture({
      items,
      issues,
      comments: [reply, mention, {author: {login: 'fro-bot'}, body: `answered\n${markerFor(pending)}`}],
    })
    expect(answered.should_comment).toBe(false)
    expect(answered.hash).toBe(seeded.hash)
  })

  it('reports no pending mention for a body-only fixture', () => {
    const seeded = runCliFixture({items, issues})

    const result = runCliFixture({items, issues, commentBody: `${mention.body}\n${markerFor(seeded)}`})

    expect(result.should_comment).toBe(false)
  })

  it('reads the pending mention from the live comment fetch', () => {
    const seeded = runCliFixture({items, issues})
    const comments = [{author: {login: 'fro-bot'}, body: markerFor(seeded)}, mention]

    const result = runCliWithFakeGh({items, issues, commentsJson: JSON.stringify({comments})})

    expect(result.status).toBe(0)
    const decision = JSON.parse(result.stdout) as CommentDecision
    expect(decision.should_comment).toBe(true)
    expect(decision.reason).toContain('operator mention pending')
  })
})

// ─── Live-shape regression: gate field mapping ────────────────────────────────

describe('buildSnapshot — gate field from live gh project shape', () => {
  it('maps raw "gateway Unit Gate" text field to gate on ProjectItem', () => {
    // The gh project item-list --format json API returns the custom field as
    // "gateway Unit Gate" (with spaces), not "gate". The normalisation layer
    // in main() must map it before calling buildSnapshot, so ProjectItem.gate
    // must be populated from that key.
    //
    // We test the normalisation contract by verifying that a ProjectItem whose
    // gate is set (as the normaliser should produce) flows through correctly.
    const item: ProjectItem = makeProjectItem({gate: 'Unit Gate'})
    const snapshot = buildSnapshot([item], [], EXTERNAL)
    expect(snapshot.items[0]?.gate).toBe('Unit Gate')
  })

  it('gate is null when raw "gateway Unit Gate" field is absent or null', () => {
    const item: ProjectItem = makeProjectItem({gate: null})
    const snapshot = buildSnapshot([item], [], EXTERNAL)
    expect(snapshot.items[0]?.gate).toBeNull()
  })

  it('gate value is preserved in the snapshot but does not affect comment hash by itself', () => {
    const withGate = buildSnapshot([makeProjectItem({gate: 'Unit Gate'})], [], EXTERNAL)
    const withoutGate = buildSnapshot([makeProjectItem({gate: null})], [], EXTERNAL)
    expect(withGate.items[0]?.gate).toBe('Unit Gate')
    expect(hashSnapshot(withGate)).toBe(hashSnapshot(withoutGate))
  })
})

// ─── Live-shape regression: normaliseRawProjectItem ──────────────────────────

describe('normaliseRawProjectItem', () => {
  it('maps "gateway Unit Gate" key to gate field', () => {
    const raw: Record<string, unknown> = {
      id: 'PVTI_1',
      content: {number: 929, repository: 'fro-bot/agent'},
      status: 'In Progress',
      readiness: null,
      'gateway Unit Gate': 'Unit Gate',
    }
    const item = normaliseRawProjectItem(raw)
    expect(item.gate).toBe('Unit Gate')
  })

  it('gate is null when field is missing', () => {
    const raw: Record<string, unknown> = {
      id: 'PVTI_2',
      content: {number: 907, repository: 'fro-bot/agent'},
      status: null,
      readiness: null,
    }
    const item = normaliseRawProjectItem(raw)
    expect(item.gate).toBeNull()
  })

  it('gate is null when field value is null', () => {
    const raw: Record<string, unknown> = {
      id: 'PVTI_3',
      content: {number: 24, repository: 'fro-bot/dashboard'},
      status: 'Backlog',
      readiness: null,
      'gateway Unit Gate': null,
    }
    const item = normaliseRawProjectItem(raw)
    expect(item.gate).toBeNull()
  })
})

// ─── Live-shape regression: issue/PR state normalisation ─────────────────────

describe('normaliseIssueState', () => {
  it('maps CLOSED to "closed"', () => {
    expect(normaliseIssueState('CLOSED')).toBe('closed')
  })

  it('maps MERGED to "merged"', () => {
    expect(normaliseIssueState('MERGED')).toBe('merged')
  })

  it('maps OPEN to "open"', () => {
    expect(normaliseIssueState('OPEN')).toBe('open')
  })

  it('maps unknown values to "open" (safe default)', () => {
    expect(normaliseIssueState('SOMETHING_ELSE')).toBe('open')
  })
})

describe('buildSnapshot — MERGED PR state', () => {
  it('issue_state is "merged" when gh returns MERGED', () => {
    const issue: IssueState = makeIssueState({
      number: 929,
      repo: 'fro-bot/agent',
      state: 'merged',
      closed_at: '2026-06-10T00:00:00Z',
    })
    const item = makeProjectItem({content_number: 929, content_repo: 'fro-bot/agent'})
    const snapshot = buildSnapshot([item], [issue], EXTERNAL)
    expect(snapshot.items[0]?.issue_state).toBe('merged')
  })

  it('merged state produces a different hash than open or closed', () => {
    const base = makeProjectItem({content_number: 929, content_repo: 'fro-bot/agent'})
    const openSnap = buildSnapshot(
      [base],
      [makeIssueState({number: 929, repo: 'fro-bot/agent', state: 'open'})],
      EXTERNAL,
    )
    const closedSnap = buildSnapshot(
      [base],
      [makeIssueState({number: 929, repo: 'fro-bot/agent', state: 'closed'})],
      EXTERNAL,
    )
    const mergedSnap = buildSnapshot(
      [base],
      [makeIssueState({number: 929, repo: 'fro-bot/agent', state: 'merged'})],
      EXTERNAL,
    )
    expect(hashSnapshot(mergedSnap)).not.toBe(hashSnapshot(openSnap))
    expect(hashSnapshot(mergedSnap)).not.toBe(hashSnapshot(closedSnap))
  })
})

// ─── deriveTrackedIssueRefs ───────────────────────────────────────────────────

describe('deriveTrackedIssueRefs', () => {
  // Import lazily so the test file compiles even before the export exists
  // (the import at the top of the file will fail if the export is missing)
  it('derives refs from supported project items', async () => {
    const {deriveTrackedIssueRefs} = await import('./rollout-tracker-snapshot.ts')
    const items: ProjectItem[] = [
      makeProjectItem({content_number: 931, content_repo: 'fro-bot/agent'}),
      makeProjectItem({content_number: 907, content_repo: 'fro-bot/agent'}),
    ]
    const refs = deriveTrackedIssueRefs(items)
    expect(refs).toContain('fro-bot/agent#931')
    expect(refs).toContain('fro-bot/agent#907')
    expect(refs).toHaveLength(2)
  })

  it('deduplicates refs when the same repo#number appears multiple times', async () => {
    const {deriveTrackedIssueRefs} = await import('./rollout-tracker-snapshot.ts')
    const items: ProjectItem[] = [
      makeProjectItem({content_number: 907, content_repo: 'fro-bot/agent'}),
      makeProjectItem({content_number: 907, content_repo: 'fro-bot/agent'}),
    ]
    const refs = deriveTrackedIssueRefs(items)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toBe('fro-bot/agent#907')
  })

  it('excludes items with empty content_repo', async () => {
    const {deriveTrackedIssueRefs} = await import('./rollout-tracker-snapshot.ts')
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const items: ProjectItem[] = [
      makeProjectItem({content_number: 907, content_repo: ''}),
      makeProjectItem({content_number: 929, content_repo: 'fro-bot/agent'}),
    ]
    const refs = deriveTrackedIssueRefs(items)
    expect(refs).not.toContain('#907')
    expect(refs).toContain('fro-bot/agent#929')
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('unsupported'))
    // stderr must not contain repo names or item IDs
    const written = stderrSpy.mock.calls.map(c => String(c[0])).join('')
    expect(written).not.toContain('fro-bot/agent')
    expect(written).not.toContain('907')
    stderrSpy.mockRestore()
  })

  it('excludes items with content_number === 0', async () => {
    const {deriveTrackedIssueRefs} = await import('./rollout-tracker-snapshot.ts')
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const items: ProjectItem[] = [
      makeProjectItem({content_number: 0, content_repo: 'fro-bot/agent'}),
      makeProjectItem({content_number: 929, content_repo: 'fro-bot/agent'}),
    ]
    const refs = deriveTrackedIssueRefs(items)
    expect(refs).not.toContain('fro-bot/agent#0')
    expect(refs).toContain('fro-bot/agent#929')
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('unsupported'))
    // stderr must not contain repo names or item IDs
    const written = stderrSpy.mock.calls.map(c => String(c[0])).join('')
    expect(written).not.toContain('fro-bot/agent')
    stderrSpy.mockRestore()
  })

  it('returns empty array when all items are unsupported', async () => {
    const {deriveTrackedIssueRefs} = await import('./rollout-tracker-snapshot.ts')
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const items: ProjectItem[] = [makeProjectItem({content_number: 0, content_repo: ''})]
    const refs = deriveTrackedIssueRefs(items)
    expect(refs).toHaveLength(0)
    expect(stderrSpy).toHaveBeenCalled()
    stderrSpy.mockRestore()
  })
})

// ─── Project-derived state: fro-bot/agent#931 ────────────────────────────────

describe('Project-derived state: fro-bot/agent#931', () => {
  it('agent#931 derives a tracked ref from Project items (not static list)', async () => {
    const {deriveTrackedIssueRefs} = await import('./rollout-tracker-snapshot.ts')
    const items: ProjectItem[] = [makeProjectItem({content_number: 931, content_repo: 'fro-bot/agent'})]
    const refs = deriveTrackedIssueRefs(items)
    expect(refs).toContain('fro-bot/agent#931')
  })

  it('agent#931 can receive issue_state merged without being in a static list', () => {
    const items: ProjectItem[] = [makeProjectItem({content_number: 931, content_repo: 'fro-bot/agent'})]
    const issues: IssueState[] = [
      makeIssueState({number: 931, repo: 'fro-bot/agent', state: 'merged', closed_at: '2026-06-17T00:00:00Z'}),
    ]
    const snapshot = buildSnapshot(items, issues, EXTERNAL)
    expect(snapshot.items[0]?.issue_state).toBe('merged')
    expect(snapshot.items[0]?.content_number).toBe(931)
  })

  it('CLI fixture: agent#931 appears in snapshot with merged state via ROLLOUT_TRACKER_ISSUES_JSON', () => {
    const items: ProjectItem[] = [makeProjectItem({content_number: 931, content_repo: 'fro-bot/agent'})]
    const issues: IssueState[] = [
      makeIssueState({number: 931, repo: 'fro-bot/agent', state: 'merged', closed_at: '2026-06-17T00:00:00Z'}),
    ]
    const result = runCliFixture({items, issues})
    const item931 = result.snapshot.items.find(i => i.content_number === 931 && i.content_repo === 'fro-bot/agent')
    expect(item931).toBeDefined()
    expect(item931?.issue_state).toBe('merged')
  })
})

// ─── Unsupported Project items excluded from snapshot ─────────────────────────

describe('unsupported Project items excluded from snapshot', () => {
  it('buildSnapshot excludes items with empty content_repo', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const items: ProjectItem[] = [
      makeProjectItem({content_number: 907, content_repo: ''}),
      makeProjectItem({content_number: 929, content_repo: 'fro-bot/agent'}),
    ]
    const issues: IssueState[] = [makeIssueState({number: 929, repo: 'fro-bot/agent', state: 'open'})]
    const snapshot = buildSnapshot(items, issues, EXTERNAL)
    // The item with empty repo must not appear in the snapshot
    expect(snapshot.items.every(i => i.content_repo !== '')).toBe(true)
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]?.content_number).toBe(929)
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('unsupported'))
    // stderr must not contain repo names or item IDs
    const written = stderrSpy.mock.calls.map(c => String(c[0])).join('')
    expect(written).not.toContain('fro-bot/agent')
    expect(written).not.toContain('907')
    stderrSpy.mockRestore()
  })

  it('buildSnapshot excludes items with content_number === 0', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const items: ProjectItem[] = [
      makeProjectItem({content_number: 0, content_repo: 'fro-bot/agent'}),
      makeProjectItem({content_number: 929, content_repo: 'fro-bot/agent'}),
    ]
    const issues: IssueState[] = [makeIssueState({number: 929, repo: 'fro-bot/agent', state: 'open'})]
    const snapshot = buildSnapshot(items, issues, EXTERNAL)
    expect(snapshot.items.every(i => i.content_number !== 0)).toBe(true)
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]?.content_number).toBe(929)
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('unsupported'))
    // stderr must not contain repo names or item IDs
    const written = stderrSpy.mock.calls.map(c => String(c[0])).join('')
    expect(written).not.toContain('fro-bot/agent')
    stderrSpy.mockRestore()
  })

  it('CLI fixture: unsupported items do not appear in snapshot output', () => {
    const items: ProjectItem[] = [
      makeProjectItem({content_number: 0, content_repo: ''}),
      makeProjectItem({content_number: 929, content_repo: 'fro-bot/agent'}),
    ]
    const issues: IssueState[] = [makeIssueState({number: 929, repo: 'fro-bot/agent', state: 'open'})]
    const result = runCliFixture({items, issues})
    expect(result.snapshot.items.every(i => i.content_number !== 0 && i.content_repo !== '')).toBe(true)
    expect(result.snapshot.items).toHaveLength(1)
  })
})

// ─── Static trackedIssues removed from production code ───────────────────────

describe('static trackedIssues removed from production code', () => {
  it('production source does not contain a hardcoded trackedIssues array', () => {
    const src = readFileSync(resolve(import.meta.dirname, './rollout-tracker-snapshot.ts'), 'utf8')
    // The static list was defined as `const trackedIssues = [...]`
    expect(src).not.toMatch(/const\s+trackedIssues\s*=\s*\[/)
  })
})

// ─── Shell-injection regression: issue fetch uses execFileSync argv form ──────

describe('shell-injection regression: issue fetch uses execFileSync argv form', () => {
  it('production source does not use shell-string interpolation for gh issue view', () => {
    const src = readFileSync(resolve(import.meta.dirname, './rollout-tracker-snapshot.ts'), 'utf8')
    // The vulnerable pattern: execSync(`gh issue view ${numStr} --repo ${repo} ...`)
    // Any template literal containing "gh issue view" is the shell-injection risk.
    expect(src).not.toMatch(/execSync\s*\(\s*`gh issue view/)
  })

  it('production source uses execFileSync with argv array for gh issue view', () => {
    const src = readFileSync(resolve(import.meta.dirname, './rollout-tracker-snapshot.ts'), 'utf8')
    // Must use execFileSync('gh', ['issue', 'view', ...]) form
    expect(src).toMatch(/execFileSync\s*\(\s*['"]gh['"]/)
  })
})

// ─── Workflow shape regression ────────────────────────────────────────────────

interface WorkflowJob {
  steps?: {name?: string; run?: string; id?: string; if?: string; uses?: string}[]
  uses?: string
  with?: Record<string, unknown>
  if?: string
}

function assertWorkflow(value: unknown): asserts value is {jobs: Record<string, WorkflowJob>} {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('jobs' in value) ||
    typeof (value as Record<string, unknown>).jobs !== 'object'
  ) {
    throw new TypeError('gateway-rollout-tracker.yaml does not have expected shape: missing jobs object')
  }
}

describe('gateway-rollout-tracker.yaml workflow shape', () => {
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/gateway-rollout-tracker.yaml')
  const parsed: unknown = parse(readFileSync(workflowPath, 'utf8'))

  assertWorkflow(parsed)

  it('has a preflight job or preflight step before the fro-bot call', () => {
    const jobs = parsed.jobs
    // Either a dedicated preflight job or a preflight step in the tracker job
    const hasPreflightJob = 'preflight' in jobs || 'rollout-preflight' in jobs
    const trackerJob = jobs['update-rollout-tracker']
    const hasPreflightStep = trackerJob?.steps?.some(
      s =>
        s.id === 'preflight' ||
        s.name?.toLowerCase().includes('preflight') ||
        s.run?.includes('rollout-tracker-snapshot'),
    )
    expect(hasPreflightJob || hasPreflightStep).toBe(true)
  })

  it('gates the fro-bot call so it does not run when should_comment != true', () => {
    const jobs = parsed.jobs
    // The fro-bot reusable call job must have an `if:` condition referencing should_comment
    // OR the step calling fro-bot must have an `if:` condition
    const trackerJob = jobs['update-rollout-tracker']
    const jobIf = trackerJob?.if ?? ''
    const froStepIf = trackerJob?.steps?.find(s => s.uses?.includes('fro-bot'))?.if ?? ''
    const hasGate =
      jobIf.includes('should_comment') ||
      froStepIf.includes('should_comment') ||
      // Could also be a separate job with needs: preflight and if: needs.preflight.outputs.should_comment == 'true'
      Object.values(jobs).some(j => {
        const jobIfStr = (j as {if?: string}).if ?? ''
        return jobIfStr.includes('should_comment')
      })
    expect(hasGate).toBe(true)
  })

  it('logs no gating transition on no-op path', () => {
    // The preflight step or a dedicated no-op step must log "no gating transition"
    const jobs = parsed.jobs
    const allSteps = Object.values(jobs).flatMap(j => (j as {steps?: {run?: string}[]}).steps ?? [])
    const hasNoOpLog = allSteps.some(s => s.run?.includes('no gating transition'))
    expect(hasNoOpLog).toBe(true)
  })

  it('keeps concurrency group intact', () => {
    const wf = parsed as unknown as {concurrency?: {group?: string}}
    expect(wf.concurrency?.group).toBe('gateway-rollout-tracker')
  })

  it('keeps tracker issue URL fro-bot/.github#3512 in the prompt', () => {
    const jobs = parsed.jobs
    const trackerJob = jobs['update-rollout-tracker']
    // The prompt is in with.prompt or in a step
    const withPrompt = (trackerJob?.with?.prompt as string | undefined) ?? ''
    const stepPrompts = trackerJob?.steps?.map(s => s.run ?? '').join('\n') ?? ''
    const allText = withPrompt + stepPrompts
    expect(allText).toContain('fro-bot/.github#3512')
  })

  it('keeps project URL https://github.com/users/fro-bot/projects/1 in the prompt', () => {
    const jobs = parsed.jobs
    const trackerJob = jobs['update-rollout-tracker']
    const withPrompt = (trackerJob?.with?.prompt as string | undefined) ?? ''
    const stepPrompts = trackerJob?.steps?.map(s => s.run ?? '').join('\n') ?? ''
    const allText = withPrompt + stepPrompts
    expect(allText).toContain('https://github.com/users/fro-bot/projects/1')
  })

  it('passes the preflight hash and snapshot into the Fro Bot prompt', () => {
    const trackerJob = parsed.jobs['update-rollout-tracker']
    const withPrompt = (trackerJob?.with?.prompt as string | undefined) ?? ''

    expect(withPrompt).toContain('needs.preflight.outputs.hash')
    expect(withPrompt).toContain('needs.preflight.outputs.snapshot')
  })
})

describe('gateway-rollout-tracker.yaml mention mode', () => {
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/gateway-rollout-tracker.yaml')
  const workflow = parse(readFileSync(workflowPath, 'utf8')) as {
    on: {workflow_dispatch?: {inputs?: Record<string, {type?: string; required?: boolean; default?: unknown}>}}
    jobs: Record<string, WorkflowJob>
  }
  const update = workflow.jobs['update-rollout-tracker']
  const prompt = String(update?.with?.prompt ?? '')
  const updateIf = String(update?.if ?? '')
  const expr = (expression: string): string => `\${{ ${expression} }}`

  function updateRuns(context: {preflight: string; shouldComment?: string; commentId?: string}): boolean {
    return evaluateExpression(updateIf, {
      inputs: {comment_id: context.commentId ?? ''},
      needs: {preflight: {result: context.preflight, outputs: {should_comment: context.shouldComment ?? 'false'}}},
    })
  }

  it('defines a comment_id dispatch input and no prompt input', () => {
    const inputs = workflow.on.workflow_dispatch?.inputs ?? {}

    expect(Object.keys(inputs)).toEqual(['comment_id'])
    expect(inputs.comment_id).toMatchObject({type: 'string', required: false, default: ''})
  })

  it('runs the update job for a mention run, even when the preflight sees no change', () => {
    expect(updateRuns({preflight: 'success', shouldComment: 'false', commentId: '4301234567'})).toBe(true)
  })

  it('runs the update job for a gating change without a mention', () => {
    expect(updateRuns({preflight: 'success', shouldComment: 'true'})).toBe(true)
  })

  it('skips the update job with neither a mention nor a gating change', () => {
    expect(updateRuns({preflight: 'success', shouldComment: 'false'})).toBe(false)
  })

  it.each(['failure', 'cancelled', 'skipped'])(
    'blocks the update job in both modes when the preflight is %s',
    result => {
      expect(updateRuns({preflight: result, shouldComment: 'true'})).toBe(false)
      expect(updateRuns({preflight: result, commentId: '4301234567'})).toBe(false)
    },
  )

  describe('comment ID validation step', () => {
    const step = workflow.jobs.preflight?.steps?.find(candidate => candidate.name === 'Validate comment ID')
    const script = String(step?.run ?? '')

    it('is the first preflight step', () => {
      expect(workflow.jobs.preflight?.steps?.[0]).toBe(step)
    })

    it.each(['', '4301234567'])('accepts %j', commentId => {
      expect(runStepWithStubs(script, {env: {COMMENT_ID: commentId}}).status).toBe(0)
    })

    it.each(['abc', '12 34', '12\n34', '12;echo pwned', '-1', '12\n'])('rejects %j', commentId => {
      const run = runStepWithStubs(script, {env: {COMMENT_ID: commentId}})

      expect(run.status).not.toBe(0)
      expect(run.stderr).toContain('comment_id must be numeric')
    })
  })

  describe('prompt', () => {
    it('receives the comment ID and the preflight outputs', () => {
      expect(prompt).toContain(expr('inputs.comment_id'))
      expect(prompt).toContain('needs.preflight.outputs.reason')
      expect(prompt).toContain('needs.preflight.outputs.hash')
      expect(prompt).toContain('needs.preflight.outputs.snapshot')
    })

    it('names every evidence source', () => {
      for (const source of [
        'linked issues and pull requests',
        'fro-bot/agent',
        'fro-bot/dashboard',
        'marcusrbrown/infra',
        'Deploy Gateway',
        'Deploy Dashboard',
        'deploy.yaml router',
        'https://dashboard.fro.bot/operator/health',
        'acceptance-run results',
      ]) {
        expect(prompt).toContain(source)
      }
    })

    it('covers the body, Project 1 and the labelled acceptance list', () => {
      expect(prompt).toContain('Rewrite every stale section of the body')
      expect(prompt).toContain('Update the Project 1 fields')
      expect(prompt).toContain('add any missing dependency items')
      expect(prompt).toContain('operator-reported')
      expect(prompt).toContain('agent-verified')
    })

    it('catches up on every operator mention newer than the latest marker comment', () => {
      expect(prompt).toContain('Read every fro-bot/.github#3512 comment by\nmarcusrbrown that contains @fro-bot')
      expect(prompt).toContain(
        'newer than the latest\ncomment by fro-bot or fro-bot[bot] that carries a\ngateway-rollout-tracker marker',
      )
      expect(prompt).toContain('Handle all of them in this run')
    })

    it('replies to mentions always and to scheduled runs only on change', () => {
      expect(prompt).toContain('always reply once')
      expect(prompt).toContain('reply on\nfro-bot/.github#3512 only if you changed something')
      expect(prompt).toContain('post nothing')
    })

    it('ends every reply with the marker built from the preflight hash and snapshot', () => {
      expect(prompt).toContain('End every tracker comment on fro-bot/.github#3512 with the')
      expect(prompt).toContain(
        `<!-- gateway-rollout-tracker:{"hash":"${expr('needs.preflight.outputs.hash')}","snapshot":${expr('needs.preflight.outputs.snapshot')}} -->`,
      )
    })
  })
})
