/**
 * Pure renderers from a queued reconcile issue to the payload `issues.create` takes. No I/O.
 */

import type {
  IssueQueueEntry,
  PerOwnerRollupIssue,
  PerRepoIssue,
  RenamePendingIssue,
  VisibilityTransitionIssue,
} from './reconcile-plan.ts'
import {
  INTEGRITY_ALERT_LABEL,
  PENDING_REVIEW_LABEL,
  RENAME_PENDING_LABEL,
  ROLLUP_LABEL,
  VISIBILITY_TRANSITION_LABEL,
} from './reconcile-labels.ts'

export interface IssuePayload {
  owner: string
  repo: string
  title: string
  body: string
  labels: string[]
}

export function renderIssuePayload(issue: IssueQueueEntry, owner: string, repo: string): IssuePayload {
  if (issue.kind === 'per-repo') {
    return renderPerRepoIssue(issue, owner, repo)
  }
  if (issue.kind === 'visibility-transition') {
    return renderVisibilityTransitionIssue(issue, owner, repo)
  }
  if (issue.kind === 'rename-pending') {
    return renderRenamePendingIssue(issue, owner, repo)
  }
  if (issue.kind === 'per-owner-rollup') {
    return renderRollupIssue(issue, owner, repo)
  }
  // Exhaustiveness guard: adding a new IssueQueueEntry kind must add a renderer above.
  const exhaustive: never = issue
  throw new Error(`renderIssuePayload: unhandled issue kind: ${JSON.stringify(exhaustive)}`)
}

function renderRenamePendingIssue(issue: RenamePendingIssue, owner: string, repo: string): IssuePayload {
  // Public issue stream: the node ID is the only identifier. node_id is validated against
  // `NODE_ID_PATTERN` before the issue is queued, so it can be interpolated without quoting.
  const title = `[RENAME] Pending repository rename for ${issue.node_id}`
  const body = [
    `<!-- reconcile:subject:node_id=${issue.node_id} -->`,
    '',
    'A tracked public repository was renamed on GitHub. Reconcile detects renames but never applies them: the repository is not surveyed until you apply the rename.',
    '',
    `- Node ID: \`${issue.node_id}\``,
    '',
    'To apply the rename (one commit: the metadata row, the wiki page and the links to it), dispatch:',
    '',
    '```sh',
    `gh workflow run rename-tracked-repo.yaml -f node_id=${issue.node_id}`,
    '```',
    '',
    'If the metadata row already holds the new name but the wiki page is still at the old slug, also pass `-f old_name=<previous owner/name>`.',
    '',
    'This issue closes automatically once reconcile no longer sees a pending rename for this node.',
  ].join('\n')
  return {owner, repo, title, body, labels: [RENAME_PENDING_LABEL]}
}

function renderVisibilityTransitionIssue(issue: VisibilityTransitionIssue, owner: string, repo: string): IssuePayload {
  // node_id is validated against /^[\w\-+/=]+$/ at the schema layer (packages/wiki-write-core/src/schemas.ts assertRepoEntry),
  // so this template can safely interpolate without shell-quoting.
  const title = `[INTEGRITY] Visibility transition for ${issue.node_id}`
  const body = [
    `<!-- reconcile:subject:node_id=${issue.node_id} -->`,
    '',
    'A tracked repository has transitioned from **public** to **private** (or access was lost, which fails closed as private).',
    '',
    `- Node ID: \`${issue.node_id}\``,
    '',
    'To look up the canonical owner/repo by node ID, run:',
    '',
    '```sh',
    `gh api graphql --field nodeId='${issue.node_id}' -f query='query($nodeId: ID!) { node(id: $nodeId) { ... on Repository { nameWithOwner isPrivate } } }'`,
    '```',
    '',
    'If the response contains `"node": null`, the canonical name is not retrievable from your token\'s scope (repo may be deleted or your token lacks access).',
    '',
    'This issue requires manual operator action. It will not be auto-closed.',
  ].join('\n')
  return {owner, repo, title, body, labels: [INTEGRITY_ALERT_LABEL, VISIBILITY_TRANSITION_LABEL]}
}

function renderPerRepoIssue(issue: PerRepoIssue, owner: string, repo: string): IssuePayload {
  const isRegain = issue.reason === 'unsolicited-regain'
  const titleVerb = isRegain ? 'regrant' : 'grant'

  if (issue.private) {
    // Private repo: omit name from title and body; reference only by node_id.
    const title = `Unsolicited collaborator ${titleVerb}: private repo`
    const body = [
      `<!-- reconcile:subject:node_id=${issue.node_id} -->`,
      '',
      `A new collaborator ${isRegain ? 'regrant' : 'grant'} was detected for a **private** repository from an owner not in \`metadata/allowlist.yaml\`.`,
      '',
      `- Reason: \`${issue.reason}\``,
      `- Node ID: \`${issue.node_id}\``,
      '',
      'The repository name is omitted because this issue stream is public. Cross-reference via your direct access to `metadata/repos.yaml` on the `data` branch.',
      '',
      'Next steps:',
      '- **Approve**: edit `metadata/repos.yaml` on the `data` branch, change `onboarding_status` to `pending`, and push.',
      '- **Reject**: remove the entry from `metadata/repos.yaml`.',
      '- **Allowlist the owner**: add the owner login to `approved_inviters` in `metadata/allowlist.yaml`.',
    ].join('\n')
    return {owner, repo, title, body, labels: [PENDING_REVIEW_LABEL]}
  }

  // Public repo: include owner/repo in title and body.
  const title = `Unsolicited collaborator ${titleVerb}: ${issue.owner}/${issue.repo}`
  const body = [
    `<!-- reconcile:subject:node_id=${issue.node_id} -->`,
    '',
    `A collaborator ${isRegain ? 'regrant' : 'grant'} was detected for [${issue.owner}/${issue.repo}](https://github.com/${issue.owner}/${issue.repo}) from an owner not in \`metadata/allowlist.yaml\`.`,
    '',
    `- Reason: \`${issue.reason}\``,
    `- Node ID: \`${issue.node_id}\``,
    '',
    'Next steps:',
    '- **Approve**: edit `metadata/repos.yaml` on the `data` branch, change `onboarding_status` to `pending`, and push.',
    '- **Reject**: remove the entry from `metadata/repos.yaml`.',
    `- **Allowlist the owner**: add \`${issue.owner}\` to \`approved_inviters\` in \`metadata/allowlist.yaml\`.`,
  ].join('\n')
  return {owner, repo, title, body, labels: [PENDING_REVIEW_LABEL]}
}

function renderRollupIssue(issue: PerOwnerRollupIssue, owner: string, repo: string): IssuePayload {
  const n = issue.entries.length
  const title = `Unsolicited collaborator grants from ${issue.owner}: ${n} new repos require review`
  const entryLines = issue.entries.map(e =>
    e.private
      ? `- **private repo** (\`${e.node_id}\`)`
      : `- [${issue.owner}/${e.repo}](https://github.com/${issue.owner}/${e.repo}) (\`${e.node_id}\`)`,
  )
  const body = [
    `<!-- reconcile:subject:rollup-owner=${issue.owner} -->`,
    '',
    `Multiple unsolicited collaborator ${issue.reason === 'unsolicited-regain' ? 'regrants' : 'grants'} detected from [${issue.owner}](https://github.com/${issue.owner}):`,
    '',
    ...entryLines,
    '',
    `Reason: \`${issue.reason}\``,
    '',
    'Next steps:',
    `- **Allowlist the owner**: add \`${issue.owner}\` to \`approved_inviters\` in \`metadata/allowlist.yaml\`.`,
    '- **Approve individual repos**: edit `metadata/repos.yaml` on the `data` branch.',
    '- **Reject**: remove entries from `metadata/repos.yaml`.',
  ].join('\n')
  return {owner, repo, title, body, labels: [PENDING_REVIEW_LABEL, ROLLUP_LABEL]}
}
