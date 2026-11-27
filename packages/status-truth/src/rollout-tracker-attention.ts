/**
 * What needs a person's attention in a domain program, and the marker edit that records it has cleared. Both work on
 * fixed codes, public repo names and counts only: nothing here reads a target repository's prose.
 */

import type {DomainPreflight, MarkerData} from './rollout-tracker-snapshot.ts'
import {createHash} from 'node:crypto'

/** A domain whose attention digest and count are not worked out yet, and whose marker update is not decided. */
export type DomainParts = Omit<DomainPreflight, 'attention_digest' | 'attention_count' | 'marker_update'>

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
    marker_update: null,
  }
}

/** `body` with its last tracker marker replaced by `marker`; null when it carries none. Finds the marker as the parse does. */
export function replaceLastMarker(body: string, marker: string): string | null {
  const lastClose = body.lastIndexOf('-->')
  if (lastClose === -1) return null
  const searchable = body.slice(0, lastClose + '-->'.length)
  const pattern = /<!--\s*gateway-rollout-tracker:[\s\S]*?-->/g
  let last: RegExpExecArray | null = null
  for (;;) {
    const match = pattern.exec(searchable)
    if (match === null) break
    last = match
  }
  if (last === null) return null
  return body.slice(0, last.index) + marker + body.slice(last.index + last[0].length)
}

/**
 * The edit that records a cleared attention state. The tracker wakes only for a non-empty list whose digest differs
 * from the marker's, and a marker is written only when the tracker runs, so a list that empties on a quiet run would
 * leave the old digest in the marker and the same stall, returning, would match it and never wake. When the list is
 * empty, the marker carries a different digest and nothing wakes the tracker, the preflight hands back the marker
 * comment with its marker replaced, for a step of its own to write in place. Nothing else changes in the comment. A
 * run that wakes the tracker writes the marker itself, and a stale run knows nothing of the state, so neither edits.
 */
export function planMarkerUpdate(input: {
  shouldComment: boolean
  stale: boolean
  attention: number
  digest: string
  previous: MarkerData | null
  markerComment: {id: number; body: string} | undefined
  marker: string
}): {comment_id: number; body: string} | null {
  const {previous, markerComment} = input
  if (
    input.shouldComment ||
    input.stale ||
    input.attention > 0 ||
    previous?.domain_digest === undefined ||
    previous.domain_digest === input.digest ||
    markerComment === undefined
  ) {
    return null
  }
  const body = replaceLastMarker(markerComment.body, input.marker)
  return body === null ? null : {comment_id: markerComment.id, body}
}
