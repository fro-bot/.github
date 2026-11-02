/**
 * Claim extraction. The bounded set of public docs paths to scan, the grammars that pull claims out of one document, the file scan, and the scan of current-repo issue bodies and comments that skips the loop's own proposal issues.
 */

import {CLAIM_KIND_DEFINITIONS, normalizeClaimText, type ClaimKind, type StatusTruthClaim} from './report-model.ts'

/**
 * Bounded allowlist of glob patterns for public docs paths to scan.
 * Excludes generated/proposal state (metadata/, data branch paths).
 */
export const SCAN_GLOB_PATTERNS: readonly string[] = [
  'README.md',
  'SECURITY.md',
  'docs/**/*.md',
  'knowledge/**/*.md',
  '.github/**/*.md',
]

/**
 * Paths to exclude from scanning (generated/proposal state, and example/brainstorm
 * prose that may contain illustrative status-truth patterns that must not trigger
 * real proposals).
 */
const SCAN_EXCLUDE_PATTERNS: readonly RegExp[] = [
  /^metadata\//u,
  /^\.github\/workflows\//u,
  /^node_modules\//u,
  /^docs\/brainstorms\//u,
]

function isExcludedPath(filePath: string): boolean {
  return SCAN_EXCLUDE_PATTERNS.some(pattern => pattern.test(filePath))
}

/**
 * Pattern to detect cross-repo references in text (owner/repo#N format).
 * Used to suppress bare #N extraction when the same number appears in a
 * cross-repo context nearby, preventing misresolution as current-repo.
 */
const CROSS_REPO_REF_PATTERN = /\b[\w.-]+\/[\w.-]+#(\d+)\b/gu

/**
 * Cross-repo PR/issue claim grammar patterns.
 *
 * Matches:
 *   - `owner/repo#N is merged|open|closed`  (PR or issue — disambiguated by state)
 *   - `issue owner/repo#N is open|closed`   (explicit issue prefix)
 *   - `release owner/repo@tag is published|draft|unpublished`
 *
 * Groups: [owner, repo, number, state]
 */
const CROSS_REPO_PR_ISSUE_PATTERN = /\b(?:(issue)\s+)?([\w.-]+)\/([\w.-]+)#(\d+)\s+is\s+(merged|open|closed)\b/giu

/**
 * Cross-repo release/tag claim grammar pattern.
 *
 * Matches: `release owner/repo@tag is published|draft|unpublished`
 * Groups: [owner, repo, tag, state]
 */
const CROSS_REPO_RELEASE_PATTERN =
  /\brelease\s+([\w.-]+)\/([\w.-]+)@([\w.-]+)\s+is\s+(published|draft|unpublished)\b/giu

// ---------------------------------------------------------------------------
// Linear-time matchers
// ---------------------------------------------------------------------------
//
// A pattern that opens with `\b[\w.-]+` and needs a literal after the run is quadratic on the
// engine's own scan: a run of N word characters and dots with no `/` after it is re-read from each
// of its N positions. These text sources are GitHub-controlled (issue bodies and comments), so the
// matchers below return exactly what `text.matchAll(pattern)` returns, in linear time.
//
// Two facts make that possible. Every start of these patterns is a character of a run, and the
// outcome of a match from a start inside a run depends on that start only through the `\b` before
// it (plus the one literal-led variant noted per matcher), so only the first `\b`-valid start of
// each run is attempted and the rest of the run is skipped. Each attempt is the original pattern
// run sticky at that start, so the groups and the match text are the engine's own.

/** Asks the engine whether a word boundary sits at an index, with the flags of the pattern it stands in for. */
type BoundaryProbe = (index: number) => boolean

function boundaryProbe(text: string, flags: string): BoundaryProbe {
  const probe = new RegExp(String.raw`\b`, `${flags.replaceAll('g', '')}y`)
  return index => {
    probe.lastIndex = index
    return probe.test(text)
  }
}

/** The first position in `[start, end)` with a word boundary before it, or -1. */
function firstWordBoundary(isBoundary: BoundaryProbe, start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    if (isBoundary(index)) return index
  }
  return -1
}

/**
 * Every match of `pattern`, left to right and without overlap, trying only the starts that
 * `startsInRun` yields for each maximal run of `runClass`. `pattern` is the original pattern.
 */
function scanRuns(
  text: string,
  pattern: RegExp,
  runClass: RegExp,
  startsInRun: (runStart: number, runEnd: number, isBoundary: BoundaryProbe) => Iterable<number>,
): RegExpExecArray[] {
  const flags = pattern.flags.replaceAll('g', '')
  const sticky = new RegExp(pattern.source, `${flags}y`)
  const runs = new RegExp(runClass.source, `${flags}g`)
  const isBoundary = boundaryProbe(text, flags)
  const matches: RegExpExecArray[] = []
  let from = 0
  while (from < text.length) {
    runs.lastIndex = from
    const run = runs.exec(text)
    if (run === null) break
    const runStart = run.index
    const runEnd = runStart + run[0].length
    let found: RegExpExecArray | null = null
    for (const start of startsInRun(runStart, runEnd, isBoundary)) {
      sticky.lastIndex = start
      found = sticky.exec(text)
      if (found !== null) break
    }
    if (found === null) {
      from = runEnd
    } else {
      matches.push(found)
      from = found.index + found[0].length
    }
  }
  return matches
}

const REF_RUN = /[\w.-]+/u

/**
 * The first boundary-valid start of a `[\w.-]` run, then the start of a literal that ends the run when the
 * pattern has a literal-led variant (`literalLength` is 0 when it has none).
 */
function* referenceStarts(
  isBoundary: BoundaryProbe,
  runStart: number,
  runEnd: number,
  literalLength: number,
): Generator<number> {
  const first = firstWordBoundary(isBoundary, runStart, runEnd)
  if (first !== -1) yield first
  // The literal ends the run because whitespace follows it.
  const literalStart = runEnd - literalLength
  if (literalLength > 0 && literalStart >= runStart && literalStart !== first) yield literalStart
}

const ISSUE_LENGTH = 'issue'.length
const RELEASE_LENGTH = 'release'.length

/** Every match of `CROSS_REPO_REF_PATTERN`, as `text.matchAll(CROSS_REPO_REF_PATTERN)` returns them. */
export function matchCrossRepoRefs(text: string): RegExpExecArray[] {
  return scanRuns(text, CROSS_REPO_REF_PATTERN, REF_RUN, (runStart, runEnd, isBoundary) =>
    referenceStarts(isBoundary, runStart, runEnd, 0),
  )
}

/**
 * Every match of `CROSS_REPO_PR_ISSUE_PATTERN`. The optional `issue ` prefix adds one start per run: the
 * five characters before the run's end.
 */
export function matchCrossRepoPrIssueClaims(text: string): RegExpExecArray[] {
  return scanRuns(text, CROSS_REPO_PR_ISSUE_PATTERN, REF_RUN, (runStart, runEnd, isBoundary) =>
    referenceStarts(isBoundary, runStart, runEnd, ISSUE_LENGTH),
  )
}

/** Every match of `CROSS_REPO_RELEASE_PATTERN`. Its only start in a run is the seven characters before the run's end. */
export function matchCrossRepoReleaseClaims(text: string): RegExpExecArray[] {
  return scanRuns(text, CROSS_REPO_RELEASE_PATTERN, REF_RUN, function* (runStart, runEnd) {
    const start = runEnd - RELEASE_LENGTH
    if (start >= runStart) yield start
  })
}

const PLAN_PATH_RUN = /[\w/-]+/u
const PLAN_PATH_PREFIX = /docs\/plans\//giu
const PLAN_WORD_LENGTH = 'plan'.length
const PLAN_STATUS_TAIL = /\.md\s+is\s+(?:active|complete|draft|cancelled|superseded)\b/iuy

/**
 * Every match of the `plan-status` pattern. A path is a run of `[\w/-]` that ends where `.md` begins, so a
 * run whose end is not followed by the tail, or that ends in `/`, has no match; and a path cannot contain
 * `//`, so no start at or before the last one in the run can match. The starts left are the `docs/plans/`
 * occurrences after it, and the `plan ` prefix is a run that ends in `plan` and is followed by whitespace.
 *
 * Both searches read the run and nothing past it, so the work over a document is the sum of its runs.
 */
export function matchPlanStatusClaims(text: string, pattern: RegExp): RegExpExecArray[] {
  const occurrences = new RegExp(PLAN_PATH_PREFIX.source, PLAN_PATH_PREFIX.flags)
  return scanRuns(text, pattern, PLAN_PATH_RUN, function* (runStart, runEnd) {
    const prefixStart = runEnd - PLAN_WORD_LENGTH
    if (prefixStart >= runStart) yield prefixStart
    PLAN_STATUS_TAIL.lastIndex = runEnd
    if (!PLAN_STATUS_TAIL.test(text) || text.charAt(runEnd - 1) === '/') return
    const run = text.slice(runStart, runEnd)
    const doubleSlash = run.lastIndexOf('//')
    occurrences.lastIndex = doubleSlash === -1 ? 0 : doubleSlash + 2
    for (let occurrence = occurrences.exec(run); occurrence !== null; occurrence = occurrences.exec(run)) {
      yield runStart + occurrence.index
    }
  })
}

/**
 * Build a set of issue/PR numbers that appear in cross-repo references
 * within the given text. These numbers must not be extracted as bare #N
 * current-repo references.
 *
 * Example: "fro-bot/agent#1033 PR #1033 is open" → Set{'1033'}
 */
function extractCrossRepoNumbers(text: string): Set<string> {
  const crossRepoNumbers = new Set<string>()
  for (const match of matchCrossRepoRefs(text)) {
    const num = match[1]
    if (num !== undefined) crossRepoNumbers.add(num)
  }
  return crossRepoNumbers
}

/**
 * Extract status-truth claims from a single document's text.
 *
 * Pure function: no I/O. Exported for testing.
 *
 * For each CLAIM_KIND_DEFINITIONS pattern, scans the text for all matches.
 * Returns one StatusTruthClaim per match with:
 * - kind: the claim kind
 * - path: the file path (caller-provided)
 * - sourceRef: derived from the match groups (number or tag)
 * - claimedState: the state captured in the match
 * - normalizedText: the normalized match text
 *
 * Cross-repo references: if a number appears in an owner/repo#N context
 * anywhere in the text, bare #N claims for pr-state/issue-state are skipped
 * to prevent misresolution as current-repo references. rollout-tracker-status
 * is exempt: its grammar ("rollout tracker #N is <state>") is unambiguous and
 * resolves via the rollout board snapshot, which is cross-repo-aware.
 */
export function extractStatusTruthClaimsFromText(params: {path: string; text: string}): StatusTruthClaim[] {
  const {path, text} = params
  const claims: StatusTruthClaim[] = []

  // Pre-compute numbers that appear in cross-repo references (owner/repo#N).
  // These must not be extracted as bare current-repo #N references.
  const crossRepoNumbers = extractCrossRepoNumbers(text)

  for (const def of CLAIM_KIND_DEFINITIONS) {
    // Use global flag for multi-match scanning
    const globalPattern = new RegExp(
      def.pattern.source,
      def.pattern.flags.includes('g') ? def.pattern.flags : `${def.pattern.flags}g`,
    )

    const matches = def.kind === 'plan-status' ? matchPlanStatusClaims(text, def.pattern) : text.matchAll(globalPattern)
    for (const match of matches) {
      const fullMatch = match[0]
      if (fullMatch === undefined) continue

      let sourceRef: string
      let claimedState: string

      if (def.kind === 'pr-state' || def.kind === 'issue-state' || def.kind === 'rollout-tracker-status') {
        // Groups: [number, state]
        const number = match[1]
        const state = match[2]
        if (number === undefined || state === undefined) continue
        // Skip if this number appears in a cross-repo reference in the same text.
        // This prevents "fro-bot/agent#1033 PR #1033 is open" from producing
        // a bare #1033 that the resolver would treat as a current-repo reference.
        // rollout-tracker-status is exempt: its grammar is unambiguous and its
        // resolver is cross-repo-aware via the rollout board snapshot.
        if (def.kind !== 'rollout-tracker-status' && crossRepoNumbers.has(number)) continue
        sourceRef = `#${number}`
        claimedState = state.toLowerCase()
      } else if (def.kind === 'release-tag-state') {
        // Groups: [tag, state]
        const tag = match[1]
        const state = match[2]
        if (tag === undefined || state === undefined) continue
        sourceRef = `@${tag}`
        claimedState = state.toLowerCase()
      } else if (def.kind === 'plan-status') {
        // Groups: [planPath, state] — cross-file prose reference to a plan file
        // Pattern: "docs/plans/<name>.md is <status>" or "plan docs/plans/<name>.md is <status>"
        const planPath = match[1]
        const state = match[2]
        if (planPath === undefined || state === undefined) continue
        // sourceRef is the plan path itself (not path#status) for cross-file claims
        sourceRef = planPath
        claimedState = state.toLowerCase()
      } else {
        continue
      }

      const normalizedText = normalizeClaimText(fullMatch)
      claims.push({kind: def.kind, path, sourceRef, claimedState, normalizedText})
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-repo claim extraction
  // ---------------------------------------------------------------------------

  // Extract cross-repo PR/issue claims: `[issue] owner/repo#N is merged|open|closed`
  for (const match of matchCrossRepoPrIssueClaims(text)) {
    const issuePrefix = match[1] // 'issue' or undefined
    const owner = match[2]
    const repo = match[3]
    const number = match[4]
    const state = match[5]
    if (owner === undefined || repo === undefined || number === undefined || state === undefined) continue

    const fullMatch = match[0]
    const normalizedText = normalizeClaimText(fullMatch)
    const claimedState = state.toLowerCase()

    // Disambiguate: if state is 'merged', it's a PR. If 'issue' prefix, it's an issue.
    // Otherwise 'open'/'closed' could be either — mark as ambiguous for PR-first resolution.
    let kind: ClaimKind
    let targetNumberKind: 'pr' | 'issue' | 'ambiguous'
    if (issuePrefix !== undefined) {
      kind = 'issue-state'
      targetNumberKind = 'issue'
    } else if (claimedState === 'merged') {
      kind = 'pr-state'
      targetNumberKind = 'pr'
    } else {
      // 'open' or 'closed' without 'issue' prefix — ambiguous (PR or issue)
      kind = 'pr-state'
      targetNumberKind = 'ambiguous'
    }

    const sourceRef = `${owner}/${repo}#${number}`
    claims.push({
      kind,
      path,
      sourceRef,
      claimedState,
      normalizedText,
      targetOwner: owner,
      targetRepo: repo,
      targetNumberKind,
    })
  }

  // Extract cross-repo release claims: `release owner/repo@tag is published|draft|unpublished`
  for (const match of matchCrossRepoReleaseClaims(text)) {
    const owner = match[1]
    const repo = match[2]
    const tag = match[3]
    const state = match[4]
    if (owner === undefined || repo === undefined || tag === undefined || state === undefined) continue

    const fullMatch = match[0]
    const normalizedText = normalizeClaimText(fullMatch)
    const claimedState = state.toLowerCase()
    const sourceRef = `${owner}/${repo}@${tag}`

    claims.push({
      kind: 'release-tag-state',
      path,
      sourceRef,
      claimedState,
      normalizedText,
      targetOwner: owner,
      targetRepo: repo,
    })
  }

  return claims
}

/**
 * Injected file reader type for testability.
 * Production: reads from disk. Tests: returns fixture content.
 */
export type FileReader = (filePath: string) => Promise<string>

/**
 * Injected file lister type for testability.
 * Production: globs the filesystem. Tests: returns fixture paths.
 */
export type FileLister = () => Promise<string[]>

/**
 * Claim kinds enabled by default in production scans.
 *
 * `plan-status` uses the file-parse resolver (`resolvePlanStatusClaim`).
 * The grammar requires an explicit `docs/plans/...md` path reference, so
 * self-referential frontmatter and ambiguous prose do not produce claims.
 */
export const DEFAULT_ENABLED_KINDS: readonly ClaimKind[] = [
  'pr-state',
  'issue-state',
  'release-tag-state',
  'plan-status',
  'rollout-tracker-status',
]

/**
 * Scan a bounded set of public docs paths for status-truth claims.
 *
 * @param params - Scan parameters.
 * @param params.fileLister - Injected function that returns the list of paths to scan.
 * @param params.fileReader - Injected function that reads a file's text content.
 * @param params.enabledKinds - Claim kinds to include. Defaults to DEFAULT_ENABLED_KINDS
 *   (excludes plan-status until a real file-parse resolver exists).
 * @returns All extracted claims from all scanned files.
 *
 * Scan failures for individual files are counted but do not abort the scan.
 * If the file lister itself fails, throws so the caller can emit execution-failure.
 */
export async function scanStatusTruthClaims(params: {
  fileLister: FileLister
  fileReader: FileReader
  enabledKinds?: readonly ClaimKind[]
}): Promise<{claims: StatusTruthClaim[]; scanErrors: number}> {
  const {fileLister, fileReader, enabledKinds = DEFAULT_ENABLED_KINDS} = params
  const paths = await fileLister()
  const claims: StatusTruthClaim[] = []
  let scanErrors = 0

  for (const filePath of paths) {
    if (isExcludedPath(filePath)) continue
    try {
      const text = await fileReader(filePath)
      const fileClaims = extractStatusTruthClaimsFromText({path: filePath, text}).filter(c =>
        enabledKinds.includes(c.kind),
      )
      claims.push(...fileClaims)
    } catch {
      // Count per-file read errors; do not abort the scan
      scanErrors++
    }
  }

  return {claims, scanErrors}
}

/**
 * A minimal issue list item returned by the issue lister.
 * Injected for testability; production uses Octokit list response.
 */
export interface IssueListItem {
  readonly number: number
  readonly title: string
  readonly body: string | null
  readonly labels: readonly {readonly name: string}[]
}

/**
 * A minimal issue comment returned by the comment fetcher.
 * Injected for testability; production uses Octokit list response.
 */
export interface IssueComment {
  readonly id: number
  readonly body: string | null
}

/**
 * Injected issue lister type for testability.
 * Production: calls Octokit issues.listForRepo. Tests: returns fixture data.
 */
export type IssueLister = (params: {owner: string; repo: string}) => Promise<IssueListItem[]>

/**
 * Injected issue comment fetcher type for testability.
 * Production: calls Octokit issues.listComments. Tests: returns fixture data.
 */
export type IssueCommentFetcher = (params: {
  owner: string
  repo: string
  issueNumber: number
}) => Promise<IssueComment[]>

/**
 * Labels and title markers that identify status-truth proposal issues.
 * Issues matching any of these are excluded from scanning to prevent
 * the loop from scanning its own proposal state.
 */
const STATUS_TRUTH_PROPOSAL_LABELS: readonly string[] = ['status-truth']

const STATUS_TRUTH_PROPOSAL_TITLE_MARKER = '[status-truth-proposal]'

/**
 * Check whether an issue is a status-truth proposal issue that should be excluded.
 * Matches by label name or title prefix/marker.
 */
function isStatusTruthProposalIssue(issue: IssueListItem): boolean {
  for (const label of issue.labels) {
    if (STATUS_TRUTH_PROPOSAL_LABELS.includes(label.name)) return true
  }
  return issue.title.toLowerCase().includes(STATUS_TRUTH_PROPOSAL_TITLE_MARKER)
}

/**
 * Build a synthetic public-safe path for an issue body source.
 * Format: `github-issue://current/issues/<number>#body`
 *
 * Uses `current` instead of `owner/repo` so that generic code does not
 * embed identity before explicit publicness proof. The resolver already
 * knows the owner/repo from its own context.
 */
function issueBodyPath(issueNumber: number): string {
  return `github-issue://current/issues/${issueNumber}#body`
}

/**
 * Build a synthetic public-safe path for an issue comment source.
 * Format: `github-issue://current/issues/<number>#comment-<id>`
 *
 * Uses `current` instead of `owner/repo` for the same reason as issueBodyPath.
 */
function issueCommentPath(issueNumber: number, commentId: number): string {
  return `github-issue://current/issues/${issueNumber}#comment-${commentId}`
}

/**
 * Scan current-repo GitHub issue bodies and comments for status-truth claims.
 *
 * @param params - Scan parameters.
 * @param params.owner - Repository owner.
 * @param params.repo - Repository name.
 * @param params.issueLister - Injected function that returns open issues.
 * @param params.commentFetcher - Injected function that returns comments for an issue.
 * @param params.enabledKinds - Claim kinds to include. Defaults to DEFAULT_ENABLED_KINDS.
 * @returns Extracted claims and scan error count.
 *
 * Failure behavior:
 * - If the issue list fetch fails, returns scanErrors > 0 and empty claims (non-clean).
 * - Per-issue comment fetch failures count as scan errors but do not abort body scanning.
 * - Issues labeled `status-truth` or containing the proposal marker are skipped.
 * - Null bodies/comments are silently skipped (no error).
 */
export async function scanIssueStatusTruthClaims(params: {
  owner: string
  repo: string
  issueLister: IssueLister
  commentFetcher: IssueCommentFetcher
  enabledKinds?: readonly ClaimKind[]
}): Promise<{claims: StatusTruthClaim[]; scanErrors: number}> {
  const {owner, repo, issueLister, commentFetcher, enabledKinds = DEFAULT_ENABLED_KINDS} = params
  const claims: StatusTruthClaim[] = []
  let scanErrors = 0

  let issues: IssueListItem[]
  try {
    issues = await issueLister({owner, repo})
  } catch {
    // Issue list fetch failure — non-clean, report as scan error
    scanErrors++
    return {claims, scanErrors}
  }

  for (const issue of issues) {
    // Skip status-truth proposal issues to prevent self-scanning
    if (isStatusTruthProposalIssue(issue)) continue

    // Scan issue body
    if (issue.body !== null && issue.body !== '') {
      const bodyPath = issueBodyPath(issue.number)
      const bodyClaims = extractStatusTruthClaimsFromText({path: bodyPath, text: issue.body}).filter(c =>
        enabledKinds.includes(c.kind),
      )
      claims.push(...bodyClaims)
    }

    // Scan issue comments
    try {
      const comments = await commentFetcher({owner, repo, issueNumber: issue.number})
      for (const comment of comments) {
        if (comment.body === null || comment.body === '') continue
        const commentPath = issueCommentPath(issue.number, comment.id)
        const commentClaims = extractStatusTruthClaimsFromText({path: commentPath, text: comment.body}).filter(c =>
          enabledKinds.includes(c.kind),
        )
        claims.push(...commentClaims)
      }
    } catch {
      // Per-issue comment fetch failure — count as scan error, continue with other issues
      scanErrors++
    }
  }

  return {claims, scanErrors}
}
