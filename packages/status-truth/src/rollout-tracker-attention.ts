/**
 * The domain-only wording and the digest of a domain program's preflight: the bootstrap instructions the tracker prompt
 * carries, the words a domain adds to the wake reason, and what needs a person's attention as a digest and a count. It
 * works on fixed codes, public repo names and counts only: nothing here reads a target repository's prose.
 */

import type {AnswerPlan} from './rollout-tracker-goals.ts'
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

export const STALE_RUN = 'stale-run'
export const LOOKUP_FAILED = 'part issue lookup failed'

export function countOf(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`
}

/** The instructions that replace the generic bootstrap issue in the tracker prompt. They start with a blank line. */
export type DomainBase = Omit<
  DomainPreflight,
  | 'bootstrap_instructions'
  | 'goal_batches'
  | 'goal_error'
  | 'part0_unreadable'
  | 'goal_instructions'
  | keyof AnswerPlan
  | 'attention_digest'
  | 'attention_count'
>

export function bootstrapInstructions(domain: DomainBase, program: string): string {
  const intro = '\n\nDomain program. '
  if (domain.brief_error === STALE_RUN) {
    return `${intro}This run is not at the head of main (${STALE_RUN}), so the part issues wait: file no part issue this run, whatever the Bootstrap list says, and say in your tracker comment only that the run was stale; a fresh run files.`
  }
  if (domain.brief_error !== null) {
    return `${intro}The program's brief cannot be used (${domain.brief_error}), so the part issues wait: file no part issue this run, whatever the Bootstrap list says, and tell the operator in your tracker comment that the brief cannot be used, with that message.`
  }
  if (domain.registry_error !== null) {
    return `${intro}Which repos may take a part cannot be checked (${domain.registry_error}), so the part issues wait: file no part issue this run, whatever the Bootstrap list says, and tell the operator in your tracker comment that the check failed, with that message.`
  }
  if (domain.part_issue_error !== null) {
    return `${intro}Which repos already have their part issue cannot be checked (${domain.part_issue_error}), so the part issues wait: file no part issue this run, whatever the Bootstrap list says, and tell the operator in your tracker comment that the check failed, with that message.`
  }
  const skipped = domain.ineligible_repos.length
  const notice =
    skipped === 0
      ? ''
      : ` ${countOf(skipped, 'listed repo is not eligible and gets', 'listed repos are not eligible and get')} no part issue. Do not name ${skipped === 1 ? 'it' : 'them'} or say why.`
  const deferred = domain.deferred_repos.length
  const deferredNotice =
    deferred === 0
      ? ''
      : ` ${countOf(deferred, 'listed repo could not be checked for an existing part issue', 'listed repos could not be checked for an existing part issue')} (${LOOKUP_FAILED}) and ${deferred === 1 ? 'gets' : 'get'} nothing this run: file nothing for ${deferred === 1 ? 'it' : 'them'} and say so in your tracker comment.`
  return `${intro}The program ${program} runs in the domain ${domain.key}; its brief is pinned to commit ${domain.brief_commit} of program-domains.json. In this program the Bootstrap duty files the part issue given here, not an issue you write yourself. For each repo you file in, use that repo's title and body from this JSON array (repo, title and body; empty when no repo needs one) exactly, character for character, and add nothing. The body links the tracker issue, which is how the search for an existing issue finds it on a re-run. A repo with no entry here gets no issue; skip it silently.\n${JSON.stringify(domain.part_issues)}\nThe preflight has already searched the repo for this program's part issue, in every state, so do not search yourself. An entry whose \`existing\` is a number already has its part issue: add that issue to the Project and file nothing new. Every other entry has none: file it. Ignore the rules above that skip a repo with a Project item and that search for an issue that links the tracker issue: in this program only the marker identifies a part issue, and an unrelated issue or pull request of the repo never counts.${notice}${deferredNotice}`
}

/** The words a domain adds to the wake reason: a stopped bootstrap, or a count of repos that get no part issue. */
export function domainReasonSuffix(domain: DomainPreflight): string {
  if (domain.brief_error !== null) return `; domain brief error: ${domain.brief_error}`
  if (domain.registry_error !== null) return `; domain registry error: ${domain.registry_error}`
  if (domain.part_issue_error !== null) return `; domain part issue error: ${domain.part_issue_error}`
  const count = domain.ineligible_repos.length
  const deferred = domain.deferred_repos.length
  return (
    (count === 0 ? '' : `; ${countOf(count, 'listed repo is', 'listed repos are')} not eligible for a part issue`) +
    (deferred === 0 ? '' : `; ${countOf(deferred, 'listed repo is', 'listed repos are')} deferred (${LOOKUP_FAILED})`) +
    (domain.goal_error === null ? '' : `; domain goal error: ${domain.goal_error}`)
  )
}
