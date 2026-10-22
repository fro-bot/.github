import {execFileSync} from 'node:child_process'
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

/** The latest successful run of an infra deploy workflow. */
export interface DeployRun {
  run_id: number
  head_sha: string
}

/**
 * Upstream signals that change the rollout state without touching a tracked
 * issue: the latest agent and dashboard releases, the latest successful infra
 * deploy run of each deploy workflow, and the dashboard health contract.
 */
export interface ExternalSignals {
  agent_release: string
  dashboard_release: string
  deploy_gateway: DeployRun
  deploy_dashboard: DeployRun
  deploy_router: DeployRun
  contract_version: string
}

/** The full rollout snapshot — only stable, gate-relevant fields. */
export interface RolloutSnapshot {
  items: SnapshotItem[]
  external: ExternalSignals
}

/** The data embedded in the HTML marker comment. */
export interface MarkerData {
  hash: string
  /** Markers written before the snapshot grew new fields stay parseable; only `hash` gates. */
  snapshot: unknown
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

/** The only author whose `@fro-bot` mention on the tracker issue wakes the tracker. */
export const OPERATOR_LOGIN = 'marcusrbrown'

const RELEASE_REPOS = {agent: 'fro-bot/agent', dashboard: 'fro-bot/dashboard'} as const
const INFRA_REPO = 'marcusrbrown/infra'
const DEPLOY_WORKFLOWS = {
  gateway: 'deploy-gateway.yaml',
  dashboard: 'deploy-dashboard.yaml',
  router: 'deploy.yaml',
} as const
const HEALTH_URL = 'https://dashboard.fro.bot/operator/health'

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
 * Kept symmetric with `frobotAuthors()` in `scripts/check-wiki-authority.ts`.
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
  let skipped = 0
  const supported = items.filter(item => {
    if (item.content_repo === '' || item.content_number === 0) {
      skipped++
      return false
    }
    return true
  })
  if (skipped > 0) {
    process.stderr.write(
      `rollout-tracker-snapshot: warning — skipping ${skipped} unsupported Project item(s) (missing repo or number)\n`,
    )
  }
  return supported
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
export function buildSnapshot(items: ProjectItem[], issues: IssueState[], external: ExternalSignals): RolloutSnapshot {
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

  return {items: snapshotItems, external}
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

/**
 * The fields that gate a wake. A field omitted here never reaches the hash, so
 * every new wake input is copied explicitly.
 */
function toGatingEvidence(snapshot: RolloutSnapshot): RolloutSnapshot {
  const {external} = snapshot
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
    external: {
      agent_release: external.agent_release,
      dashboard_release: external.dashboard_release,
      deploy_gateway: {run_id: external.deploy_gateway.run_id, head_sha: external.deploy_gateway.head_sha},
      deploy_dashboard: {run_id: external.deploy_dashboard.run_id, head_sha: external.deploy_dashboard.head_sha},
      deploy_router: {run_id: external.deploy_router.run_id, head_sha: external.deploy_router.head_sha},
      contract_version: external.contract_version,
    },
  }
}

/**
 * JSON.stringify replacer that sorts object keys alphabetically.
 * Arrays preserve their order (deterministic from buildSnapshot sort).
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(value).sort()) {
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

function findLatestMarkerCommentIndex(comments: TrackerComment[]): number {
  return comments.findLastIndex(
    comment => FROBOT_COMMENT_AUTHORS.has(comment.author.login) && extractPreviousMarker(comment.body) !== null,
  )
}

export function selectLatestMarkerCommentBody(comments: TrackerComment[]): string {
  return comments[findLatestMarkerCommentIndex(comments)]?.body ?? ''
}

/**
 * True when the operator mentioned `@fro-bot` after the latest tracker marker
 * comment. Comments arrive oldest first, so "newer" is a later position. With
 * no marker comment, every operator mention is pending.
 */
export function hasPendingOperatorMention(comments: TrackerComment[]): boolean {
  return comments
    .slice(findLatestMarkerCommentIndex(comments) + 1)
    .some(comment => comment.author.login === OPERATOR_LOGIN && /@fro-bot/i.test(comment.body))
}

/**
 * Decide whether to post a tracker comment.
 *
 * - Cold start (previousMarker === null): always comment to seed state.
 * - Different hash: state changed, comment.
 * - Same hash with a pending operator mention: comment to answer it. The
 *   pending flag stays out of the hash, so answering it never changes the next
 *   comparison.
 * - Same hash, nothing pending: no gating transition, skip.
 */
export function decideComment(
  snapshot: RolloutSnapshot,
  hash: string,
  previousMarker: MarkerData | null,
  pendingMention: boolean,
): CommentDecision {
  if (previousMarker === null) {
    return {
      should_comment: true,
      reason: 'cold start — no prior marker found; seeding initial state',
      hash,
      snapshot,
    }
  }

  if (hash !== previousMarker.hash) {
    const mention = pendingMention ? '; operator mention pending' : ''
    return {
      should_comment: true,
      reason: `gating transition detected — hash changed from ${previousMarker.hash.slice(0, 8)} to ${hash.slice(0, 8)}${mention}`,
      hash,
      snapshot,
    }
  }

  if (pendingMention) {
    return {
      should_comment: true,
      reason: 'operator mention pending — @fro-bot comment newer than the last tracker marker',
      hash,
      snapshot,
    }
  }

  return {
    should_comment: false,
    reason: 'no gating transition — snapshot hash unchanged since last comment',
    hash,
    snapshot,
  }
}

// ─── External signals ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireNonEmptyString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${what} is missing or empty`)
  }
  return value
}

/** Parse a `releases/latest` API response into its tag. */
export function parseReleaseTag(raw: unknown, what: string): string {
  if (!isRecord(raw)) throw new Error(`${what} response is not an object`)
  return requireNonEmptyString(raw.tag_name, `${what} tag_name`)
}

/** Parse a workflow `runs?status=success&per_page=1` API response into its newest run. */
export function parseDeployRun(raw: unknown, what: string): DeployRun {
  if (!isRecord(raw) || !Array.isArray(raw.workflow_runs)) throw new Error(`${what} response has no workflow_runs`)
  const run: unknown = raw.workflow_runs[0]
  if (!isRecord(run)) throw new Error(`${what} has no successful run`)
  if (typeof run.id !== 'number' || !Number.isInteger(run.id) || run.id <= 0) {
    throw new Error(`${what} run id is missing or invalid`)
  }
  return {run_id: run.id, head_sha: requireNonEmptyString(run.head_sha, `${what} head_sha`)}
}

/** Parse the dashboard `/operator/health` response into its contract version. */
export function parseContractVersion(raw: unknown): string {
  if (!isRecord(raw)) throw new Error('health response is not an object')
  return requireNonEmptyString(raw.contractVersion, 'health contractVersion')
}

function parseFixtureJson(name: string, value: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`failed to parse ${name}: ${detail}`, {cause: error})
  }
}

function fixtureMember(fixture: unknown, key: string, name: string): unknown {
  if (!isRecord(fixture)) throw new Error(`${name} is not an object`)
  return fixture[key]
}

function ghApiJson(endpoint: string): unknown {
  const raw = execFileSync('gh', ['api', endpoint], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  })
  return JSON.parse(raw)
}

async function fetchHealth(): Promise<unknown> {
  const response = await fetch(HEALTH_URL, {signal: AbortSignal.timeout(30_000)})
  if (!response.ok) throw new Error(`health endpoint returned HTTP ${response.status}`)
  return response.json()
}

/**
 * Read the external signals. Any read failure, unparseable response or empty
 * value throws; a failed read must never look like "nothing changed".
 *
 * Fixture env vars carry the API response shapes and replace the network reads:
 *   ROLLOUT_TRACKER_RELEASES_JSON — {agent, dashboard}: `releases/latest` responses
 *   ROLLOUT_TRACKER_DEPLOYS_JSON  — {gateway, dashboard, router}: workflow `runs` responses
 *   ROLLOUT_TRACKER_HEALTH_JSON   — the `/operator/health` response
 */
export async function loadExternalSignals(env: NodeJS.ProcessEnv): Promise<ExternalSignals> {
  const releasesFixture =
    env.ROLLOUT_TRACKER_RELEASES_JSON === undefined
      ? undefined
      : parseFixtureJson('ROLLOUT_TRACKER_RELEASES_JSON', env.ROLLOUT_TRACKER_RELEASES_JSON)
  const deploysFixture =
    env.ROLLOUT_TRACKER_DEPLOYS_JSON === undefined
      ? undefined
      : parseFixtureJson('ROLLOUT_TRACKER_DEPLOYS_JSON', env.ROLLOUT_TRACKER_DEPLOYS_JSON)
  const healthFixture =
    env.ROLLOUT_TRACKER_HEALTH_JSON === undefined
      ? undefined
      : parseFixtureJson('ROLLOUT_TRACKER_HEALTH_JSON', env.ROLLOUT_TRACKER_HEALTH_JSON)

  const release = (key: keyof typeof RELEASE_REPOS): string => {
    const what = `${RELEASE_REPOS[key]} latest release`
    const raw =
      releasesFixture === undefined
        ? ghApiJson(`repos/${RELEASE_REPOS[key]}/releases/latest`)
        : fixtureMember(releasesFixture, key, 'ROLLOUT_TRACKER_RELEASES_JSON')
    return parseReleaseTag(raw, what)
  }
  const deploy = (key: keyof typeof DEPLOY_WORKFLOWS): DeployRun => {
    const what = `${INFRA_REPO} ${DEPLOY_WORKFLOWS[key]}`
    const raw =
      deploysFixture === undefined
        ? ghApiJson(`repos/${INFRA_REPO}/actions/workflows/${DEPLOY_WORKFLOWS[key]}/runs?status=success&per_page=1`)
        : fixtureMember(deploysFixture, key, 'ROLLOUT_TRACKER_DEPLOYS_JSON')
    return parseDeployRun(raw, what)
  }

  return {
    agent_release: release('agent'),
    dashboard_release: release('dashboard'),
    deploy_gateway: deploy('gateway'),
    deploy_dashboard: deploy('dashboard'),
    deploy_router: deploy('router'),
    contract_version: parseContractVersion(healthFixture === undefined ? await fetchHealth() : healthFixture),
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
 *   ROLLOUT_TRACKER_COMMENTS_JSON — JSON array of tracker issue comments (oldest first); supplies both
 *                                   the marker body and the pending operator mention, and takes
 *                                   precedence over ROLLOUT_TRACKER_COMMENT_BODY
 *   ROLLOUT_TRACKER_RELEASES_JSON / _DEPLOYS_JSON / _HEALTH_JSON — external signal API responses
 *                                   (see loadExternalSignals)
 *
 * A body fixture supplies no comment list, so it reports no pending mention.
 */
async function main(): Promise<void> {
  const trackerIssue = process.env.ROLLOUT_TRACKER_ISSUE ?? 'fro-bot/.github#3512'
  const projectUrl = process.env.ROLLOUT_TRACKER_PROJECT ?? 'https://github.com/users/fro-bot/projects/1'

  let items: ProjectItem[]
  let issues: IssueState[]
  let latestCommentBody: string
  let pendingMention = false

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
        timeout: 60_000,
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
    for (const ref of trackedIssues) {
      const [repo, numStr] = ref.split('#')
      if (repo === undefined || numStr === undefined) continue
      try {
        const raw = execFileSync(
          'gh',
          ['issue', 'view', numStr, '--repo', repo, '--json', 'number,state,title,closedAt,labels'],
          {encoding: 'utf8', timeout: 30_000},
        )
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
      } catch {
        process.stderr.write(
          'rollout-tracker-snapshot: FATAL — failed to fetch a tracked issue; refusing to treat access failure as no-drift; exiting 1\n',
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

  if (process.env.ROLLOUT_TRACKER_COMMENTS_JSON !== undefined) {
    let comments: TrackerComment[]
    try {
      const parsed: unknown = JSON.parse(process.env.ROLLOUT_TRACKER_COMMENTS_JSON)
      if (!Array.isArray(parsed)) throw new TypeError('not an array')
      comments = parsed as TrackerComment[]
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      process.stderr.write(`rollout-tracker-snapshot: failed to parse ROLLOUT_TRACKER_COMMENTS_JSON: ${detail}\n`)
      process.exitCode = 1
      return
    }
    latestCommentBody = selectLatestMarkerCommentBody(comments)
    pendingMention = hasPendingOperatorMention(comments)
  } else if (process.env.ROLLOUT_TRACKER_COMMENT_BODY === undefined) {
    // Fetch latest @fro-bot comment from tracker issue
    const [trackerRepo, trackerNumStr] = trackerIssue.split('#')
    if (trackerRepo === undefined || trackerNumStr === undefined) {
      process.stderr.write(`rollout-tracker-snapshot: invalid ROLLOUT_TRACKER_ISSUE format: ${trackerIssue}\n`)
      process.exit(1)
    }
    try {
      // `--json comments` alone returns every comment; current gh rejects it combined with `--comments`.
      const raw = execFileSync('gh', ['issue', 'view', trackerNumStr, '--repo', trackerRepo, '--json', 'comments'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 60_000,
      })
      const parsed = JSON.parse(raw) as {comments: TrackerComment[]}
      latestCommentBody = selectLatestMarkerCommentBody(parsed.comments)
      pendingMention = hasPendingOperatorMention(parsed.comments)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      process.stderr.write(`rollout-tracker-snapshot: FATAL — failed to fetch tracker comments: ${detail}\n`)
      process.stderr.write(
        'rollout-tracker-snapshot: refusing to treat a comment-fetch failure as a cold start; exiting 1\n',
      )
      process.exit(1)
    }
  } else {
    latestCommentBody = process.env.ROLLOUT_TRACKER_COMMENT_BODY
  }

  let external: ExternalSignals
  try {
    external = await loadExternalSignals(process.env)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    process.stderr.write(`rollout-tracker-snapshot: FATAL — failed to read external signals: ${detail}\n`)
    process.stderr.write('rollout-tracker-snapshot: refusing to treat a signal read failure as no-drift; exiting 1\n')
    process.exitCode = 1
    return
  }

  const snapshot = buildSnapshot(items, issues, external)
  const hash = hashSnapshot(snapshot)
  const previousMarker = extractPreviousMarker(latestCommentBody)
  const decision = decideComment(snapshot, hash, previousMarker, pendingMention)

  process.stdout.write(`${JSON.stringify(decision)}\n`)
  process.exitCode = 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
