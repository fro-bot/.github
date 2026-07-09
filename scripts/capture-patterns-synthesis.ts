/**
 * Source corpus and pattern-proposal metadata model for recurring pattern synthesis.
 *
 * Defines the allowed source corpus (accepted `docs/solutions/` docs + learning-proposal
 * issues), stable source-ID derivation, hidden proposal markers, closed-vocabulary outcome
 * labels, and outcome classification for pattern-proposal issues.
 */

import {parse} from 'yaml'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical `docs/solutions/` subdirectories eligible as source artifacts. */
export const SOLUTION_SUBDIRS = [
  'best-practices',
  'documentation-gaps',
  'integration-issues',
  'runtime-errors',
  'security-issues',
  'workflow-issues',
] as const

const SOLUTIONS_ROOT = 'docs/solutions'

/** Primary label applied to every pattern-proposal issue. */
export const PATTERN_PROPOSAL_LABEL = 'pattern-proposal'

/** Closed vocabulary of mutually exclusive pattern-proposal outcome labels. */
export const PATTERN_PROPOSAL_OUTCOME_LABELS = {
  accepted: 'pattern-proposal:accepted',
  deferred: 'pattern-proposal:deferred',
  rejected: 'pattern-proposal:rejected',
  superseded: 'pattern-proposal:superseded',
} as const

/** Label descriptor shape, ready for `.github/settings.yml` and runtime label preflight. */
export interface PatternProposalLabelDescriptor {
  readonly name: string
  readonly color: string
  readonly description: string
}

/**
 * All labels required by the pattern-synthesis loop. `needs-outcome` is intentionally
 * absent — it is a derived state from `classifyPatternProposalOutcome`, not an operator label.
 */
export const PATTERN_PROPOSAL_REQUIRED_LABELS: readonly PatternProposalLabelDescriptor[] = [
  {
    name: PATTERN_PROPOSAL_LABEL,
    color: '5319e7',
    description: 'Recurring pattern proposal awaiting operator review',
  },
  {
    name: PATTERN_PROPOSAL_OUTCOME_LABELS.accepted,
    color: '0e8a16',
    description: 'Pattern proposal accepted as a durable lesson',
  },
  {
    name: PATTERN_PROPOSAL_OUTCOME_LABELS.deferred,
    color: 'fbca04',
    description: 'Pattern proposal deferred pending more evidence',
  },
  {
    name: PATTERN_PROPOSAL_OUTCOME_LABELS.rejected,
    color: 'e4e669',
    description: 'Pattern proposal rejected as low-signal',
  },
  {
    name: PATTERN_PROPOSAL_OUTCOME_LABELS.superseded,
    color: 'cfd3d7',
    description: 'Pattern proposal superseded by a newer proposal',
  },
]

// ---------------------------------------------------------------------------
// Hidden marker helpers
// ---------------------------------------------------------------------------

const FINGERPRINT_MARKER_PATTERN = /<!-- pattern-proposal:fingerprint=([a-f0-9]{64}) -->/u
const SOURCE_IDS_MARKER_PATTERN = /<!-- pattern-proposal:source-ids=([^\n]+?) -->/u
const SUPERSEDES_MARKER_PATTERN = /<!-- pattern-proposal:supersedes=([a-f0-9]{64}) -->/u

/**
 * Build hidden markers for a pattern-proposal issue body.
 *
 * `sourceIds` is sorted before rendering so the marker (and the fingerprint it
 * accompanies) never depends on input ordering. `supersedes`, when present, is an
 * optional fourth marker pointing at the fingerprint this proposal replaces.
 */
export function buildPatternProposalMarkers(params: {
  fingerprint: string
  sourceIds: string[]
  supersedes?: string
}): string {
  const sortedIds = [...params.sourceIds].sort((a, b) => a.localeCompare(b))
  const lines = [
    `<!-- pattern-proposal:fingerprint=${params.fingerprint} -->`,
    `<!-- pattern-proposal:source-ids=${sortedIds.join(',')} -->`,
  ]
  if (params.supersedes !== undefined) {
    lines.push(`<!-- pattern-proposal:supersedes=${params.supersedes} -->`)
  }
  return lines.join('\n')
}

/** Parse the fingerprint marker from a pattern-proposal body. Null if absent/malformed. */
export function parsePatternProposalFingerprint(body: string): string | null {
  const match = FINGERPRINT_MARKER_PATTERN.exec(body)
  return match?.[1] ?? null
}

/**
 * Parse the sorted source-IDs marker from a pattern-proposal body.
 * Returns the IDs split on commas, or null if the marker is absent or empty.
 */
export function parsePatternProposalSourceIds(body: string): string[] | null {
  const match = SOURCE_IDS_MARKER_PATTERN.exec(body)
  const raw = match?.[1]
  if (raw === undefined || raw.trim() === '') return null
  return raw.split(',').map(id => id.trim())
}

/** Parse the optional supersedes marker from a pattern-proposal body. Null if absent/malformed. */
export function parsePatternProposalSupersedes(body: string): string | null {
  const match = SUPERSEDES_MARKER_PATTERN.exec(body)
  return match?.[1] ?? null
}

// ---------------------------------------------------------------------------
// Outcome classification
// ---------------------------------------------------------------------------

/**
 * Canonical outcome states for a pattern-proposal issue.
 * `needs-outcome` is derived from a closed issue with no recognized outcome label —
 * it is never applied as an operator label.
 */
export type PatternProposalOutcomeState =
  | 'proposed-pending'
  | 'accepted'
  | 'deferred'
  | 'rejected'
  | 'superseded'
  | 'needs-outcome'
  | 'conflicting-labels'
  | 'malformed-outcome'

/** Minimal shape of an existing pattern-proposal issue used for outcome classification. */
export interface ExistingPatternProposalIssue {
  readonly number: number
  readonly state: 'open' | 'closed'
  readonly labels: readonly string[]
  readonly body: string | null | undefined
}

const RECOGNIZED_OUTCOME_LABELS: readonly string[] = [
  PATTERN_PROPOSAL_OUTCOME_LABELS.accepted,
  PATTERN_PROPOSAL_OUTCOME_LABELS.deferred,
  PATTERN_PROPOSAL_OUTCOME_LABELS.rejected,
  PATTERN_PROPOSAL_OUTCOME_LABELS.superseded,
]

/**
 * Classify a pattern-proposal issue into a canonical outcome state.
 *
 * Pure function: no I/O, no side effects. `needs-outcome` is derived state, not a label.
 *
 * Rules (priority order):
 * 1. Open issue → proposed-pending (regardless of labels).
 * 2. Closed issue with more than one recognized outcome label → conflicting-labels.
 * 3. Closed issue with an unrecognized `pattern-proposal:*` label → malformed-outcome.
 * 4. Closed issue with exactly one recognized outcome label → that outcome.
 * 5. Closed issue with no recognized outcome label → needs-outcome.
 */
export function classifyPatternProposalOutcome(issue: ExistingPatternProposalIssue): PatternProposalOutcomeState {
  if (issue.state === 'open') {
    return 'proposed-pending'
  }

  const namespacedLabels = issue.labels.filter(l => l !== PATTERN_PROPOSAL_LABEL && l.startsWith('pattern-proposal:'))

  const recognized = namespacedLabels.filter(l => RECOGNIZED_OUTCOME_LABELS.includes(l))
  if (recognized.length > 1) {
    return 'conflicting-labels'
  }

  const unrecognized = namespacedLabels.filter(l => !RECOGNIZED_OUTCOME_LABELS.includes(l))
  if (unrecognized.length > 0) {
    return 'malformed-outcome'
  }

  if (recognized.includes(PATTERN_PROPOSAL_OUTCOME_LABELS.accepted)) return 'accepted'
  if (recognized.includes(PATTERN_PROPOSAL_OUTCOME_LABELS.deferred)) return 'deferred'
  if (recognized.includes(PATTERN_PROPOSAL_OUTCOME_LABELS.rejected)) return 'rejected'
  if (recognized.includes(PATTERN_PROPOSAL_OUTCOME_LABELS.superseded)) return 'superseded'

  return 'needs-outcome'
}

// ---------------------------------------------------------------------------
// Source artifact model
// ---------------------------------------------------------------------------

/**
 * Structured correction-behavior signals used by the cluster/scoring planner.
 * to distinguish repeated correction substance from superficial keyword overlap.
 * Derived from frontmatter (solution docs) or title tokens (learning proposals) —
 * never from raw body prose.
 */
export interface PatternSourceSignals {
  /** `module` frontmatter field (solution docs) or empty string. */
  module: string
  /** `tags` frontmatter field (solution docs) or empty array. */
  tags: string[]
  /** `problem_type` frontmatter field (solution docs) or empty string. */
  problemType: string
  /** Lowercase, tokenized, stopword-filtered tokens derived from the source title. */
  titleTokens: string[]
}

/** A single source artifact eligible for pattern clustering. */
export interface PatternSourceArtifact {
  /** Stable public ID: filename stem for solution docs, merge SHA for learning proposals. */
  id: string
  kind: 'solution-doc' | 'learning-proposal'
  /** Public-safe, dereferenceable link — separate from identity. */
  link: string
  /** Public-safe title used for display and digest source-title gating. */
  title: string
  /**
   * ISO 8601 date string used for recency ranking (`date` frontmatter field for
   * solution docs; issue creation date for learning proposals). Empty string when
   * unavailable — sorts as least-recent.
   */
  date: string
  /** Structured correction-behavior signals for clustering. */
  signals: PatternSourceSignals
}

/** Result of collecting source artifacts from one corpus segment. */
export interface SourceCollectionResult {
  sources: PatternSourceArtifact[]
  invalidCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Generic English stopwords plus repo-generic tokens filtered from title tokenization.
 * Kept small and deterministic — this is display/clustering support, not NLP.
 */
const TITLE_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'do',
  'does',
  'fix',
  'for',
  'from',
  'has',
  'have',
  'in',
  'into',
  'is',
  'it',
  'not',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'will',
  'with',
])

/**
 * Tokenize a title into lowercase, stopword-filtered word tokens.
 * Pure function: no I/O.
 */
export function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(token => token.length >= 3 && !TITLE_STOPWORDS.has(token))
}

function splitFrontmatter(content: string): {frontmatter: Record<string, unknown>; body: string} {
  const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)
  if (match === null) {
    return {frontmatter: {}, body: content.trim()}
  }
  const frontmatterText = match[1]
  if (frontmatterText === undefined) {
    return {frontmatter: {}, body: content.trim()}
  }
  const parsed: unknown = parse(frontmatterText)
  return {
    frontmatter: isRecord(parsed) ? parsed : {},
    body: content.slice(match[0].length).trim(),
  }
}

/**
 * Build the SHA-pinned GitHub blob URL for a solution doc at the checked-out HEAD.
 * Identity (filename stem) is separate from this link — the link may change across
 * commits without altering the source ID.
 */
export function buildSolutionDocLink(path: string, headSha: string): string {
  return `https://github.com/fro-bot/.github/blob/${headSha}/${path}`
}

/** Build the stable issues URL for a learning-proposal issue. */
export function buildLearningProposalLink(issueNumber: number): string {
  return `https://github.com/fro-bot/.github/issues/${issueNumber}`
}

/**
 * Collect solution-doc source artifacts from a flat file map (`path -> content`).
 *
 * Only files under the canonical `docs/solutions/<subdir>/` directories are considered.
 * Source ID is the filename stem — stable across subdirectory moves and frontmatter edits.
 * Duplicate stems across any subdirectory are invalid: all colliding docs are excluded
 * and each increments `invalidCount`.
 *
 * Pure function: no I/O, fully unit-testable.
 */
export function collectSolutionDocSources(files: Record<string, string>, headSha: string): SourceCollectionResult {
  const byStem = new Map<string, string[]>()

  for (const path of Object.keys(files)) {
    if (!path.endsWith('.md')) continue
    const withinCanonicalSubdir = SOLUTION_SUBDIRS.some(subdir => path.startsWith(`${SOLUTIONS_ROOT}/${subdir}/`))
    if (!withinCanonicalSubdir) continue

    const filename = path.slice(path.lastIndexOf('/') + 1)
    const stem = filename.slice(0, -'.md'.length)
    const existing = byStem.get(stem) ?? []
    existing.push(path)
    byStem.set(stem, existing)
  }

  const sources: PatternSourceArtifact[] = []
  let invalidCount = 0

  for (const [stem, paths] of byStem) {
    if (paths.length > 1) {
      invalidCount += paths.length
      continue
    }
    const path = paths[0]
    if (path === undefined) continue

    // Frontmatter is parsed to validate the doc is readable and to extract clustering
    // signals; only the stem determines identity.
    let frontmatter: Record<string, unknown>
    try {
      frontmatter = splitFrontmatter(files[path] ?? '').frontmatter
    } catch {
      invalidCount += 1
      continue
    }

    const title = typeof frontmatter.title === 'string' ? frontmatter.title : stem
    const moduleField = typeof frontmatter.module === 'string' ? frontmatter.module : ''
    const tags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags.filter((t): t is string => typeof t === 'string')
      : []
    const problemType = typeof frontmatter.problem_type === 'string' ? frontmatter.problem_type : ''
    const date = typeof frontmatter.date === 'string' ? frontmatter.date : ''

    sources.push({
      id: stem,
      kind: 'solution-doc',
      link: buildSolutionDocLink(path, headSha),
      title,
      date,
      signals: {module: moduleField, tags, problemType, titleTokens: tokenizeTitle(title)},
    })
  }

  return {sources, invalidCount}
}

/** Minimal shape of a learning-proposal issue needed for source collection. */
export interface LearningProposalIssueInput {
  readonly number: number
  readonly body: string | null | undefined
  /** Public-safe issue title, used as display title and clustering signal source. */
  readonly title: string
  /** ISO 8601 issue creation date, used for recency ranking. */
  readonly createdAt: string
  /** Issue label names, used as tag-equivalent clustering signals. */
  readonly labels: readonly string[]
}

const CAPTURED_LEARNING_MERGE_SHA_PATTERN = /<!-- captured-learning:merge_sha=([a-f0-9]{7,40}) -->/u

/**
 * Collect learning-proposal source artifacts from raw issues.
 *
 * Source ID is the captured merge-SHA marker. Issues with a missing or malformed
 * marker are excluded from clustering and increment `invalidCount`. Links use the
 * stable public issues URL — never the issue title or raw body excerpt.
 *
 * Pure function: no I/O, fully unit-testable.
 */
export function collectLearningProposalSources(issues: readonly LearningProposalIssueInput[]): SourceCollectionResult {
  const sources: PatternSourceArtifact[] = []
  let invalidCount = 0

  for (const issue of issues) {
    const body = issue.body
    const match = typeof body === 'string' ? CAPTURED_LEARNING_MERGE_SHA_PATTERN.exec(body) : null
    const sha = match?.[1]
    if (sha === undefined) {
      invalidCount += 1
      continue
    }
    sources.push({
      id: sha,
      kind: 'learning-proposal',
      link: buildLearningProposalLink(issue.number),
      title: issue.title,
      date: issue.createdAt,
      signals: {module: '', tags: [...issue.labels], problemType: '', titleTokens: tokenizeTitle(issue.title)},
    })
  }

  return {sources, invalidCount}
}

// ---------------------------------------------------------------------------
// Existing pattern-proposal fetch (I/O shell)
// ---------------------------------------------------------------------------

/** Shape of a single issue returned by `listForRepo`, minimal fields only. */
export interface PatternProposalIssueListItem {
  readonly number: number
  readonly state: string
  readonly labels: readonly (string | {readonly name?: string | null | undefined})[]
  readonly body: string | null | undefined
}

/** Minimal Octokit-like client interface for pattern-proposal issue reads. */
export interface PatternProposalOctokitClient {
  readonly rest: {
    readonly issues: {
      readonly listForRepo: (params: {
        owner: string
        repo: string
        labels: string
        state: 'open' | 'closed'
        per_page: number
        page: number
      }) => Promise<{data: PatternProposalIssueListItem[]}>
    }
  }
}

/** Result of `fetchExistingPatternProposals`: open/closed issues keyed by fingerprint. */
export interface ExistingPatternProposals {
  openByFingerprint: Map<string, ExistingPatternProposalIssue[]>
  closedByFingerprint: Map<string, ExistingPatternProposalIssue[]>
  /** Count of issues whose fingerprint marker was missing or malformed — not suppression matches. */
  invalidMarkerCount: number
}

async function paginateAllPatternIssues(
  listFn: (page: number) => Promise<{data: PatternProposalIssueListItem[]}>,
  perPage = 100,
): Promise<PatternProposalIssueListItem[]> {
  const all: PatternProposalIssueListItem[] = []
  let page = 1
  for (;;) {
    const response = await listFn(page)
    all.push(...response.data)
    if (response.data.length < perPage) break
    page++
  }
  return all
}

/**
 * Fetch existing pattern-proposal issues across open and closed states with full
 * pagination, grouping them into fingerprint-keyed maps for later suppression/upgrade
 * decisions.
 *
 * Fail-closed: any API error is propagated to the caller so later units abort before
 * issue writes can happen. Malformed fingerprint markers are counted (`invalidMarkerCount`)
 * and excluded from the maps — never treated as a matching suppression.
 */
export async function fetchExistingPatternProposals(params: {
  octokit: PatternProposalOctokitClient
  owner: string
  repo: string
}): Promise<ExistingPatternProposals> {
  const {octokit, owner, repo} = params
  const openByFingerprint = new Map<string, ExistingPatternProposalIssue[]>()
  const closedByFingerprint = new Map<string, ExistingPatternProposalIssue[]>()
  let invalidMarkerCount = 0

  const perPage = 100

  const openItems = await paginateAllPatternIssues(
    async page =>
      octokit.rest.issues.listForRepo({
        owner,
        repo,
        labels: PATTERN_PROPOSAL_LABEL,
        state: 'open',
        per_page: perPage,
        page,
      }),
    perPage,
  )

  const closedItems = await paginateAllPatternIssues(
    async page =>
      octokit.rest.issues.listForRepo({
        owner,
        repo,
        labels: PATTERN_PROPOSAL_LABEL,
        state: 'closed',
        per_page: perPage,
        page,
      }),
    perPage,
  )

  const groupInto = (items: PatternProposalIssueListItem[], target: Map<string, ExistingPatternProposalIssue[]>) => {
    for (const item of items) {
      const labelNames = item.labels.map(l => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean)
      if (!labelNames.includes(PATTERN_PROPOSAL_LABEL)) continue

      const body = item.body ?? ''
      const fingerprint = parsePatternProposalFingerprint(body)
      if (fingerprint === null) {
        invalidMarkerCount += 1
        continue
      }

      const issue: ExistingPatternProposalIssue = {
        number: item.number,
        state: item.state === 'closed' ? 'closed' : 'open',
        labels: labelNames,
        body: item.body,
      }
      const existing = target.get(fingerprint) ?? []
      existing.push(issue)
      target.set(fingerprint, existing)
    }
  }

  groupInto(openItems, openByFingerprint)
  groupInto(closedItems, closedByFingerprint)

  return {openByFingerprint, closedByFingerprint, invalidMarkerCount}
}
