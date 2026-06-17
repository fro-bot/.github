import {createHash} from 'node:crypto'
import process from 'node:process'

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single tracked issue/PR's state from the GitHub API. */
export interface IssueState {
  number: number
  repo: string
  state: 'open' | 'closed' | 'merged'
  title: string
  closed_at: string | null
  labels: string[]
}

/** A single GitHub Project item with relevant fields. */
export interface ProjectItem {
  id: string
  content_number: number
  content_repo: string
  status: string | null
  readiness: string | null
  gate: string | null
}

/** A normalized snapshot item — excludes volatile prose fields. */
export interface SnapshotItem {
  content_number: number
  content_repo: string
  status: string | null
  readiness: string | null
  gate: string | null
  issue_state: 'open' | 'closed' | 'merged' | null
  issue_closed_at: string | null
  issue_labels: string[]
}

/** The full rollout snapshot — only stable, gate-relevant fields. */
export interface RolloutSnapshot {
  items: SnapshotItem[]
}

/** The data embedded in the HTML marker comment. */
export interface MarkerData {
  hash: string
  snapshot: RolloutSnapshot
}

/** The decision output from decideComment. */
export interface CommentDecision {
  should_comment: boolean
  reason: string
  hash: string
  snapshot: RolloutSnapshot
}

export interface TrackerComment {
  author: {login: string}
  body: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * HTML marker prefix embedded in tracker comments.
 * Full marker: `<!-- gateway-rollout-tracker:{...} -->`
 */
export const MARKER_PREFIX = 'gateway-rollout-tracker:'

/**
 * Fro Bot identities permitted to author tracker marker comments.
 *
 * GitHub issues/PRs surface two distinct login values depending on how the bot
 * authenticated: `fro-bot` (PAT / classic token) and `fro-bot[bot]` (GitHub
 * App installation token). Both are legitimate and must be treated as equivalent.
 *
 * Kept symmetric with the `FROBOT_AUTHORS` set in `scripts/check-wiki-authority.ts`.
 */
export const FROBOT_COMMENT_AUTHORS: ReadonlySet<string> = new Set(['fro-bot', 'fro-bot[bot]'])

// ─── Core functions (exported for tests) ─────────────────────────────────────

/**
 * The custom field name used by the GitHub Project for the gate column.
 * `gh project item-list --format json` exposes it as a top-level key with
 * this exact string (spaces included).
 */
export const GATE_FIELD_NAME = 'gateway Unit Gate'

/**
 * Normalise a raw `gh project item-list --format json` item into a ProjectItem.
 *
 * The gate value lives under the key `"gateway Unit Gate"` (with spaces), not
 * `"gate"`. Everything else follows the standard content/repository shape.
 */
export function normaliseRawProjectItem(raw: Record<string, unknown>): ProjectItem {
  const content = raw.content as Record<string, unknown> | null | undefined
  return {
    id: String(raw.id ?? ''),
    content_number: Number(content?.number ?? raw.number ?? 0),
    content_repo: String(content?.repository ?? raw.repository ?? ''),
    status: (raw.status as string | null) ?? null,
    readiness: (raw.readiness as string | null) ?? null,
    gate: (raw[GATE_FIELD_NAME] as string | null) ?? null,
  }
}

/**
 * Normalise a raw GitHub API state string into the canonical IssueState state.
 *
 * GitHub returns uppercase strings: `OPEN`, `CLOSED`, `MERGED`.
 * PRs that have been merged come back as `MERGED`, not `CLOSED`.
 */
export function normaliseIssueState(raw: string): 'open' | 'closed' | 'merged' {
  if (raw === 'CLOSED') return 'closed'
  if (raw === 'MERGED') return 'merged'
  return 'open'
}

/**
 * Derive a deduplicated list of `"repo#number"` ref strings from Project items.
 *
 * Items with an empty `content_repo` or a `content_number` of `0` are
 * considered unsupported (e.g. draft cards, notes, or items without a linked
 * issue/PR). Each unsupported item emits a warning to stderr and is excluded
 * from the returned set.
 */
export function deriveTrackedIssueRefs(items: ProjectItem[]): string[] {
  const seen = new Set<string>()
  for (const item of filterSupportedProjectItems(items)) {
    seen.add(`${item.content_repo}#${item.content_number}`)
  }
  return [...seen]
}

function filterSupportedProjectItems(items: ProjectItem[]): ProjectItem[] {
  return items.filter(item => {
    if (item.content_repo === '' || item.content_number === 0) {
      process.stderr.write(
        `rollout-tracker-snapshot: warning — skipping unsupported Project item (id=${item.id}, repo="${item.content_repo}", number=${item.content_number})\n`,
      )
      return false
    }
    return true
  })
}

/**
 * Build a normalized, deterministic snapshot from Project items and issue states.
 *
 * Volatile fields (title, body, prose) are excluded. Items are sorted by
 * repo+number for stable ordering. Issue state is merged by matching
 * content_repo+content_number to issue repo+number.
 *
 * Unsupported items (`content_repo === ''` or `content_number === 0`) are
 * excluded from the snapshot with a stderr warning.
 */
export function buildSnapshot(items: ProjectItem[], issues: IssueState[]): RolloutSnapshot {
  // Build a lookup map: "repo#number" → IssueState
  const issueMap = new Map<string, IssueState>()
  for (const issue of issues) {
    issueMap.set(`${issue.repo}#${issue.number}`, issue)
  }

  const supportedItems = filterSupportedProjectItems(items)

  const snapshotItems: SnapshotItem[] = supportedItems.map(item => {
    const key = `${item.content_repo}#${item.content_number}`
    const issue = issueMap.get(key)
    return {
      content_number: item.content_number,
      content_repo: item.content_repo,
      status: item.status,
      readiness: item.readiness,
      gate: item.gate,
      issue_state: issue?.state ?? null,
      issue_closed_at: issue?.closed_at ?? null,
      issue_labels: issue?.labels ?? [],
    }
  })

  // Sort deterministically: repo ascending, then number ascending
  snapshotItems.sort((a, b) => {
    const repoCompare = a.content_repo.localeCompare(b.content_repo)
    if (repoCompare !== 0) return repoCompare
    return a.content_number - b.content_number
  })

  return {items: snapshotItems}
}

/**
 * Produce a stable SHA-256 hex hash of a RolloutSnapshot.
 *
 * Keys are sorted recursively so insertion order does not affect the hash.
 * No volatile fields should be present in the snapshot at this point.
 */
export function hashSnapshot(snapshot: RolloutSnapshot): string {
  const stable = JSON.stringify(toGatingEvidence(snapshot), sortedReplacer)
  return createHash('sha256').update(stable).digest('hex')
}

function toGatingEvidence(snapshot: RolloutSnapshot): RolloutSnapshot {
  return {
    items: snapshot.items.map(item => ({
      content_number: item.content_number,
      content_repo: item.content_repo,
      status: null,
      readiness: null,
      gate: null,
      issue_state: item.issue_state,
      issue_closed_at: null,
      issue_labels: [],
    })),
  }
}

/**
 * JSON.stringify replacer that sorts object keys alphabetically.
 * Arrays preserve their order (deterministic from buildSnapshot sort).
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k]
    }
    return sorted
  }
  return value
}

/**
 * Extract the previous MarkerData from the latest `<!-- gateway-rollout-tracker:{...} -->`
 * HTML comment in a tracker comment body.
 *
 * Returns null if no marker is found or if the marker JSON is malformed.
 * When multiple markers are present, the LAST one wins (latest state).
 */
export function extractPreviousMarker(body: string): MarkerData | null {
  if (!body) return null

  // Match all occurrences; take the last one.
  // Capture everything between the prefix and the closing --> (non-greedy).
  const markerRegex = /<!--\s*gateway-rollout-tracker:([\s\S]*?)-->/g
  let lastMatch: RegExpExecArray | null = null

  for (;;) {
    const match = markerRegex.exec(body)
    if (match === null) break
    lastMatch = match
  }

  if (lastMatch === null) return null

  const jsonStr = lastMatch[1]
  if (jsonStr === undefined) return null

  try {
    const parsed: unknown = JSON.parse(jsonStr)
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>).hash !== 'string' ||
      typeof (parsed as Record<string, unknown>).snapshot !== 'object'
    ) {
      process.stderr.write('rollout-tracker-snapshot: marker JSON has unexpected shape\n')
      return null
    }
    return parsed as MarkerData
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    process.stderr.write(`rollout-tracker-snapshot: failed to parse marker JSON: ${detail}\n`)
    return null
  }
}

export function selectLatestMarkerCommentBody(comments: TrackerComment[]): string {
  return (
    comments.findLast(
      comment => FROBOT_COMMENT_AUTHORS.has(comment.author.login) && extractPreviousMarker(comment.body) !== null,
    )?.body ?? ''
  )
}

/**
 * Decide whether to post a tracker comment.
 *
 * - Cold start (previousMarker === null): always comment to seed state.
 * - Same hash as previous: no gating transition, skip.
 * - Different hash: state changed, comment.
 */
export function decideComment(
  snapshot: RolloutSnapshot,
  hash: string,
  previousMarker: MarkerData | null,
): CommentDecision {
  if (previousMarker === null) {
    return {
      should_comment: true,
      reason: 'cold start — no prior marker found; seeding initial state',
      hash,
      snapshot,
    }
  }

  if (hash === previousMarker.hash) {
    return {
      should_comment: false,
      reason: 'no gating transition — snapshot hash unchanged since last comment',
      hash,
      snapshot,
    }
  }

  return {
    should_comment: true,
    reason: `gating transition detected — hash changed from ${previousMarker.hash.slice(0, 8)} to ${hash.slice(0, 8)}`,
    hash,
    snapshot,
  }
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

/**
 * CLI mode: runs the preflight check using `gh` to fetch live data.
 *
 * Outputs JSON to stdout: { should_comment, reason, hash, snapshot }
 * Exits non-zero if Project #1 access fails (fail loudly, not silently).
 *
 * Accepts optional injected fixtures via environment variables for testing:
 *   ROLLOUT_TRACKER_ITEMS_JSON  — JSON array of ProjectItem[]
 *   ROLLOUT_TRACKER_ISSUES_JSON — JSON array of IssueState[]
 *   ROLLOUT_TRACKER_COMMENT_BODY — raw body of the latest @fro-bot tracker comment
 */
async function main(): Promise<void> {
  const trackerIssue = process.env.ROLLOUT_TRACKER_ISSUE ?? 'fro-bot/.github#3512'
  const projectUrl = process.env.ROLLOUT_TRACKER_PROJECT ?? 'https://github.com/users/fro-bot/projects/1'

  let items: ProjectItem[]
  let issues: IssueState[]
  let latestCommentBody: string

  // Allow fixture injection for tests / dry-run
  if (process.env.ROLLOUT_TRACKER_ITEMS_JSON === undefined) {
    // Fetch from GitHub Project via gh CLI
    // Project number 1 for user fro-bot
    const projectNumber = '1'
    const projectOwner = 'fro-bot'
    let rawItems: string
    try {
      const {execSync} = await import('node:child_process')
      rawItems = execSync(`gh project item-list ${projectNumber} --owner ${projectOwner} --format json --limit 100`, {
        encoding: 'utf8',
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      process.stderr.write(`rollout-tracker-snapshot: FATAL — failed to read Project ${projectUrl}: ${detail}\n`)
      process.stderr.write(
        'rollout-tracker-snapshot: refusing to treat Project access failure as no-drift; exiting 1\n',
      )
      process.exit(1)
    }

    try {
      const parsed: unknown = JSON.parse(rawItems)
      // gh project item-list --format json returns { items: [...] }
      const rawArr =
        parsed !== null && typeof parsed === 'object' && 'items' in parsed
          ? (parsed as {items: unknown[]}).items
          : (parsed as unknown[])
      items = (rawArr as Record<string, unknown>[]).map(raw => normaliseRawProjectItem(raw))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      process.stderr.write(`rollout-tracker-snapshot: failed to parse project items: ${detail}\n`)
      process.exit(1)
    }
  } else {
    try {
      items = JSON.parse(process.env.ROLLOUT_TRACKER_ITEMS_JSON) as ProjectItem[]
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      process.stderr.write(`rollout-tracker-snapshot: failed to parse ROLLOUT_TRACKER_ITEMS_JSON: ${detail}\n`)
      process.exit(1)
    }
  }

  if (process.env.ROLLOUT_TRACKER_ISSUES_JSON === undefined) {
    items = filterSupportedProjectItems(items)
    const trackedIssues = deriveTrackedIssueRefs(items)
    issues = []
    const {execSync} = await import('node:child_process')
    for (const ref of trackedIssues) {
      const [repo, numStr] = ref.split('#')
      if (repo === undefined || numStr === undefined) continue
      try {
        const raw = execSync(`gh issue view ${numStr} --repo ${repo} --json number,state,title,closedAt,labels`, {
          encoding: 'utf8',
        })
        const parsed = JSON.parse(raw) as {
          number: number
          state: string
          title: string
          closedAt: string | null
          labels: {name: string}[]
        }
        issues.push({
          number: parsed.number,
          repo,
          state: normaliseIssueState(parsed.state),
          title: parsed.title,
          closed_at: parsed.closedAt,
          labels: parsed.labels.map(l => l.name),
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        process.stderr.write(`rollout-tracker-snapshot: FATAL — failed to fetch ${ref}: ${detail}\n`)
        process.stderr.write(
          'rollout-tracker-snapshot: refusing to treat tracked issue access failure as no-drift; exiting 1\n',
        )
        process.exit(1)
      }
    }
  } else {
    try {
      issues = JSON.parse(process.env.ROLLOUT_TRACKER_ISSUES_JSON) as IssueState[]
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      process.stderr.write(`rollout-tracker-snapshot: failed to parse ROLLOUT_TRACKER_ISSUES_JSON: ${detail}\n`)
      process.exit(1)
    }
  }

  if (process.env.ROLLOUT_TRACKER_COMMENT_BODY === undefined) {
    // Fetch latest @fro-bot comment from tracker issue
    const [trackerRepo, trackerNumStr] = trackerIssue.split('#')
    if (trackerRepo === undefined || trackerNumStr === undefined) {
      process.stderr.write(`rollout-tracker-snapshot: invalid ROLLOUT_TRACKER_ISSUE format: ${trackerIssue}\n`)
      process.exit(1)
    }
    try {
      const {execSync} = await import('node:child_process')
      const raw = execSync(`gh issue view ${trackerNumStr} --repo ${trackerRepo} --comments --json comments`, {
        encoding: 'utf8',
      })
      const parsed = JSON.parse(raw) as {comments: TrackerComment[]}
      latestCommentBody = selectLatestMarkerCommentBody(parsed.comments)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      process.stderr.write(`rollout-tracker-snapshot: warning — failed to fetch tracker comments: ${detail}\n`)
      latestCommentBody = ''
    }
  } else {
    latestCommentBody = process.env.ROLLOUT_TRACKER_COMMENT_BODY
  }

  const snapshot = buildSnapshot(items, issues)
  const hash = hashSnapshot(snapshot)
  const previousMarker = extractPreviousMarker(latestCommentBody)
  const decision = decideComment(snapshot, hash, previousMarker)

  process.stdout.write(`${JSON.stringify(decision)}\n`)
  process.exit(0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
