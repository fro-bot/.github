/**
 * The domain config behind the foreman: `program-domains.json` groups repositories into domains and gives
 * each domain a brief, the bar its repository agents hold their repositories to. This module parses and
 * validates that file and checks it against the registry and against `program-trackers.json`. Every failure
 * is an `Error` with a fixed message that never echoes the file's content, so a bad entry cannot smuggle
 * text into a log or a prompt.
 *
 * Regexes and other values whose mutants matter are built inside the functions that use them: a mutant
 * in a module-level constant runs before any test and survives.
 */

import {readFileSync} from 'node:fs'
import {parseRepos, type ConfirmedRepo, type ProgramTrackers} from './program-trackers.ts'

/** A per-repository exception to the domain's bar, with the reason it applies. */
export interface DomainException {
  readonly nameWithOwner: string
  readonly reason: string
}

/**
 * The domain's bar for security, agent automation and developer experience, each as checkable standards a
 * repository agent can hold its repository against, plus the exceptions that apply to single repositories.
 */
export interface DomainBrief {
  readonly security: readonly string[]
  readonly automation: readonly string[]
  readonly developerExperience: readonly string[]
  readonly exceptions: readonly DomainException[]
}

/** One domain, as `program-domains.json` commits it. */
export interface DomainEntry {
  readonly key: string
  readonly repos: readonly ConfirmedRepo[]
  readonly brief: DomainBrief
}

export interface ProgramDomains {
  readonly domains: readonly DomainEntry[]
}

/** What the registry (`metadata/repos.yaml`) says about one tracked repository. */
export interface RegistryRepo {
  readonly nameWithOwner: string
  readonly nodeId: string
  readonly private: boolean
  readonly archived: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function parseStandards(value: unknown, at: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${at} is invalid`)
  const standards: string[] = []
  for (const [index, raw] of value.entries()) {
    if (!isText(raw)) throw new Error(`${at}[${index}] is invalid`)
    standards.push(raw)
  }
  return standards
}

function parseExceptions(value: unknown, at: string, repos: readonly ConfirmedRepo[]): DomainException[] {
  if (!Array.isArray(value)) throw new Error(`${at} is invalid`)
  const exceptions: DomainException[] = []
  for (const [index, raw] of value.entries()) {
    const nameWithOwner: unknown = isRecord(raw) ? raw.nameWithOwner : undefined
    const reason: unknown = isRecord(raw) ? raw.reason : undefined
    const inDomain =
      typeof nameWithOwner === 'string' &&
      repos.some(repo => repo.nameWithOwner.toLowerCase() === nameWithOwner.toLowerCase())
    if (!inDomain || !isText(reason)) throw new Error(`${at}[${index}] is invalid`)
    exceptions.push({nameWithOwner, reason})
  }
  return exceptions
}

function parseBrief(value: unknown, at: string, repos: readonly ConfirmedRepo[]): DomainBrief {
  if (!isRecord(value)) throw new Error(`${at} is invalid`)
  const security = parseStandards(value.security, `${at}.security`)
  const automation = parseStandards(value.automation, `${at}.automation`)
  const developerExperience = parseStandards(value.developerExperience, `${at}.developerExperience`)
  const exceptions = parseExceptions(value.exceptions, `${at}.exceptions`, repos)
  if ([security, automation, developerExperience].every(standards => standards.length === 0)) {
    throw new Error(`${at} is empty`)
  }
  return {security, automation, developerExperience, exceptions}
}

function parseDomain(raw: unknown, index: number): DomainEntry {
  const at = `domains[${index}]`
  if (!isRecord(raw)) throw new Error(`${at} must be an object`)

  const {key, repos, brief} = raw
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error(`${at}.key is invalid`)
  if (!Array.isArray(repos) || repos.length === 0) throw new Error(`${at}.repos is invalid`)

  const confirmed = parseRepos(repos, `${at}.repos`)
  return {key, repos: confirmed, brief: parseBrief(brief, `${at}.brief`, confirmed)}
}

/**
 * Parse and validate the text of `program-domains.json`. Fields the foreman does not read are dropped, so
 * the returned domains carry only validated values. A repository belongs to at most one domain.
 */
export function parseProgramDomains(text: string): ProgramDomains {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('program-domains.json is not valid JSON')
  }
  const domains: unknown = isRecord(parsed) ? parsed.domains : undefined
  if (!Array.isArray(domains)) {
    throw new TypeError('program-domains.json must hold a "domains" array')
  }

  const entries = domains.map((raw, index) => parseDomain(raw, index))
  for (const [index, entry] of entries.entries()) {
    const earlier = entries.slice(0, index)
    if (earlier.some(other => other.key === entry.key)) throw new Error('duplicate domain key')
    const listed = earlier.flatMap(other => other.repos)
    const shared = entry.repos.some(repo =>
      listed.some(other => other.nameWithOwner.toLowerCase() === repo.nameWithOwner.toLowerCase()),
    )
    if (shared) throw new Error('a repo is listed in two domains')
    for (const [repoIndex, repo] of entry.repos.entries()) {
      const repeated = [...listed, ...entry.repos.slice(0, repoIndex)].some(other => other.nodeId === repo.nodeId)
      if (repeated) throw new Error(`domains[${index}].repos[${repoIndex}] repeats a node ID`)
    }
  }
  return {domains: entries}
}

/** Read and parse the config file at `path`. A missing file and an unreadable path are told apart. */
export function loadProgramDomains(path: string): ProgramDomains {
  let text: string
  try {
    text = readFileSync(path).toString()
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined
    throw new Error(code === 'ENOENT' ? 'program-domains.json is missing' : 'program-domains.json cannot be read', {
      cause: error,
    })
  }
  return parseProgramDomains(text)
}

/** The domain with `key`, or an `unknown domain key` error. */
export function selectDomain(config: ProgramDomains, key: string): DomainEntry {
  const entry = config.domains.find(domain => domain.key === key)
  if (entry === undefined) throw new Error('unknown domain key')
  return entry
}

/** A listed repository the registry does not admit: its position in the file and why, without its name. */
export interface IneligibleDomainRepo {
  readonly domainIndex: number
  readonly repoIndex: number
  /** The position and the problem, e.g. `domains[0].repos[1] is private`. It names no repository or node ID. */
  readonly reason: string
}

/** The first thing wrong with one listed repository in the registry, as the words that follow its position. */
function registryProblem(repo: ConfirmedRepo, registry: readonly RegistryRepo[]): string | undefined {
  const [tracked, ...otherNames] = registry.filter(
    other => other.nameWithOwner.toLowerCase() === repo.nameWithOwner.toLowerCase(),
  )
  const [identified, ...otherIds] = registry.filter(other => other.nodeId === repo.nodeId)
  if (tracked === undefined) return 'is not in metadata/repos.yaml'
  if (otherNames.length > 0) return 'matches more than one row of metadata/repos.yaml by name'
  if (identified === undefined) return 'has a node ID that differs from metadata/repos.yaml'
  if (otherIds.length > 0) return 'matches more than one row of metadata/repos.yaml by node ID'
  if (tracked !== identified) return 'has a name and a node ID that name different registry rows'
  if (tracked.private) return 'is private'
  if (tracked.archived) return 'is archived'
  return undefined
}

/**
 * Every listed repository the registry does not admit, in file order, each with its first problem: the name and
 * the node ID must resolve to exactly one `metadata/repos.yaml` row (names compare ignoring case), and that row
 * must be public and not archived. A name or node ID that matches several rows, or a name and node ID that point
 * at different rows, is ambiguous and fails whatever order the rows come in. A reason names the position, never
 * the repository.
 */
export function findIneligibleDomainRepos(
  config: ProgramDomains,
  registry: readonly RegistryRepo[],
): IneligibleDomainRepo[] {
  const ineligible: IneligibleDomainRepo[] = []
  for (const [domainIndex, domain] of config.domains.entries()) {
    for (const [repoIndex, repo] of domain.repos.entries()) {
      const problem = registryProblem(repo, registry)
      if (problem !== undefined) {
        ineligible.push({domainIndex, repoIndex, reason: `domains[${domainIndex}].repos[${repoIndex}] ${problem}`})
      }
    }
  }
  return ineligible
}

/**
 * Check every listed repository against the registry at the point of use (see `findIneligibleDomainRepos`). The
 * first problem in file order is the error, and the message names the position, never the repository.
 */
export function checkDomainReposInRegistry(config: ProgramDomains, registry: readonly RegistryRepo[]): void {
  const [first] = findIneligibleDomainRepos(config, registry)
  if (first !== undefined) throw new Error(first.reason)
}

/** Check that every program that names a domain names one that `program-domains.json` lists. */
export function checkProgramDomainRefs(trackers: ProgramTrackers, domains: ProgramDomains): void {
  for (const [index, program] of trackers.programs.entries()) {
    if (program.domain !== undefined && !domains.domains.some(domain => domain.key === program.domain)) {
      throw new Error(`programs[${index}].domain is not in program-domains.json`)
    }
  }
}
