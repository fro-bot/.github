/**
 * Tests for scripts/capture-patterns-synthesis.ts
 *
 * Structure:
 * - Marker helper tests: build/parse pattern-proposal hidden markers
 * - Label descriptor tests
 * - Outcome classification tests
 * - Source collection tests (solution docs + learning-proposal issues)
 * - fetchExistingPatternProposals I/O shell tests (mocked Octokit)
 */

import {describe, expect, it} from 'vitest'

import {
  buildLearningProposalLink,
  buildPatternProposalMarkers,
  buildSolutionDocLink,
  classifyPatternProposalOutcome,
  collectLearningProposalSources,
  collectSolutionDocSources,
  fetchExistingPatternProposals,
  parsePatternProposalFingerprint,
  parsePatternProposalSourceIds,
  parsePatternProposalSupersedes,
  PATTERN_PROPOSAL_LABEL,
  PATTERN_PROPOSAL_OUTCOME_LABELS,
  PATTERN_PROPOSAL_REQUIRED_LABELS,
  SOLUTION_SUBDIRS,
  type ExistingPatternProposalIssue,
  type LearningProposalIssueInput,
  type PatternProposalOctokitClient,
} from './capture-patterns-synthesis.ts'

// ---------------------------------------------------------------------------
// Marker helpers
// ---------------------------------------------------------------------------

describe('buildPatternProposalMarkers / parsePatternProposalFingerprint', () => {
  it('round-trips a fingerprint through build and parse', () => {
    const fingerprint = 'a'.repeat(64)
    const body = buildPatternProposalMarkers({fingerprint, sourceIds: ['id-a', 'id-b']})
    expect(parsePatternProposalFingerprint(body)).toBe(fingerprint)
  })

  it('returns null when no fingerprint marker is present', () => {
    expect(parsePatternProposalFingerprint('No marker here')).toBeNull()
  })

  it('returns null for a malformed fingerprint marker (non-hex)', () => {
    const body = '<!-- pattern-proposal:fingerprint=not-hex-value -->'
    expect(parsePatternProposalFingerprint(body)).toBeNull()
  })

  it('does not reuse the captured-learning marker namespace', () => {
    const fingerprint = 'b'.repeat(64)
    const body = buildPatternProposalMarkers({fingerprint, sourceIds: ['id-a']})
    expect(body).not.toContain('captured-learning:')
    expect(body).toContain('pattern-proposal:fingerprint=')
  })
})

describe('parsePatternProposalSourceIds', () => {
  it('round-trips sorted comma-separated source IDs', () => {
    const fingerprint = 'c'.repeat(64)
    const body = buildPatternProposalMarkers({fingerprint, sourceIds: ['zebra', 'alpha', 'mid']})
    expect(parsePatternProposalSourceIds(body)).toEqual(['alpha', 'mid', 'zebra'])
  })

  it('round-trips filename-stem source IDs containing hyphens', () => {
    const fingerprint = 'c'.repeat(64)
    const body = buildPatternProposalMarkers({
      fingerprint,
      sourceIds: ['pure-core-privacy-gates-shared-module-2026-06-22', 'agent-review-loop-2026-07-06'],
    })

    expect(parsePatternProposalSourceIds(body)).toEqual([
      'agent-review-loop-2026-07-06',
      'pure-core-privacy-gates-shared-module-2026-06-22',
    ])
  })

  it('returns null when no source-ids marker is present', () => {
    expect(parsePatternProposalSourceIds('No marker here')).toBeNull()
  })

  it('returns null for an empty source-ids marker', () => {
    const body = '<!-- pattern-proposal:source-ids= -->'
    expect(parsePatternProposalSourceIds(body)).toBeNull()
  })
})

describe('parsePatternProposalSupersedes', () => {
  it('parses an optional supersedes marker when present', () => {
    const fingerprint = 'd'.repeat(64)
    const supersedes = 'e'.repeat(64)
    const body = buildPatternProposalMarkers({fingerprint, sourceIds: ['id-a'], supersedes})
    expect(parsePatternProposalSupersedes(body)).toBe(supersedes)
  })

  it('returns null when supersedes marker is absent', () => {
    const fingerprint = 'd'.repeat(64)
    const body = buildPatternProposalMarkers({fingerprint, sourceIds: ['id-a']})
    expect(parsePatternProposalSupersedes(body)).toBeNull()
  })

  it('returns null for a malformed supersedes marker (non-hex)', () => {
    const body = '<!-- pattern-proposal:supersedes=zzz -->'
    expect(parsePatternProposalSupersedes(body)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Label descriptors
// ---------------------------------------------------------------------------

describe('label descriptors', () => {
  it('defines a primary pattern-proposal label', () => {
    expect(PATTERN_PROPOSAL_LABEL).toBe('pattern-proposal')
  })

  it('defines four mutually exclusive outcome labels', () => {
    expect(PATTERN_PROPOSAL_OUTCOME_LABELS).toEqual({
      accepted: 'pattern-proposal:accepted',
      deferred: 'pattern-proposal:deferred',
      rejected: 'pattern-proposal:rejected',
      superseded: 'pattern-proposal:superseded',
    })
  })

  it('does not define needs-outcome as a label', () => {
    const names = PATTERN_PROPOSAL_REQUIRED_LABELS.map(l => l.name)
    expect(names).not.toContain('needs-outcome')
  })

  it('provides ready-to-use descriptors for .github/settings.yml (name/color/description)', () => {
    expect(PATTERN_PROPOSAL_REQUIRED_LABELS.length).toBeGreaterThanOrEqual(5)
    for (const label of PATTERN_PROPOSAL_REQUIRED_LABELS) {
      expect(typeof label.name).toBe('string')
      expect(label.name.length).toBeGreaterThan(0)
      expect(typeof label.color).toBe('string')
      expect(typeof label.description).toBe('string')
    }
    const names = PATTERN_PROPOSAL_REQUIRED_LABELS.map(l => l.name)
    expect(names).toContain(PATTERN_PROPOSAL_LABEL)
    expect(names).toContain(PATTERN_PROPOSAL_OUTCOME_LABELS.accepted)
    expect(names).toContain(PATTERN_PROPOSAL_OUTCOME_LABELS.deferred)
    expect(names).toContain(PATTERN_PROPOSAL_OUTCOME_LABELS.rejected)
    expect(names).toContain(PATTERN_PROPOSAL_OUTCOME_LABELS.superseded)
  })
})

// ---------------------------------------------------------------------------
// Outcome classification
// ---------------------------------------------------------------------------

function makeIssue(overrides: Partial<ExistingPatternProposalIssue> = {}): ExistingPatternProposalIssue {
  return {
    number: 1,
    state: 'open',
    labels: [PATTERN_PROPOSAL_LABEL],
    body: `<!-- pattern-proposal:fingerprint=${'a'.repeat(64)} -->\n<!-- pattern-proposal:source-ids=id-a -->`,
    ...overrides,
  }
}

describe('classifyPatternProposalOutcome', () => {
  it('classifies an open issue as proposed-pending regardless of labels', () => {
    const issue = makeIssue({state: 'open'})
    expect(classifyPatternProposalOutcome(issue)).toBe('proposed-pending')
  })

  it('classifies a closed issue with the accepted label as accepted', () => {
    const issue = makeIssue({
      state: 'closed',
      labels: [PATTERN_PROPOSAL_LABEL, PATTERN_PROPOSAL_OUTCOME_LABELS.accepted],
    })
    expect(classifyPatternProposalOutcome(issue)).toBe('accepted')
  })

  it('classifies a closed issue with the deferred label as deferred', () => {
    const issue = makeIssue({
      state: 'closed',
      labels: [PATTERN_PROPOSAL_LABEL, PATTERN_PROPOSAL_OUTCOME_LABELS.deferred],
    })
    expect(classifyPatternProposalOutcome(issue)).toBe('deferred')
  })

  it('classifies a closed issue with the rejected label as rejected', () => {
    const issue = makeIssue({
      state: 'closed',
      labels: [PATTERN_PROPOSAL_LABEL, PATTERN_PROPOSAL_OUTCOME_LABELS.rejected],
    })
    expect(classifyPatternProposalOutcome(issue)).toBe('rejected')
  })

  it('classifies a closed issue with the superseded label as superseded', () => {
    const issue = makeIssue({
      state: 'closed',
      labels: [PATTERN_PROPOSAL_LABEL, PATTERN_PROPOSAL_OUTCOME_LABELS.superseded],
    })
    expect(classifyPatternProposalOutcome(issue)).toBe('superseded')
  })

  it('classifies a closed issue with no recognized outcome label as needs-outcome (derived, not a label)', () => {
    const issue = makeIssue({state: 'closed', labels: [PATTERN_PROPOSAL_LABEL]})
    expect(classifyPatternProposalOutcome(issue)).toBe('needs-outcome')
  })

  it('classifies a closed issue with conflicting outcome labels as conflicting-labels', () => {
    const issue = makeIssue({
      state: 'closed',
      labels: [
        PATTERN_PROPOSAL_LABEL,
        PATTERN_PROPOSAL_OUTCOME_LABELS.accepted,
        PATTERN_PROPOSAL_OUTCOME_LABELS.rejected,
      ],
    })
    expect(classifyPatternProposalOutcome(issue)).toBe('conflicting-labels')
  })

  it('classifies a closed issue with an unrecognized pattern-proposal:* label as malformed-outcome', () => {
    const issue = makeIssue({state: 'closed', labels: [PATTERN_PROPOSAL_LABEL, 'pattern-proposal:bogus']})
    expect(classifyPatternProposalOutcome(issue)).toBe('malformed-outcome')
  })
})

// ---------------------------------------------------------------------------
// Solution doc source collection
// ---------------------------------------------------------------------------

describe('collectSolutionDocSources', () => {
  const headSha = 'f'.repeat(40)

  it('happy path: parses a solution doc into a source artifact with a stable ID', () => {
    const files = {
      'docs/solutions/best-practices/example-doc.md': '---\nmodule: scripts/foo.ts\n---\nBody',
    }
    const result = collectSolutionDocSources(files, headSha)
    expect(result.invalidCount).toBe(0)
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.id).toBe('example-doc')
    expect(result.sources[0]?.kind).toBe('solution-doc')
    expect(result.sources[0]?.link).toBe(buildSolutionDocLink('docs/solutions/best-practices/example-doc.md', headSha))
  })

  it('only enumerates canonical solution subdirectories', () => {
    expect(SOLUTION_SUBDIRS).toEqual([
      'best-practices',
      'documentation-gaps',
      'integration-issues',
      'runtime-errors',
      'security-issues',
      'workflow-issues',
    ])
    const files = {
      'docs/solutions/not-a-real-subdir/example-doc.md': '---\nmodule: scripts/foo.ts\n---\nBody',
    }
    const result = collectSolutionDocSources(files, headSha)
    expect(result.sources).toHaveLength(0)
    expect(result.invalidCount).toBe(0)
  })

  it('edge case: subdirectory move does not change source identity when the filename stem is unchanged', () => {
    const filesBefore = {
      'docs/solutions/best-practices/example-doc.md': '---\nmodule: scripts/foo.ts\n---\nBody',
    }
    const filesAfter = {
      'docs/solutions/workflow-issues/example-doc.md': '---\nmodule: scripts/foo.ts\n---\nBody',
    }
    const before = collectSolutionDocSources(filesBefore, headSha)
    const after = collectSolutionDocSources(filesAfter, headSha)
    expect(before.sources[0]?.id).toBe(after.sources[0]?.id)
  })

  it('edge case: frontmatter title/category edit does not change source identity', () => {
    const filesBefore = {
      'docs/solutions/best-practices/example-doc.md': '---\nmodule: scripts/foo.ts\ntitle: Old Title\n---\nBody',
    }
    const filesAfter = {
      'docs/solutions/best-practices/example-doc.md': '---\nmodule: scripts/bar.ts\ntitle: New Title\n---\nBody v2',
    }
    const before = collectSolutionDocSources(filesBefore, headSha)
    const after = collectSolutionDocSources(filesAfter, headSha)
    expect(before.sources[0]?.id).toBe(after.sources[0]?.id)
  })

  it('edge case: duplicate solution filename stems are invalid sources', () => {
    const files = {
      'docs/solutions/best-practices/example-doc.md': '---\nmodule: a\n---\nBody',
      'docs/solutions/runtime-errors/example-doc.md': '---\nmodule: b\n---\nBody',
    }
    const result = collectSolutionDocSources(files, headSha)
    expect(result.sources).toHaveLength(0)
    expect(result.invalidCount).toBe(2)
  })

  it('privacy: source IDs and links never contain private repo names, branch names, or raw body excerpts', () => {
    const files = {
      'docs/solutions/security-issues/leak-check.md': '---\nmodule: scripts/foo.ts\n---\nSecret body text here',
    }
    const result = collectSolutionDocSources(files, headSha)
    const source = result.sources[0]
    expect(source?.id).not.toContain('Secret body text here')
    expect(source?.link).not.toContain('Secret body text here')
    expect(source?.link).toContain(headSha)
  })
})

// ---------------------------------------------------------------------------
// Learning-proposal source collection
// ---------------------------------------------------------------------------

describe('collectLearningProposalSources', () => {
  it('happy path: parses a learning-proposal issue with a captured merge-SHA marker', () => {
    const sha = 'abc123def456abc123def456abc123def456abc1'
    const issues: LearningProposalIssueInput[] = [
      {
        number: 42,
        body: `Some proposal body\n<!-- captured-learning:merge_sha=${sha} -->`,
        title: 'Example proposal title',
        createdAt: '2026-06-01T00:00:00Z',
        labels: ['learning-proposal'],
      },
    ]
    const result = collectLearningProposalSources(issues)
    expect(result.invalidCount).toBe(0)
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.id).toBe(sha)
    expect(result.sources[0]?.kind).toBe('learning-proposal')
    expect(result.sources[0]?.link).toBe(buildLearningProposalLink(42))
  })

  it('edge case: missing merge-SHA marker excludes the issue and increments invalid-source counts', () => {
    const issues: LearningProposalIssueInput[] = [
      {number: 43, body: 'No marker here', title: 't', createdAt: '2026-06-01T00:00:00Z', labels: []},
    ]
    const result = collectLearningProposalSources(issues)
    expect(result.sources).toHaveLength(0)
    expect(result.invalidCount).toBe(1)
  })

  it('edge case: malformed merge-SHA marker excludes the issue and increments invalid-source counts', () => {
    const issues: LearningProposalIssueInput[] = [
      {
        number: 44,
        body: '<!-- captured-learning:merge_sha= -->',
        title: 't',
        createdAt: '2026-06-01T00:00:00Z',
        labels: [],
      },
    ]
    const result = collectLearningProposalSources(issues)
    expect(result.sources).toHaveLength(0)
    expect(result.invalidCount).toBe(1)
  })

  it('edge case: null body excludes the issue and increments invalid-source counts', () => {
    const issues: LearningProposalIssueInput[] = [
      {number: 45, body: null, title: 't', createdAt: '2026-06-01T00:00:00Z', labels: []},
    ]
    const result = collectLearningProposalSources(issues)
    expect(result.sources).toHaveLength(0)
    expect(result.invalidCount).toBe(1)
  })

  it('privacy: source links use a stable issues URL without titles or body excerpts', () => {
    const sha = 'def456abc123def456abc123def456abc123def4'
    const issues: LearningProposalIssueInput[] = [
      {
        number: 46,
        body: `Sensitive title context\n<!-- captured-learning:merge_sha=${sha} -->`,
        title: 'Sensitive title context',
        createdAt: '2026-06-01T00:00:00Z',
        labels: [],
      },
    ]
    const result = collectLearningProposalSources(issues)
    expect(result.sources[0]?.link).toBe('https://github.com/fro-bot/.github/issues/46')
    expect(result.sources[0]?.link).not.toContain('Sensitive title context')
  })
})

// ---------------------------------------------------------------------------
// fetchExistingPatternProposals — I/O shell
// ---------------------------------------------------------------------------

function makeIssueListItem(
  number: number,
  state: 'open' | 'closed',
  labels: string[],
  body: string | null,
): {number: number; state: string; labels: string[]; body: string | null} {
  return {number, state, labels, body}
}

function makeFetchOctokit(
  overrides: {
    openIssues?: ReturnType<typeof makeIssueListItem>[]
    closedIssues?: ReturnType<typeof makeIssueListItem>[]
    openThrows?: boolean
    closedThrows?: boolean
  } = {},
): PatternProposalOctokitClient {
  const openIssues = overrides.openIssues ?? []
  const closedIssues = overrides.closedIssues ?? []
  return {
    rest: {
      issues: {
        listForRepo: async (params: {state: 'open' | 'closed'; per_page: number; page: number}) => {
          if (params.state === 'open') {
            if (overrides.openThrows === true) throw new Error('API error')
            const start = (params.page - 1) * params.per_page
            return {data: openIssues.slice(start, start + params.per_page)}
          }
          if (overrides.closedThrows === true) throw new Error('API error')
          const start = (params.page - 1) * params.per_page
          return {data: closedIssues.slice(start, start + params.per_page)}
        },
      },
    },
  } as unknown as PatternProposalOctokitClient
}

describe('fetchExistingPatternProposals', () => {
  it('parses open and closed pattern-proposal issues into fingerprint-keyed maps', async () => {
    const fpOpen = 'a'.repeat(64)
    const fpClosed = 'b'.repeat(64)
    const openIssues = [
      makeIssueListItem(1, 'open', [PATTERN_PROPOSAL_LABEL], `<!-- pattern-proposal:fingerprint=${fpOpen} -->`),
    ]
    const closedIssues = [
      makeIssueListItem(
        2,
        'closed',
        [PATTERN_PROPOSAL_LABEL, PATTERN_PROPOSAL_OUTCOME_LABELS.accepted],
        `<!-- pattern-proposal:fingerprint=${fpClosed} -->`,
      ),
    ]
    const octokit = makeFetchOctokit({openIssues, closedIssues})

    const result = await fetchExistingPatternProposals({octokit, owner: 'fro-bot', repo: '.github'})

    expect(result.openByFingerprint.get(fpOpen)).toHaveLength(1)
    expect(result.closedByFingerprint.get(fpClosed)).toHaveLength(1)
  })

  it('counts malformed fingerprint markers without treating them as a match', async () => {
    const openIssues = [makeIssueListItem(1, 'open', [PATTERN_PROPOSAL_LABEL], 'No marker here')]
    const octokit = makeFetchOctokit({openIssues})

    const result = await fetchExistingPatternProposals({octokit, owner: 'fro-bot', repo: '.github'})

    expect(result.openByFingerprint.size).toBe(0)
    expect(result.invalidMarkerCount).toBe(1)
  })

  it('fails closed when the open-issue fetch throws', async () => {
    const octokit = makeFetchOctokit({openThrows: true})
    await expect(fetchExistingPatternProposals({octokit, owner: 'fro-bot', repo: '.github'})).rejects.toThrow()
  })

  it('fails closed when the closed-issue fetch throws', async () => {
    const octokit = makeFetchOctokit({closedThrows: true})
    await expect(fetchExistingPatternProposals({octokit, owner: 'fro-bot', repo: '.github'})).rejects.toThrow()
  })

  it('paginates across multiple pages of closed issues', async () => {
    const closedIssues = Array.from({length: 150}, (_, i) =>
      makeIssueListItem(
        100 + i,
        'closed',
        [PATTERN_PROPOSAL_LABEL, PATTERN_PROPOSAL_OUTCOME_LABELS.deferred],
        `<!-- pattern-proposal:fingerprint=${String(i).padStart(64, '0')} -->`,
      ),
    )
    const octokit = makeFetchOctokit({closedIssues})

    const result = await fetchExistingPatternProposals({octokit, owner: 'fro-bot', repo: '.github'})

    let total = 0
    for (const issues of result.closedByFingerprint.values()) total += issues.length
    expect(total).toBe(150)
  })
})
