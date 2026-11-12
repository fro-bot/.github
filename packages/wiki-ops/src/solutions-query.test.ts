import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import process from 'node:process'
import {describe, expect, it, vi} from 'vitest'
import {parse} from 'yaml'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const solutionsQueryModulePromise: Promise<{
  assembleSolutionsContext: typeof import('./solutions-query.js').assembleSolutionsContext
  searchSolutions: typeof import('./solutions-query.js').searchSolutions
}> = import(`./solutions-query${'.js'}`)
const {assembleSolutionsContext, searchSolutions} = await solutionsQueryModulePromise

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

  it('names a skipped malformed doc on stderr by path and error code, never by frontmatter text', () => {
    // #given a doc whose parse error would interpolate source text into the message (an unresolved
    // alias is a plain ReferenceError whose FIRST line carries the token), and a token that must
    // not reach the log surface
    const files = {
      'docs/solutions/best-practices/alias.md': '---\ntitle: *acme-private-repo\n---\n\nBody.\n',
      'docs/solutions/best-practices/scalar.md': '---\ntitle: `acme-private-repo` leaked\n---\n\nBody.\n',
    }
    const written: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
      written.push(String(chunk))
      return true
    })

    try {
      assembleSolutionsContext({
        files,
        event: {eventName: 'pull_request', title: 'x', body: 'x'},
        privateNames: [],
        now: new Date('2026-06-22'),
      })
    } finally {
      spy.mockRestore()
    }

    // #then each skip is announced with its path and a closed-vocabulary reason
    const skips = written.filter(line => line.includes('malformed frontmatter'))
    expect(skips).toHaveLength(2)
    expect(skips.some(line => line.includes('(path: docs/solutions/best-practices/alias.md): ReferenceError'))).toBe(
      true,
    )
    expect(
      skips.some(line =>
        /\(path: docs\/solutions\/best-practices\/scalar\.md\): BAD_SCALAR_START at line \d+/u.test(line),
      ),
    ).toBe(true)
    // #then no line carries frontmatter-derived text
    for (const line of written) {
      expect(line).not.toContain('acme-private-repo')
    }
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

// ---------------------------------------------------------------------------
// searchSolutions: the query entry for in-process callers
// ---------------------------------------------------------------------------

type Readers = Parameters<typeof searchSolutions>[1]

/** A file-system error as Node raises it: the `code` is what tells a missing path from an unreadable one. */
function fsError(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${path}`), {code})
}

/** An in-memory checkout: a map from path to content. A directory exists when some path sits under it. */
function memoryReaders(files: Readonly<Record<string, string>>, overrides: Partial<Readers> = {}): Readers {
  return {
    readDir: async path => {
      const prefix = `${path}/`
      const names = Object.keys(files)
        .filter(file => file.startsWith(prefix) && !file.slice(prefix.length).includes('/'))
        .map(file => file.slice(prefix.length))
      const isDirectory = Object.keys(files).some(file => file.startsWith(prefix))
      if (!isDirectory) throw fsError('ENOENT', path)
      return names.map(name => ({name, isFile: () => true}))
    },
    readFile: async path => {
      const content = files[path]
      if (content === undefined) throw fsError('ENOENT', path)
      return content
    },
    ...overrides,
  }
}

const SEARCH_REPOS_YAML = 'repos:\n  - owner: acme-corp\n    name: hidden-repo\n    private: true\n'

describe('searchSolutions', () => {
  it('returns the doc whose title matches the query, with its excerpt and path', async () => {
    // #given a checkout holding one reconcile doc
    const files = {...ALL_DOCS, 'metadata/repos.yaml': SEARCH_REPOS_YAML}

    // #when the query matches that doc's title
    const outcome = await searchSolutions('reconcile repos pattern', memoryReaders(files))

    // #then the result carries the doc
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.selectedPaths).toEqual(['docs/solutions/best-practices/reconcile-repos-pattern.md'])
    expect(outcome.result.excerpt).toContain('## Reconcile Repos Pattern')
    expect(outcome.result.excerpt).toContain('Path: docs/solutions/best-practices/reconcile-repos-pattern.md')
  })

  it('returns an empty result, not a failure, when nothing matches', async () => {
    const files = {...ALL_DOCS, 'metadata/repos.yaml': SEARCH_REPOS_YAML}

    const outcome = await searchSolutions('zzzzqqqq nonexistent topic', memoryReaders(files))

    expect(outcome).toEqual({ok: true, result: {excerpt: '', selectedPaths: [], byteLength: 0}})
  })

  it.each([
    ['empty', '   '],
    ['path-like', '../etc/passwd'],
    ['overbroad', 'wiki'],
    ['over 200 characters', `reconcile ${'a'.repeat(200)}`],
  ])('rejects a %s query before reading anything', async (_label, query) => {
    // #given readers that fail the test when touched
    const touched = vi.fn()
    const readers: Readers = {
      readDir: async () => {
        touched()
        return []
      },
      readFile: async () => {
        touched()
        return ''
      },
    }

    // #when the query is rejected
    const outcome = await searchSolutions(query, readers)

    // #then no corpus access happened
    expect(outcome).toEqual({ok: false, reason: 'invalid-query'})
    expect(touched).not.toHaveBeenCalled()
  })

  it('fails with corpus-unavailable when the docs/solutions tree is missing, and the sink gets no path', async () => {
    // #given a checkout with metadata but no docs/solutions
    const warn = vi.fn()
    const readers = memoryReaders({'metadata/repos.yaml': SEARCH_REPOS_YAML}, {warn})
    const missing: Readers = {
      ...readers,
      readDir: async path => {
        throw fsError('ENOENT', path)
      },
    }

    // #when a valid query runs
    const outcome = await searchSolutions('reconcile repos pattern', missing)

    // #then the failure is distinct from an empty match and nothing carrying a path reached the sink
    expect(outcome).toEqual({ok: false, reason: 'corpus-unavailable'})
    expect(warn).not.toHaveBeenCalled()
  })

  it('fails with corpus-unavailable when one category lists and another exists but cannot be listed', async () => {
    // #given a readable category and a category directory that exists but denies the listing
    const files = {...BEST_PRACTICE_DOC, 'metadata/repos.yaml': SEARCH_REPOS_YAML}
    const readers = memoryReaders(files)
    const denied: Readers = {
      ...readers,
      readDir: async path => {
        if (path === 'docs/solutions/security-issues') throw fsError('EACCES', path)
        return readers.readDir(path)
      },
    }
    const warn = vi.fn()

    // #when a query that the readable category matches runs
    const outcome = await searchSolutions('reconcile repos pattern', {...denied, warn})

    // #then a partial corpus is a failure, not a successful answer from the readable half
    expect(outcome).toEqual({ok: false, reason: 'corpus-unavailable'})
  })

  it('fails with corpus-unavailable when one doc reads and another cannot be read', async () => {
    const files = {
      ...BEST_PRACTICE_DOC,
      'docs/solutions/best-practices/unreadable.md': '---\ntitle: Unreadable\n---\nbody\n',
      'metadata/repos.yaml': SEARCH_REPOS_YAML,
    }
    const readers = memoryReaders(files)
    const denied: Readers = {
      ...readers,
      readFile: async path => {
        if (path === 'docs/solutions/best-practices/unreadable.md') throw fsError('EACCES', path)
        return readers.readFile(path)
      },
    }

    expect(await searchSolutions('reconcile repos pattern', denied)).toEqual({ok: false, reason: 'corpus-unavailable'})
  })

  it('treats a category directory that does not exist as a normal skip', async () => {
    // #given only one category exists; the rest raise ENOENT
    const files = {...BEST_PRACTICE_DOC, 'metadata/repos.yaml': SEARCH_REPOS_YAML}

    const outcome = await searchSolutions('reconcile repos pattern', memoryReaders(files))

    expect(outcome.ok).toBe(true)
  })

  it('fails with metadata-unavailable when repos.yaml cannot be read, parsed or has the wrong shape', async () => {
    const docs = {...ALL_DOCS}
    const readers = memoryReaders(docs)

    await expect(searchSolutions('reconcile repos pattern', readers)).resolves.toEqual({
      ok: false,
      reason: 'metadata-unavailable',
    })
    await expect(
      searchSolutions('reconcile repos pattern', memoryReaders({...docs, 'metadata/repos.yaml': 'repos: [unclosed\n'})),
    ).resolves.toEqual({ok: false, reason: 'metadata-unavailable'})
    await expect(
      searchSolutions('reconcile repos pattern', memoryReaders({...docs, 'metadata/repos.yaml': 'just a string\n'})),
    ).resolves.toEqual({ok: false, reason: 'metadata-unavailable'})
    await expect(
      searchSolutions('reconcile repos pattern', memoryReaders({...docs, 'metadata/repos.yaml': 'other: 1\n'})),
    ).resolves.toEqual({ok: false, reason: 'metadata-unavailable'})
  })

  it('applies the private-name scan and routes warnings to the injected sink, never to process.stderr', async () => {
    // #given a doc naming a private repo and a doc with malformed frontmatter
    const files = {
      ...BEST_PRACTICE_DOC,
      'docs/solutions/workflow-issues/leaky.md':
        '---\ntitle: Reconcile leak\n---\nReconcile acme-corp/hidden-repo settings.\n',
      'docs/solutions/workflow-issues/broken.md': '---\ntitle: [unclosed\n---\nreconcile body\n',
      'metadata/repos.yaml': SEARCH_REPOS_YAML,
    }
    const warn = vi.fn()
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      // #when the query matches all three
      const outcome = await searchSolutions('reconcile repos', memoryReaders(files, {warn}))

      // #then only the clean doc is returned, the sink saw both skips, and process.stderr stayed silent
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      expect(outcome.result.selectedPaths).toEqual(['docs/solutions/best-practices/reconcile-repos-pattern.md'])
      expect(warn.mock.calls.map(call => String(call[0]))).toEqual(
        expect.arrayContaining([
          expect.stringContaining('excluded 1 doc on privacy scan'),
          expect.stringContaining('skipped 1 doc on malformed frontmatter'),
        ]),
      )
      expect(stderr).not.toHaveBeenCalled()
    } finally {
      stderr.mockRestore()
    }
  })

  it('drops warnings by default and never writes to process.stderr', async () => {
    const files = {
      'docs/solutions/workflow-issues/broken.md': '---\ntitle: [unclosed\n---\nreconcile body\n',
      'metadata/repos.yaml': SEARCH_REPOS_YAML,
    }
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      const outcome = await searchSolutions('reconcile body', memoryReaders(files))

      expect(outcome.ok).toBe(true)
      expect(stderr).not.toHaveBeenCalled()
    } finally {
      stderr.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// Real corpus gate: every docs/solutions/**/*.md frontmatter must parse
// ---------------------------------------------------------------------------

describe('docs/solutions corpus', () => {
  const root = 'docs/solutions'
  const docPaths = readdirSync(root, {withFileTypes: true, recursive: true})
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => join(entry.parentPath, entry.name))
    .sort()

  it('contains documents', () => {
    expect(docPaths.length).toBeGreaterThan(0)
  })

  it.each(docPaths)('%s has parseable YAML frontmatter', path => {
    // #given the real doc on disk
    const content = readFileSync(path, 'utf8')
    const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)

    // #then it has a frontmatter block and yaml.parse accepts it -- collectDocs skips (with a
    // stderr line) any doc whose frontmatter throws, so a doc that fails here is invisible to
    // every future retrieval while all other gates stay green
    expect(match, 'missing frontmatter block').not.toBeNull()
    expect(() => {
      parse(match?.[1] ?? '')
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Frontmatter: the shared block rule
// ---------------------------------------------------------------------------

describe('assembleSolutionsContext: the block rule', () => {
  const DOC_PATH = 'docs/solutions/best-practices/doc.md'

  /** Reads one document with an event that matches the token `docs`, which the path and a `Docs` title both carry. */
  function readDoc(content: string) {
    const warnings: string[] = []
    const result = assembleSolutionsContext({
      files: {[DOC_PATH]: content},
      event: {eventName: 'issues', title: 'docs', body: ''},
      privateNames: [],
      now: new Date('2026-06-22'),
      warn: line => warnings.push(line),
    })
    return {warnings, excerpt: result.excerpt, selectedPaths: result.selectedPaths}
  }

  const UNCLOSED_WARNING = `solutions-query: skipped 1 doc on malformed frontmatter (path: ${DOC_PATH}): unclosed-frontmatter\n`

  it('reads a CRLF document: the title and tags come from the block', () => {
    const {excerpt} = readDoc(
      '---\r\ntitle: Docs CRLF title\r\nmodule: m\r\ntags:\r\n  - alpha\r\n---\r\nBody text\r\n',
    )
    expect(excerpt).toContain('## Docs CRLF title\n')
    expect(excerpt).toContain('\n\nBody text\n')
  })

  it.each([
    ['an unclosed block', '---\ntitle: Docs unclosed\nBody text with no close\n'],
    ['a file that is only ---', '---'],
    ['a file that is --- and a line ending', '---\n'],
    ['an unclosed CRLF block', '---\r\ntitle: Docs unclosed\r\n'],
  ])('skips %s with the warning and the fixed reason unclosed-frontmatter, with no position', (_label, content) => {
    const {warnings, selectedPaths} = readDoc(content)
    expect(selectedPaths).toEqual([])
    expect(warnings).toEqual([UNCLOSED_WARNING])
  })

  it('keeps the closed vocabulary for every kind of skipped document', () => {
    const vocabulary =
      /^solutions-query: skipped 1 doc on malformed frontmatter \(path: [^)]+\): (?:[A-Z_]+ at line (?:\d+|\?)|ReferenceError|unclosed-frontmatter)\n$/u
    const contents = [
      '---\ntitle: [unclosed bracket\n---\nBody',
      '---\ntitle: *acme-private-repo\n---\nBody',
      '---\ntitle: Docs\nBody with acme-private-repo and no close',
      '---',
      '---\ntitle: T\n----\n---\nBody',
    ]
    for (const content of contents) {
      const {warnings} = readDoc(content)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toMatch(vocabulary)
      expect(warnings[0]).not.toContain('acme-private-repo')
    }
  })

  it('reads an empty block as an empty mapping, and the lines after it as the body', () => {
    expect(readDoc('---\n---\nBody text\n').excerpt).toContain(`## ${DOC_PATH}\n`)
    expect(readDoc('---\n---\ntitle: Docs hidden\n---\nBody text\n').excerpt).toContain(`## ${DOC_PATH}\n`)
  })

  it('reads a ---x: y line as a key of the block, so the keys after it count', () => {
    const {excerpt} = readDoc('---\ntype: x\n---x: y\ntitle: Docs after\n---\nBody text')
    expect(excerpt).toContain('## Docs after\n')
  })

  it.each(['----', '--- text'])('skips the document with the YAML warning when a %s line is inside the block', line => {
    const {warnings} = readDoc(`---\ntitle: Docs\n${line}\n---\nBody text`)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/malformed frontmatter \(path: .+\): [A-Z_]+ at line \d+\n$/u)
  })

  it('closes a block at --- followed by spaces or tabs, and leaves no whitespace at the start of the body', () => {
    for (const close of ['---  ', '---\t', '--- \t ']) {
      const {excerpt, warnings} = readDoc(`---\ntitle: Docs close\n${close}\nBody text\n`)
      expect(warnings).toEqual([])
      expect(excerpt).toContain('## Docs close\n')
      expect(excerpt).toContain('\n\nBody text\n')
    }
  })

  it.each([
    ['null', '---\nnull\n---\nBody text'],
    ['only comments', '---\n# nothing\n---\nBody text'],
    ['only ...', '---\n...\n---\nBody text'],
    ['a list', '---\n- a\n---\nBody text'],
  ])('gives a block that is %s no metadata, and skips nothing', (_label, content) => {
    const {warnings, excerpt} = readDoc(content)
    expect(warnings).toEqual([])
    expect(excerpt).toContain(`## ${DOC_PATH}\n`)
  })

  it('reads a mapping that ends with ..., and treats ... between two keys as invalid YAML', () => {
    expect(readDoc('---\ntitle: Docs done\n...\n---\nBody text').excerpt).toContain('## Docs done\n')
    const {warnings} = readDoc('---\ntitle: Docs\n...\nmodule: m\n---\nBody text')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/malformed frontmatter/u)
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

interface SolutionsRead {
  skipped: 'yaml' | 'unclosed' | null
  title: string | null
}

function oldSolutionsRead(content: string): SolutionsRead {
  const docPath = 'docs/solutions/best-practices/doc.md'
  const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)
  if (match?.[1] === undefined) return {skipped: null, title: docPath}
  let parsed: unknown
  try {
    parsed = parse(match[1])
  } catch {
    return {skipped: 'yaml', title: null}
  }
  const title =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as {title?: unknown}).title
      : undefined
  return {skipped: null, title: typeof title === 'string' ? title : docPath}
}

describe('assembleSolutionsContext against the regex reader it replaced, over a seeded corpus', () => {
  const docPath = 'docs/solutions/best-practices/doc.md'
  const read = (content: string): SolutionsRead => {
    const warnings: string[] = []
    const result = assembleSolutionsContext({
      files: {[docPath]: content},
      event: {eventName: 'issues', title: 'docs', body: ''},
      privateNames: [],
      now: new Date('2026-06-22'),
      warn: line => warnings.push(line),
    })
    const titleLine = result.excerpt.split('\n').find(line => line.startsWith('## '))
    let skipped: SolutionsRead['skipped'] = null
    if (warnings.length > 0)
      skipped = warnings.some(line => line.endsWith('unclosed-frontmatter\n')) ? 'unclosed' : 'yaml'
    return {skipped, title: titleLine === undefined ? null : titleLine.slice(3)}
  }
  const expectedFor = (outcome: Outcome): SolutionsRead => {
    if (outcome === 'fields') return {skipped: null, title: 'Docs title'}
    if (outcome === 'empty') return {skipped: null, title: docPath}
    return {skipped: outcome === 'unclosed' ? 'unclosed' : 'yaml', title: null}
  }
  const fieldLines = ['title: Docs title']

  it('agrees with the old reader outside the changed conditions and with the stated result inside them', () => {
    const report = runDifferential({fieldLines, readerWasLfOnly: true, read, oldRead: oldSolutionsRead, expectedFor})
    expect(report.mismatches).toEqual([])
    expectCorpusVolume(report)
  })

  it('test of the test: a reader that kept the old boundaries fails the differential', () => {
    const report = runDifferential({
      fieldLines,
      readerWasLfOnly: true,
      read: oldSolutionsRead,
      oldRead: oldSolutionsRead,
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
      oldRead: oldSolutionsRead,
      expectedFor: wrong,
    })
    expect(report.mismatches.length).toBeGreaterThan(0)
  })
})
