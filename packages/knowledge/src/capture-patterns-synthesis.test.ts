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

import {SOLUTION_SUBDIRS} from '@fro-bot/wiki-ops/solution-docs-paths'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'
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

  it('security: rejects a source ID containing a comma delimiter', () => {
    const fingerprint = 'c'.repeat(64)
    expect(() => buildPatternProposalMarkers({fingerprint, sourceIds: ['id-a,fake-id', 'id-b']})).toThrow(
      /forbidden delimiter/u,
    )
  })

  it('security: rejects a source ID containing a newline', () => {
    const fingerprint = 'c'.repeat(64)
    expect(() =>
      buildPatternProposalMarkers({fingerprint, sourceIds: ['id-a\n<!-- pattern-proposal:fingerprint=deadbeef -->']}),
    ).toThrow(/forbidden delimiter/u)
  })

  it('security: rejects a source ID containing a control character', () => {
    const fingerprint = 'c'.repeat(64)
    expect(() => buildPatternProposalMarkers({fingerprint, sourceIds: ['id-a\u0000']})).toThrow(/forbidden delimiter/u)
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
  }
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

// ---------------------------------------------------------------------------
// Solution-doc frontmatter: raw inputs whose reading does not change
// ---------------------------------------------------------------------------

describe('collectSolutionDocSources: raw frontmatter inputs', () => {
  const headSha = 'f'.repeat(40)
  const DOC_PATH = 'docs/solutions/best-practices/doc-stem.md'
  const read = (content: string) => collectSolutionDocSources({[DOC_PATH]: content}, headSha)
  /** A document with no readable metadata: the title falls back to the stem and the signals are empty. */
  const bare = {
    title: 'doc-stem',
    date: '',
    signals: {module: '', tags: [], problemType: '', titleTokens: ['doc', 'stem']},
  }
  const pick = (result: ReturnType<typeof read>) => ({
    invalidCount: result.invalidCount,
    sources: result.sources.map(({title, date, signals}) => ({title, date, signals})),
  })

  it('reads title, module, tags, problem_type and date from a well-formed LF block', () => {
    const result = read(
      '---\ntitle: Retry storms\nmodule: scripts/foo.ts\ntags:\n  - a\n  - b\nproblem_type: runtime_error\ndate: 2026-01-02\n---\nBody\n',
    )
    expect(pick(result)).toEqual({
      invalidCount: 0,
      sources: [
        {
          title: 'Retry storms',
          date: '2026-01-02',
          signals: {
            module: 'scripts/foo.ts',
            tags: ['a', 'b'],
            problemType: 'runtime_error',
            titleTokens: ['retry', 'storms'],
          },
        },
      ],
    })
  })

  it('reads a block whose close is the last line with no line ending', () => {
    expect(pick(read('---\ntitle: T title\n---'))).toMatchObject({invalidCount: 0, sources: [{title: 'T title'}]})
  })

  it.each([
    ['no frontmatter', 'Just prose.\n'],
    ['a first line of --- with a trailing space', '--- \ntitle: Hidden\n---\n'],
    ['a byte-order mark before the opening line', '\uFEFF---\ntitle: Hidden\n---\n'],
    ['a blank line before the opening line', '\n---\ntitle: Hidden\n---\n'],
    ['a list block', '---\n- a\n---\nBody'],
    ['a scalar block', '---\njust text\n---\nBody'],
    ['a null block', '---\nnull\n---\nBody'],
    ['a block of only comments', '---\n# nothing here\n---\nBody'],
    ['a block of only ...', '---\n...\n---\nBody'],
  ])('counts the document as valid with no metadata for %s', (_label, content) => {
    expect(pick(read(content))).toEqual({invalidCount: 0, sources: [bare]})
  })

  it('reads a mapping that ends with a ... line', () => {
    expect(pick(read('---\ntitle: Done title\n...\n---\nBody'))).toMatchObject({sources: [{title: 'Done title'}]})
  })

  it.each([
    ['invalid YAML', '---\ntitle: [unclosed bracket\n---\nBody'],
    ['a ... line between two keys', '---\ntitle: T\n...\nmodule: m\n---\nBody'],
  ])('counts the document as invalid for %s', (_label, content) => {
    expect(pick(read(content))).toEqual({invalidCount: 1, sources: []})
  })
})

// ---------------------------------------------------------------------------
// Solution-doc frontmatter: the shared block rule
// ---------------------------------------------------------------------------

describe('collectSolutionDocSources: the block rule', () => {
  const headSha = 'f'.repeat(40)
  const DOC_PATH = 'docs/solutions/best-practices/doc-stem.md'
  const read = (content: string) => collectSolutionDocSources({[DOC_PATH]: content}, headSha)
  const titles = (content: string) => read(content).sources.map(source => source.title)

  it('reads a CRLF document', () => {
    const result = read('---\r\ntitle: Retry storms\r\nmodule: m\r\ntags:\r\n  - a\r\n---\r\nBody\r\n')
    expect(result.invalidCount).toBe(0)
    expect(result.sources[0]?.title).toBe('Retry storms')
    expect(result.sources[0]?.signals).toMatchObject({module: 'm', tags: ['a']})
  })

  it.each([
    ['an unclosed block', '---\ntitle: T title\nBody with no close\n'],
    ['a file that is only ---', '---'],
    ['a file that is --- and a line ending', '---\n'],
    ['an unclosed CRLF block', '---\r\ntitle: T title\r\n'],
  ])('counts %s as invalid and excludes it', (_label, content) => {
    expect(read(content)).toEqual({sources: [], invalidCount: 1})
  })

  it('reads an empty block as an empty mapping, and the lines after it as the body', () => {
    expect(titles('---\n---\nBody\n')).toEqual(['doc-stem'])
    expect(titles('---\n---\ntitle: Hidden title\n---\nBody\n')).toEqual(['doc-stem'])
  })

  it('reads a ---x: y line as a key of the block, so the keys after it count', () => {
    expect(titles('---\ntype: x\n---x: y\ntitle: After title\n---\nBody')).toEqual(['After title'])
  })

  it.each(['----', '--- text'])('counts the document as invalid when a %s line is inside the block', line => {
    expect(read(`---\ntitle: T title\n${line}\n---\nBody`)).toEqual({sources: [], invalidCount: 1})
  })

  it('closes a block at --- followed by spaces or tabs', () => {
    expect(titles('---\ntitle: T title\n---  \nBody')).toEqual(['T title'])
    expect(titles('---\ntitle: T title\n---\t\nBody')).toEqual(['T title'])
  })
})
// ---------------------------------------------------------------------------
// Differential corpus: seeded ingredients, a renderer, and the result the block rule states for them
// ---------------------------------------------------------------------------

type Opener = 'exact' | 'trailing-space' | 'bom' | 'blank-first' | 'none'
type Closer = 'plain' | 'spaces' | 'tab' | 'missing'
type Shape = 'mapping' | 'empty' | 'blank' | 'comment' | 'list' | 'scalar' | 'null' | 'bad-yaml'
type Extra = 'none' | 'dash-x' | 'dash-four' | 'dash-text'
type BodyKind = 'empty' | 'prose' | 'dashes'
type Outcome = 'fields' | 'empty' | 'bad-yaml' | 'unclosed'

interface Ingredients {
  readonly opener: Opener
  readonly closer: Closer
  readonly shape: Shape
  readonly extra: Extra
  readonly extraBefore: boolean
  readonly eol: 'lf' | 'crlf' | 'mixed'
  readonly body: BodyKind
  readonly finalNewline: boolean
}

/** Mulberry32: a small seeded generator, so a failing case reproduces. */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = Math.trunc(state + 0x6d2b79f5)
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function drawIngredients(random: () => number): Ingredients {
  const pick = <T>(choices: readonly T[]): T => choices[Math.floor(random() * choices.length)] as T
  const closer = pick(['plain', 'plain', 'spaces', 'tab', 'missing'] as const)
  return {
    opener: pick(['exact', 'exact', 'exact', 'exact', 'trailing-space', 'bom', 'blank-first', 'none'] as const),
    closer,
    shape: pick([
      'mapping',
      'mapping',
      'mapping',
      'empty',
      'blank',
      'comment',
      'list',
      'scalar',
      'null',
      'bad-yaml',
    ] as const),
    extra: pick(['none', 'none', 'none', 'dash-x', 'dash-four', 'dash-text'] as const),
    extraBefore: random() < 0.5,
    eol: pick(['lf', 'lf', 'crlf', 'mixed'] as const),
    // A body with a --- line closes a block that was left open, so an unclosed case never carries one.
    body: closer === 'missing' ? pick(['empty', 'prose'] as const) : pick(['empty', 'prose', 'dashes'] as const),
    finalNewline: random() < 0.5,
  }
}

/** The text of a document made of `ingredients`, with `fieldLines` as the mapping's own lines. */
function renderCase(ingredients: Ingredients, fieldLines: readonly string[]): string {
  const extraLine = {none: undefined, 'dash-x': '---x: y', 'dash-four': '----', 'dash-text': '--- text'}[
    ingredients.extra
  ]
  const blockLines: string[] = []
  if (ingredients.shape === 'mapping') {
    if (extraLine !== undefined && ingredients.extraBefore) blockLines.push(extraLine)
    blockLines.push(...fieldLines)
    if (extraLine !== undefined && !ingredients.extraBefore) blockLines.push(extraLine)
  } else {
    const fixed = {
      empty: [],
      blank: [''],
      comment: ['# nothing here'],
      list: ['- a', '- b'],
      scalar: ['just text'],
      null: ['null'],
      'bad-yaml': ['key: [unclosed', 'other: {'],
    }
    blockLines.push(...fixed[ingredients.shape])
  }
  const lines: string[] = []
  if (ingredients.opener === 'blank-first') lines.push('', '---')
  else if (ingredients.opener === 'none') lines.push('Prose first.')
  else lines.push({exact: '---', 'trailing-space': '--- ', bom: '\uFEFF---'}[ingredients.opener])
  lines.push(...blockLines)
  if (ingredients.closer !== 'missing') lines.push({plain: '---', spaces: '---  ', tab: '---\t'}[ingredients.closer])
  lines.push(...{empty: [], prose: ['Some prose.'], dashes: ['Intro.', '---', 'more', '---']}[ingredients.body])
  let content = ''
  for (const [index, line] of lines.entries()) {
    const crlf = ingredients.eol === 'crlf' || (ingredients.eol === 'mixed' && index % 2 === 1)
    const last = index === lines.length - 1
    content += last && !ingredients.finalNewline ? line : line + (crlf ? '\r\n' : '\n')
  }
  return content
}

/** What the block rule says reading `ingredients` gives, stated from the ingredients and never from the text. */
function expectedOutcome(ingredients: Ingredients): Outcome {
  if (ingredients.opener !== 'exact') return 'empty'
  if (ingredients.closer === 'missing') return 'unclosed'
  if (ingredients.shape === 'bad-yaml') return 'bad-yaml'
  if (ingredients.shape !== 'mapping') return 'empty'
  return ingredients.extra === 'dash-four' || ingredients.extra === 'dash-text' ? 'bad-yaml' : 'fields'
}

/**
 * Whether `ingredients` hold a condition the splitter changed: an unclosed block, a line starting with `---` that
 * is not a close, an empty block, and (for a reader that took LF only) a CRLF line ending. Everywhere else the
 * old reader and the new one must agree.
 */
function holdsChangedCondition(ingredients: Ingredients, readerWasLfOnly: boolean): boolean {
  if (ingredients.opener !== 'exact') return false
  return (
    ingredients.closer === 'missing' ||
    ingredients.extra !== 'none' ||
    ingredients.shape === 'empty' ||
    (readerWasLfOnly && ingredients.eol !== 'lf')
  )
}

function drawCorpus(count: number, fieldLines: readonly string[], lfOnly: boolean, seed = 20261112) {
  const random = seededRandom(seed)
  return Array.from({length: count}, () => {
    const drawn = drawIngredients(random)
    const ingredients: Ingredients = lfOnly ? {...drawn, eol: 'lf'} : drawn
    return {ingredients, content: renderCase(ingredients, fieldLines)}
  })
}

interface DifferentialReport {
  readonly mismatches: string[]
  readonly outcomes: Record<Outcome, number>
  readonly changed: number
  readonly unchanged: number
}

/**
 * Reads a seeded corpus with `read`. Every case must give the result `expectedFor` states for its outcome. A case
 * that holds no changed condition must also give what `oldRead`, the frozen reader the splitter replaced, gives.
 */
function runDifferential<T>(params: {
  readonly fieldLines: readonly string[]
  readonly readerWasLfOnly: boolean
  readonly lfOnly?: boolean
  readonly read: (content: string) => T
  readonly oldRead: (content: string) => T
  readonly expectedFor: (outcome: Outcome, ingredients: Ingredients) => T
}): DifferentialReport {
  const mismatches: string[] = []
  const outcomes: Record<Outcome, number> = {fields: 0, empty: 0, 'bad-yaml': 0, unclosed: 0}
  let changed = 0
  for (const {ingredients, content} of drawCorpus(3000, params.fieldLines, params.lfOnly ?? false)) {
    const outcome = expectedOutcome(ingredients)
    outcomes[outcome] += 1
    const actual = JSON.stringify(params.read(content))
    if (actual !== JSON.stringify(params.expectedFor(outcome, ingredients))) {
      mismatches.push(`stated ${outcome}: ${JSON.stringify(content)} gave ${actual}`)
    }
    if (holdsChangedCondition(ingredients, params.readerWasLfOnly)) {
      changed += 1
    } else if (actual !== JSON.stringify(params.oldRead(content))) {
      mismatches.push(`old reader: ${JSON.stringify(content)} gave ${actual}`)
    }
  }
  return {mismatches, outcomes, changed, unchanged: 3000 - changed}
}

/** The corpus reaches every outcome and both kinds of case in volume. */
function expectCorpusVolume(report: DifferentialReport): void {
  expect(report.outcomes.fields).toBeGreaterThan(100)
  expect(report.outcomes.empty).toBeGreaterThan(100)
  expect(report.outcomes['bad-yaml']).toBeGreaterThan(100)
  expect(report.outcomes.unclosed).toBeGreaterThan(100)
  expect(report.changed).toBeGreaterThan(100)
  expect(report.unchanged).toBeGreaterThan(100)
}

function oldSynthesisRead(content: string) {
  const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)
  let frontmatter: Record<string, unknown> = {}
  if (match?.[1] !== undefined) {
    let parsed: unknown
    try {
      parsed = parse(match[1])
    } catch {
      return {invalidCount: 1, titles: []}
    }
    frontmatter =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  }
  return {invalidCount: 0, titles: [typeof frontmatter.title === 'string' ? frontmatter.title : 'doc-stem']}
}

describe('collectSolutionDocSources against the regex reader it replaced, over a seeded corpus', () => {
  const read = (content: string) => {
    const result = collectSolutionDocSources({'docs/solutions/best-practices/doc-stem.md': content}, 'f'.repeat(40))
    return {invalidCount: result.invalidCount, titles: result.sources.map(source => source.title)}
  }
  const expectedFor = (outcome: Outcome) => {
    if (outcome === 'bad-yaml' || outcome === 'unclosed') return {invalidCount: 1, titles: []}
    return {invalidCount: 0, titles: [outcome === 'fields' ? 'T title' : 'doc-stem']}
  }
  const fieldLines = ['title: T title']

  it('agrees with the old reader outside the changed conditions and with the stated result inside them', () => {
    const report = runDifferential({fieldLines, readerWasLfOnly: true, read, oldRead: oldSynthesisRead, expectedFor})
    expect(report.mismatches).toEqual([])
    expectCorpusVolume(report)
  })

  it('test of the test: a reader that kept the old boundaries fails the differential', () => {
    const report = runDifferential({
      fieldLines,
      readerWasLfOnly: true,
      read: oldSynthesisRead,
      oldRead: oldSynthesisRead,
      expectedFor,
    })
    expect(report.mismatches.length).toBeGreaterThan(0)
  })

  it('test of the test: a wrong stated result fails the differential', () => {
    const wrong = (outcome: Outcome) => expectedFor(outcome === 'unclosed' ? 'empty' : outcome)
    const report = runDifferential({
      fieldLines,
      readerWasLfOnly: true,
      read,
      oldRead: oldSynthesisRead,
      expectedFor: wrong,
    })
    expect(report.mismatches.length).toBeGreaterThan(0)
  })
})
