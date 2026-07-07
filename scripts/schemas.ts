/**
 * Runtime type guards for metadata files. Schemas documented in metadata/README.md.
 *
 * - `is<Name>` — returns boolean
 * - `assert<Name>` — throws SchemaValidationError with a path to the bad field
 *
 * Call `assert<Name>` on the result of `parse(yamlText)` before operating on the data.
 */

export interface AllowlistFile {
  version: 1
  approved_inviters: ApprovedInviter[]
  /**
   * Operator-curated list of GitHub org logins. Repos under these orgs that contain
   * `.github/workflows/fro-bot.yaml` are eligible to surface via the `contrib` channel.
   * Optional during the rollout window; loaders treat missing as `[]` for backward compat.
   */
  approved_contrib_orgs?: string[]
  /**
   * Operator-curated list of `owner/name` strings. Each named repo is probed for
   * `.github/workflows/fro-bot.yaml` and surfaced via the `contrib` channel when present.
   * Optional during the rollout window; loaders treat missing as `[]` for backward compat.
   */
  approved_contrib_repos?: string[]
}

export interface ApprovedInviter {
  username: string
  added: string
  role: string
}

export interface ReposFile {
  version: 1
  repos: RepoEntry[]
}

export interface RepoEntry {
  owner: string
  name: string
  added: string
  onboarding_status: OnboardingStatus
  last_survey_at: string | null
  last_survey_status: SurveyStatus | null
  has_fro_bot_workflow: boolean
  has_renovate: boolean
  /**
   * Which channel surfaced this entry. Sticky after first write — reconcile never auto-rewrites it.
   * Operators can re-classify by editing `metadata/repos.yaml` on the `data` branch directly.
   *
   * Optional during the rollout window: legacy entries without a channel are treated as `'collab'`
   * by default. The cadence migration path will tighten this to required after `data` is migrated.
   */
  discovery_channel?: DiscoveryChannel
  /**
   * ISO date (YYYY-MM-DD) at which this entry becomes eligible for re-survey, or `null` for
   * entries that have never been surveyed (treat as immediately eligible).
   *
   * Optional during the rollout window: legacy entries without an eligibility date are treated
   * as immediately eligible. The cadence migration path will tighten this to required after
   * `data` is migrated.
   */
  next_survey_eligible_at?: string | null
  /**
   * Whether this repo is private. Authoritative input for the privacy posture: when `true`,
   * autonomous mutators write the entry in always-redacted form (`owner: '[REDACTED]'`,
   * `name: <node_id>`) so canonical identifiers never reach `main`. Populated by reconcile's
   * 5-state probe; preserved across transient/malformed responses (sticky).
   *
   * Optional during the rollout window: legacy entries from before the privacy migration
   * have no value, and downstream code defaults absent to "treat as private until probe
   * confirms otherwise" (fail-safe). Tightened to required after `data` is migrated.
   */
  private?: boolean
  /**
   * GitHub GraphQL global node ID (e.g. `R_kgDO...`). Stable across owner/name renames and
   * doubles as the redacted name when `private: true`. Populated by reconcile's probe.
   *
   * Optional during the rollout window for the same reason as `private`. Tightened later.
   */
  node_id?: string
  /**
   * Stable numeric GitHub REST `repository.id`. The format-independent denylist anchor for
   * redacted entries: unlike `node_id`, this value does not change when GitHub migrates its
   * node_id format (legacy base64 → next-gen `R_…`). Populated by reconcile's field probe.
   *
   * Like `node_id`, this promotes to main with the entry but must NEVER be embedded in a
   * rendered/logged public surface (issue text, commit message, log line). Optional: legacy
   * and public entries need not carry it; a redacted entry without `database_id` remains
   * protected by the primary `node_id` guard.
   */
  database_id?: number
  /**
   * Optional operator-declared cross-repo receipt contract capability. When set to
   * `'coordination-issue-v1'`, this target is receipt-accountable for A3 cross-repo dispatch:
   * the coordinator treats a missing accepted receipt as non-terminal rather than best-effort.
   * This is an administrative routing gate written only through the `data`-branch sole-writer
   * path (see the `repos.yaml` sole-writer rule above) — it is not a prompt-delivered value or
   * a target self-report, and it does not prove the target will actually comply at runtime.
   * Absent means legacy/best-effort: dispatchable, but a missing receipt is never read as
   * evidence the worker did not run or as `completed`. See `metadata/README.md` for the full
   * authority boundary.
   */
  cross_repo_receipts?: string
}

export type OnboardingStatus = 'pending' | 'onboarded' | 'failed' | 'lost-access' | 'pending-review'
export type SurveyStatus = 'success' | 'failure'
export type DiscoveryChannel = 'collab' | 'owned' | 'contrib'

export interface RenovateFile {
  repositories: {
    'with-renovate': string[]
  }
}

export interface SocialCooldownsFile {
  version: 1
  cooldowns: Record<string, SocialCooldownEntry>
}

export interface SocialCooldownEntry {
  last_broadcast_at: string
  repo?: string
}

/**
 * GitHub identifier rules for `owner/name`:
 * - Owner: 1-39 chars, alphanumeric or hyphens, no leading/trailing hyphen, no consecutive
 *   hyphens. Same rule applies to user logins and org logins.
 * - Repo: 1-100 chars, alphanumeric, hyphens, underscores, periods. Cannot be `.` or `..`.
 *
 * The pattern enforces both pieces. Defense-in-depth on operator-curated input — Octokit
 * URL-encodes path params correctly, but rejecting invalid identifiers at parse time keeps
 * typos and shell metachars out of `metadata/allowlist.yaml` entirely.
 */
const CONTRIB_REPO_PATTERN = /^[A-Z\d](?:[A-Z\d]|-(?=[A-Z\d])){0,38}\/(?!\.{1,2}$)[\w.-]{1,100}$/i

/**
 * GitHub repository GraphQL node_id shape. Two real forms exist:
 * - Next-gen: `R_kgDO...` (TYPE prefix + URL-safe base64, chars `[A-Za-z0-9_-]`, no padding).
 * - Legacy:   `MDEwOlJlcG9zaXRvcnk...==` (standard-ish base64, may carry 1-2 `=` padding chars).
 *
 * Both are opaque identifiers — neither contains a `/`. The body is `[\w-]+` (word chars
 * plus hyphen) followed by optional base64 padding. Rejecting `/` is the point: it keeps an
 * `owner/repo`-shaped string from passing schema and later reaching a render/log site as if
 * it were a node_id. Verified against every node_id currently on the data branch.
 */
const NODE_ID_PATTERN = /^[\w-]+={0,2}$/

export class SchemaValidationError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'SchemaValidationError'
    this.path = path
  }
}

export function isAllowlistFile(value: unknown): value is AllowlistFile {
  if (!isRecord(value)) return false
  if (value.version !== 1) return false
  if (!Array.isArray(value.approved_inviters)) return false
  if (!value.approved_inviters.every(isApprovedInviter)) return false
  if (value.approved_contrib_orgs !== undefined) {
    if (!Array.isArray(value.approved_contrib_orgs)) return false
    if (!value.approved_contrib_orgs.every(v => typeof v === 'string')) return false
  }
  if (value.approved_contrib_repos !== undefined) {
    if (!Array.isArray(value.approved_contrib_repos)) return false
    if (!value.approved_contrib_repos.every(v => typeof v === 'string' && CONTRIB_REPO_PATTERN.test(v))) return false
  }
  return true
}

export function assertAllowlistFile(value: unknown, path = 'allowlist'): asserts value is AllowlistFile {
  if (!isRecord(value)) throw new SchemaValidationError(path, 'expected object')
  if (value.version !== 1) throw new SchemaValidationError(`${path}.version`, 'expected 1')
  if (!Array.isArray(value.approved_inviters))
    throw new SchemaValidationError(`${path}.approved_inviters`, 'expected array')
  value.approved_inviters.forEach((entry, index) => {
    assertApprovedInviter(entry, `${path}.approved_inviters[${index}]`)
  })
  if (value.approved_contrib_orgs !== undefined) {
    if (!Array.isArray(value.approved_contrib_orgs))
      throw new SchemaValidationError(`${path}.approved_contrib_orgs`, 'expected array of strings or omitted')
    value.approved_contrib_orgs.forEach((entry, index) => {
      if (typeof entry !== 'string')
        throw new SchemaValidationError(`${path}.approved_contrib_orgs[${index}]`, 'expected string')
    })
  }
  if (value.approved_contrib_repos !== undefined) {
    if (!Array.isArray(value.approved_contrib_repos))
      throw new SchemaValidationError(
        `${path}.approved_contrib_repos`,
        'expected array of "owner/name" strings or omitted',
      )
    value.approved_contrib_repos.forEach((entry, index) => {
      if (typeof entry !== 'string')
        throw new SchemaValidationError(`${path}.approved_contrib_repos[${index}]`, 'expected string')
      if (!CONTRIB_REPO_PATTERN.test(entry))
        throw new SchemaValidationError(
          `${path}.approved_contrib_repos[${index}]`,
          'expected GitHub "owner/name" identifier (e.g., "bfra-me/.github")',
        )
    })
  }
}

function isApprovedInviter(value: unknown): value is ApprovedInviter {
  return (
    isRecord(value) &&
    typeof value.username === 'string' &&
    typeof value.added === 'string' &&
    typeof value.role === 'string'
  )
}

function assertApprovedInviter(value: unknown, path: string): asserts value is ApprovedInviter {
  if (!isRecord(value)) throw new SchemaValidationError(path, 'expected object')
  if (typeof value.username !== 'string') throw new SchemaValidationError(`${path}.username`, 'expected string')
  if (typeof value.added !== 'string') throw new SchemaValidationError(`${path}.added`, 'expected ISO date string')
  if (typeof value.role !== 'string') throw new SchemaValidationError(`${path}.role`, 'expected string')
}

export function isReposFile(value: unknown): value is ReposFile {
  if (!isRecord(value)) return false
  if (value.version !== 1) return false
  if (!Array.isArray(value.repos)) return false
  return value.repos.every(isRepoEntry)
}

export function assertReposFile(value: unknown, path = 'repos'): asserts value is ReposFile {
  if (!isRecord(value)) throw new SchemaValidationError(path, 'expected object')
  if (value.version !== 1) throw new SchemaValidationError(`${path}.version`, 'expected 1')
  if (!Array.isArray(value.repos)) throw new SchemaValidationError(`${path}.repos`, 'expected array')
  value.repos.forEach((entry, index) => {
    assertRepoEntry(entry, `${path}.repos[${index}]`)
  })
}

function isRepoEntry(value: unknown): value is RepoEntry {
  return (
    isRecord(value) &&
    typeof value.owner === 'string' &&
    typeof value.name === 'string' &&
    typeof value.added === 'string' &&
    isOnboardingStatus(value.onboarding_status) &&
    (value.last_survey_at === null || typeof value.last_survey_at === 'string') &&
    (value.last_survey_status === null || isSurveyStatus(value.last_survey_status)) &&
    typeof value.has_fro_bot_workflow === 'boolean' &&
    typeof value.has_renovate === 'boolean' &&
    (value.discovery_channel === undefined || isDiscoveryChannel(value.discovery_channel)) &&
    (value.next_survey_eligible_at === undefined ||
      value.next_survey_eligible_at === null ||
      typeof value.next_survey_eligible_at === 'string') &&
    (value.private === undefined || typeof value.private === 'boolean') &&
    (value.node_id === undefined ||
      (typeof value.node_id === 'string' && value.node_id.length > 0 && NODE_ID_PATTERN.test(value.node_id))) &&
    (value.database_id === undefined ||
      (typeof value.database_id === 'number' && Number.isInteger(value.database_id) && value.database_id > 0))
  )
}

function assertRepoEntry(value: unknown, path: string): asserts value is RepoEntry {
  if (!isRecord(value)) throw new SchemaValidationError(path, 'expected object')
  if (typeof value.owner !== 'string') throw new SchemaValidationError(`${path}.owner`, 'expected string')
  if (typeof value.name !== 'string') throw new SchemaValidationError(`${path}.name`, 'expected string')
  if (typeof value.added !== 'string') throw new SchemaValidationError(`${path}.added`, 'expected ISO date string')
  if (!isOnboardingStatus(value.onboarding_status))
    throw new SchemaValidationError(
      `${path}.onboarding_status`,
      'expected one of: pending, onboarded, failed, lost-access, pending-review',
    )
  if (value.last_survey_at !== null && typeof value.last_survey_at !== 'string')
    throw new SchemaValidationError(`${path}.last_survey_at`, 'expected string or null')
  if (value.last_survey_status !== null && !isSurveyStatus(value.last_survey_status))
    throw new SchemaValidationError(`${path}.last_survey_status`, 'expected one of: success, failure, or null')
  if (typeof value.has_fro_bot_workflow !== 'boolean')
    throw new SchemaValidationError(`${path}.has_fro_bot_workflow`, 'expected boolean')
  if (typeof value.has_renovate !== 'boolean')
    throw new SchemaValidationError(`${path}.has_renovate`, 'expected boolean')
  if (value.discovery_channel !== undefined && !isDiscoveryChannel(value.discovery_channel))
    throw new SchemaValidationError(`${path}.discovery_channel`, 'expected one of: collab, owned, contrib (or omitted)')
  if (
    value.next_survey_eligible_at !== undefined &&
    value.next_survey_eligible_at !== null &&
    typeof value.next_survey_eligible_at !== 'string'
  )
    throw new SchemaValidationError(`${path}.next_survey_eligible_at`, 'expected string, null, or omitted')
  if (value.private !== undefined && typeof value.private !== 'boolean')
    throw new SchemaValidationError(`${path}.private`, 'expected boolean or omitted')
  if (value.node_id !== undefined && (typeof value.node_id !== 'string' || value.node_id.length === 0))
    throw new SchemaValidationError(`${path}.node_id`, 'expected non-empty string or omitted')
  // Render sites embed node_id in shell commands (see renderVisibilityTransitionIssue in scripts/reconcile-repos.ts);
  // keep this pattern restrictive to GitHub's node-id format and reject owner/repo shapes.
  if (value.node_id !== undefined && typeof value.node_id === 'string' && !NODE_ID_PATTERN.test(value.node_id))
    throw new SchemaValidationError(
      `${path}.node_id`,
      'expected safe GitHub node_id (no slash; base64url body with optional padding)',
    )
  if (
    value.database_id !== undefined &&
    (typeof value.database_id !== 'number' || !Number.isInteger(value.database_id) || value.database_id <= 0)
  )
    throw new SchemaValidationError(
      `${path}.database_id`,
      'expected positive integer (stable numeric GitHub repository.id) or omitted',
    )
}

function isOnboardingStatus(value: unknown): value is OnboardingStatus {
  return (
    value === 'pending' ||
    value === 'onboarded' ||
    value === 'failed' ||
    value === 'lost-access' ||
    value === 'pending-review'
  )
}

function isSurveyStatus(value: unknown): value is SurveyStatus {
  return value === 'success' || value === 'failure'
}

export function isDiscoveryChannel(value: unknown): value is DiscoveryChannel {
  return value === 'collab' || value === 'owned' || value === 'contrib'
}

export function isRenovateFile(value: unknown): value is RenovateFile {
  if (!isRecord(value)) return false
  if (!isRecord(value.repositories)) return false
  return (
    Array.isArray(value.repositories['with-renovate']) &&
    value.repositories['with-renovate'].every((v: unknown) => typeof v === 'string')
  )
}

export function assertRenovateFile(value: unknown, path = 'renovate'): asserts value is RenovateFile {
  if (!isRecord(value)) throw new SchemaValidationError(path, 'expected object')
  if (!isRecord(value.repositories)) throw new SchemaValidationError(`${path}.repositories`, 'expected object')
  if (!Array.isArray(value.repositories['with-renovate']))
    throw new SchemaValidationError(`${path}.repositories.with-renovate`, 'expected array of strings')
  for (const [index, entry] of value.repositories['with-renovate'].entries()) {
    if (typeof entry !== 'string')
      throw new SchemaValidationError(`${path}.repositories.with-renovate[${index}]`, 'expected string')
  }
}

export function isSocialCooldownsFile(value: unknown): value is SocialCooldownsFile {
  if (!isRecord(value)) return false
  if (value.version !== 1) return false
  if (!isRecord(value.cooldowns)) return false
  return Object.values(value.cooldowns).every(isSocialCooldownEntry)
}

export function assertSocialCooldownsFile(
  value: unknown,
  path = 'social-cooldowns',
): asserts value is SocialCooldownsFile {
  if (!isRecord(value)) throw new SchemaValidationError(path, 'expected object')
  if (value.version !== 1) throw new SchemaValidationError(`${path}.version`, 'expected 1')
  if (!isRecord(value.cooldowns)) throw new SchemaValidationError(`${path}.cooldowns`, 'expected object')
  for (const [key, entry] of Object.entries(value.cooldowns)) {
    assertSocialCooldownEntry(entry, `${path}.cooldowns[${key}]`)
  }
}

function isSocialCooldownEntry(value: unknown): value is SocialCooldownEntry {
  return (
    isRecord(value) &&
    typeof value.last_broadcast_at === 'string' &&
    (value.repo === undefined || typeof value.repo === 'string')
  )
}

function assertSocialCooldownEntry(value: unknown, path: string): asserts value is SocialCooldownEntry {
  if (!isRecord(value)) throw new SchemaValidationError(path, 'expected object')
  if (typeof value.last_broadcast_at !== 'string')
    throw new SchemaValidationError(`${path}.last_broadcast_at`, 'expected ISO datetime string')
  if (value.repo !== undefined && typeof value.repo !== 'string')
    throw new SchemaValidationError(`${path}.repo`, 'expected string or undefined')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
