/**
 * What needs a person's attention in a domain program, as a digest and a count. It works on fixed codes, public repo
 * names and counts only: nothing here reads a target repository's prose.
 */

import type {DomainPreflight} from './rollout-tracker-snapshot.ts'
import {createHash} from 'node:crypto'

/** A domain whose attention digest and count are not worked out yet. */
export type DomainParts = Omit<DomainPreflight, 'attention_digest' | 'attention_count'>

/**
 * What needs a person's attention in a domain program, as a digest and a count: the stalled and unknown parts (by repo
 * and kind, never by prose or age), the fixed errors of the brief, the registry, the part issues and the goals, the
 * goal batches that stopped with an error, the Part 0 repos whose Part 0 cannot be read, the deferred repos, and how
 * many listed repos are ineligible. A stale run is not state: it reports a digest, and the caller carries the last one
 * through instead. A part's age is left out on purpose, or the digest would change every day and wake the tracker.
 */
export function withAttention(domain: DomainParts): DomainPreflight {
  const byRepo = (left: string, right: string): number => left.localeCompare(right)
  const batchErrors = domain.goal_batches.flatMap(batch => (batch.error === null ? [] : [[batch.batch, batch.error]]))
  const stable = {
    stalled: domain.stalled_parts.map(part => `${part.repo.toLowerCase()} ${part.stalled}`).toSorted(byRepo),
    unknown: domain.unknown_parts.map(part => `${part.repo.toLowerCase()} ${part.reason}`).toSorted(byRepo),
    errors: [domain.brief_error, domain.registry_error, domain.part_issue_error, domain.goal_error].filter(
      (message): message is string => message !== null,
    ),
    batches: batchErrors,
    part0_unreadable: domain.part0_unreadable.map(name => name.toLowerCase()).toSorted(byRepo),
    deferred: domain.deferred_repos.map(repo => `${repo.nameWithOwner.toLowerCase()} ${repo.reason}`).toSorted(byRepo),
    ineligible: domain.ineligible_repos.length,
  }
  const count =
    stable.stalled.length +
    stable.unknown.length +
    stable.errors.length +
    stable.batches.length +
    stable.part0_unreadable.length +
    stable.deferred.length +
    (stable.ineligible > 0 ? 1 : 0)
  return {
    ...domain,
    attention_digest: createHash('sha256').update(JSON.stringify(stable)).digest('hex'),
    attention_count: count,
  }
}
