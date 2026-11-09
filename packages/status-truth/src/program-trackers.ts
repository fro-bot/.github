/**
 * The program config behind the rollout tracker: `program-trackers.json` maps each cross-repo program to
 * its tracker issue, its Project and its operator. This module parses and validates that file and holds
 * the pure predicates the snapshot and the start flow share. Every failure is an `Error` with a fixed
 * message that never echoes the file's content, so a bad entry cannot smuggle text into a log.
 *
 * Regexes and other values whose mutants matter are built inside the functions that use them: a mutant
 * in a module-level constant runs before any test and survives.
 */

import {readFileSync} from 'node:fs'

/** What a program's tracker reads as external evidence: #3512's releases, deploys and health, or none. */
export type EvidenceKind = 'gateway' | 'none'

/** A repo the operator confirmed for the program, by name and GraphQL node ID. */
export interface ConfirmedRepo {
  readonly nameWithOwner: string
  readonly nodeId: string
}

/** One program, as `program-trackers.json` commits it. */
export interface ProgramEntry {
  readonly key: string
  /** The tracker issue as `owner/repo#n`. */
  readonly issue: string
  readonly project: {readonly owner: string; readonly number: number; readonly gateField: string}
  readonly operator: {readonly id: number; readonly login: string}
  readonly evidence: EvidenceKind
  readonly repos?: readonly ConfirmedRepo[]
}

export interface ProgramTrackers {
  readonly programs: readonly ProgramEntry[]
}

/** The kind of comment event that dispatched a run; an empty string is a run with no comment event. */
export type CommentEvent = 'created' | 'edited' | ''

/** The parts of a tracker issue comment the predicates read. `author.id` is absent in fixtures and old callers. */
export interface CommentLike {
  readonly author: {readonly login: string; readonly id?: number}
  readonly body: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isEvidenceKind(value: unknown): value is EvidenceKind {
  return value === 'gateway' || value === 'none'
}

function matches(pattern: RegExp, value: unknown): value is string {
  return typeof value === 'string' && pattern.test(value)
}

function parseRepos(value: unknown, at: string): ConfirmedRepo[] {
  if (!Array.isArray(value)) throw new Error(`${at} is invalid`)
  const repos: ConfirmedRepo[] = []
  for (const [index, raw] of value.entries()) {
    const nameWithOwner: unknown = isRecord(raw) ? raw.nameWithOwner : undefined
    const nodeId: unknown = isRecord(raw) ? raw.nodeId : undefined
    if (!matches(/^[\w.-]+\/[\w.-]+$/, nameWithOwner) || typeof nodeId !== 'string' || nodeId === '') {
      throw new Error(`${at}[${index}] is invalid`)
    }
    if (repos.some(earlier => earlier.nameWithOwner.toLowerCase() === nameWithOwner.toLowerCase())) {
      throw new Error(`${at} has a duplicate repo`)
    }
    repos.push({nameWithOwner, nodeId})
  }
  return repos
}

function parseEntry(raw: unknown, index: number): ProgramEntry {
  const at = `programs[${index}]`
  if (!isRecord(raw)) throw new Error(`${at} must be an object`)

  const {key, issue, project, operator, evidence, repos} = raw
  if (!matches(/^[a-z0-9][a-z0-9-]*$/, key)) throw new Error(`${at}.key is invalid`)
  if (!matches(/^[\w.-]+\/[\w.-]+#[1-9]\d*$/, issue)) throw new Error(`${at}.issue is invalid`)

  if (!isRecord(project)) throw new Error(`${at}.project is invalid`)
  if (!matches(/^[\w-]+$/, project.owner)) throw new Error(`${at}.project.owner is invalid`)
  if (!isPositiveSafeInteger(project.number)) throw new Error(`${at}.project.number is invalid`)
  if (typeof project.gateField !== 'string' || project.gateField.trim() === '') {
    throw new Error(`${at}.project.gateField is invalid`)
  }

  if (!isRecord(operator)) throw new Error(`${at}.operator is invalid`)
  if (!isPositiveSafeInteger(operator.id)) throw new Error(`${at}.operator.id is invalid`)
  if (!matches(/^[a-z0-9-]+$/i, operator.login)) throw new Error(`${at}.operator.login is invalid`)

  if (!isEvidenceKind(evidence)) throw new Error(`${at}.evidence is invalid`)

  const base = {
    key,
    issue,
    project: {owner: project.owner, number: project.number, gateField: project.gateField},
    operator: {id: operator.id, login: operator.login},
    evidence,
  }
  return repos === undefined ? base : {...base, repos: parseRepos(repos, `${at}.repos`)}
}

/**
 * Parse and validate the text of `program-trackers.json`. Fields the tracker does not read are dropped,
 * so the returned entries carry only validated values.
 */
export function parseProgramTrackers(text: string): ProgramTrackers {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('program-trackers.json is not valid JSON')
  }
  const programs: unknown = isRecord(parsed) ? parsed.programs : undefined
  if (!Array.isArray(programs) || programs.length === 0) {
    throw new Error('program-trackers.json must hold a non-empty "programs" array')
  }

  const entries = programs.map((raw, index) => parseEntry(raw, index))
  for (const [index, entry] of entries.entries()) {
    const earlier = entries.slice(0, index)
    if (earlier.some(other => other.key === entry.key)) throw new Error('duplicate program key')
    if (earlier.some(other => other.issue.toLowerCase() === entry.issue.toLowerCase())) {
      throw new Error('duplicate tracker issue')
    }
  }
  return {programs: entries}
}

/** Read and parse the config file at `path`. A missing file and an unreadable path are told apart. */
export function loadProgramTrackers(path: string): ProgramTrackers {
  let text: string
  try {
    text = readFileSync(path).toString()
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined
    throw new Error(code === 'ENOENT' ? 'program-trackers.json is missing' : 'program-trackers.json cannot be read', {
      cause: error,
    })
  }
  return parseProgramTrackers(text)
}

/** The entry with `key`, or an `unknown program key` error. */
export function selectProgram(config: ProgramTrackers, key: string): ProgramEntry {
  const entry = config.programs.find(program => program.key === key)
  if (entry === undefined) throw new Error('unknown program key')
  return entry
}

/** The tracker issue's repository and number. The parser already checked the `owner/repo#n` shape. */
export function issueRef(entry: ProgramEntry): {repo: string; number: number} {
  const at = entry.issue.indexOf('#')
  return {repo: entry.issue.slice(0, at), number: Number(entry.issue.slice(at + 1))}
}

/** Whether the program's operator wrote the comment: the login, and the numeric ID when the comment carries one. */
export function isOperatorComment(comment: Pick<CommentLike, 'author'>, entry: ProgramEntry): boolean {
  if (comment.author.login !== entry.operator.login) return false
  return comment.author.id === undefined || comment.author.id === entry.operator.id
}

/**
 * Whether a comment that dispatched a run may make it pending. Only the operator's comment counts. A
 * created comment must also mention the bot, as the relay requires; an edit needs no mention, because
 * the operator may be editing a result into an older comment.
 */
export function isAuthorizedTrigger(comment: CommentLike, entry: ProgramEntry, event: CommentEvent): boolean {
  if (!isOperatorComment(comment, entry)) return false
  return event === 'edited' || /@fro-bot/i.test(comment.body)
}

/**
 * The confirmed repos that are still public and have no Project item yet, in config order. A repo that
 * turned private is left out, so it never triggers a bootstrap. Names compare ignoring case.
 */
export function confirmedReposMissing(
  entry: ProgramEntry,
  items: readonly {readonly content_repo: string}[],
  publicRepos: ReadonlySet<string>,
): ConfirmedRepo[] {
  const present = new Set(items.map(item => item.content_repo.toLowerCase()))
  const visible = new Set([...publicRepos].map(name => name.toLowerCase()))
  return (entry.repos ?? []).filter(repo => {
    const folded = repo.nameWithOwner.toLowerCase()
    return visible.has(folded) && !present.has(folded)
  })
}

/**
 * Split the confirmed repos that need a bootstrap into those the tracker can file in and those with issues
 * disabled, which it cannot. Both lists keep config order; names compare ignoring case.
 */
export function partitionBootstrapRepos(
  missing: readonly ConfirmedRepo[],
  issuesDisabled: ReadonlySet<string>,
): {ready: ConfirmedRepo[]; blocked: ConfirmedRepo[]} {
  const disabled = new Set([...issuesDisabled].map(name => name.toLowerCase()))
  const isBlocked = (repo: ConfirmedRepo): boolean => disabled.has(repo.nameWithOwner.toLowerCase())
  return {ready: missing.filter(repo => !isBlocked(repo)), blocked: missing.filter(repo => isBlocked(repo))}
}

/** Whether a repository visibility value, from `gh api` or `gh repo view`, means public. */
export function isPublicVisibility(value: string): boolean {
  return value.toLowerCase() === 'public'
}
