// Import types from the module under test
import type {CommentDecision, IssueState, MarkerData, ProjectItem, RolloutSnapshot} from './rollout-tracker-snapshot.ts'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import process from 'node:process'
import {describe, expect, it, vi} from 'vitest'
import {parse} from 'yaml'

import {
  buildSnapshot,
  decideComment,
  extractPreviousMarker,
  hashSnapshot,
  MARKER_PREFIX,
  normaliseIssueState,
  normaliseRawProjectItem,
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

function runCliFixture(params: {items: ProjectItem[]; issues: IssueState[]; commentBody?: string}): CommentDecision {
  const scriptPath = resolve(import.meta.dirname, './rollout-tracker-snapshot.ts')
  const stdout = execFileSync('node', [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ROLLOUT_TRACKER_COMMENT_BODY: params.commentBody ?? '',
      ROLLOUT_TRACKER_ISSUES_JSON: JSON.stringify(params.issues),
      ROLLOUT_TRACKER_ITEMS_JSON: JSON.stringify(params.items),
    },
  })

  return JSON.parse(stdout) as CommentDecision
}

// ─── buildSnapshot ────────────────────────────────────────────────────────────

describe('buildSnapshot', () => {
  it('constructs a normalized snapshot from project items and issue states', () => {
    const items: ProjectItem[] = [makeProjectItem()]
    const issues: IssueState[] = [makeIssueState()]

    const snapshot = buildSnapshot(items, issues)

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

    const snapshot = buildSnapshot(items, issues)

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

    const snapshot = buildSnapshot(items, issues)

    expect(snapshot.items[0]?.content_number).toBe(907)
    expect(snapshot.items[1]?.content_number).toBe(929)
    expect(snapshot.items[2]?.content_number).toBe(24)
  })

  it('excludes volatile fields (timestamps, prose) from snapshot items', () => {
    const items: ProjectItem[] = [makeProjectItem()]
    const issues: IssueState[] = [makeIssueState({title: 'Some prose title that changes'})]

    const snapshot = buildSnapshot(items, issues)

    // title should NOT appear in snapshot items (volatile prose)
    expect(JSON.stringify(snapshot)).not.toContain('Some prose title that changes')
  })
})

// ─── hashSnapshot ─────────────────────────────────────────────────────────────

describe('hashSnapshot', () => {
  it('produces a stable hex string for the same snapshot', () => {
    const snapshot: RolloutSnapshot = {
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
      items: [
        {
          content_number: 24,
          content_repo: 'fro-bot/dashboard',
          status: 'Todo',
          readiness: 'ready now',
          gate: 'Unit 3',
          issue_state: 'open',
          issue_closed_at: null,
          issue_labels: [],
        },
      ],
    }
    const baseItem = base.items[0]
    if (baseItem === undefined) throw new Error('missing base item')
    const fieldOnlyDrift: RolloutSnapshot = {
      items: [
        {
          ...baseItem,
          status: 'In Progress',
          readiness: 'blocked',
          gate: 'Unit 4',
        },
      ],
    }

    expect(hashSnapshot(base)).toBe(hashSnapshot(fieldOnlyDrift))
  })

  it('does not change hash for issue label-only drift', () => {
    const base: RolloutSnapshot = {
      items: [
        {
          content_number: 24,
          content_repo: 'fro-bot/dashboard',
          status: 'Todo',
          readiness: 'ready now',
          gate: 'Unit 3',
          issue_state: 'open',
          issue_closed_at: null,
          issue_labels: [],
        },
      ],
    }
    const baseItem = base.items[0]
    if (baseItem === undefined) throw new Error('missing base item')
    const labelOnlyDrift: RolloutSnapshot = {
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
    const result = decideComment(baseSnapshot, hash, null)

    expect(result.should_comment).toBe(true)
    expect(result.reason).toMatch(/cold start/i)
    expect(result.hash).toBe(hash)
    expect(result.snapshot).toEqual(baseSnapshot)
  })

  it('same hash as previous marker => should_comment:false with no gating transition reason', () => {
    const hash = hashSnapshot(baseSnapshot)
    const previousMarker: MarkerData = {hash, snapshot: baseSnapshot}

    const result = decideComment(baseSnapshot, hash, previousMarker)

    expect(result.should_comment).toBe(false)
    expect(result.reason).toMatch(/no gating transition/i)
    expect(result.hash).toBe(hash)
  })

  it('different hash from previous marker => should_comment:true', () => {
    const oldSnapshot: RolloutSnapshot = {
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

    const result = decideComment(newSnapshot, newHash, previousMarker)

    expect(result.should_comment).toBe(true)
    expect(result.hash).toBe(newHash)
    expect(result.snapshot).toEqual(newSnapshot)
  })

  it('returns hash and snapshot in result regardless of should_comment value', () => {
    const hash = hashSnapshot(baseSnapshot)
    const previousMarker: MarkerData = {hash, snapshot: baseSnapshot}

    const result = decideComment(baseSnapshot, hash, previousMarker)

    expect(result.hash).toBeDefined()
    expect(result.snapshot).toBeDefined()
  })
})

describe('rollout-tracker-snapshot CLI fixture path', () => {
  it('gates comments only on tracked identity or issue-state transitions', () => {
    const items = [makeProjectItem({content_number: 24, content_repo: 'fro-bot/dashboard', gate: 'Unit 3'})]
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
    const snapshot = buildSnapshot([item], [])
    expect(snapshot.items[0]?.gate).toBe('Unit Gate')
  })

  it('gate is null when raw "gateway Unit Gate" field is absent or null', () => {
    const item: ProjectItem = makeProjectItem({gate: null})
    const snapshot = buildSnapshot([item], [])
    expect(snapshot.items[0]?.gate).toBeNull()
  })

  it('gate value is preserved in the snapshot but does not affect comment hash by itself', () => {
    const withGate = buildSnapshot([makeProjectItem({gate: 'Unit Gate'})], [])
    const withoutGate = buildSnapshot([makeProjectItem({gate: null})], [])
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
    const snapshot = buildSnapshot([item], [issue])
    expect(snapshot.items[0]?.issue_state).toBe('merged')
  })

  it('merged state produces a different hash than open or closed', () => {
    const base = makeProjectItem({content_number: 929, content_repo: 'fro-bot/agent'})
    const openSnap = buildSnapshot([base], [makeIssueState({number: 929, repo: 'fro-bot/agent', state: 'open'})])
    const closedSnap = buildSnapshot([base], [makeIssueState({number: 929, repo: 'fro-bot/agent', state: 'closed'})])
    const mergedSnap = buildSnapshot([base], [makeIssueState({number: 929, repo: 'fro-bot/agent', state: 'merged'})])
    expect(hashSnapshot(mergedSnap)).not.toBe(hashSnapshot(openSnap))
    expect(hashSnapshot(mergedSnap)).not.toBe(hashSnapshot(closedSnap))
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
