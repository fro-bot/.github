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

  it('does not time-demote a doc with verified: date-string (ISO date form)', () => {
    // #given a doc that is old but has verified: <ISO-date-string> (the real-world form)
    const verifiedDateDoc = makeDoc(
      'docs/solutions/best-practices/reconcile-repos-pattern.md',
      {
        title: 'Reconcile Repos Pattern',
        module: 'scripts/reconcile-repos.ts',
        problem_type: 'best_practice',
        last_updated: '2026-01-01', // old — exceeds 60-day staleness vs now=2026-06-22
        verified: '2026-01-01', // date-string form used by 21 of 22 real docs
        tags: ['reconcile', 'repos'],
      },
      'Use reconcile-repos to sync settings.',
    )

    // #when the freshness check sees verified: date-string
    const result = assembleSolutionsContext({
      files: verifiedDateDoc,
      event: {
        eventName: 'pull_request',
        title: 'feat: reconcile repos',
        body: 'automation',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
    })

    // #then no candidate marker is added (date-string verified suppresses staleness)
    expect(result.excerpt).not.toContain('candidate')
    expect(result.selectedPaths).toContain('docs/solutions/best-practices/reconcile-repos-pattern.md')
  })

  it('mutation-proves verified:date fix — reverting to boolean-only makes old date-string doc stale', () => {
    // #given a doc with verified: date-string and old last_updated
    // This test proves the fix by showing the doc IS stale without the date-string check.
    // We simulate the old behavior by using verified: false (no verified field) to confirm
    // the stale path fires, then confirm verified: date-string suppresses it.
    const unverifiedOldDoc = makeDoc(
      'docs/solutions/best-practices/reconcile-repos-pattern.md',
      {
        title: 'Reconcile Repos Pattern',
        module: 'scripts/reconcile-repos.ts',
        problem_type: 'best_practice',
        last_updated: '2026-01-01', // old
        // no verified field → verified=false → stale
        tags: ['reconcile', 'repos'],
      },
      'Use reconcile-repos to sync settings.',
    )

    const staleResult = assembleSolutionsContext({
      files: unverifiedOldDoc,
      event: {eventName: 'pull_request', title: 'feat: reconcile repos', body: 'automation'},
      privateNames: [],
      now: new Date('2026-06-22'),
    })

    // #when verified is absent the doc IS flagged stale (mutation baseline)
    expect(staleResult.excerpt).toContain('candidate')

    // #when verified is a date-string the doc is NOT flagged stale (the fix)
    const verifiedDateDoc = makeDoc(
      'docs/solutions/best-practices/reconcile-repos-pattern.md',
      {
        title: 'Reconcile Repos Pattern',
        module: 'scripts/reconcile-repos.ts',
        problem_type: 'best_practice',
        last_updated: '2026-01-01',
        verified: '2026-01-01',
        tags: ['reconcile', 'repos'],
      },
      'Use reconcile-repos to sync settings.',
    )

    const freshResult = assembleSolutionsContext({
      files: verifiedDateDoc,
      event: {eventName: 'pull_request', title: 'feat: reconcile repos', body: 'automation'},
      privateNames: [],
      now: new Date('2026-06-22'),
    })

    expect(freshResult.excerpt).not.toContain('candidate')
  })

  it('excludes a doc whose FRONTMATTER (not body) contains a private token (full-content scan)', () => {
    // #given a doc with a clean body but the private token only in frontmatter title
    const privateName = 'testowner/secret-repo'
    const frontmatterLeakDoc = makeDoc(
      'docs/solutions/best-practices/reconcile-repos-pattern.md',
      {
        title: 'Fix for testowner/secret-repo integration', // private token in frontmatter
        module: 'scripts/reconcile-repos.ts',
        problem_type: 'best_practice',
        last_updated: '2026-06-01',
        verified: '2026-06-01',
        tags: ['reconcile', 'repos', 'automation'],
      },
      'Use reconcile-repos to sync settings.', // clean body — no private token here
    )

    const result = assembleSolutionsContext({
      files: frontmatterLeakDoc,
      event: {
        eventName: 'pull_request',
        title: 'feat: improve reconcile-repos logic',
        body: 'Refactors the reconcile-repos automation script.',
      },
      privateNames: [privateName],
      now: new Date('2026-06-22'),
    })

    // #when the privacy gate scans the full content (frontmatter + body)
    // #then the doc is excluded even though the body is clean
    expect(result.selectedPaths).not.toContain('docs/solutions/best-practices/reconcile-repos-pattern.md')
    expect(result.excerpt).toBe('')
  })

  it('excludes a doc whose body contains the owner--name token form', () => {
    // #given a doc whose body contains the double-dash form of the private token
    const privateName = 'testowner/secret-repo'
    const doubleDashDoc = makeDoc(
      'docs/solutions/best-practices/reconcile-repos-pattern.md',
      {
        title: 'Reconcile Repos Pattern',
        module: 'scripts/reconcile-repos.ts',
        problem_type: 'best_practice',
        last_updated: '2026-06-01',
        verified: '2026-06-01',
        tags: ['reconcile', 'repos', 'automation'],
      },
      'See testowner--secret-repo for the wiki page reference.', // double-dash form
    )

    const result = assembleSolutionsContext({
      files: doubleDashDoc,
      event: {
        eventName: 'pull_request',
        title: 'feat: improve reconcile-repos logic',
        body: 'Refactors the reconcile-repos automation script.',
      },
      privateNames: [privateName],
      now: new Date('2026-06-22'),
    })

    // #when the privacy gate checks the owner--name token form
    // #then the doc is excluded fail-closed
    expect(result.selectedPaths).not.toContain('docs/solutions/best-practices/reconcile-repos-pattern.md')
    expect(result.excerpt).toBe('')
  })

  it('excludes a doc with a MIXED-CASE private name in body (case-insensitive scan)', () => {
    // #given a private name registered as lowercase, but the doc body uses mixed case
    const privateName = 'testowner/secret-repo' // registered lowercase
    const mixedCaseDoc = makeDoc(
      'docs/solutions/best-practices/reconcile-repos-pattern.md',
      {
        title: 'Reconcile Repos Pattern',
        module: 'scripts/reconcile-repos.ts',
        problem_type: 'best_practice',
        last_updated: '2026-06-01',
        verified: '2026-06-01',
        tags: ['reconcile', 'repos', 'automation'],
      },
      'See TestOwner/Secret-Repo for reference.', // mixed-case form in body
    )

    const result = assembleSolutionsContext({
      files: mixedCaseDoc,
      event: {
        eventName: 'pull_request',
        title: 'feat: improve reconcile-repos logic',
        body: 'Refactors the reconcile-repos automation script.',
      },
      privateNames: [privateName],
      now: new Date('2026-06-22'),
    })

    // #when the privacy gate lowercases both the content and the tokens
    // #then the mixed-case occurrence is still detected and the doc is excluded
    expect(result.selectedPaths).not.toContain('docs/solutions/best-practices/reconcile-repos-pattern.md')
    expect(result.excerpt).toBe('')
  })

  it('security bonus isolation: security_issue doc ranks higher than equal-scoring best_practice on security event', () => {
    // #given two docs that score EQUAL on all non-bonus dimensions (same tokens in title/tags/module/body)
    // Only problem_type differs: one is security_issue, one is best_practice.
    const securityBonusDoc = makeDoc(
      'docs/solutions/security-issues/equal-score-security.md',
      {
        title: 'Token Handling Pattern',
        module: 'scripts/token-handler.ts',
        problem_type: 'security_issue',
        last_updated: '2026-06-01',
        verified: '2026-06-01',
        tags: ['token', 'handler'],
      },
      'Handle tokens carefully to avoid leaks.',
    )

    const bestPracticeEqualDoc = makeDoc(
      'docs/solutions/best-practices/equal-score-best-practice.md',
      {
        title: 'Token Handling Pattern',
        module: 'scripts/token-handler.ts',
        problem_type: 'best_practice',
        last_updated: '2026-06-01',
        verified: '2026-06-01',
        tags: ['token', 'handler'],
      },
      'Handle tokens carefully to avoid leaks.',
    )

    // #when the event is security-flavored (contains 'leak' which is in SECURITY_EVENT_TOKENS)
    const result = assembleSolutionsContext({
      files: {...securityBonusDoc, ...bestPracticeEqualDoc},
      event: {
        eventName: 'pull_request',
        title: 'fix: token handler leak',
        body: 'Addresses a token leak in the handler.',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
    })

    // #then the security_issue doc ranks BEFORE the best_practice doc due to the +20 bonus
    const securityIdx = result.selectedPaths.indexOf('docs/solutions/security-issues/equal-score-security.md')
    const bestPracticeIdx = result.selectedPaths.indexOf('docs/solutions/best-practices/equal-score-best-practice.md')
    expect(securityIdx).toBeGreaterThanOrEqual(0)
    expect(bestPracticeIdx).toBeGreaterThanOrEqual(0)
    expect(securityIdx).toBeLessThan(bestPracticeIdx)
  })

  it('mutation-proves security bonus: without the bonus the equal-scoring docs do NOT sort security-first', () => {
    // #given the same two equal-scoring docs on a NON-security-flavored event
    // (no security tokens → bonus does not apply → tie broken by insertion order)
    // best-practice doc is spread FIRST so it appears first in Object.entries without the bonus
    const bestPracticeEqualDoc = makeDoc(
      'docs/solutions/best-practices/equal-score-best-practice.md',
      {
        title: 'Token Handling Pattern',
        module: 'scripts/token-handler.ts',
        problem_type: 'best_practice',
        last_updated: '2026-06-01',
        verified: '2026-06-01',
        tags: ['token', 'handler'],
      },
      'Handle tokens carefully to avoid leaks.',
    )

    const securityBonusDoc = makeDoc(
      'docs/solutions/security-issues/equal-score-security.md',
      {
        title: 'Token Handling Pattern',
        module: 'scripts/token-handler.ts',
        problem_type: 'security_issue',
        last_updated: '2026-06-01',
        verified: '2026-06-01',
        tags: ['token', 'handler'],
      },
      'Handle tokens carefully to avoid leaks.',
    )

    // #when the event has NO security-flavored tokens (no 'token'/'secret'/etc in event)
    const result = assembleSolutionsContext({
      files: {...bestPracticeEqualDoc, ...securityBonusDoc},
      event: {
        eventName: 'pull_request',
        title: 'refactor handler module',
        body: 'Updating the handler module.',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
    })

    // #then both docs appear and security_issue does NOT rank first (no bonus → insertion order)
    // best-practice was inserted first → it appears first without the security bonus
    const securityIdx = result.selectedPaths.indexOf('docs/solutions/security-issues/equal-score-security.md')
    const bestPracticeIdx = result.selectedPaths.indexOf('docs/solutions/best-practices/equal-score-best-practice.md')
    expect(securityIdx).toBeGreaterThanOrEqual(0)
    expect(bestPracticeIdx).toBeGreaterThanOrEqual(0)
    // Without bonus, best-practice (inserted first) appears before security_issue
    expect(bestPracticeIdx).toBeLessThan(securityIdx)
  })

  it('does not apply the security bonus on an ordinary token/auth event with no genuine security word', () => {
    // #given two equal-scoring docs, best-practice inserted first
    const bestPracticeEqualDoc = makeDoc(
      'docs/solutions/best-practices/equal-score-best-practice.md',
      {
        title: 'Token Handling Pattern',
        module: 'scripts/token-handler.ts',
        problem_type: 'best_practice',
        last_updated: '2026-06-01',
        verified: '2026-06-01',
        tags: ['token', 'handler'],
      },
      'Handle tokens carefully.',
    )
    const securityBonusDoc = makeDoc(
      'docs/solutions/security-issues/equal-score-security.md',
      {
        title: 'Token Handling Pattern',
        module: 'scripts/token-handler.ts',
        problem_type: 'security_issue',
        last_updated: '2026-06-01',
        verified: '2026-06-01',
        tags: ['token', 'handler'],
      },
      'Handle tokens carefully.',
    )

    // #when the event reads as routine token/auth work — 'token' and 'auth' alone must
    // NOT be treated as security-flavored (they fire on ordinary PRs like OAuth refresh)
    const result = assembleSolutionsContext({
      files: {...bestPracticeEqualDoc, ...securityBonusDoc},
      event: {
        eventName: 'pull_request',
        title: 'refactor: OAuth token refresh handler',
        body: 'Updating the auth token refresh path.',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
    })

    // #then no bonus applies → best-practice (inserted first) ranks before security_issue
    const securityIdx = result.selectedPaths.indexOf('docs/solutions/security-issues/equal-score-security.md')
    const bestPracticeIdx = result.selectedPaths.indexOf('docs/solutions/best-practices/equal-score-best-practice.md')
    expect(securityIdx).toBeGreaterThanOrEqual(0)
    expect(bestPracticeIdx).toBeGreaterThanOrEqual(0)
    expect(bestPracticeIdx).toBeLessThan(securityIdx)
  })

  it('multi-byte truncation: emoji at budget boundary emits no U+FFFD replacement chars', () => {
    // #given content with a 4-byte emoji positioned so the byte budget would split it
    // We use assembleSolutionsContext with a tight maxBytes to exercise truncateToBytes
    const emojiBody = 'reconcile repos 😀 automation notes'
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

    // Budget is set to force truncation mid-emoji (the header + path lines are ~80 bytes,
    // so 120 bytes total leaves very little for the body, splitting the emoji)
    const result = assembleSolutionsContext({
      files: emojiDoc,
      event: {
        eventName: 'pull_request',
        title: 'feat: reconcile repos automation',
        body: 'emoji handling',
      },
      privateNames: [],
      now: new Date('2026-06-22'),
      maxBytes: 120,
    })

    // #when the byte-budget truncation slices through emoji bytes
    // #then the output contains NO U+FFFD replacement chars
    expect(result.excerpt).not.toContain('\uFFFD')
    expect(result.byteLength).toBeLessThanOrEqual(120)
  })
})
