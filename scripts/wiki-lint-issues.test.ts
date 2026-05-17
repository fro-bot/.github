import type {ExistingIssue, OctokitClient, PlanInput} from './wiki-lint-issues.ts'
import type {WikiLintFindingKind, WikiLintJsonFinding, WikiLintJsonReport} from './wiki-lint.ts'

import {readFileSync} from 'node:fs'
import process from 'node:process'

import {describe, expect, it, vi} from 'vitest'
import {parse as parseYaml} from 'yaml'
import {planIssueLifecycle, syncWikiLintIssues, validateWikiLintJsonReport} from './wiki-lint-issues.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<WikiLintJsonReport> = {}): WikiLintJsonReport {
  return {
    schema_version: 1,
    fingerprint_version: 1,
    status: 'clean',
    scan_complete: true,
    snapshot_sha: 'abc123',
    generated_at: '2026-05-17T00:00:00Z',
    failure_class: null,
    repair_eligible: false,
    findings: [],
    freshness: [],
    counts: {
      findings_total: 0,
      findings_deterministic: 0,
      findings_advisory: 0,
      pages_scanned: 0,
      pages_stale: 0,
    },
    ...overrides,
  }
}

function makeFinding(overrides: Partial<WikiLintJsonFinding> = {}): WikiLintJsonFinding {
  return {
    kind: 'broken-wikilink' as WikiLintFindingKind,
    severity: 'deterministic',
    path: 'knowledge/wiki/repos/foo.md',
    target: null,
    message: 'Broken wikilink [[bar]]',
    fingerprint: 'deadbeef01234567',
    ...overrides,
  }
}

function makeOpenIssue(fingerprint: string, number = 1): ExistingIssue {
  return {
    number,
    state: 'open',
    body: `<!-- wiki-lint:subject:fingerprint=${fingerprint} -->\n\nSome body.`,
  }
}

function makeClosedIssue(fingerprint: string, number = 2): ExistingIssue {
  return {
    number,
    state: 'closed',
    body: `<!-- wiki-lint:subject:fingerprint=${fingerprint} -->\n\nSome body.`,
  }
}

function makeFailureOpenIssue(failureClass: string, number = 10): ExistingIssue {
  return {
    number,
    state: 'open',
    body: `<!-- wiki-lint:subject:failure-class=${failureClass} -->\n\nSome body.`,
  }
}

function emptyInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    report: makeReport(),
    openIssues: [],
    recentlyClosedIssues: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Mock octokit factory
// ---------------------------------------------------------------------------

interface MockIssuesMethods {
  create: ReturnType<typeof vi.fn>
  createComment: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

interface MockOctokitShape {
  rest: {
    issues: MockIssuesMethods
  }
}

function mockOctokit(
  overrides: {
    create?: ReturnType<typeof vi.fn>
    createComment?: ReturnType<typeof vi.fn>
    update?: ReturnType<typeof vi.fn>
  } = {},
): OctokitClient {
  const shape: MockOctokitShape = {
    rest: {
      issues: {
        create: overrides.create ?? vi.fn().mockResolvedValue({data: {number: 99}}),
        createComment: overrides.createComment ?? vi.fn().mockResolvedValue({data: {id: 1}}),
        update: overrides.update ?? vi.fn().mockResolvedValue({data: {number: 1}}),
      },
    },
  }
  return shape as unknown as OctokitClient
}

// ---------------------------------------------------------------------------
// Pure-function tests: planIssueLifecycle
// ---------------------------------------------------------------------------

describe('planIssueLifecycle', () => {
  it('1. new deterministic finding with no existing issue → toOpen with correct marker and labels', () => {
    const finding = makeFinding()
    const report = makeReport({
      status: 'findings',
      scan_complete: true,
      findings: [finding],
      counts: {findings_total: 1, findings_deterministic: 1, findings_advisory: 0, pages_scanned: 1, pages_stale: 0},
    })
    const plan = planIssueLifecycle(emptyInput({report}))

    expect(plan.toOpen).toHaveLength(1)
    expect(plan.toUpdate).toHaveLength(0)
    expect(plan.toReopen).toHaveLength(0)
    expect(plan.toClose).toHaveLength(0)

    const [draft] = plan.toOpen
    if (!draft) throw new Error('expected one toOpen entry')
    expect(draft.body).toContain(`<!-- wiki-lint:subject:fingerprint=${finding.fingerprint} -->`)
    expect(draft.labels).toContain('wiki-lint')
    expect(draft.labels).toContain('wiki-lint-finding')
    expect(draft.title).toContain('broken-wikilink')
    expect(draft.title).toContain('knowledge/wiki/repos/foo.md')
  })

  it('2. deterministic finding matching an existing OPEN issue → toUpdate, NOT toOpen', () => {
    const finding = makeFinding()
    const report = makeReport({
      status: 'findings',
      scan_complete: true,
      findings: [finding],
    })
    const openIssue = makeOpenIssue(finding.fingerprint, 42)
    const plan = planIssueLifecycle(emptyInput({report, openIssues: [openIssue]}))

    expect(plan.toOpen).toHaveLength(0)
    expect(plan.toUpdate).toHaveLength(1)
    expect(plan.toUpdate[0]?.issueNumber).toBe(42)
    expect(plan.toReopen).toHaveLength(0)
  })

  it('3. deterministic finding matching a recently-closed issue → toReopen, NOT toOpen', () => {
    const finding = makeFinding()
    const report = makeReport({
      status: 'findings',
      scan_complete: true,
      findings: [finding],
    })
    const closedIssue = makeClosedIssue(finding.fingerprint, 55)
    const plan = planIssueLifecycle(emptyInput({report, recentlyClosedIssues: [closedIssue]}))

    expect(plan.toOpen).toHaveLength(0)
    expect(plan.toReopen).toHaveLength(1)
    expect(plan.toReopen[0]?.issueNumber).toBe(55)
    expect(plan.toUpdate).toHaveLength(0)
  })

  it('4. clean run with open finding issue not in current findings → toClose', () => {
    const report = makeReport({status: 'clean', scan_complete: true, findings: []})
    const openIssue = makeOpenIssue('aabbccdd11223344', 7)
    const plan = planIssueLifecycle(emptyInput({report, openIssues: [openIssue]}))

    expect(plan.toClose).toHaveLength(1)
    expect(plan.toClose[0]?.issueNumber).toBe(7)
    expect(plan.toOpen).toHaveLength(0)
  })

  it('5. execution-failure run with open finding issues → toClose is EMPTY, failure issue opened', () => {
    const report = makeReport({
      status: 'execution-failure',
      scan_complete: false,
      failure_class: 'snapshot-restore',
      findings: [],
    })
    const openFindingIssue = makeOpenIssue('some-fingerprint', 3)
    const plan = planIssueLifecycle(emptyInput({report, openIssues: [openFindingIssue]}))

    expect(plan.toClose).toHaveLength(0)
    expect(plan.toOpen).toHaveLength(1)
    expect(plan.toOpen[0]?.labels).toContain('wiki-lint-failure')
  })

  it('6. execution-failure for snapshot-restore with no existing failure issue → toOpen failure draft', () => {
    const report = makeReport({
      status: 'execution-failure',
      scan_complete: false,
      failure_class: 'snapshot-restore',
    })
    const plan = planIssueLifecycle(emptyInput({report}))

    expect(plan.toOpen).toHaveLength(1)
    const [draft] = plan.toOpen
    if (!draft) throw new Error('expected one toOpen entry')
    expect(draft.body).toContain('<!-- wiki-lint:subject:failure-class=snapshot-restore -->')
    expect(draft.labels).toContain('wiki-lint')
    expect(draft.labels).toContain('wiki-lint-failure')
    expect(draft.title).toContain('snapshot-restore')
  })

  it('7. execution-failure matching an existing OPEN failure-class issue → toUpdate', () => {
    const report = makeReport({
      status: 'execution-failure',
      scan_complete: false,
      failure_class: 'snapshot-restore',
    })
    const openFailureIssue = makeFailureOpenIssue('snapshot-restore', 20)
    const plan = planIssueLifecycle(emptyInput({report, openIssues: [openFailureIssue]}))

    expect(plan.toUpdate).toHaveLength(1)
    expect(plan.toUpdate[0]?.issueNumber).toBe(20)
    expect(plan.toOpen).toHaveLength(0)
  })

  it('8. findings run (scan_complete=true) with open issue NOT in current findings → toClose', () => {
    const report = makeReport({
      status: 'findings',
      scan_complete: true,
      findings: [makeFinding({fingerprint: 'aabbccdd11223344'})],
    })
    const staleOpenIssue = makeOpenIssue('deadbeef01234567', 9)
    const plan = planIssueLifecycle(emptyInput({report, openIssues: [staleOpenIssue]}))

    expect(plan.toClose).toHaveLength(1)
    expect(plan.toClose[0]?.issueNumber).toBe(9)
  })

  it('9. findings run with scan_complete=false → toClose is empty (defensive)', () => {
    const report = makeReport({
      status: 'findings',
      scan_complete: false,
      findings: [],
    })
    const openIssue = makeOpenIssue('some-fp', 4)
    const plan = planIssueLifecycle(emptyInput({report, openIssues: [openIssue]}))

    expect(plan.toClose).toHaveLength(0)
  })

  it('10. advisory finding is IGNORED — no issue opened', () => {
    const advisoryFinding = makeFinding({severity: 'advisory', fingerprint: 'advisory-fp'})
    const report = makeReport({
      status: 'findings',
      scan_complete: true,
      findings: [advisoryFinding],
    })
    const plan = planIssueLifecycle(emptyInput({report}))

    expect(plan.toOpen).toHaveLength(0)
    expect(plan.toUpdate).toHaveLength(0)
    expect(plan.toReopen).toHaveLength(0)
  })

  it('20. deduplicates findings with the same fingerprint in a single report — only one toOpen entry', () => {
    const fp = 'deadbeef01234567'
    const finding1 = makeFinding({fingerprint: fp, path: 'knowledge/wiki/repos/foo.md'})
    const finding2 = makeFinding({fingerprint: fp, path: 'knowledge/wiki/repos/bar.md'}) // same fingerprint, different path
    const report = makeReport({
      status: 'findings',
      scan_complete: true,
      findings: [finding1, finding2],
    })
    const plan = planIssueLifecycle(emptyInput({report}))

    // Only one toOpen entry — the duplicate is skipped
    expect(plan.toOpen).toHaveLength(1)
    expect(plan.toUpdate).toHaveLength(0)
    expect(plan.toReopen).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// I/O shell tests: syncWikiLintIssues
// ---------------------------------------------------------------------------

describe('syncWikiLintIssues', () => {
  it('11. plan with 1 toOpen → issues.create called, counters.opened=1', async () => {
    const createMock = vi.fn().mockResolvedValue({data: {number: 1}})
    const octokit = mockOctokit({create: createMock})
    const plan = {
      toOpen: [{title: 'Wiki lint: broken-wikilink in foo.md', body: '<!-- marker -->', labels: ['wiki-lint']}],
      toUpdate: [],
      toReopen: [],
      toClose: [],
    }
    const result = await syncWikiLintIssues({octokit, owner: 'fro-bot', repo: '.github', plan})

    expect(createMock).toHaveBeenCalledOnce()
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({title: 'Wiki lint: broken-wikilink in foo.md'}))
    expect(result.counters.opened).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('12. plan with 1 toUpdate → issues.createComment called, counters.updated=1', async () => {
    const commentMock = vi.fn().mockResolvedValue({data: {id: 1}})
    const octokit = mockOctokit({createComment: commentMock})
    const plan = {
      toOpen: [],
      toUpdate: [{issueNumber: 42, comment: 'Recurrence detected.'}],
      toReopen: [],
      toClose: [],
    }
    const result = await syncWikiLintIssues({octokit, owner: 'fro-bot', repo: '.github', plan})

    expect(commentMock).toHaveBeenCalledOnce()
    expect(commentMock).toHaveBeenCalledWith(expect.objectContaining({issue_number: 42}))
    expect(result.counters.updated).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('13. plan with 1 toClose → issues.update with state=closed, counters.closed=1', async () => {
    const updateMock = vi.fn().mockResolvedValue({data: {number: 7}})
    const octokit = mockOctokit({update: updateMock})
    const plan = {
      toOpen: [],
      toUpdate: [],
      toReopen: [],
      toClose: [{issueNumber: 7}],
    }
    const result = await syncWikiLintIssues({octokit, owner: 'fro-bot', repo: '.github', plan})

    expect(updateMock).toHaveBeenCalledOnce()
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({state: 'closed', issue_number: 7}))
    expect(result.counters.closed).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('14. issues.create rejects → failed increments, errors has entry, other ops still execute', async () => {
    const createMock = vi.fn().mockRejectedValue(new Error('API error'))
    const commentMock = vi.fn().mockResolvedValue({data: {id: 1}})
    const octokit = mockOctokit({create: createMock, createComment: commentMock})
    const plan = {
      toOpen: [{title: 'Failing issue', body: '<!-- marker -->', labels: ['wiki-lint']}],
      toUpdate: [{issueNumber: 5, comment: 'Recurrence.'}],
      toReopen: [],
      toClose: [],
    }
    const result = await syncWikiLintIssues({octokit, owner: 'fro-bot', repo: '.github', plan})

    expect(result.counters.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.counters.updated).toBe(1) // other op still ran
  })

  it('15. issues.update rejects when closing → failed increments, errors has entry', async () => {
    const updateMock = vi.fn().mockRejectedValue(new Error('Forbidden'))
    const octokit = mockOctokit({update: updateMock})
    const plan = {
      toOpen: [],
      toUpdate: [],
      toReopen: [],
      toClose: [{issueNumber: 3}],
    }
    const result = await syncWikiLintIssues({octokit, owner: 'fro-bot', repo: '.github', plan})

    expect(result.counters.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('#3')
  })

  it('21. failure isolation — update fails, close still runs', async () => {
    let updateCallCount = 0
    const updateMock = vi.fn().mockImplementation(async () => {
      updateCallCount++
      if (updateCallCount === 1) {
        throw new Error('update failed')
      }
      return {data: {number: 99}}
    })
    const octokit = mockOctokit({update: updateMock})
    const plan = {
      toOpen: [],
      toUpdate: [],
      toReopen: [{issueNumber: 10, comment: 'Recurrence.'}], // uses update internally
      toClose: [{issueNumber: 20}],
    }
    const result = await syncWikiLintIssues({octokit, owner: 'fro-bot', repo: '.github', plan})

    expect(result.counters.failed).toBe(1)
    expect(result.counters.closed).toBe(1)
  })

  it('22. failure isolation — createComment fails, close still runs', async () => {
    const commentMock = vi.fn().mockRejectedValue(new Error('comment failed'))
    const updateMock = vi.fn().mockResolvedValue({data: {number: 1}})
    const octokit = mockOctokit({createComment: commentMock, update: updateMock})
    const plan = {
      toOpen: [],
      toUpdate: [{issueNumber: 5, comment: 'Recurrence.'}],
      toReopen: [],
      toClose: [{issueNumber: 7}],
    }
    const result = await syncWikiLintIssues({octokit, owner: 'fro-bot', repo: '.github', plan})

    expect(result.counters.failed).toBe(1)
    expect(result.counters.closed).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Shape validation tests: validateWikiLintJsonReport
// ---------------------------------------------------------------------------

describe('validateWikiLintJsonReport', () => {
  it('23. valid report passes validation without throwing', () => {
    const raw = makeReport()
    expect(() => validateWikiLintJsonReport(raw)).not.toThrow()
  })

  it('24. execution-failure report with null failure_class is rejected as invalid', () => {
    const raw = makeReport({status: 'execution-failure', failure_class: null})
    // validateWikiLintJsonReport calls process.exit(1) — we need to intercept it
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called')
    })
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      expect(() => validateWikiLintJsonReport(raw)).toThrow('process.exit called')
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('execution-failure report missing failure_class'))
    } finally {
      exitSpy.mockRestore()
      stderrSpy.mockRestore()
    }
  })

  it('25. report with invalid status is rejected', () => {
    const raw = {...makeReport(), status: 'unknown-status'}
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called')
    })
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      expect(() => validateWikiLintJsonReport(raw)).toThrow('process.exit called')
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('invalid report shape'))
    } finally {
      exitSpy.mockRestore()
      stderrSpy.mockRestore()
    }
  })

  it('26. report with non-array findings is rejected', () => {
    const raw = {...makeReport(), findings: 'not-an-array'}
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called')
    })
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      expect(() => validateWikiLintJsonReport(raw)).toThrow('process.exit called')
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('findings is not an array'))
    } finally {
      exitSpy.mockRestore()
      stderrSpy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// CLI main() tests (via temp file + GITHUB_OUTPUT)
// ---------------------------------------------------------------------------

describe('main() CLI via temp files', () => {
  it.todo('schema_version mismatch → exit 1, no octokit calls (requires testable main() extraction)')
  it.todo('fingerprint_version mismatch → exit 1, no octokit calls (requires testable main() extraction)')
  it.todo('CLI main() counters output — GITHUB_OUTPUT contains opened=1 (requires testable main() extraction)')
})

// ---------------------------------------------------------------------------
// Workflow YAML integration tests
// ---------------------------------------------------------------------------

const workflowPath = new URL('../.github/workflows/wiki-lint.yaml', import.meta.url).pathname

describe('wiki-lint.yaml workflow', () => {
  const workflowContent = readFileSync(workflowPath, 'utf8')
  const workflow = parseYaml(workflowContent) as Record<string, unknown>
  const jobs = workflow.jobs as Record<string, unknown>

  it('16. workflow has wiki-lint-issue-sync job that depends on wiki-lint via needs', () => {
    expect(jobs).toHaveProperty('wiki-lint-issue-sync')
    const syncJob = jobs['wiki-lint-issue-sync'] as Record<string, unknown>
    const needs = syncJob.needs
    const needsArr = Array.isArray(needs) ? needs : [needs]
    expect(needsArr).toContain('wiki-lint')
  })

  it('17. issue-sync job runs if: always()', () => {
    const syncJob = jobs['wiki-lint-issue-sync'] as Record<string, unknown>
    expect(syncJob.if).toBe('always()')
  })

  it('18. issue-sync job uses create-github-app-token and download-artifact', () => {
    const syncJob = jobs['wiki-lint-issue-sync'] as Record<string, unknown>
    const steps = syncJob.steps as Record<string, unknown>[]
    const usesValues = steps.map(s => s.uses).filter(Boolean)
    expect(usesValues.some(u => typeof u === 'string' && u.includes('create-github-app-token'))).toBe(true)
    expect(usesValues.some(u => typeof u === 'string' && u.includes('download-artifact'))).toBe(true)
  })

  it('19. issue-sync job has permissions issues:write and contents:read', () => {
    const syncJob = jobs['wiki-lint-issue-sync'] as Record<string, unknown>
    const permissions = syncJob.permissions as Record<string, unknown>
    expect(permissions).toBeDefined()
    expect(permissions.issues).toBe('write')
    expect(permissions.contents).toBe('read')
  })

  it('27. app-token step has permission-issues:write and permission-contents:read', () => {
    const syncJob = jobs['wiki-lint-issue-sync'] as Record<string, unknown>
    const steps = syncJob.steps as Record<string, unknown>[]
    const appTokenStep = steps.find(s => typeof s.uses === 'string' && s.uses.includes('create-github-app-token'))
    expect(appTokenStep).toBeDefined()
    const withBlock = appTokenStep?.with as Record<string, unknown> | undefined
    expect(withBlock).toBeDefined()
    expect(withBlock?.['permission-issues']).toBe('write')
    expect(withBlock?.['permission-contents']).toBe('read')
  })
})
