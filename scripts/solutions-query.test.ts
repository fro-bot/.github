import {describe, expect, it} from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const solutionsQueryModulePromise: Promise<{
  assembleSolutionsContext: typeof import('./solutions-query.js').assembleSolutionsContext
}> = import(`./solutions-query${'.js'}`)
const {assembleSolutionsContext} = await solutionsQueryModulePromise

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeDoc(path: string, frontmatter: Record<string, unknown>, body: string): Record<string, string> {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}:\n${v.map(item => `  - ${item}`).join('\n')}`
      }
      return `${k}: ${String(v)}`
    })
    .join('\n')
  return {[path]: `---\n${fm}\n---\n\n${body}\n`}
}

const BEST_PRACTICE_DOC = makeDoc(
  'docs/solutions/best-practices/reconcile-repos-pattern.md',
  {
    title: 'Reconcile Repos Pattern',
    module: 'scripts/reconcile-repos.ts',
    problem_type: 'best_practice',
    last_updated: '2026-06-01',
    verified: '2026-06-01',
    tags: ['reconcile', 'repos', 'automation'],
  },
  'Use reconcile-repos to synchronize repository settings across the org.',
)

const SECURITY_DOC = makeDoc(
  'docs/solutions/security-issues/private-leak-gate.md',
  {
    title: 'Private Leak Gate',
    module: 'scripts/check-private-leak.ts',
    problem_type: 'security_issue',
    last_updated: '2026-06-10',
    verified: '2026-06-10',
    tags: ['privacy', 'security', 'leak', 'gate'],
    applies_when: ['a private identifier may appear in injected content', 'fail-closed gate required'],
  },
  'Scan injected content for private identifiers before surfacing it.',
)

const UNRELATED_DOC = makeDoc(
  'docs/solutions/workflow-issues/jq-trap.md',
  {
    title: 'JQ Falsy Coalesce Trap',
    module: 'scripts/jq-helper.ts',
    problem_type: 'workflow_issue',
    last_updated: '2026-05-17',
    verified: '2026-05-17',
    tags: ['jq', 'shell', 'workflow'],
  },
  'Avoid jq falsy coalesce in shell gates.',
)

const ALL_DOCS = {...BEST_PRACTICE_DOC, ...SECURITY_DOC, ...UNRELATED_DOC}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assembleSolutionsContext', () => {
  it('selects a doc whose module and tags match the event; excerpt includes title, Path, and Last updated', () => {
    // #given a PR event whose title/body reference the reconcile-repos module
    const result = assembleSolutionsContext({
      files: ALL_DOCS,
      event: {
        eventName: 'pull_request',
        owner: 'fro-bot',
        repo: '.github',
        title: 'feat: improve reconcile-repos logic',
        body: 'Refactors the reconcile-repos automation script.',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
    })

    // #when the scorer ranks docs by token overlap
    // #then the reconcile-repos doc is selected and the excerpt contains required fields
    expect(result.selectedPaths).toContain('docs/solutions/best-practices/reconcile-repos-pattern.md')
    expect(result.excerpt).toContain('Reconcile Repos Pattern')
    expect(result.excerpt).toContain('Path: docs/solutions/best-practices/reconcile-repos-pattern.md')
    expect(result.excerpt).toContain('Last updated: 2026-06-01')
    expect(result.byteLength).toBeGreaterThan(0)
  })

  it('returns an empty excerpt when no docs match the event context', () => {
    // #given an event with tokens that share no signal with any doc
    const result = assembleSolutionsContext({
      files: ALL_DOCS,
      event: {
        eventName: 'issues',
        owner: 'fro-bot',
        repo: '.github',
        title: 'Quartz zephyr tuning',
        body: 'Nebula glyph orbits lumen vectors.',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
    })

    // #when scoring finds zero matches
    // #then the assembled context is intentionally empty
    expect(result.excerpt).toBe('')
    expect(result.selectedPaths).toEqual([])
    expect(result.byteLength).toBe(0)
  })

  it('enforces the hard byte-budget cap and truncates with the overflow marker', () => {
    const largeBody = 'reconcile repos automation '.repeat(500)
    const bigDoc = makeDoc(
      'docs/solutions/best-practices/reconcile-repos-pattern.md',
      {
        title: 'Reconcile Repos Pattern',
        module: 'scripts/reconcile-repos.ts',
        problem_type: 'best_practice',
        last_updated: '2026-06-01',
        verified: '2026-06-01',
        tags: ['reconcile', 'repos'],
      },
      largeBody,
    )

    // #given a matching doc whose body far exceeds the byte budget
    const result = assembleSolutionsContext({
      files: bigDoc,
      event: {
        eventName: 'pull_request',
        title: 'feat: reconcile repos',
        body: 'automation',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
      maxBytes: 300,
    })

    // #when the packer truncates to fit the budget
    // #then the excerpt contains the overflow marker and stays within budget
    expect(result.excerpt).toContain('…')
    expect(result.byteLength).toBeLessThanOrEqual(300)
    expect(result.excerpt).not.toContain('�')
  })

  it('truncates multi-byte utf8 content without emitting invalid text', () => {
    const emojiBody = 'reconcile repos 😀😀😀 automation notes.'.repeat(200)
    const emojiDoc = makeDoc(
      'docs/solutions/best-practices/reconcile-repos-pattern.md',
      {
        title: 'Reconcile Repos Pattern',
        module: 'scripts/reconcile-repos.ts',
        problem_type: 'best_practice',
        last_updated: '2026-06-01',
        verified: '2026-06-01',
        tags: ['reconcile', 'repos'],
      },
      emojiBody,
    )

    // #given a matching doc with emoji-heavy body that must be truncated
    const result = assembleSolutionsContext({
      files: emojiDoc,
      event: {
        eventName: 'pull_request',
        title: 'feat: reconcile repos automation',
        body: 'emoji handling',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
      maxBytes: 200,
    })

    // #when utf8 truncation slices through emoji bytes
    // #then the result is valid text with the overflow marker and no replacement chars
    expect(result.excerpt).toContain('…')
    expect(result.byteLength).toBeLessThanOrEqual(200)
    expect(result.excerpt).not.toContain('�')
  })

  it('ranks a security_issue doc above a best_practice doc on a security-flavored event', () => {
    // #given a PR event with security-flavored title tokens
    const result = assembleSolutionsContext({
      files: ALL_DOCS,
      event: {
        eventName: 'pull_request',
        owner: 'fro-bot',
        repo: '.github',
        title: 'fix: security leak in private token handling',
        body: 'Addresses a credential leak in the auth gate.',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
    })

    // #when the scorer applies event-aware problem_type weighting
    // #then the security_issue doc ranks above the best_practice doc
    const securityIdx = result.selectedPaths.indexOf('docs/solutions/security-issues/private-leak-gate.md')
    const bestPracticeIdx = result.selectedPaths.indexOf('docs/solutions/best-practices/reconcile-repos-pattern.md')
    expect(securityIdx).toBeGreaterThanOrEqual(0)
    // security doc should appear before best_practice doc (or best_practice may not appear at all)
    if (bestPracticeIdx !== -1) {
      expect(securityIdx).toBeLessThan(bestPracticeIdx)
    }
  })

  it('matches a free-form module field via substring/token overlap', () => {
    // #given an event token that is a substring of the module path
    const result = assembleSolutionsContext({
      files: BEST_PRACTICE_DOC,
      event: {
        eventName: 'pull_request',
        title: 'refactor reconcile-repos script',
        body: 'Updating the reconcile-repos module.',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
    })

    // #when the scorer checks module via token overlap (not equality)
    // #then the doc is selected even though the event token is not the full module path
    expect(result.selectedPaths).toContain('docs/solutions/best-practices/reconcile-repos-pattern.md')
  })

  it('excludes a doc whose body contains a private token (fail-closed privacy gate)', () => {
    // #given a fixture private name and a doc whose body contains that private token
    const privateName = 'testowner/secret-repo'
    const leakyDoc = makeDoc(
      'docs/solutions/best-practices/reconcile-repos-pattern.md',
      {
        title: 'Reconcile Repos Pattern',
        module: 'scripts/reconcile-repos.ts',
        problem_type: 'best_practice',
        last_updated: '2026-06-01',
        verified: '2026-06-01',
        tags: ['reconcile', 'repos', 'automation'],
      },
      // Body contains the private token — must be excluded fail-closed
      'Use reconcile-repos to sync settings. See testowner/secret-repo for reference.',
    )

    const result = assembleSolutionsContext({
      files: leakyDoc,
      event: {
        eventName: 'pull_request',
        title: 'feat: improve reconcile-repos logic',
        body: 'Refactors the reconcile-repos automation script.',
      },
      privateNames: [privateName],
      now: new Date('2026-06-22'),
    })

    // #when the privacy gate scans the doc body for private tokens
    // #then the doc is excluded fail-closed and no private name appears in any output field
    expect(result.selectedPaths).not.toContain('docs/solutions/best-practices/reconcile-repos-pattern.md')
    expect(result.excerpt).not.toContain('testowner/secret-repo')
    expect(result.excerpt).not.toContain('testowner--secret-repo')
    expect(result.excerpt).not.toContain('secret-repo')
    // excerpt is empty because the only matching doc was excluded
    expect(result.excerpt).toBe('')
  })

  it('mutation-proves the privacy exclusion: removing privateNames makes the doc appear', () => {
    // #given the same leaky doc but with no privateNames supplied
    const leakyDoc = makeDoc(
      'docs/solutions/best-practices/reconcile-repos-pattern.md',
      {
        title: 'Reconcile Repos Pattern',
        module: 'scripts/reconcile-repos.ts',
        problem_type: 'best_practice',
        last_updated: '2026-06-01',
        verified: '2026-06-01',
        tags: ['reconcile', 'repos', 'automation'],
      },
      'Use reconcile-repos to sync settings. See testowner/secret-repo for reference.',
    )

    const result = assembleSolutionsContext({
      files: leakyDoc,
      event: {
        eventName: 'pull_request',
        title: 'feat: improve reconcile-repos logic',
        body: 'Refactors the reconcile-repos automation script.',
      },
      privateNames: [], // no private names → gate is open → doc appears
      now: new Date('2026-06-22'),
    })

    // #when no private names are registered the doc is NOT excluded
    // #then it appears in the excerpt (proving the exclusion in the prior test is the gate, not scoring)
    expect(result.selectedPaths).toContain('docs/solutions/best-practices/reconcile-repos-pattern.md')
    expect(result.excerpt).toContain('Reconcile Repos Pattern')
  })

  it('flags a stale doc as a candidate suggestion when last_updated exceeds the threshold', () => {
    const staleDoc = makeDoc(
      'docs/solutions/best-practices/reconcile-repos-pattern.md',
      {
        title: 'Reconcile Repos Pattern',
        module: 'scripts/reconcile-repos.ts',
        problem_type: 'best_practice',
        last_updated: '2025-01-01', // very old
        tags: ['reconcile', 'repos'],
      },
      'Use reconcile-repos to sync settings.',
    )

    // #given a doc whose last_updated is older than the staleness threshold
    const result = assembleSolutionsContext({
      files: staleDoc,
      event: {
        eventName: 'pull_request',
        title: 'feat: reconcile repos',
        body: 'automation',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
    })

    // #when the freshness check compares last_updated to now
    // #then the doc is rendered with a candidate-suggestion marker
    expect(result.excerpt).toContain('candidate')
    expect(result.excerpt).toContain('2025-01-01')
  })

  it('does not time-demote a doc with verified: true', () => {
    const verifiedDoc = makeDoc(
      'docs/solutions/best-practices/reconcile-repos-pattern.md',
      {
        title: 'Reconcile Repos Pattern',
        module: 'scripts/reconcile-repos.ts',
        problem_type: 'best_practice',
        last_updated: '2025-01-01', // old but verified
        verified: true,
        tags: ['reconcile', 'repos'],
      },
      'Use reconcile-repos to sync settings.',
    )

    // #given a doc that is old but has verified: true
    const result = assembleSolutionsContext({
      files: verifiedDoc,
      event: {
        eventName: 'pull_request',
        title: 'feat: reconcile repos',
        body: 'automation',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
    })

    // #when the freshness check sees verified: true
    // #then no candidate marker is added
    expect(result.excerpt).not.toContain('candidate')
    expect(result.selectedPaths).toContain('docs/solutions/best-practices/reconcile-repos-pattern.md')
  })

  it('does not throw when a doc is missing last_updated', () => {
    const noDateDoc = makeDoc(
      'docs/solutions/best-practices/reconcile-repos-pattern.md',
      {
        title: 'Reconcile Repos Pattern',
        module: 'scripts/reconcile-repos.ts',
        problem_type: 'best_practice',
        tags: ['reconcile', 'repos'],
        // no last_updated
      },
      'Use reconcile-repos to sync settings.',
    )

    // #given a doc with no last_updated field
    const result = assembleSolutionsContext({
      files: noDateDoc,
      event: {
        eventName: 'pull_request',
        title: 'feat: reconcile repos',
        body: 'automation',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
    })

    // #when the freshness check encounters a missing date
    // #then it does not throw and the doc is still returned without a stale flag
    expect(result.selectedPaths).toContain('docs/solutions/best-practices/reconcile-repos-pattern.md')
    expect(result.excerpt).not.toContain('candidate')
  })

  it('skips a doc with malformed frontmatter and still returns others', () => {
    const malformedDoc = {
      'docs/solutions/best-practices/malformed.md': '---\ntitle: [unclosed bracket\n---\n\nSome body text.\n',
    }

    // #given a corpus with one malformed doc and one valid matching doc
    const result = assembleSolutionsContext({
      files: {...malformedDoc, ...BEST_PRACTICE_DOC},
      event: {
        eventName: 'pull_request',
        title: 'feat: reconcile repos',
        body: 'automation',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
    })

    // #when the loader encounters a parse error on one doc
    // #then that doc is skipped and the valid doc is still returned
    expect(result.selectedPaths).toContain('docs/solutions/best-practices/reconcile-repos-pattern.md')
    expect(result.selectedPaths).not.toContain('docs/solutions/best-practices/malformed.md')
  })
})
