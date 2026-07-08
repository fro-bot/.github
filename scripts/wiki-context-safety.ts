/**
 * Runtime public-context safety gate for agent-invoked wiki context expansion.
 *
 * Two-layer safety model: the data-branch promotion gate is the upstream provenance
 * guard for what lands in the wiki corpus at all. This module is the second layer —
 * a runtime chokepoint that scans every field a caller intends to emit (excerpt body,
 * path header, selected path, resolved canonical path, title, alias-derived target,
 * count labels) against the private token vocabulary before formatting output.
 *
 * Fail-closed: an empty/missing token set is still checked normally (no tokens means
 * nothing matches, which is correct), but callers that fail to load tokens at all must
 * treat that as a hard failure and return an empty result — this module does not decide
 * "token load failed" for the caller.
 */

export interface SafetyCandidate {
  readonly path: string
  readonly title: string
  readonly body: string
  readonly aliases?: readonly string[]
}

export interface CandidateSafetyResult {
  readonly safe: boolean
  /** Fields that failed the scan, for callers that want to log a closed-vocabulary reason. */
  readonly unsafeFields: readonly ('path' | 'title' | 'body' | 'aliases')[]
}

/**
 * Evaluate a single candidate wiki page against the private token set.
 *
 * Every emitted-shape field is scanned independently: path, title, body, and aliases.
 * A candidate is unsafe if ANY field contains a private token — path/alias leaks are
 * just as disqualifying as body leaks.
 */
export function evaluateCandidateSafety(
  candidate: SafetyCandidate,
  privateTokens: ReadonlySet<string>,
): CandidateSafetyResult {
  const unsafeFields: ('path' | 'title' | 'body' | 'aliases')[] = []

  if (containsPrivateToken(candidate.path, privateTokens)) {
    unsafeFields.push('path')
  }
  if (containsPrivateToken(candidate.title, privateTokens)) {
    unsafeFields.push('title')
  }
  if (containsPrivateToken(candidate.body, privateTokens)) {
    unsafeFields.push('body')
  }
  if ((candidate.aliases ?? []).some(alias => containsPrivateToken(alias, privateTokens))) {
    unsafeFields.push('aliases')
  }

  return {safe: unsafeFields.length === 0, unsafeFields}
}

/**
 * Filter a candidate list down to safe candidates only.
 *
 * This is the gate callers must run BEFORE assembling any excerpt payload — it must
 * run before formatting, not after, so an unsafe candidate never reaches string
 * concatenation that could re-expose a private token through a differently-cased or
 * differently-truncated fragment.
 */
export function filterSafeCandidates<T extends SafetyCandidate>(
  candidates: readonly T[],
  privateTokens: ReadonlySet<string>,
): T[] {
  return candidates.filter(candidate => evaluateCandidateSafety(candidate, privateTokens).safe)
}

function containsPrivateToken(value: string, privateTokens: ReadonlySet<string>): boolean {
  const lower = value.toLowerCase()
  for (const token of privateTokens) {
    // Deliberately substring-based and fail-closed: over-excluding a public page whose text
    // contains a private token prefix is safer than requiring exact delimiter semantics here.
    if (token !== '' && lower.includes(token)) {
      return true
    }
  }
  return false
}
