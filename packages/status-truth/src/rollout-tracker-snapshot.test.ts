// Import types from the module under test
import type {
  ExternalSignals,
  IssueState,
  MarkerData,
  PreflightResult,
  ProjectItem,
  RolloutSnapshot,
  TrackerComment,
} from './rollout-tracker-snapshot.ts'
import {execFile, execFileSync} from 'node:child_process'
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import process from 'node:process'
import {promisify} from 'node:util'
import {evaluateExpression} from '@fro-bot/test-kit/workflow-expression'
import {runStepWithStubs} from '@fro-bot/test-kit/workflow-step'
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest'
import {parse} from 'yaml'
import {parseProgramTrackers, selectProgram, type CommentEvent} from './program-trackers.ts'
import {
  buildMarker,
  buildSnapshot,
  decideComment,
  extractPreviousMarker,
  hashSnapshot,
  MARKER_PREFIX,
  normaliseIssueState,
  normaliseRawProjectItem,
  scanOperatorMentions,
  selectLatestMarkerCommentBody,
} from './rollout-tracker-snapshot.ts'

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

/** A workflow expression, built so the source holds no template-looking string. */
const expr = (expression: string): string => `${'$'}{{ ${expression} }}`

function comment(id: number, login: string, body: string): TrackerComment {
  return {id, author: {login}, body}
}

/** The #3512 entry, as `program-trackers.json` commits it. */
const GATEWAY_ENTRY = selectProgram(
  parseProgramTrackers(readFileSync(resolve(import.meta.dirname, '../../../program-trackers.json'), 'utf8')),
  'gateway',
)

/** `scanOperatorMentions` for #3512's operator. A bare number is a dispatching comment with no event kind. */
function scan(
  comments: readonly TrackerComment[],
  previousMarker: MarkerData | null,
  trigger: number | {id: number; event: CommentEvent} | null = null,
): ReturnType<typeof scanOperatorMentions> {
  const resolved = typeof trigger === 'number' ? {id: trigger, event: '' as const} : trigger
  return scanOperatorMentions(comments, previousMarker, GATEWAY_ENTRY, resolved)
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
  const scriptPath = resolve(import.meta.dirname, '../../../scripts/rollout-tracker-snapshot.ts')
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
  /** The dispatching comment ID, as the workflow passes `inputs.comment_id`. */
  triggerCommentId?: string
  /** The event kind that dispatched it, as the workflow passes `inputs.comment_event`. */
  triggerCommentEvent?: string
  /** Visibility per repository, `null` for a 404; every repository of `items` is public unless it is listed here. */
  visibility?: Record<string, string | null>
}

/** The `ROLLOUT_TRACKER_VISIBILITY_JSON` fixture: public for every repository of the items, then the overrides. */
function visibilityFixture(
  items: readonly {content_repo: string}[],
  overrides: Record<string, string | null> = {},
): string {
  const visibility: Record<string, string | null> = {}
  for (const item of items) {
    if (item.content_repo !== '') visibility[item.content_repo] = 'public'
  }
  return JSON.stringify({...visibility, ...overrides})
}

function fixtureEnv(params: FixtureParams): Record<string, string | undefined> {
  const signals = {...SIGNAL_FIXTURES, ...params.signals}
  return {
    ROLLOUT_TRACKER_COMMENT_BODY: params.commentBody ?? '',
    ROLLOUT_TRACKER_COMMENT_ID: params.triggerCommentId,
    ROLLOUT_TRACKER_COMMENT_EVENT: params.triggerCommentEvent,
    ROLLOUT_TRACKER_COMMENTS_JSON: params.comments === undefined ? undefined : JSON.stringify(params.comments),
    ROLLOUT_TRACKER_ISSUES_JSON: JSON.stringify(params.issues),
    ROLLOUT_TRACKER_ITEMS_JSON: JSON.stringify(params.items),
    ROLLOUT_TRACKER_VISIBILITY_JSON: visibilityFixture(params.items, params.visibility),
    ROLLOUT_TRACKER_RELEASES_JSON: JSON.stringify(signals.releases),
    ROLLOUT_TRACKER_DEPLOYS_JSON: JSON.stringify(signals.deploys),
    ROLLOUT_TRACKER_HEALTH_JSON: JSON.stringify(signals.health),
  }
}

function runCliFixture(params: FixtureParams): PreflightResult {
  const result = runCliRaw(fixtureEnv(params))
  if (result.status !== 0) throw new Error(`fixture run failed (${result.status}): ${result.stderr}`)
  return JSON.parse(result.stdout) as PreflightResult
}

function markerFor(decision: PreflightResult): string {
  return decision.marker
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
    const markerData: MarkerData = {hash: 'abc123', last_mention_id: 0}
    const body = `Some text\n<!-- ${MARKER_PREFIX}${JSON.stringify(markerData)} -->\nMore text`

    const result = extractPreviousMarker(body)

    expect(result).not.toBeNull()
    expect(result?.hash).toBe('abc123')
    expect(result?.last_mention_id).toBe(0)
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
    const first: MarkerData = {hash: 'first', last_mention_id: 0}
    const second: MarkerData = {hash: 'second', last_mention_id: 0}
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
        comment(1, 'fro-bot', first),
        comment(2, 'fro-bot', '@fro-bot prose-only follow-up'),
        comment(3, 'marcusrbrown', second),
        comment(4, 'fro-bot', second),
      ]),
    ).toBe(second)
  })

  it('selects a marker comment authored by fro-bot[bot] (GitHub App identity)', () => {
    const markerBody = `<!-- ${MARKER_PREFIX}${JSON.stringify({hash: 'bot-hash', snapshot: {items: []}})} -->`

    expect(selectLatestMarkerCommentBody([comment(1, 'fro-bot[bot]', markerBody)])).toBe(markerBody)
  })

  it('prefers the latest marker across both fro-bot and fro-bot[bot] identities', () => {
    const patMarker = `<!-- ${MARKER_PREFIX}${JSON.stringify({hash: 'pat', snapshot: {items: []}})} -->`
    const appMarker = `<!-- ${MARKER_PREFIX}${JSON.stringify({hash: 'app', snapshot: {items: []}})} -->`

    expect(
      selectLatestMarkerCommentBody([comment(1, 'fro-bot', patMarker), comment(2, 'fro-bot[bot]', appMarker)]),
    ).toBe(appMarker)
  })

  it('returns an empty body when no fro-bot marker exists', () => {
    expect(
      selectLatestMarkerCommentBody([
        comment(1, 'fro-bot', '@fro-bot prose-only'),
        comment(2, 'marcusrbrown', `<!-- ${MARKER_PREFIX}{"hash":"x","snapshot":{"items":[]}} -->`),
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
    const result = decideComment(baseSnapshot, hash, null, [])

    expect(result.should_comment).toBe(true)
    expect(result.reason).toMatch(/cold start/i)
    expect(result.hash).toBe(hash)
    expect(result.snapshot).toEqual(baseSnapshot)
  })

  it('same hash as previous marker => should_comment:false with no gating transition reason', () => {
    const hash = hashSnapshot(baseSnapshot)
    const previousMarker: MarkerData = {hash, last_mention_id: 0}

    const result = decideComment(baseSnapshot, hash, previousMarker, [])

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
    const previousMarker: MarkerData = {hash: oldHash, last_mention_id: 0}

    const result = decideComment(newSnapshot, newHash, previousMarker, [])

    expect(result.should_comment).toBe(true)
    expect(result.hash).toBe(newHash)
    expect(result.snapshot).toEqual(newSnapshot)
  })

  it('returns hash and snapshot in result regardless of should_comment value', () => {
    const hash = hashSnapshot(baseSnapshot)
    const previousMarker: MarkerData = {hash, last_mention_id: 0}

    const result = decideComment(baseSnapshot, hash, previousMarker, [])

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

// ─── Live reads through gh ────────────────────────────────────────────────────

// Fake `gh` that answers `gh api` by endpoint so the live reads run for real: tracker comments come
// from a fixture file as one JSON object per line (what the script's `--jq` produces), releases and
// deploy runs from env. An endpoint the preflight is not expected to read fails the call.
const FAKE_GH = [
  '#!/bin/sh',
  'if [ "$1" != api ]; then echo "unexpected gh command: $*" >&2; exit 1; fi',
  // A repository visibility read: `gh api repos/<owner>/<repo> --jq .visibility`. It is answered before the
  // blanket API failure below, so a test can fail the signal reads and leave the visibility reads alone.
  'case "$2" in',
  '  repos/*/*/*) ;;',
  '  repos/*/*)',
  '    name=$(echo "$2" | sed "s#^repos/##")',
  '    echo "$name" >> "$FAKE_GH_VISIBILITY_LOG"',
  '    case " $FAKE_GH_VIS_NOTFOUND " in *" $name "*) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;; esac',
  '    case " $FAKE_GH_VIS_ERROR " in *" $name "*) echo "gh: Bad Gateway (HTTP 502)" >&2; exit 1 ;; esac',
  '    case " $FAKE_GH_VIS_NETWORK " in *" $name "*) echo "error connecting to api.github.com" >&2; exit 1 ;; esac',
  '    case " $FAKE_GH_VIS_PRIVATE " in *" $name "*) echo private; exit 0 ;; esac',
  '    case " $FAKE_GH_VIS_INTERNAL " in *" $name "*) echo internal; exit 0 ;; esac',
  '    case " $FAKE_GH_VIS_GARBLED " in *" $name "*) echo; exit 0 ;; esac',
  '    echo public; exit 0 ;;',
  'esac',
  'case "$*" in',
  '  *--paginate*repos/fro-bot/.github/issues/3512/comments*)',
  '    [ -n "$FAKE_GH_FAIL" ] && { echo "HTTP 502" >&2; exit 1; }',
  '    cat "$FAKE_GH_COMMENTS_FILE"; exit 0 ;;',
  'esac',
  '[ -n "$FAKE_GH_API_FAIL" ] && { echo "HTTP 502" >&2; exit 1; }',
  'case "$2" in',
  '  repos/fro-bot/agent/releases/latest) printf "%s" "$FAKE_GH_AGENT_RELEASE" ;;',
  '  repos/fro-bot/dashboard/releases/latest) printf "%s" "$FAKE_GH_DASHBOARD_RELEASE" ;;',
  '  repos/marcusrbrown/infra/actions/workflows/deploy-gateway.yaml/runs*) printf "%s" "$FAKE_GH_GATEWAY_RUNS" ;;',
  '  repos/marcusrbrown/infra/actions/workflows/deploy-dashboard.yaml/runs*) printf "%s" "$FAKE_GH_DASHBOARD_RUNS" ;;',
  '  repos/marcusrbrown/infra/actions/workflows/deploy.yaml/runs*) printf "%s" "$FAKE_GH_ROUTER_RUNS" ;;',
  '  *) echo "unexpected endpoint: $2" >&2; exit 1 ;;',
  'esac',
].join('\n')

interface FakeGhParams {
  items: ProjectItem[]
  issues: IssueState[]
  comments?: TrackerComment[]
  /** Raw comment lines, for a payload the script must reject. */
  rawCommentLines?: string
  fail?: boolean
  apiFail?: boolean
  agentRelease?: unknown
  gatewayRuns?: unknown
  /** Repositories whose visibility read answers private, internal, 404, 502, a network error or nothing. */
  visibility?: {
    private?: string[]
    internal?: string[]
    notFound?: string[]
    error?: string[]
    network?: string[]
    garbled?: string[]
  }
}

function runCliWithFakeGh(params: FakeGhParams): CliResult & {visibilityReads: string[]} {
  const dir = mkdtempSync(join(tmpdir(), 'rollout-tracker-gh-'))
  try {
    writeFileSync(join(dir, 'gh'), FAKE_GH)
    chmodSync(join(dir, 'gh'), 0o755)
    const commentsFile = join(dir, 'comments.ndjson')
    const lines =
      params.rawCommentLines ??
      (params.comments ?? [])
        .map(entry => JSON.stringify({id: entry.id, login: entry.author.login, body: entry.body}))
        .join('\n')
    writeFileSync(commentsFile, lines)
    const visibilityLog = join(dir, 'visibility.log')
    writeFileSync(visibilityLog, '')
    const visibility = params.visibility ?? {}
    const result = runCliRaw({
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      FAKE_GH_COMMENTS_FILE: commentsFile,
      FAKE_GH_VISIBILITY_LOG: visibilityLog,
      FAKE_GH_VIS_PRIVATE: (visibility.private ?? []).join(' '),
      FAKE_GH_VIS_INTERNAL: (visibility.internal ?? []).join(' '),
      FAKE_GH_VIS_NOTFOUND: (visibility.notFound ?? []).join(' '),
      FAKE_GH_VIS_ERROR: (visibility.error ?? []).join(' '),
      FAKE_GH_VIS_NETWORK: (visibility.network ?? []).join(' '),
      FAKE_GH_VIS_GARBLED: (visibility.garbled ?? []).join(' '),
      ROLLOUT_TRACKER_VISIBILITY_JSON: undefined,
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
    return {
      ...result,
      visibilityReads: readFileSync(visibilityLog, 'utf8')
        .split('\n')
        .filter(line => line !== ''),
    }
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
}

describe('rollout-tracker-snapshot live comment fetch', () => {
  const items = [makeProjectItem({content_number: 24, content_repo: 'fro-bot/dashboard'})]
  const issues = [makeIssueState({number: 24, repo: 'fro-bot/dashboard', state: 'open'})]

  it('finds the prior marker in a comment payload over 1 MiB and stays quiet with an unchanged hash', () => {
    const seeded = runCliFixture({items, issues})
    const padding = comment(1, 'fro-bot', 'x'.repeat(1_200_000))
    const comments = [padding, comment(2, 'fro-bot', `@fro-bot seeded\n${seeded.marker}`)]
    expect(JSON.stringify(comments).length).toBeGreaterThan(1024 * 1024)

    const result = runCliWithFakeGh({items, issues, comments})

    expect(result.status).toBe(0)
    const decision = JSON.parse(result.stdout) as PreflightResult
    expect(decision.should_comment).toBe(false)
    expect(decision.reason).toContain('no gating transition')
    expect(decision.hash).toBe(seeded.hash)
  })

  it('exits non-zero instead of treating a failed comment fetch as a cold start', () => {
    const result = runCliWithFakeGh({items, issues, comments: [], fail: true})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('failed to fetch tracker comments')
  })

  it('exits non-zero when the comment payload has an unexpected shape', () => {
    const result = runCliWithFakeGh({items, issues, rawCommentLines: '{"id":"IC_node","login":"fro-bot","body":"x"}'})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('failed to fetch tracker comments')
  })

  it('reads the pending mentions from the live comment fetch', () => {
    const seeded = runCliFixture({items, issues})
    const comments = [
      comment(10, 'fro-bot', seeded.marker),
      comment(11, 'marcusrbrown', '@fro-bot dashboard 2026.10.68 is live'),
    ]

    const result = runCliWithFakeGh({items, issues, comments})

    expect(result.status).toBe(0)
    const decision = JSON.parse(result.stdout) as PreflightResult
    expect(decision.should_comment).toBe(true)
    expect(decision.pending_mention_ids).toEqual([11])
    expect(decision.last_mention_id).toBe(11)
  })
})

describe('rollout-tracker-snapshot live external signal reads', () => {
  const items = [makeProjectItem({content_number: 24, content_repo: 'fro-bot/dashboard'})]
  const issues = [makeIssueState({number: 24, repo: 'fro-bot/dashboard', state: 'open'})]

  it('reads releases and deploy runs through gh api and records them in the snapshot', () => {
    const result = runCliWithFakeGh({items, issues})

    expect(result.status).toBe(0)
    const decision = JSON.parse(result.stdout) as PreflightResult
    expect(decision.snapshot.external).toEqual(EXTERNAL)
  })

  it('exits non-zero with empty stdout when gh api fails', () => {
    const result = runCliWithFakeGh({items, issues, apiFail: true})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('FATAL')
    expect(result.stderr).toContain('external signals')
  })

  it('exits non-zero when no successful deploy run exists', () => {
    const result = runCliWithFakeGh({items, issues, gatewayRuns: {workflow_runs: []}})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('deploy-gateway.yaml has no successful run')
  })

  it('exits non-zero when a release has an empty tag', () => {
    const result = runCliWithFakeGh({items, issues, agentRelease: {tag_name: ''}})

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
    const legacyMarker = {hash: 'a'.repeat(64), snapshot: {items: []}}
    const body = `<!-- ${MARKER_PREFIX}${JSON.stringify(legacyMarker)} -->`
    const previous = extractPreviousMarker(body)
    const snapshot = buildSnapshot(items, issues, EXTERNAL)

    const decision = decideComment(snapshot, hashSnapshot(snapshot), previous, [])

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
      const decision = JSON.parse(result.stdout) as PreflightResult
      expect(decision.snapshot.external).toEqual(EXTERNAL)
      expect(decision.hash).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })
})

const execFileAsync = promisify(execFile)

/** Like `runCliRaw`, but async so a server in this process can answer while the CLI runs. */
async function runCliRawAsync(env: Record<string, string | undefined>): Promise<CliResult> {
  const scriptPath = resolve(import.meta.dirname, '../../../scripts/rollout-tracker-snapshot.ts')
  try {
    const {stdout} = await execFileAsync('node', [scriptPath], {
      encoding: 'utf8',
      env: {...process.env, ...env},
      maxBuffer: 16 * 1024 * 1024,
    })
    return {status: 0, stdout, stderr: ''}
  } catch (error) {
    const failure = error as {code?: number; stdout?: string; stderr?: string}
    return {status: failure.code ?? 1, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? '')}
  }
}

describe('health endpoint read', () => {
  const items = [makeProjectItem({content_number: 24, content_repo: 'fro-bot/dashboard'})]
  const issues = [makeIssueState({number: 24, repo: 'fro-bot/dashboard', state: 'open'})]
  const servers: ReturnType<typeof createServer>[] = []

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        async server =>
          new Promise<void>(done => {
            server.close(() => {
              done()
            })
          }),
      ),
    )
  })

  async function serve(status: number, body: string): Promise<string> {
    const server = createServer((_request, response) => {
      response.statusCode = status
      response.setHeader('content-type', 'application/json')
      response.end(body)
    })
    servers.push(server)
    await new Promise<void>(ready => {
      server.listen(0, '127.0.0.1', () => {
        ready()
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server has no port')
    return `http://127.0.0.1:${address.port}/operator/health`
  }

  function liveHealthEnv(url: string): Record<string, string | undefined> {
    return {...fixtureEnv({items, issues}), ROLLOUT_TRACKER_HEALTH_JSON: undefined, ROLLOUT_TRACKER_HEALTH_URL: url}
  }

  it('reads the contract version from the configured endpoint', async () => {
    const url = await serve(200, JSON.stringify({ok: true, contractVersion: '1.14.0'}))

    const result = await runCliRawAsync(liveHealthEnv(url))

    expect(result.status).toBe(0)
    expect((JSON.parse(result.stdout) as PreflightResult).snapshot.external.contract_version).toBe('1.14.0')
  })

  it('fails closed on a 503', async () => {
    const url = await serve(503, '{"ok":false}')

    const result = await runCliRawAsync(liveHealthEnv(url))

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('FATAL')
    expect(result.stderr).toContain('HTTP 503')
  })

  it('fails closed on a 200 with no contract version', async () => {
    const url = await serve(200, '{"ok":true}')

    const result = await runCliRawAsync(liveHealthEnv(url))

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('health contractVersion is missing or empty')
  })

  it('fails closed when nothing is listening', async () => {
    const url = await serve(200, '{}')
    await new Promise<void>(closed => {
      servers.pop()?.close(() => {
        closed()
      })
    })

    const result = await runCliRawAsync(liveHealthEnv(url))

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('FATAL')
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

// ─── Pending operator mentions ────────────────────────────────────────────────

describe('scanOperatorMentions', () => {
  const mention = (id: number): TrackerComment => comment(id, 'marcusrbrown', `@fro-bot claim ${id}`)
  const marked = (lastMentionId: number | null): MarkerData => ({
    hash: 'h',
    last_mention_id: lastMentionId,
  })
  const markerComment = (id: number, fields: string): TrackerComment =>
    comment(id, 'fro-bot', `answered\n<!-- ${MARKER_PREFIX}{"hash":"h"${fields}} -->`)

  it('marks an operator @fro-bot comment above the last answered ID as pending', () => {
    expect(scan([mention(105)], marked(100))).toEqual({pendingIds: [105], lastMentionId: 105})
  })

  it('does not mark a mention at or below the last answered ID as pending', () => {
    expect(scan([mention(99), mention(100)], marked(100))).toEqual({pendingIds: [], lastMentionId: 100})
  })

  it('marks a mention pending even when thread order puts it before the latest marker comment', () => {
    const comments = [mention(101), markerComment(103, ',"last_mention_id":100')]

    // The operator comment (101) was posted while the run that wrote comment 103 was in flight.
    expect(scan(comments, marked(100)).pendingIds).toEqual([101])
  })

  it('keeps a mention that precedes a marker with last_mention_id 0 pending', () => {
    const comments = [mention(101), markerComment(103, ',"last_mention_id":0')]

    expect(scan(comments, marked(0)).pendingIds).toEqual([101])
  })

  describe('a damaged latest marker', () => {
    it('keeps the highest valid last_mention_id from an earlier marker comment', () => {
      const comments = [
        markerComment(1, ',"last_mention_id":3000'),
        mention(3010),
        markerComment(3020, ',"last_mention_id":"3010"'),
      ]
      const latest = extractPreviousMarker(comments[2]?.body ?? '')

      expect(latest?.last_mention_id).toBeNull()
      expect(scan(comments, latest)).toEqual({pendingIds: [3010], lastMentionId: 3010})
    })

    it('does the same when the latest marker has no last_mention_id at all', () => {
      const comments = [markerComment(1, ',"last_mention_id":3000'), mention(3010), markerComment(3020, '')]

      expect(scan(comments, extractPreviousMarker(comments[2]?.body ?? '')).pendingIds).toEqual([3010])
    })

    it('uses the highest valid value when several markers carry one', () => {
      const comments = [
        markerComment(1, ',"last_mention_id":3000'),
        markerComment(2, ',"last_mention_id":3500'),
        mention(3400),
        mention(3600),
        markerComment(3, ',"last_mention_id":"x"'),
      ]

      expect(scan(comments, extractPreviousMarker(comments[4]?.body ?? '')).pendingIds).toEqual([3600])
    })

    it('falls back to the position rule only when no marker carries a valid value', () => {
      const comments = [mention(1), markerComment(2, ',"last_mention_id":"x"'), mention(3)]

      expect(scan(comments, extractPreviousMarker(comments[1]?.body ?? '')).pendingIds).toEqual([3])
    })
  })

  describe('a marker without last_mention_id', () => {
    const legacy = (): TrackerComment[] => [
      mention(7),
      comment(8, 'fro-bot', 'prose-only follow-up'),
      mention(9),
      markerComment(10, ''),
      mention(11),
      mention(12),
    ]

    it('takes the highest mention before the latest fro-bot comment as the baseline', () => {
      expect(scan(legacy(), marked(null))).toEqual({pendingIds: [11, 12], lastMentionId: 12})
    })

    it('leaves nothing pending when no mention follows the latest fro-bot comment', () => {
      expect(scan(legacy().slice(0, 4), marked(null))).toEqual({pendingIds: [], lastMentionId: 9})
    })

    it('counts a fro-bot reply without a marker as answering the mentions before it', () => {
      const comments = [
        mention(7),
        markerComment(8, ''),
        mention(9),
        mention(10),
        comment(11, 'fro-bot', '@marcusrbrown answered without a marker'),
        mention(12),
      ]

      expect(scan(comments, marked(null))).toEqual({pendingIds: [12], lastMentionId: 12})
    })

    it('counts a fro-bot[bot] comment of any kind the same way', () => {
      const comments = [markerComment(1, ''), mention(2), comment(3, 'fro-bot[bot]', 'plain reply'), mention(4)]

      expect(scan(comments, marked(null))).toEqual({pendingIds: [4], lastMentionId: 4})
    })

    it('keeps a mention pending when only other authors comment after it', () => {
      const comments = [markerComment(1, ''), mention(2), comment(3, 'octocat', 'unrelated')]

      expect(scan(comments, marked(null))).toEqual({pendingIds: [2], lastMentionId: 2})
    })

    it('anchors on the latest marker comment, not an earlier one', () => {
      const comments = [mention(1), markerComment(2, ''), mention(3), markerComment(4, ''), mention(5)]

      expect(scan(comments, marked(null))).toEqual({pendingIds: [5], lastMentionId: 5})
    })

    it('treats an invalid last_mention_id the same way', () => {
      const comments = [mention(1), markerComment(2, ',"last_mention_id":"7"'), mention(3)]
      const previous = extractPreviousMarker(comments[1]?.body ?? '')

      expect(previous?.last_mention_id).toBeNull()
      expect(scan(comments, previous)).toEqual({pendingIds: [3], lastMentionId: 3})
    })
  })

  describe('a thread with no marker', () => {
    it('leaves a mention after the last fro-bot comment pending', () => {
      const comments = [mention(7), comment(8, 'fro-bot', 'prose-only reply'), mention(9)]

      expect(scan(comments, null)).toEqual({pendingIds: [9], lastMentionId: 9})
    })

    it('counts a mention before the last fro-bot comment as answered and stays at the baseline', () => {
      const comments = [mention(7), mention(9), comment(10, 'fro-bot[bot]', 'prose-only reply')]

      expect(scan(comments, null)).toEqual({pendingIds: [], lastMentionId: 9})
    })

    it('leaves every operator mention pending when fro-bot never commented', () => {
      expect(scan([mention(7), mention(9), mention(8)], null)).toEqual({
        pendingIds: [7, 8, 9],
        lastMentionId: 9,
      })
    })

    it('has nothing pending and a zero baseline when the thread has no operator mention', () => {
      expect(scan([comment(1, 'octocat', 'hello')], null)).toEqual({pendingIds: [], lastMentionId: 0})
    })
  })

  describe('the dispatching comment', () => {
    it('is not pending when the comment list lacks it, because nothing shows who wrote it or where', () => {
      expect(scan([mention(100)], marked(100), 105)).toEqual({pendingIds: [], lastMentionId: 100})
    })

    it('is listed once when the comment list already carries it', () => {
      expect(scan([mention(105)], marked(100), 105)).toEqual({pendingIds: [105], lastMentionId: 105})
    })

    it('is ignored when at or below the baseline, because it is already acknowledged', () => {
      expect(scan([mention(100)], marked(100), 100)).toEqual({pendingIds: [], lastMentionId: 100})
      expect(scan([mention(100)], marked(100), 90)).toEqual({pendingIds: [], lastMentionId: 100})
    })

    it('joins the pending mentions in ascending order', () => {
      expect(scan([mention(103), mention(101), mention(102)], marked(100), 102).pendingIds).toEqual([101, 102, 103])
    })
  })

  describe('an authorized trigger', () => {
    const edited = (id: number): {id: number; event: CommentEvent} => ({id, event: 'edited'})
    const created = (id: number): {id: number; event: CommentEvent} => ({id, event: 'created'})
    const plain = (id: number): TrackerComment => comment(id, 'marcusrbrown', `G4c pass ${id}`)

    it('makes an operator edit below the baseline pending, and leaves last_mention_id at the baseline', () => {
      expect(scan([plain(50), mention(100)], marked(100), edited(50))).toEqual({pendingIds: [50], lastMentionId: 100})
    })

    it('makes an operator edit of the last answered comment pending', () => {
      expect(scan([mention(100)], marked(100), edited(100))).toEqual({pendingIds: [100], lastMentionId: 100})
    })

    it('makes an operator edit above the baseline pending without a mention and advances last_mention_id', () => {
      expect(scan([plain(105)], marked(100), edited(105))).toEqual({pendingIds: [105], lastMentionId: 105})
    })

    it('joins an edit with the pending mentions in ascending order', () => {
      expect(scan([plain(50), mention(101), mention(102)], marked(100), edited(50)).pendingIds).toEqual([50, 101, 102])
    })

    it('ignores a third party edit, whatever it says', () => {
      const stranger = comment(50, 'octocat', '@fro-bot G4c pass')

      expect(scan([stranger, mention(100)], marked(100), edited(50))).toEqual({pendingIds: [], lastMentionId: 100})
    })

    it('ignores the bot editing its own comment', () => {
      const own = comment(50, 'fro-bot', '@fro-bot reply')

      expect(scan([own, mention(100)], marked(100), edited(50)).pendingIds).toEqual([])
    })

    it('ignores an edit of a comment the list does not carry, as one posted on another issue', () => {
      expect(scan([mention(100)], marked(100), edited(50)).pendingIds).toEqual([])
    })

    it('ignores a created operator comment with no mention, even above the baseline', () => {
      expect(scan([plain(105)], marked(100), created(105)).pendingIds).toEqual([])
    })

    it('treats a trigger with no event kind like a created comment', () => {
      expect(scan([plain(105)], marked(100), 105).pendingIds).toEqual([])
      expect(scan([mention(105)], marked(100), 105).pendingIds).toEqual([105])
    })

    it('ignores an operator login that carries the wrong numeric user ID', () => {
      const spoof: TrackerComment = {id: 50, author: {login: 'marcusrbrown', id: 1}, body: 'G4c pass'}

      expect(scan([spoof, mention(100)], marked(100), edited(50)).pendingIds).toEqual([])
    })

    it('accepts the operator with the matching numeric user ID', () => {
      const genuine: TrackerComment = {id: 50, author: {login: 'marcusrbrown', id: 831617}, body: 'G4c pass'}

      expect(scan([genuine, mention(100)], marked(100), edited(50)).pendingIds).toEqual([50])
    })
  })

  it('lists pending IDs ascending and never lowers last_mention_id', () => {
    expect(scan([mention(30), mention(20)], marked(25))).toEqual({pendingIds: [30], lastMentionId: 30})
    expect(scan([], marked(25))).toEqual({pendingIds: [], lastMentionId: 25})
  })

  it('ignores a comment without @fro-bot, one by another author, and bot replies', () => {
    expect(
      scan(
        [
          comment(11, 'marcusrbrown', 'acceptance run green'),
          comment(12, 'octocat', '@fro-bot please look'),
          comment(13, 'fro-bot', '@fro-bot prose-only follow-up'),
        ],
        marked(0),
      ),
    ).toEqual({pendingIds: [], lastMentionId: 0})
  })

  it('matches the mention case-insensitively, like the hop gate', () => {
    expect(scan([comment(5, 'marcusrbrown', 'ping @Fro-Bot')], marked(0)).pendingIds).toEqual([5])
  })
})

describe('marker round trip', () => {
  const items = [
    makeProjectItem({content_number: 24, content_repo: 'fro-bot/dashboard', gate: 'blocked --> see <b>&</b>'}),
  ]
  const issues = [makeIssueState({number: 24, repo: 'fro-bot/dashboard', state: 'open'})]
  const snapshot = buildSnapshot(items, issues, EXTERNAL)
  const hash = hashSnapshot(snapshot)

  it('keeps text containing --> from closing the HTML comment', () => {
    const hostile = 'blocked --> see <b>&</b>'
    const marker = buildMarker(hostile, 4321)

    const inner = marker.slice('<!-- '.length, -' -->'.length)

    expect(marker.split('-->').length - 1).toBe(1)
    expect(marker.endsWith(' -->')).toBe(true)
    expect(inner).not.toMatch(/[<>&]/)
    expect(inner).toContain(String.raw`\u003e`)
    expect(extractPreviousMarker(marker)?.hash).toBe(hostile)
  })

  it('round-trips the hash and last_mention_id through extractPreviousMarker', () => {
    const parsed = extractPreviousMarker(`reply text\n${buildMarker(hash, 4321)}`)

    expect(parsed).toEqual({hash, last_mention_id: 4321})
  })

  it('reads an absent or invalid last_mention_id as null and keeps a valid 0', () => {
    for (const lastMentionId of ['', '"7"', '-3', '1.5', 'null']) {
      const extra = lastMentionId === '' ? '' : `,"last_mention_id":${lastMentionId}`
      const parsed = extractPreviousMarker(`<!-- ${MARKER_PREFIX}{"hash":"abc"${extra}} -->`)

      expect(parsed?.last_mention_id).toBeNull()
    }
    expect(extractPreviousMarker(`<!-- ${MARKER_PREFIX}{"hash":"abc","last_mention_id":0} -->`)?.last_mention_id).toBe(
      0,
    )
  })

  it('gates on the hash alone when the snapshot is not an object', () => {
    const stringSnapshot = extractPreviousMarker(`<!-- ${MARKER_PREFIX}{"hash":"${hash}","snapshot":"opaque"} -->`)
    const noSnapshot = extractPreviousMarker(`<!-- ${MARKER_PREFIX}{"hash":"${hash}"} -->`)

    expect(stringSnapshot?.hash).toBe(hash)
    expect(noSnapshot?.hash).toBe(hash)
    expect(decideComment(snapshot, hash, stringSnapshot, []).should_comment).toBe(false)
    expect(decideComment(snapshot, hash, noSnapshot, []).should_comment).toBe(false)
  })

  it('still rejects a marker with no string hash', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(extractPreviousMarker(`<!-- ${MARKER_PREFIX}{"snapshot":{"items":[]}} -->`)).toBeNull()
    expect(extractPreviousMarker(`<!-- ${MARKER_PREFIX}{"hash":7} -->`)).toBeNull()
    stderrSpy.mockRestore()
  })
})

describe('decideComment with pending operator mentions', () => {
  const snapshot = buildSnapshot([makeProjectItem()], [makeIssueState()], EXTERNAL)
  const hash = hashSnapshot(snapshot)
  const previous: MarkerData = {hash, last_mention_id: 0}

  it('wakes with an unchanged hash and says why', () => {
    const decision = decideComment(snapshot, hash, previous, [41])

    expect(decision.should_comment).toBe(true)
    expect(decision.reason).toContain('operator mention pending')
    expect(decision.hash).toBe(hash)
  })

  it('names the pending mentions when the hash also changed', () => {
    const decision = decideComment(snapshot, hash, {...previous, hash: 'b'.repeat(64)}, [41, 42])

    expect(decision.should_comment).toBe(true)
    expect(decision.reason).toContain('hash changed')
    expect(decision.reason).toContain('operator mention pending (2)')
  })

  it('stays quiet when nothing changed and nothing is pending', () => {
    expect(decideComment(snapshot, hash, previous, []).should_comment).toBe(false)
  })
})

describe('pending operator mentions through the CLI', () => {
  const items = [makeProjectItem({content_number: 24, content_repo: 'fro-bot/dashboard'})]
  const issues = [makeIssueState({number: 24, repo: 'fro-bot/dashboard', state: 'open'})]

  it('wakes on an unanswered mention, then goes quiet once the marker carries its ID', () => {
    const seeded = runCliFixture({items, issues})
    const reply = comment(100, 'fro-bot', `@fro-bot seeded\n${seeded.marker}`)
    const mention = comment(101, 'marcusrbrown', '@fro-bot dashboard 2026.10.68 is live')

    const quiet = runCliFixture({items, issues, comments: [reply]})
    expect(quiet.should_comment).toBe(false)
    expect(quiet.pending_mention_ids).toEqual([])

    const pending = runCliFixture({items, issues, comments: [reply, mention]})
    expect(pending.should_comment).toBe(true)
    expect(pending.reason).toContain('operator mention pending')
    expect(pending.pending_mention_ids).toEqual([101])
    expect(pending.last_mention_id).toBe(101)
    expect(pending.hash).toBe(seeded.hash)

    const answered = runCliFixture({
      items,
      issues,
      comments: [reply, mention, comment(102, 'fro-bot', `answered\n${pending.marker}`)],
    })
    expect(answered.should_comment).toBe(false)
    expect(answered.pending_mention_ids).toEqual([])
    expect(answered.last_mention_id).toBe(101)
    expect(answered.hash).toBe(seeded.hash)
  })

  it('keeps a mention that lands during a run pending although it precedes the run marker in the thread', () => {
    const seeded = runCliFixture({items, issues})
    const first = comment(100, 'marcusrbrown', '@fro-bot first')
    const firstRun = runCliFixture({items, issues, comments: [first]})
    const midRun = comment(101, 'marcusrbrown', '@fro-bot second, posted while the run was in flight')
    // The run's marker comment (102) is later in the thread than the mid-run mention (101).
    const runReply = comment(102, 'fro-bot', `answered\n${firstRun.marker}`)

    const next = runCliFixture({items, issues, comments: [first, midRun, runReply]})

    expect(seeded.hash).toBe(firstRun.hash)
    expect(next.should_comment).toBe(true)
    expect(next.pending_mention_ids).toEqual([101])
  })

  it('migrates a legacy marker by position: only mentions after the latest fro-bot comment are pending, and the new marker covers the earlier ones', () => {
    const seeded = runCliFixture({items, issues})
    const legacyMarker = `<!-- ${MARKER_PREFIX}${JSON.stringify({hash: seeded.hash, snapshot: seeded.snapshot})} -->`
    const comments = [
      comment(1, 'marcusrbrown', '@fro-bot old claim'),
      comment(2, 'marcusrbrown', '@fro-bot older claim'),
      comment(3, 'fro-bot', legacyMarker),
      comment(4, 'marcusrbrown', '@fro-bot newer claim'),
    ]

    const result = runCliFixture({items, issues, comments})

    expect(result.should_comment).toBe(true)
    expect(result.pending_mention_ids).toEqual([4])
    expect(result.last_mention_id).toBeGreaterThanOrEqual(2)
    expect(result.last_mention_id).toBe(4)
    expect(extractPreviousMarker(result.marker)?.last_mention_id).toBe(4)
  })

  it('counts a markerless fro-bot reply after a legacy marker as answering the mentions before it', () => {
    const seeded = runCliFixture({items, issues})
    const legacyMarker = `<!-- ${MARKER_PREFIX}${JSON.stringify({hash: seeded.hash, snapshot: seeded.snapshot})} -->`

    const result = runCliFixture({
      items,
      issues,
      comments: [
        comment(1, 'fro-bot', legacyMarker),
        comment(2, 'marcusrbrown', '@fro-bot answered by the general reply job'),
        comment(3, 'fro-bot', 'general reply with no marker'),
        comment(4, 'marcusrbrown', '@fro-bot genuinely new'),
      ],
    })

    expect(result.pending_mention_ids).toEqual([4])
    expect(result.last_mention_id).toBe(4)
  })

  it('leaves a legacy marker with no later mention quiet and records the pre-marker baseline', () => {
    const seeded = runCliFixture({items, issues})
    const legacyMarker = `<!-- ${MARKER_PREFIX}${JSON.stringify({hash: seeded.hash, snapshot: seeded.snapshot})} -->`

    const result = runCliFixture({
      items,
      issues,
      comments: [comment(1, 'marcusrbrown', '@fro-bot old claim'), comment(2, 'fro-bot', legacyMarker)],
    })

    expect(result.should_comment).toBe(false)
    expect(result.pending_mention_ids).toEqual([])
    expect(result.last_mention_id).toBe(1)
  })

  it('leaves a request after the last fro-bot comment pending when no marker exists', () => {
    const result = runCliFixture({
      items,
      issues,
      comments: [
        comment(1, 'marcusrbrown', '@fro-bot old claim'),
        comment(2, 'fro-bot', 'prose-only reply'),
        comment(3, 'marcusrbrown', '@fro-bot unanswered claim'),
      ],
    })

    expect(result.should_comment).toBe(true)
    expect(result.pending_mention_ids).toEqual([3])
    expect(result.last_mention_id).toBe(3)
  })

  it('leaves every request pending when fro-bot never commented', () => {
    const result = runCliFixture({
      items,
      issues,
      comments: [comment(1, 'marcusrbrown', '@fro-bot first'), comment(2, 'marcusrbrown', '@fro-bot second')],
    })

    expect(result.pending_mention_ids).toEqual([1, 2])
    expect(result.last_mention_id).toBe(2)
  })

  describe('queued dispatches', () => {
    const quiet = runCliFixture({items, issues})
    const reply = comment(100, 'fro-bot', quiet.marker)
    const a = comment(101, 'marcusrbrown', '@fro-bot claim A')
    const b = comment(102, 'marcusrbrown', '@fro-bot claim B')

    it('answers both A and B in the run dispatched for A when both exist before its preflight', () => {
      const runA = runCliFixture({items, issues, comments: [reply, a, b], triggerCommentId: '101'})

      expect(runA.should_comment).toBe(true)
      expect(runA.pending_mention_ids).toEqual([101, 102])
      expect(runA.last_mention_id).toBe(102)
    })

    it('finds nothing pending in the run dispatched for B once A answered both', () => {
      const answeredByA = comment(103, 'fro-bot', runCliFixture({items, issues, comments: [reply, a, b]}).marker)

      const runB = runCliFixture({items, issues, comments: [reply, a, b, answeredByA], triggerCommentId: '102'})

      expect(runB.should_comment).toBe(false)
      expect(runB.pending_mention_ids).toEqual([])
      expect(runB.last_mention_id).toBe(102)
    })

    it('does not treat a dispatching comment the comment list lacks as pending', () => {
      const lagging = runCliFixture({items, issues, comments: [reply], triggerCommentId: '500'})

      expect(lagging.should_comment).toBe(false)
      expect(lagging.pending_mention_ids).toEqual([])
      expect(lagging.last_mention_id).toBe(0)
    })

    it('does not treat a third party comment as pending because a run was dispatched for it', () => {
      const stranger = comment(101, 'octocat', '@fro-bot G4c pass')

      const result = runCliFixture({items, issues, comments: [reply, stranger], triggerCommentId: '101'})

      expect(result.should_comment).toBe(false)
      expect(result.pending_mention_ids).toEqual([])
    })

    it('wakes for an operator edit below the baseline and answers only that comment', () => {
      const old = comment(90, 'marcusrbrown', 'G2c pass, edited')
      const marker = comment(100, 'fro-bot', buildMarker(quiet.hash, 100))

      const result = runCliFixture({
        items,
        issues,
        comments: [old, marker],
        triggerCommentId: '90',
        triggerCommentEvent: 'edited',
      })

      expect(result.should_comment).toBe(true)
      expect(result.reason).toContain('operator mention pending (1)')
      expect(result.pending_mention_ids).toEqual([90])
      expect(result.hash).toBe(quiet.hash)
    })

    it('does not wake for the same comment id when the event is a created comment without a mention', () => {
      const old = comment(90, 'marcusrbrown', 'G2c pass')
      const marker = comment(100, 'fro-bot', buildMarker(quiet.hash, 100))

      const result = runCliFixture({
        items,
        issues,
        comments: [old, marker],
        triggerCommentId: '90',
        triggerCommentEvent: 'created',
      })

      expect(result.should_comment).toBe(false)
    })

    it.each(['edit', 'EDITED', 'created;ls', '1'])('fails closed on the comment event %j', event => {
      const result = runCliRaw({
        ...fixtureEnv({items, issues, comments: [reply]}),
        ROLLOUT_TRACKER_COMMENT_EVENT: event,
      })

      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe(
        'rollout-tracker-snapshot: FATAL — ROLLOUT_TRACKER_COMMENT_EVENT must be created, edited or empty\n',
      )
    })

    it('does not wake for an empty comment ID with nothing else pending', () => {
      expect(runCliFixture({items, issues, comments: [reply], triggerCommentId: ''}).should_comment).toBe(false)
    })

    it('fails closed on a non-numeric dispatching comment ID', () => {
      const result = runCliRaw({...fixtureEnv({items, issues, comments: [reply]}), ROLLOUT_TRACKER_COMMENT_ID: '12;ls'})

      expect(result.status).not.toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('ROLLOUT_TRACKER_COMMENT_ID must be numeric')
    })
  })

  it('reports the ID of the latest marker comment, and null without one', () => {
    const seeded = runCliFixture({items, issues})

    const withMarker = runCliFixture({
      items,
      issues,
      comments: [
        comment(10, 'fro-bot', seeded.marker),
        comment(11, 'marcusrbrown', 'a note'),
        comment(12, 'fro-bot', seeded.marker),
        comment(13, 'fro-bot', 'prose-only reply'),
      ],
    })
    const withoutMarker = runCliFixture({items, issues, comments: [comment(1, 'marcusrbrown', 'a note')]})

    expect(withMarker.marker_comment_id).toBe(12)
    expect(withoutMarker.marker_comment_id).toBeNull()
  })

  it('anchors on an earlier marker when the latest one is damaged', () => {
    const seeded = runCliFixture({items, issues})
    const earlier = buildMarker(seeded.hash, 3000)
    const damaged = `<!-- ${MARKER_PREFIX}${JSON.stringify({hash: seeded.hash, last_mention_id: '3010'})} -->`

    const result = runCliFixture({
      items,
      issues,
      comments: [
        comment(1, 'fro-bot', earlier),
        comment(3010, 'marcusrbrown', '@fro-bot posted before the damaged marker'),
        comment(3020, 'fro-bot', damaged),
      ],
    })

    expect(result.pending_mention_ids).toEqual([3010])
    expect(result.marker_comment_id).toBe(3020)
  })

  it('reports no pending mention for a body-only fixture', () => {
    const seeded = runCliFixture({items, issues})

    const result = runCliFixture({items, issues, commentBody: `@fro-bot claim\n${seeded.marker}`})

    expect(result.should_comment).toBe(false)
    expect(result.pending_mention_ids).toEqual([])
  })

  it('emits a marker that parses back to the printed hash and last_mention_id', () => {
    const result = runCliFixture({items, issues, comments: [comment(77, 'marcusrbrown', '@fro-bot hi')]})

    const parsed = extractPreviousMarker(result.marker)

    expect(parsed).toEqual({hash: result.hash, last_mention_id: 77})
    expect(result.snapshot.external).toEqual(EXTERNAL)
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
  const workflowPath = resolve(import.meta.dirname, '../../../.github/workflows/gateway-rollout-tracker.yaml')
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

  it('serializes runs per program and never cancels one in progress', () => {
    const wf = parsed as unknown as {concurrency?: {group?: string; 'cancel-in-progress'?: boolean}}
    expect(wf.concurrency?.group).toBe(`program-tracker-${expr("inputs.program || 'fanout'")}`)
    expect(wf.concurrency?.['cancel-in-progress']).toBe(false)
  })

  it('takes the tracker issue and the Project URL from the preflight in the prompt', () => {
    const trackerJob = parsed.jobs['update-rollout-tracker']
    const withPrompt = (trackerJob?.with?.prompt as string | undefined) ?? ''
    expect(withPrompt).toContain(expr('needs.preflight.outputs.tracker_issue'))
    expect(withPrompt).toContain(expr('needs.preflight.outputs.project_url'))
  })

  it('passes the preflight marker into the Fro Bot prompt', () => {
    const trackerJob = parsed.jobs['update-rollout-tracker']
    const withPrompt = (trackerJob?.with?.prompt as string | undefined) ?? ''

    expect(withPrompt).toContain('needs.preflight.outputs.marker')
  })
})

describe('gateway-rollout-tracker.yaml mention mode', () => {
  const workflowPath = resolve(import.meta.dirname, '../../../.github/workflows/gateway-rollout-tracker.yaml')
  const workflow = parse(readFileSync(workflowPath, 'utf8')) as {
    on: {workflow_dispatch?: {inputs?: Record<string, {type?: string; required?: boolean; default?: unknown}>}}
    jobs: Record<string, WorkflowJob>
  }
  const update = workflow.jobs['update-rollout-tracker']
  const prompt = String(update?.with?.prompt ?? '')
  const updateIf = String(update?.if ?? '')

  function updateRuns(context: {preflight: string; shouldComment?: string; commentId?: string}): boolean {
    return evaluateExpression(updateIf, {
      inputs: {comment_id: context.commentId ?? ''},
      needs: {preflight: {result: context.preflight, outputs: {should_comment: context.shouldComment ?? 'false'}}},
    })
  }

  it('defines program, comment_id and comment_event dispatch inputs and no prompt input', () => {
    const inputs = workflow.on.workflow_dispatch?.inputs ?? {}

    expect(Object.keys(inputs)).toEqual(['program', 'comment_id', 'comment_event'])
    expect(inputs.comment_id).toMatchObject({type: 'string', required: false, default: ''})
  })

  it('runs the update job for a mention run whose preflight found it pending', () => {
    expect(updateRuns({preflight: 'success', shouldComment: 'true', commentId: '4301234567'})).toBe(true)
  })

  it('skips the update job for a mention run whose comment is already acknowledged', () => {
    expect(updateRuns({preflight: 'success', shouldComment: 'false', commentId: '4301234567'})).toBe(false)
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

  it('passes the dispatching comment ID to the preflight step', () => {
    const preflight = workflow.jobs.preflight as {steps?: {id?: string; env?: Record<string, string>}[]}
    const env = preflight.steps?.find(step => step.id === 'snapshot')?.env

    expect(env?.ROLLOUT_TRACKER_COMMENT_ID).toBe(expr('inputs.comment_id'))
  })

  it('wires the pending IDs, the marker and the marker comment ID from the preflight step to the prompt', () => {
    const preflight = workflow.jobs.preflight as {
      outputs?: Record<string, string>
      steps?: {id?: string; run?: string}[]
    }
    const run = String(preflight.steps?.find(step => step.id === 'snapshot')?.run ?? '')

    for (const name of ['pending_mention_ids', 'marker', 'marker_comment_id']) {
      expect(preflight.outputs?.[name]).toBe(expr(`steps.snapshot.outputs.${name}`))
      expect(run).toContain(`${name}`)
      expect(prompt).toContain(expr(`needs.preflight.outputs.${name}`))
    }
    expect(run).toContain(`.marker_comment_id // ""`)
  })

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
    // Assertions read the prompt with whitespace collapsed, so YAML line wrapping is not pinned.
    const flat = prompt.replaceAll(/\s+/g, ' ')

    it('receives the comment ID, the pending mention IDs and the preflight result', () => {
      expect(flat).toContain(expr('inputs.comment_id'))
      expect(flat).toContain(expr('needs.preflight.outputs.pending_mention_ids'))
      expect(flat).toContain(expr('needs.preflight.outputs.reason'))
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
        expect(flat).toContain(source)
      }
    })

    it('covers the body, Project 1 and the labelled acceptance list', () => {
      expect(flat).toContain('Rewrite every stale section of the body')
      expect(flat).toContain('Update the Project fields')
      expect(flat).toContain('add any missing dependency items')
      expect(flat).toContain('operator-reported')
      expect(flat).toContain('agent-verified')
    })

    it('lists only the dependencies that are not Done and counts the rest with a Project link', () => {
      expect(flat).toContain('list only the dependencies whose Project status is not Done')
      expect(flat).toContain(
        `one line that counts the Done dependencies and links the full list at ${expr('needs.preflight.outputs.project_url')}`,
      )
      expect(flat).toContain('The Project is the source of truth for every item')
      expect(flat).toContain('Never parse prose tables as state')
    })

    it('measures the body in UTF-8 bytes before each write and gates it at 60,000 and 65,000', () => {
      expect(flat).toContain('Before each write of the body, measure it in UTF-8 bytes')
      expect(flat).toContain('over 60,000 bytes, shorten the oldest prose in "Current state" and "Still open"')
      expect(flat).toContain('Every unmet gate and every open item stays')
      expect(flat).toContain('Never write a body over 65,000 bytes')
      expect(flat).toContain('skip the body write and say so in your tracker comment')
    })

    it('leaves the marker alone when the body write is skipped, so the next run retries', () => {
      expect(flat).toContain(
        'In that case, do not write the new marker and leave the existing marker comment as it is, so the next run wakes and retries',
      )
    })

    it('answers exactly the pending mention IDs, fetching each by ID', () => {
      expect(flat).toContain('Answer exactly the pending mention IDs and no others')
      expect(flat).toContain('fetch each one by ID')
      expect(flat).toContain('for context only')
      expect(flat).not.toContain('plus the')
      expect(flat).toContain(`gh api repos/${expr('needs.preflight.outputs.tracker_repo')}/issues/comments/<id>`)
    })

    it('does not anchor on thread order', () => {
      expect(flat).not.toContain('newer than the latest')
    })

    it('replies once to listed comments and edits the latest marker comment in place when nothing changes', () => {
      expect(flat).toContain(
        `post one reply on ${expr('needs.preflight.outputs.tracker_issue')} that covers all of them`,
      )
      expect(flat).toContain('narrates only that change')
      expect(flat).toContain('do not post a new comment')
      expect(flat).toContain('edit the marker comment in place')
      expect(flat).toContain(
        `gh api -X PATCH repos/${expr('needs.preflight.outputs.tracker_repo')}/issues/comments/<id>`,
      )
      expect(flat).toContain('where <id> is exactly this marker comment ID')
      expect(flat).toContain(expr('needs.preflight.outputs.marker_comment_id'))
      expect(flat).toContain('Replace only the marker in its body')
      expect(flat).toContain('Post a one-line seed comment that ends with the marker only when that ID is empty')
    })

    it('ends every reply and in-place edit with the ready-made marker', () => {
      expect(flat).toContain(
        `End every tracker comment on ${expr('needs.preflight.outputs.tracker_issue')}, and every in-place edit, with this`,
      )
      expect(flat).toContain('Copy it exactly')
      expect(flat).toContain(expr('needs.preflight.outputs.marker'))
      expect(flat).not.toContain('needs.preflight.outputs.hash')
      expect(flat).not.toContain('needs.preflight.outputs.snapshot')
    })
  })
})

// ─── Live Project read: every item, or fail closed ───────────────────────────

// Fake `gh project item-list` that behaves like the real one: it returns at most `--limit` items
// (30 when the flag is absent) out of FAKE_GH_PROJECT_TOTAL, and reports the true `totalCount`.
function fakeProjectGhSource(): string {
  return [
    `#!${process.execPath}`,
    'const args = process.argv.slice(2)',
    "if (args[0] === 'api' && args[1] === 'repos/fro-bot/agent') {",
    String.raw`  process.stdout.write('public\n')`,
    '  process.exit(0)',
    '}',
    "if (args[0] !== 'project' || args[1] !== 'item-list') {",
    "  console.error('unexpected gh command: ' + args.join(' '))",
    '  process.exit(1)',
    '}',
    "const flag = args.indexOf('--limit')",
    'const limit = flag === -1 ? 30 : Number(args[flag + 1])',
    'const total = Number(process.env.FAKE_GH_PROJECT_TOTAL)',
    'const items = Array.from({length: Math.min(total, limit)}, (_, index) => ({',
    "  id: 'PVTI_' + (index + 1),",
    "  content: {number: index + 1, repository: 'fro-bot/agent', type: 'Issue'},",
    "  status: 'In Progress',",
    "  title: 'x'.repeat(Number(process.env.FAKE_GH_PROJECT_PAD ?? 0)),",
    '}))',
    'process.stdout.write(JSON.stringify({items, totalCount: total}))',
  ].join('\n')
}

function runCliWithLiveProject(total: number, padBytes = 0): CliResult {
  const dir = mkdtempSync(join(tmpdir(), 'rollout-tracker-project-'))
  try {
    writeFileSync(join(dir, 'gh'), fakeProjectGhSource())
    chmodSync(join(dir, 'gh'), 0o755)
    return runCliRaw({
      ...fixtureEnv({items: [], issues: []}),
      ROLLOUT_TRACKER_ITEMS_JSON: undefined,
      ROLLOUT_TRACKER_VISIBILITY_JSON: undefined,
      ROLLOUT_TRACKER_COMMENTS_JSON: '[]',
      ROLLOUT_TRACKER_COMMENT_BODY: undefined,
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      FAKE_GH_PROJECT_TOTAL: String(total),
      FAKE_GH_PROJECT_PAD: String(padBytes),
    })
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
}

describe('live Project read covers every item', () => {
  // The read limit the preflight passes to `gh project item-list`; a result of exactly this size
  // may be truncated and must fail closed.
  const readLimit = 1000

  it('reads all items of a Project with more than 100', () => {
    const result = runCliWithLiveProject(146)

    expect(result.status).toBe(0)
    const decision = JSON.parse(result.stdout) as PreflightResult
    expect(decision.snapshot.items).toHaveLength(146)
  })

  it('reads a Project one item short of the read limit', () => {
    const result = runCliWithLiveProject(readLimit - 1)

    expect(result.status).toBe(0)
    expect((JSON.parse(result.stdout) as PreflightResult).snapshot.items).toHaveLength(readLimit - 1)
  })

  it('fails closed when the result is exactly the read limit', () => {
    const result = runCliWithLiveProject(readLimit)

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      `rollout-tracker-snapshot: FATAL — Project item list reached the read limit of ${readLimit} items and may be truncated; refusing to treat a partial read as no-drift; exiting 1\n`,
    )
  })

  it('fails closed when the Project holds more than the read limit', () => {
    const result = runCliWithLiveProject(readLimit * 5)

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('may be truncated')
  })

  it('reads a Project response larger than 1 MiB with fewer items than the read limit', () => {
    const total = 900
    const result = runCliWithLiveProject(total, 1200)

    expect(result.status).toBe(0)
    expect((JSON.parse(result.stdout) as PreflightResult).snapshot.items).toHaveLength(total)
  })
})

describe('the marker stays under the GitHub comment limit', () => {
  const commentLimit = 65_536

  it('carries only the hash and last_mention_id, with no snapshot', () => {
    const result = JSON.parse(runCliWithLiveProject(5).stdout) as PreflightResult
    const body = result.marker.slice(`<!-- ${MARKER_PREFIX}`.length, -' -->'.length)

    expect(Object.keys(JSON.parse(body) as Record<string, unknown>).sort()).toEqual(['hash', 'last_mention_id'])
    expect(result.marker).not.toContain('snapshot')
  })

  it('stays well under 65,536 characters for a 999-item Project, while stdout still carries the snapshot', () => {
    const result = JSON.parse(runCliWithLiveProject(999).stdout) as PreflightResult

    expect(result.marker.length).toBeLessThan(commentLimit / 10)
    expect(result.snapshot.items).toHaveLength(999)
    expect(extractPreviousMarker(result.marker)?.hash).toBe(result.hash)
  })

  it('still parses an old marker that carries a snapshot', () => {
    const old = `<!-- ${MARKER_PREFIX}${JSON.stringify({hash: 'old-hash', snapshot: {items: [{content_number: 1}]}, last_mention_id: 77})} -->`

    const parsed = extractPreviousMarker(old)

    expect(parsed?.hash).toBe('old-hash')
    expect(parsed?.last_mention_id).toBe(77)
  })
})

// ─── Program config ───────────────────────────────────────────────────────────

const configRoot = mkdtempSync(join(tmpdir(), 'rollout-tracker-config-'))
afterAll(() => {
  rmSync(configRoot, {recursive: true, force: true})
})

let configCounter = 0

/** Writes a program config file and returns its path. */
function writeConfig(programs: readonly unknown[]): string {
  configCounter += 1
  const path = join(configRoot, `config-${configCounter}.json`)
  writeFileSync(path, JSON.stringify({programs}))
  return path
}

function programEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'gateway',
    issue: 'fro-bot/.github#3512',
    project: {owner: 'fro-bot', number: 1, gateField: 'gateway Unit Gate'},
    operator: {id: 831617, login: 'marcusrbrown'},
    evidence: 'gateway',
    ...overrides,
  }
}

describe('the program config in a snapshot run', () => {
  // The #3512-shaped fixture and its output as the snapshot printed it before the config existed.
  const goldenItems = [
    {id: 'PVTI_1', content_number: 907, content_repo: 'fro-bot/agent', status: 'Done', readiness: null, gate: 'Unit 2'},
    {
      id: 'PVTI_2',
      content_number: 24,
      content_repo: 'fro-bot/dashboard',
      status: 'In Progress',
      readiness: 'blocked',
      gate: 'Gateway stage 3',
    },
    {
      id: 'PVTI_3',
      content_number: 1712,
      content_repo: 'marcusrbrown/infra',
      status: 'Todo',
      readiness: null,
      gate: null,
    },
    {
      id: 'PVTI_4',
      content_number: 3512,
      content_repo: 'fro-bot/.github',
      status: 'In Progress',
      readiness: null,
      gate: 'G4c',
    },
  ]
  const goldenIssues = [
    {number: 907, repo: 'fro-bot/agent', state: 'merged', title: 'a', closed_at: '2026-10-01T00:00:00Z', labels: ['x']},
    {number: 24, repo: 'fro-bot/dashboard', state: 'open', title: 'b', closed_at: null, labels: []},
    {
      number: 1712,
      repo: 'marcusrbrown/infra',
      state: 'closed',
      title: 'c',
      closed_at: '2026-10-30T00:00:00Z',
      labels: [],
    },
    {number: 3512, repo: 'fro-bot/.github', state: 'open', title: 'd', closed_at: null, labels: []},
  ]
  const goldenComments = [
    {
      id: 100,
      author: {login: 'fro-bot'},
      body: `@fro-bot seeded\n<!-- gateway-rollout-tracker:${JSON.stringify({hash: 'deadbeef', last_mention_id: 100})} -->`,
    },
    {id: 101, author: {login: 'marcusrbrown'}, body: '@fro-bot acceptance green'},
    {id: 102, author: {login: 'octocat'}, body: '@fro-bot G4c pass'},
    {id: 103, author: {login: 'marcusrbrown'}, body: 'no mention here'},
    {id: 104, author: {login: 'marcusrbrown'}, body: '@fro-bot another'},
  ]
  const goldenSignals = {
    releases: {agent: {tag_name: 'v0.136.4'}, dashboard: {tag_name: '2026.10.80'}},
    deploys: {
      gateway: {workflow_runs: [{id: 42450423239, head_sha: 'aaaa'}]},
      dashboard: {workflow_runs: [{id: 42450423240, head_sha: 'bbbb'}]},
      router: {workflow_runs: [{id: 42450423241, head_sha: 'cccc'}]},
    },
    health: {ok: true, contractVersion: '1.15.0'},
  }
  const goldenStdout =
    '{"should_comment":true,"reason":"gating transition detected — hash changed from deadbeef to e81328e4; operator mention pending (2)","hash":"e81328e4b86d316e8cee53afc629fda1dc992920c711f1c48e69c6a5ddff7f3d","snapshot":{"items":[{"content_number":3512,"content_repo":"fro-bot/.github","status":"In Progress","readiness":null,"gate":"G4c","issue_state":"open","issue_closed_at":null,"issue_labels":[]},{"content_number":907,"content_repo":"fro-bot/agent","status":"Done","readiness":null,"gate":"Unit 2","issue_state":"merged","issue_closed_at":"2026-10-01T00:00:00Z","issue_labels":["x"]},{"content_number":24,"content_repo":"fro-bot/dashboard","status":"In Progress","readiness":"blocked","gate":"Gateway stage 3","issue_state":"open","issue_closed_at":null,"issue_labels":[]},{"content_number":1712,"content_repo":"marcusrbrown/infra","status":"Todo","readiness":null,"gate":null,"issue_state":"closed","issue_closed_at":"2026-10-30T00:00:00Z","issue_labels":[]}],"external":{"agent_release":"v0.136.4","dashboard_release":"2026.10.80","deploy_gateway":{"run_id":42450423239,"head_sha":"aaaa"},"deploy_dashboard":{"run_id":42450423240,"head_sha":"bbbb"},"deploy_router":{"run_id":42450423241,"head_sha":"cccc"},"contract_version":"1.15.0"}},"pending_mention_ids":[101,104],"last_mention_id":104,"marker":"<!-- gateway-rollout-tracker:{\\"hash\\":\\"e81328e4b86d316e8cee53afc629fda1dc992920c711f1c48e69c6a5ddff7f3d\\",\\"last_mention_id\\":104} -->","marker_comment_id":100}\n'

  function goldenEnv(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
    return {
      ROLLOUT_TRACKER_ITEMS_JSON: JSON.stringify(goldenItems),
      ROLLOUT_TRACKER_ISSUES_JSON: JSON.stringify(goldenIssues),
      ROLLOUT_TRACKER_VISIBILITY_JSON: visibilityFixture(goldenItems),
      ROLLOUT_TRACKER_COMMENTS_JSON: JSON.stringify(goldenComments),
      ROLLOUT_TRACKER_COMMENT_BODY: undefined,
      ROLLOUT_TRACKER_COMMENT_ID: undefined,
      ROLLOUT_TRACKER_PROGRAM: undefined,
      ROLLOUT_TRACKER_CONFIG: undefined,
      ROLLOUT_TRACKER_RELEASES_JSON: JSON.stringify(goldenSignals.releases),
      ROLLOUT_TRACKER_DEPLOYS_JSON: JSON.stringify(goldenSignals.deploys),
      ROLLOUT_TRACKER_HEALTH_JSON: JSON.stringify(goldenSignals.health),
      ...extra,
    }
  }

  /** The result without the `program` block, which was added after the golden output was recorded. */
  function withoutProgram(stdout: string): string {
    const result = JSON.parse(stdout) as Record<string, unknown>
    delete result.program
    return `${JSON.stringify(result)}\n`
  }

  it("prints #3512's snapshot byte for byte as it did before the config existed, plus the program block", () => {
    const result = runCliRaw(goldenEnv())

    expect(result.status).toBe(0)
    expect(withoutProgram(result.stdout)).toBe(goldenStdout)
    expect((JSON.parse(result.stdout) as PreflightResult).program).toEqual({
      key: 'gateway',
      issue: 'fro-bot/.github#3512',
      repo: 'fro-bot/.github',
      project_url: 'https://github.com/users/fro-bot/projects/1',
      operator_login: 'marcusrbrown',
      evidence: 'gateway',
    })
  })

  it('selects the gateway program when ROLLOUT_TRACKER_PROGRAM is empty or unset', () => {
    expect(withoutProgram(runCliRaw(goldenEnv({ROLLOUT_TRACKER_PROGRAM: ''})).stdout)).toBe(goldenStdout)
  })

  it("reports the selected program's issue, repo, project URL, operator login and evidence kind", () => {
    const config = writeConfig([
      programEntry(),
      programEntry({
        key: 'plugins',
        issue: 'marcusrbrown/plugins#42',
        project: {owner: 'marcusrbrown', number: 9, gateField: 'Gate'},
        operator: {id: 5, login: 'octocat'},
        evidence: 'none',
      }),
    ])

    const result = runCliRaw(goldenEnv({ROLLOUT_TRACKER_CONFIG: config, ROLLOUT_TRACKER_PROGRAM: 'plugins'}))

    expect((JSON.parse(result.stdout) as PreflightResult).program).toEqual({
      key: 'plugins',
      issue: 'marcusrbrown/plugins#42',
      repo: 'marcusrbrown/plugins',
      project_url: 'https://github.com/users/marcusrbrown/projects/9',
      operator_login: 'octocat',
      evidence: 'none',
    })
  })

  it('selects the program named by ROLLOUT_TRACKER_PROGRAM and reads its operator', () => {
    const config = writeConfig([
      programEntry(),
      programEntry({
        key: 'plugins',
        issue: 'marcusrbrown/plugins#42',
        operator: {id: 5, login: 'octocat'},
        evidence: 'gateway',
      }),
    ])

    const result = runCliRaw(goldenEnv({ROLLOUT_TRACKER_CONFIG: config, ROLLOUT_TRACKER_PROGRAM: 'plugins'}))

    expect(result.status).toBe(0)
    // octocat is the operator of this program: only comment 102 mentions the bot.
    expect((JSON.parse(result.stdout) as PreflightResult).pending_mention_ids).toEqual([102])
  })

  it('exits 1 with a fixed message for an unknown program key, before any read', () => {
    const result = runCliRaw(goldenEnv({ROLLOUT_TRACKER_PROGRAM: 'nope'}))

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('rollout-tracker-snapshot: FATAL — program config: unknown program key\n')
  })

  it.each([
    ['a missing file', (): string => join(configRoot, 'absent.json'), 'program-trackers.json is missing'],
    [
      'malformed JSON',
      (): string => {
        const path = join(configRoot, 'malformed.json')
        writeFileSync(path, '{')
        return path
      },
      'program-trackers.json is not valid JSON',
    ],
    [
      'a duplicate key',
      (): string => writeConfig([programEntry(), programEntry({issue: 'a/b#1'})]),
      'duplicate program key',
    ],
    [
      'a duplicate issue',
      (): string => writeConfig([programEntry(), programEntry({key: 'other'})]),
      'duplicate tracker issue',
    ],
    [
      'a non-numeric operator id',
      (): string => writeConfig([programEntry({operator: {id: '831617', login: 'marcusrbrown'}})]),
      'programs[0].operator.id is invalid',
    ],
  ])('exits 1 with a fixed message for %s', (_name, makePath, message) => {
    const result = runCliRaw(goldenEnv({ROLLOUT_TRACKER_CONFIG: makePath()}))

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(`rollout-tracker-snapshot: FATAL — program config: ${message}\n`)
  })

  it('gives an empty external and makes no external read for evidence none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rollout-tracker-nogh-'))
    try {
      const calls = join(dir, 'calls.log')
      writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho "$*" >> '${calls}'\nexit 1\n`)
      chmodSync(join(dir, 'gh'), 0o755)
      const config = writeConfig([programEntry({evidence: 'none'})])

      const result = runCliRaw(
        goldenEnv({
          PATH: `${dir}:${process.env.PATH ?? ''}`,
          ROLLOUT_TRACKER_CONFIG: config,
          ROLLOUT_TRACKER_RELEASES_JSON: undefined,
          ROLLOUT_TRACKER_DEPLOYS_JSON: undefined,
          ROLLOUT_TRACKER_HEALTH_JSON: undefined,
          ROLLOUT_TRACKER_HEALTH_URL: 'http://127.0.0.1:1/never',
        }),
      )

      expect(result.status).toBe(0)
      const decision = JSON.parse(result.stdout) as PreflightResult
      expect(decision.snapshot.external).toEqual({})
      expect(decision.snapshot.items).toHaveLength(4)
      expect(() => readFileSync(calls, 'utf8')).toThrow()
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  it('hashes an empty external deterministically and differently from a populated one', () => {
    const none = writeConfig([programEntry({evidence: 'none'})])
    const withoutSignals = goldenEnv({
      ROLLOUT_TRACKER_CONFIG: none,
      ROLLOUT_TRACKER_RELEASES_JSON: undefined,
      ROLLOUT_TRACKER_DEPLOYS_JSON: undefined,
      ROLLOUT_TRACKER_HEALTH_JSON: undefined,
    })

    const first = JSON.parse(runCliRaw(withoutSignals).stdout) as PreflightResult
    const second = JSON.parse(runCliRaw(withoutSignals).stdout) as PreflightResult

    expect(first.hash).toBe(second.hash)
    expect(first.hash).not.toBe('e81328e4b86d316e8cee53afc629fda1dc992920c711f1c48e69c6a5ddff7f3d')
  })

  it("reads the Project, the owner and the gate field from the program's entry", () => {
    const dir = mkdtempSync(join(tmpdir(), 'rollout-tracker-project-cfg-'))
    try {
      writeFileSync(
        join(dir, 'gh'),
        [
          `#!${process.execPath}`,
          'const args = process.argv.slice(2)',
          "if (args.slice(0, 5).join(' ') !== 'project item-list 7 --owner octo') {",
          "  console.error('unexpected gh command: ' + args.join(' '))",
          '  process.exit(1)',
          '}',
          'process.stdout.write(JSON.stringify({',
          "  items: [{id: 'PVTI_1', content: {number: 5, repository: 'octo/repo', type: 'Issue'}, status: 'Todo', 'Phase Gate': 'G7'}],",
          '  totalCount: 1,',
          '}))',
        ].join('\n'),
      )
      chmodSync(join(dir, 'gh'), 0o755)
      const config = writeConfig([
        programEntry({
          key: 'octo',
          issue: 'octo/repo#9',
          project: {owner: 'octo', number: 7, gateField: 'Phase Gate'},
          evidence: 'none',
        }),
      ])

      const result = runCliRaw({
        ...goldenEnv({
          PATH: `${dir}:${process.env.PATH ?? ''}`,
          ROLLOUT_TRACKER_CONFIG: config,
          ROLLOUT_TRACKER_PROGRAM: 'octo',
          ROLLOUT_TRACKER_ITEMS_JSON: undefined,
          ROLLOUT_TRACKER_VISIBILITY_JSON: JSON.stringify({'octo/repo': 'public'}),
          ROLLOUT_TRACKER_ISSUES_JSON: JSON.stringify([]),
          ROLLOUT_TRACKER_COMMENTS_JSON: '[]',
        }),
      })

      expect(result.status).toBe(0)
      const items = (JSON.parse(result.stdout) as PreflightResult).snapshot.items
      expect(items.map(item => [item.content_repo, item.content_number, item.gate])).toEqual([['octo/repo', 5, 'G7']])
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  it("reads the tracker comments from the entry's issue", () => {
    const dir = mkdtempSync(join(tmpdir(), 'rollout-tracker-issue-cfg-'))
    try {
      writeFileSync(
        join(dir, 'gh'),
        [
          '#!/bin/sh',
          'case "$*" in',
          '  "api --paginate repos/octo/repo/issues/9/comments?per_page=100 --jq "*)',
          '    echo \'{"id":11,"login":"marcusrbrown","body":"@fro-bot hello"}\'; exit 0 ;;',
          'esac',
          'echo "unexpected gh command: $*" >&2; exit 1',
        ].join('\n'),
      )
      chmodSync(join(dir, 'gh'), 0o755)
      const config = writeConfig([
        programEntry({
          key: 'octo',
          issue: 'octo/repo#9',
          project: {owner: 'octo', number: 7, gateField: 'G'},
          evidence: 'none',
        }),
      ])

      const result = runCliRaw(
        goldenEnv({
          PATH: `${dir}:${process.env.PATH ?? ''}`,
          ROLLOUT_TRACKER_CONFIG: config,
          ROLLOUT_TRACKER_PROGRAM: 'octo',
          ROLLOUT_TRACKER_COMMENTS_JSON: undefined,
        }),
      )

      expect(result.status).toBe(0)
      expect((JSON.parse(result.stdout) as PreflightResult).pending_mention_ids).toEqual([11])
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })
})

// ─── Public-only snapshot ─────────────────────────────────────────────────────

describe('a snapshot of public repos only', () => {
  const publicItem = makeProjectItem({id: 'PVTI_pub', content_number: 24, content_repo: 'fro-bot/dashboard'})
  const hiddenItem = makeProjectItem({id: 'PVTI_hid', content_number: 7, content_repo: 'secret-org/hidden-repo'})
  const issues = [
    makeIssueState({number: 24, repo: 'fro-bot/dashboard'}),
    makeIssueState({number: 7, repo: 'secret-org/hidden-repo', title: 'hidden title'}),
  ]

  it('keeps an item from a public repo', () => {
    const result = runCliFixture({items: [publicItem], issues})

    expect(result.snapshot.items.map(item => `${item.content_repo}#${item.content_number}`)).toEqual([
      'fro-bot/dashboard#24',
    ])
  })

  it.each([
    ['private', 'private'],
    ['internal', 'internal'],
    ['a 404', null],
  ])('leaves out an item from a repo that is %s, and leaves no trace of it', (_name, visibility) => {
    const result = runCliRaw(
      fixtureEnv({
        items: [publicItem, hiddenItem],
        issues,
        visibility: {'secret-org/hidden-repo': visibility},
      }),
    )

    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('secret-org')
    expect(result.stdout).not.toContain('hidden-repo')
    expect(result.stdout).not.toContain('hidden title')
    expect(result.stderr).not.toContain('secret-org')
    const decision = JSON.parse(result.stdout) as PreflightResult
    expect(decision.snapshot.items).toHaveLength(1)
    expect(decision.snapshot.items.map(item => item.content_number)).toEqual([24])
    expect(decision.reason).not.toMatch(/omit|private|hidden|2 items|count/i)
  })

  it('hashes the same with or without the hidden item, so the hidden item cannot move the hash', () => {
    const withHidden = runCliFixture({
      items: [publicItem, hiddenItem],
      issues,
      visibility: {'secret-org/hidden-repo': 'private'},
    })
    const without = runCliFixture({items: [publicItem], issues})

    expect(withHidden.hash).toBe(without.hash)
    expect(withHidden.snapshot).toEqual(without.snapshot)
  })

  it('does not read the issue state of a hidden item', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rollout-tracker-issue-reads-'))
    try {
      const calls = join(dir, 'calls.log')
      writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho "$*" >> '${calls}'\nexit 1\n`)
      chmodSync(join(dir, 'gh'), 0o755)

      const result = runCliRaw({
        ...fixtureEnv({items: [hiddenItem], issues: [], visibility: {'secret-org/hidden-repo': 'private'}}),
        ROLLOUT_TRACKER_ISSUES_JSON: undefined,
        PATH: `${dir}:${process.env.PATH ?? ''}`,
      })

      expect(result.status).toBe(0)
      expect((JSON.parse(result.stdout) as PreflightResult).snapshot.items).toEqual([])
      expect(() => readFileSync(calls, 'utf8')).toThrow()
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  it('keeps an unsupported draft item to be warned about as before', () => {
    const draft = makeProjectItem({id: 'PVTI_draft', content_number: 0, content_repo: ''})

    const result = runCliRaw(fixtureEnv({items: [publicItem, draft], issues}))

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect((JSON.parse(result.stdout) as PreflightResult).snapshot.items).toHaveLength(1)
  })

  it('fails closed when the visibility fixture lacks a repo', () => {
    const result = runCliRaw({
      ...fixtureEnv({items: [publicItem], issues}),
      ROLLOUT_TRACKER_VISIBILITY_JSON: JSON.stringify({}),
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      'rollout-tracker-snapshot: FATAL — failed to read repository visibility; refusing to treat an access failure as no-drift; exiting 1\n',
    )
  })

  it.each([
    ['not an object', '[]'],
    ['malformed', '{'],
  ])('fails closed when the visibility fixture is %s', (_name, fixture) => {
    const result = runCliRaw({
      ...fixtureEnv({items: [publicItem], issues}),
      ROLLOUT_TRACKER_VISIBILITY_JSON: fixture,
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('failed to read repository visibility')
  })

  describe('through gh', () => {
    const items = [
      publicItem,
      makeProjectItem({id: 'PVTI_2', content_number: 25, content_repo: 'fro-bot/dashboard'}),
      makeProjectItem({id: 'PVTI_3', content_number: 9, content_repo: 'fro-bot/agent'}),
      hiddenItem,
    ]
    const allIssues = [
      makeIssueState({number: 24, repo: 'fro-bot/dashboard'}),
      makeIssueState({number: 25, repo: 'fro-bot/dashboard'}),
      makeIssueState({number: 9, repo: 'fro-bot/agent'}),
    ]

    it('reads visibility once for each distinct repo', () => {
      const result = runCliWithFakeGh({items, issues: allIssues})

      expect(result.status).toBe(0)
      expect([...result.visibilityReads].sort()).toEqual([
        'fro-bot/agent',
        'fro-bot/dashboard',
        'secret-org/hidden-repo',
      ])
    })

    it('treats repo names that differ only in case as one repo', () => {
      const result = runCliWithFakeGh({
        items: [
          makeProjectItem({content_number: 1, content_repo: 'fro-bot/agent'}),
          makeProjectItem({content_number: 2, content_repo: 'Fro-Bot/Agent'}),
        ],
        issues: [],
      })

      expect(result.visibilityReads).toHaveLength(1)
    })

    it('keeps the public items and omits a 404, a private and an internal repo, naming none', () => {
      const result = runCliWithFakeGh({
        items: [
          ...items,
          makeProjectItem({id: 'PVTI_4', content_number: 3, content_repo: 'gone/deleted'}),
          makeProjectItem({id: 'PVTI_5', content_number: 4, content_repo: 'corp/internal-one'}),
        ],
        issues: allIssues,
        visibility: {private: ['secret-org/hidden-repo'], notFound: ['gone/deleted'], internal: ['corp/internal-one']},
      })

      expect(result.status).toBe(0)
      const decision = JSON.parse(result.stdout) as PreflightResult
      expect(decision.snapshot.items.map(item => `${item.content_repo}#${item.content_number}`)).toEqual([
        'fro-bot/agent#9',
        'fro-bot/dashboard#24',
        'fro-bot/dashboard#25',
      ])
      for (const hidden of ['secret-org', 'gone/deleted', 'corp/internal-one']) {
        expect(result.stdout).not.toContain(hidden)
        expect(result.stderr).not.toContain(hidden)
      }
    })

    it('still answers the other items when one repo returns 404', () => {
      const result = runCliWithFakeGh({items, issues: allIssues, visibility: {notFound: ['secret-org/hidden-repo']}})

      expect(result.status).toBe(0)
      expect((JSON.parse(result.stdout) as PreflightResult).snapshot.items).toHaveLength(3)
    })

    it.each([
      ['a 5xx', {error: ['fro-bot/agent']}],
      ['a network failure', {network: ['fro-bot/agent']}],
      ['an empty answer', {garbled: ['fro-bot/agent']}],
    ])('exits 1 with nothing on stdout on %s from a visibility read', (_name, visibility) => {
      const result = runCliWithFakeGh({items, issues: allIssues, visibility})

      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe(
        'rollout-tracker-snapshot: FATAL — failed to read repository visibility; refusing to treat an access failure as no-drift; exiting 1\n',
      )
    })
  })
})
