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
}

export type OnboardingStatus = 'pending' | 'onboarded' | 'failed'
export type SurveyStatus = 'success' | 'failure'

export interface RenovateFile {
  version: 1
  repos: RenovateRepoEntry[]
}

export interface RenovateRepoEntry {
  owner: string
  name: string
  workflow_path: string
  last_dispatched_at: string | null
  last_dispatch_status: RenovateDispatchStatus | null
}

export type RenovateDispatchStatus = 'success' | 'skipped-running' | 'failure'

export interface SocialCooldownsFile {
  version: 1
  cooldowns: Record<string, SocialCooldownEntry>
}

export interface SocialCooldownEntry {
  last_broadcast_at: string
  repo?: string
}

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
  return value.approved_inviters.every(isApprovedInviter)
}

export function assertAllowlistFile(value: unknown, path = 'allowlist'): asserts value is AllowlistFile {
  if (!isRecord(value)) throw new SchemaValidationError(path, 'expected object')
  if (value.version !== 1) throw new SchemaValidationError(`${path}.version`, 'expected 1')
  if (!Array.isArray(value.approved_inviters))
    throw new SchemaValidationError(`${path}.approved_inviters`, 'expected array')
  value.approved_inviters.forEach((entry, index) => {
    assertApprovedInviter(entry, `${path}.approved_inviters[${index}]`)
  })
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
    typeof value.has_renovate === 'boolean'
  )
}

function assertRepoEntry(value: unknown, path: string): asserts value is RepoEntry {
  if (!isRecord(value)) throw new SchemaValidationError(path, 'expected object')
  if (typeof value.owner !== 'string') throw new SchemaValidationError(`${path}.owner`, 'expected string')
  if (typeof value.name !== 'string') throw new SchemaValidationError(`${path}.name`, 'expected string')
  if (typeof value.added !== 'string') throw new SchemaValidationError(`${path}.added`, 'expected ISO date string')
  if (!isOnboardingStatus(value.onboarding_status))
    throw new SchemaValidationError(`${path}.onboarding_status`, 'expected one of: pending, onboarded, failed')
  if (value.last_survey_at !== null && typeof value.last_survey_at !== 'string')
    throw new SchemaValidationError(`${path}.last_survey_at`, 'expected string or null')
  if (value.last_survey_status !== null && !isSurveyStatus(value.last_survey_status))
    throw new SchemaValidationError(`${path}.last_survey_status`, 'expected one of: success, failure, or null')
  if (typeof value.has_fro_bot_workflow !== 'boolean')
    throw new SchemaValidationError(`${path}.has_fro_bot_workflow`, 'expected boolean')
  if (typeof value.has_renovate !== 'boolean')
    throw new SchemaValidationError(`${path}.has_renovate`, 'expected boolean')
}

function isOnboardingStatus(value: unknown): value is OnboardingStatus {
  return value === 'pending' || value === 'onboarded' || value === 'failed'
}

function isSurveyStatus(value: unknown): value is SurveyStatus {
  return value === 'success' || value === 'failure'
}

export function isRenovateFile(value: unknown): value is RenovateFile {
  if (!isRecord(value)) return false
  if (value.version !== 1) return false
  if (!Array.isArray(value.repos)) return false
  return value.repos.every(isRenovateRepoEntry)
}

export function assertRenovateFile(value: unknown, path = 'renovate'): asserts value is RenovateFile {
  if (!isRecord(value)) throw new SchemaValidationError(path, 'expected object')
  if (value.version !== 1) throw new SchemaValidationError(`${path}.version`, 'expected 1')
  if (!Array.isArray(value.repos)) throw new SchemaValidationError(`${path}.repos`, 'expected array')
  value.repos.forEach((entry, index) => {
    assertRenovateRepoEntry(entry, `${path}.repos[${index}]`)
  })
}

function isRenovateRepoEntry(value: unknown): value is RenovateRepoEntry {
  return (
    isRecord(value) &&
    typeof value.owner === 'string' &&
    typeof value.name === 'string' &&
    typeof value.workflow_path === 'string' &&
    (value.last_dispatched_at === null || typeof value.last_dispatched_at === 'string') &&
    (value.last_dispatch_status === null || isRenovateDispatchStatus(value.last_dispatch_status))
  )
}

function assertRenovateRepoEntry(value: unknown, path: string): asserts value is RenovateRepoEntry {
  if (!isRecord(value)) throw new SchemaValidationError(path, 'expected object')
  if (typeof value.owner !== 'string') throw new SchemaValidationError(`${path}.owner`, 'expected string')
  if (typeof value.name !== 'string') throw new SchemaValidationError(`${path}.name`, 'expected string')
  if (typeof value.workflow_path !== 'string')
    throw new SchemaValidationError(`${path}.workflow_path`, 'expected string')
  if (value.last_dispatched_at !== null && typeof value.last_dispatched_at !== 'string')
    throw new SchemaValidationError(`${path}.last_dispatched_at`, 'expected string or null')
  if (value.last_dispatch_status !== null && !isRenovateDispatchStatus(value.last_dispatch_status))
    throw new SchemaValidationError(
      `${path}.last_dispatch_status`,
      'expected one of: success, skipped-running, failure, or null',
    )
}

function isRenovateDispatchStatus(value: unknown): value is RenovateDispatchStatus {
  return value === 'success' || value === 'skipped-running' || value === 'failure'
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
