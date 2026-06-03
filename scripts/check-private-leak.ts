import type {NodeIdResolver} from './private-repo-resolution.ts'
import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import process from 'node:process'
import {parse as parseYaml} from 'yaml'
import {isRecord, makeGhNodeIdResolver} from './private-repo-resolution.ts'
import {assertReposFile} from './schemas.ts'
import {computeRepoSlug} from './wiki-slug.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GuardResult = {readonly ok: true} | {readonly ok: false; readonly matchedFiles: readonly string[]}

/**
 * Result of a promotion scan.
 *
 * - `{ok: true}` — scan passed (no private tokens found in diff).
 * - `{ok: false, matchedFiles}` — private token found; matchedFiles lists affected file paths only.
 * - `{ok: false, resolutionFailed: true, failedNodeIds}` — one or more node_ids could not be
 *   resolved (non-access-lost failure); promotion is blocked fail-closed.
 */
export type PromotionScanResult =
  | {readonly ok: true}
  | {readonly ok: false; readonly matchedFiles: readonly string[]}
  | {readonly ok: false; readonly resolutionFailed: true; readonly failedNodeIds: readonly string[]}

export interface PromotionScanInputs {
  /** Raw YAML text of data branch's metadata/repos.yaml */
  readonly reposYaml: string
  /** Injectable resolver — caller wires FRO_BOT_POLL_PAT into makeGhNodeIdResolver(token) */
  readonly resolver: NodeIdResolver
  /** Unified diff text (main...data three-dot diff) */
  readonly diff: string
}

export interface OverrideOptions {
  readonly titlePrefixed: boolean
  readonly isOperator: boolean
}

// ---------------------------------------------------------------------------
// Operator override
// ---------------------------------------------------------------------------

/**
 * The GitHub login of the operator permitted to use the [allow-private-leak] title prefix.
 * Kept as a literal constant so it never leaks via computed interpolation.
 */
const OPERATOR_LOGIN = 'marcusrbrown'

// ---------------------------------------------------------------------------
// Pure decision function
// ---------------------------------------------------------------------------

/**
 * Scan the unified diff for case-insensitive substring matches against a list of
 * private repository tokens (canonical `owner/name`, slug `owner--name`, etc.).
 *
 * Three leak surfaces are scanned:
 * 1. **File paths of newly-added files** — detected via `--- /dev/null` header immediately
 *    before the `+++ b/<path>` line.
 * 2. **Rename/copy destination paths** — detected via `rename to <path>` / `copy to <path>`
 *    extended headers, and via `diff --git a/X b/Y` when X ≠ Y (rename without content change).
 * 3. **Added content lines** — `+` lines (excluding `+++` headers).
 *
 * Returns which FILES contained a match, never which token matched.
 * Override: if `override.titlePrefixed && override.isOperator` → bypass and return `{ok:true}`.
 */
export function checkPrivateLeak(
  privateNames: readonly string[],
  diff: string,
  override: OverrideOptions,
): GuardResult {
  // Honor override only when BOTH conditions hold.
  if (override.titlePrefixed && override.isOperator) {
    return {ok: true}
  }

  if (privateNames.length === 0 || diff.length === 0) {
    return {ok: true}
  }

  // Build lowercased name list once for efficiency.
  const lowerNames = privateNames.map(n => n.toLowerCase())

  const matchedFiles: string[] = []
  let currentFile: string | null = null
  // True when the preceding `---` line was `/dev/null` (new file being added).
  let checkPathAsNew = false

  /** Check a path as a new disclosure surface and record it if it matches. */
  const checkPath = (path: string): void => {
    const pathLower = path.toLowerCase()
    if (lowerNames.some(n => pathLower.includes(n)) && !matchedFiles.includes(path)) {
      matchedFiles.push(path)
    }
  }

  for (const line of diff.split('\n')) {
    // Track current file from diff headers.
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/.+ b\/(.+)$/.exec(line)
      if (match !== null && match[1] !== undefined) {
        const bPath = match[1]
        // Derive a-path by removing the known prefix and suffix.
        const aPath = line.slice('diff --git a/'.length, line.length - ` b/${bPath}`.length)
        currentFile = bPath
        checkPathAsNew = false
        // If a-path ≠ b-path this is a rename/copy; b-path is a new disclosure surface.
        // Handles renames with no content change (no subsequent ---/+++ in some git configs).
        if (aPath !== bPath) {
          checkPath(bPath)
        }
      } else {
        currentFile = null
        checkPathAsNew = false
      }
      continue
    }

    // Extended headers: `rename to <path>` and `copy to <path>` — destination is new disclosure.
    if (line.startsWith('rename to ') || line.startsWith('copy to ')) {
      const destPath = line.startsWith('rename to ') ? line.slice('rename to '.length) : line.slice('copy to '.length)
      if (destPath !== '') {
        checkPath(destPath)
      }
      continue
    }

    // `--- /dev/null` signals a new-file addition; any other `--- ` is a modification/deletion.
    if (line.startsWith('--- ')) {
      checkPathAsNew = line === '--- /dev/null'
      continue
    }

    // `+++` header: if this is a new file, also check the path itself as a leak surface.
    if (line.startsWith('+++')) {
      if (checkPathAsNew && currentFile !== null) {
        checkPath(currentFile)
      }
      checkPathAsNew = false
      continue
    }

    // Only scan added content lines.
    if (!line.startsWith('+')) {
      continue
    }

    const content = line.slice(1).toLowerCase()
    if (currentFile !== null && lowerNames.some(n => content.includes(n)) && !matchedFiles.includes(currentFile)) {
      matchedFiles.push(currentFile)
    }
  }

  if (matchedFiles.length === 0) {
    return {ok: true}
  }

  return {ok: false, matchedFiles}
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

async function readPullRequestContext(
  eventPath: string,
): Promise<{prNumber: number; title: string; author: string; fullName: string | null}> {
  const raw = await readFile(eventPath, 'utf8')
  const parsed: unknown = JSON.parse(raw)

  if (!isRecord(parsed)) {
    throw new Error(`check-private-leak: event payload is not an object (path=${eventPath})`)
  }

  const pr = isRecord(parsed.pull_request) ? parsed.pull_request : undefined
  const prNumber = pr === undefined ? undefined : pr.number
  const title = pr === undefined ? undefined : pr.title
  const user = pr !== undefined && isRecord(pr.user) ? pr.user : undefined
  const author = typeof user?.login === 'string' ? user.login : undefined
  const base = pr !== undefined && isRecord(pr.base) ? pr.base : undefined
  const repo = base !== undefined && isRecord(base.repo) ? base.repo : undefined
  const rawFullName = repo === undefined ? undefined : repo.full_name

  if (typeof prNumber !== 'number' || typeof author !== 'string' || author === '') {
    throw new Error(
      `check-private-leak: event payload missing pull_request.number or pull_request.user.login (path=${eventPath})`,
    )
  }
  if (typeof title !== 'string') {
    throw new TypeError(`check-private-leak: event payload missing pull_request.title (path=${eventPath})`)
  }
  const fullName = typeof rawFullName === 'string' && rawFullName.length > 0 ? rawFullName : null
  return {prNumber, title, author, fullName}
}

/**
 * Fetch metadata/repos.yaml from the `data` branch and return node_ids for private entries.
 */
function fetchPrivateNodeIds(fullName: string): string[] {
  const encoded = execFileSync(
    'gh',
    ['api', `repos/${fullName}/contents/metadata/repos.yaml?ref=data`, '--jq', '.content'],
    {encoding: 'utf8'},
  ).trim()

  // GitHub API returns base64 with potential embedded newlines.
  const yamlText = Buffer.from(encoded.replaceAll('\n', ''), 'base64').toString('utf8')
  const parsed: unknown = parseYaml(yamlText)
  assertReposFile(parsed)
  const repos = parsed.repos

  return repos
    .filter(r => r.private === true && typeof r.node_id === 'string' && r.node_id.length > 0)
    .map(r => r.node_id as string)
}

/**
 * Fetch unified diff text for a pull request.
 */
function fetchPrDiff(prNumber: number): string {
  return execFileSync('gh', ['pr', 'diff', String(prNumber)], {encoding: 'utf8'})
}

/**
 * Post a transparency comment on the PR about the override.
 */
function postOverrideComment(prNumber: number, author: string): void {
  const body = `⚠️ **[allow-private-leak] override honored** — \`${author}\` bypassed the private-leak guard on this PR. Operator-approved.`
  execFileSync(
    'gh',
    ['api', `repos/{owner}/{repo}/issues/${prNumber}/comments`, '--method', 'POST', '-f', `body=${body}`],
    {encoding: 'utf8'},
  )
}

// ---------------------------------------------------------------------------
// Promotion scan — pure testable core
// ---------------------------------------------------------------------------

/**
 * Build the private token set from a resolved nameWithOwner string.
 * Returns [canonical, slug] — both carry the owner prefix for specificity.
 * Bare name is intentionally excluded (false-positive risk on short names).
 */
function buildTokensForName(nameWithOwner: string): string[] {
  const slashIndex = nameWithOwner.indexOf('/')
  if (slashIndex < 1) return []
  const owner = nameWithOwner.slice(0, slashIndex)
  const name = nameWithOwner.slice(slashIndex + 1)
  if (owner === '' || name === '') return []
  const tokens: string[] = [nameWithOwner]
  try {
    tokens.push(computeRepoSlug(owner, name))
  } catch {
    // computeRepoSlug throws on empty segments — skip slug form
  }
  return tokens
}

/**
 * Promotion-mode scan: pure, injectable, testable.
 *
 * Resolves private node_ids from repos.yaml content, builds the token set, and
 * runs `checkPrivateLeak` against the provided diff. The resolver and diff are
 * both injectable so tests can exercise the full matrix without shelling out.
 *
 * Resolution matrix (exhaustive, fail-closed):
 * - `access-lost` → SKIP (repo deleted/no-access; no current content to leak)
 * - any other failure (transient/auth/rate-limit/unknown) → BLOCK: returns
 *   `{ok:false, resolutionFailed:true, failedNodeIds}` — never silently passes
 * - success → include `owner/name` + `owner--slug` in the token set
 *
 * Zero private entries → `{ok:true}` immediately (nothing to scan).
 *
 * Redaction guarantee: no resolved private name appears in any returned value.
 * The caller (CLI shell) is responsible for redacted stderr output.
 */
export async function runPromotionScan(inputs: PromotionScanInputs): Promise<PromotionScanResult> {
  const {reposYaml, resolver, diff} = inputs

  // Parse repos.yaml and extract private node_ids.
  const parsed: unknown = parseYaml(reposYaml)
  assertReposFile(parsed)
  const privateNodeIds = parsed.repos
    .filter(r => r.private === true && typeof r.node_id === 'string' && r.node_id.length > 0)
    .map(r => r.node_id as string)

  // Zero private entries → nothing to scan.
  if (privateNodeIds.length === 0) {
    return {ok: true}
  }

  // Resolve each node_id — exhaustive matrix.
  const resolvedNames: string[] = []
  const failedNodeIds: string[] = []

  for (const nodeId of privateNodeIds) {
    const result = await resolver(nodeId)
    if ('nameWithOwner' in result) {
      resolvedNames.push(result.nameWithOwner)
    } else if (result.error === 'access-lost') {
      // access-lost: repo gone, no current content to leak — skip safely.
      // (Caller logs this with the node_id; we don't log here to keep this pure.)
    } else {
      // Non-access-lost failure: transient/auth/rate-limit/unknown — fail closed.
      // Cannot guarantee a complete scan; block promotion.
      failedNodeIds.push(nodeId)
    }
  }

  // Any non-access-lost failure → block (fail-closed).
  if (failedNodeIds.length > 0) {
    return {ok: false, resolutionFailed: true, failedNodeIds}
  }

  // Build token set from resolved names.
  const privateTokens: string[] = []
  for (const nameWithOwner of resolvedNames) {
    privateTokens.push(...buildTokensForName(nameWithOwner))
  }

  // Run the pure scan. No override in promotion mode (operator-supervised scheduled job).
  const scanResult = checkPrivateLeak(privateTokens, diff, {titlePrefixed: false, isOperator: false})
  return scanResult
}

/**
 * CLI shell for promotion mode: wires env (FRO_BOT_POLL_PAT), reads repos.yaml
 * from the data subtree, runs git diff, maps result to exit code.
 *
 * Accepts the repos.yaml path via PROMOTION_REPOS_YAML_PATH env (injectable for
 * testing; defaults to 'metadata/repos.yaml' relative to CWD which is the
 * data-branch-check subtree in CI).
 */
async function runPromotionCli(): Promise<void> {
  const pat = process.env.FRO_BOT_POLL_PAT
  if (pat === undefined || pat === '') {
    process.stderr.write(
      'check-private-leak: FRO_BOT_POLL_PAT not set. This is required for promotion mode to resolve private repo names.\n',
    )
    process.exit(1)
  }

  // Read repos.yaml from the data subtree (CWD = data-branch-check in CI).
  const reposYamlPath = process.env.PROMOTION_REPOS_YAML_PATH ?? 'metadata/repos.yaml'
  let reposYaml: string
  try {
    reposYaml = await readFile(reposYamlPath, 'utf8')
  } catch (error) {
    process.stderr.write(
      `check-private-leak: could not read repos.yaml at ${reposYamlPath}: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  }

  // Obtain the main...data diff via local git — no token needed.
  let diff: string
  try {
    diff = execFileSync('git', ['diff', 'origin/main...origin/data'], {encoding: 'utf8'})
  } catch (error) {
    process.stderr.write(
      `check-private-leak: could not obtain main...data diff: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  }

  // Wire FRO_BOT_POLL_PAT ONLY to the resolver — not to the diff or any other call.
  const resolver = makeGhNodeIdResolver(pat)

  // Parse repos.yaml to log access-lost node_ids (the pure function doesn't log).
  const parsedForLog: unknown = parseYaml(reposYaml)
  assertReposFile(parsedForLog)
  const privateNodeIds = parsedForLog.repos
    .filter(r => r.private === true && typeof r.node_id === 'string' && r.node_id.length > 0)
    .map(r => r.node_id as string)

  // Wrap resolver to emit redacted stderr for access-lost and error cases.
  const loggingResolver = async (nodeId: string) => {
    const result = await resolver(nodeId)
    if ('nameWithOwner' in result) {
      // Success — no logging (name is private; never log it)
    } else if (result.error === 'access-lost') {
      process.stderr.write(
        `check-private-leak [promotion]: node_id=${nodeId} access-lost (deleted/no-access), skipping\n`,
      )
    } else {
      process.stderr.write(`check-private-leak [promotion]: could not resolve node_id=${nodeId} (error)\n`)
    }
    return result
  }

  const result = await runPromotionScan({reposYaml, resolver: loggingResolver, diff})

  if (result.ok) {
    process.stdout.write(`check-private-leak [promotion]: ok (scanned ${privateNodeIds.length} private node_id(s))\n`)
    return
  }

  if ('resolutionFailed' in result && result.resolutionFailed) {
    // Fail-closed: resolution failure blocks promotion.
    process.stderr.write(
      `check-private-leak [promotion]: FAILED — could not resolve private node_id(s): ${result.failedNodeIds.join(', ')}\n`,
    )
    process.stderr.write('check-private-leak [promotion]: cannot guarantee a complete scan — blocking promotion\n')
    process.exit(1)
  }

  // Diff match: print file paths only, never the matched name.
  process.stderr.write(
    'check-private-leak [promotion]: FAILED — private repository name(s) detected in promotion diff\n',
  )
  process.stderr.write('\nMatched files:\n')
  if ('matchedFiles' in result) {
    for (const file of result.matchedFiles) {
      process.stderr.write(`  - ${file}\n`)
    }
  }
  process.stderr.write(
    '\nTo look up the private repository locally, run: GH_TOKEN=<operator-PAT> node scripts/resolve-private.ts metadata/repos.yaml\n',
  )
  process.stderr.write('  (This prints a node_id → owner/name table for all private entries.)\n')
  process.stderr.write('To resolve: redact the private name from the data branch and re-run the promotion.\n')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (eventPath === undefined || eventPath === '') {
    process.stderr.write(
      'check-private-leak: GITHUB_EVENT_PATH not set. This script must run inside a GitHub Actions pull_request event.\n',
    )
    process.exit(1)
  }

  const {prNumber, title, author, fullName: eventFullName} = await readPullRequestContext(eventPath)
  const fullName =
    eventFullName ??
    execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {encoding: 'utf8'}).trim()

  // Resolve private node_ids from data branch.
  const privateNodeIds = fetchPrivateNodeIds(fullName)
  if (privateNodeIds.length === 0) {
    process.stdout.write('check-private-leak: no private entries found in metadata/repos.yaml — skipping scan\n')
    return
  }

  // FIX #1: evaluate override BEFORE deciding to fail-closed.
  const titlePrefixed = title.startsWith('[allow-private-leak]')
  const isOperator = author === OPERATOR_LOGIN
  const override: OverrideOptions = {titlePrefixed, isOperator}

  // Resolve each node_id → nameWithOwner, tracking successes and failures separately.
  const resolver = makeGhNodeIdResolver()
  const resolvedNames: string[] = []
  const failedNodeIds: string[] = []

  for (const nodeId of privateNodeIds) {
    const result = await resolver(nodeId)
    if ('nameWithOwner' in result) {
      resolvedNames.push(result.nameWithOwner)
    } else if (result.error === 'access-lost') {
      // access-lost = repo gone = no current content to leak; safe to skip.
      // transient error = unknown state = must fail closed.
      process.stderr.write(`check-private-leak: node_id=${nodeId} access-lost (deleted/no-access), skipping\n`)
    } else {
      // 'error' class: transient/auth/rate-limit/unknown — fail closed.
      // Log only node_id + coarse error class; never echo raw gh stderr (may contain owner/name).
      failedNodeIds.push(nodeId)
      process.stderr.write(`check-private-leak: could not resolve node_id=${nodeId} (error)\n`)
    }
  }

  // FIX #1: fail-closed if ANY node_id failed to resolve, unless override is active.
  if (failedNodeIds.length > 0) {
    if (titlePrefixed && isOperator) {
      // Operator override allows proceeding even during a GitHub outage.
      process.stderr.write(
        `check-private-leak: ⚠️  resolution failed for node_id(s): ${failedNodeIds.join(', ')} — operator override active, proceeding with ${resolvedNames.length} resolved name(s)\n`,
      )
    } else {
      // Fail closed: cannot guarantee a complete scan.
      process.stderr.write(
        `check-private-leak: FAILED — could not resolve private node_id(s): ${failedNodeIds.join(', ')}\n`,
      )
      process.stderr.write(
        'check-private-leak: cannot guarantee a complete scan — refusing to pass the PR without full resolution\n',
      )
      process.exit(1)
    }
  }

  // Build the full set of tokens to scan for.
  // For each resolved nameWithOwner (owner/name), include:
  //   - canonical form:  owner/name
  //   - wiki slug form:  owner--slug  (e.g. computeRepoSlug('org', 'repo') → 'org--repo')
  // Bare name (without owner) is intentionally excluded: short names like 'go', 'api', 'web'
  // substring-match unrelated content and cause false-positive blocks on clean PRs.
  // Both tokens above carry the owner prefix, so they remain specific.
  const privateTokens: string[] = []
  for (const nameWithOwner of resolvedNames) {
    const slashIndex = nameWithOwner.indexOf('/')
    if (slashIndex < 1) continue
    const owner = nameWithOwner.slice(0, slashIndex)
    const name = nameWithOwner.slice(slashIndex + 1)
    if (owner === '' || name === '') continue
    privateTokens.push(nameWithOwner) // canonical: owner/name
    try {
      privateTokens.push(computeRepoSlug(owner, name)) // wiki slug: owner--slug
    } catch {
      // computeRepoSlug throws on empty segments — skip slug form if it can't be computed
    }
  }

  // Fetch diff and evaluate.
  const diff = fetchPrDiff(prNumber)
  const result = checkPrivateLeak(privateTokens, diff, override)

  if (result.ok) {
    if (titlePrefixed && isOperator) {
      process.stderr.write(
        `check-private-leak: ⚠️  override honored for operator ${author} — bypassing private-leak guard\n`,
      )
      try {
        postOverrideComment(prNumber, author)
      } catch {
        process.stderr.write('check-private-leak: could not post override transparency comment\n')
      }
    }
    process.stdout.write(`check-private-leak: ok (scanned ${resolvedNames.length} private name(s))\n`)
    return
  }

  // Failure: print file paths only, never the matched name.
  process.stderr.write('check-private-leak: FAILED — private repository name(s) detected in PR diff\n')
  process.stderr.write('\nMatched files:\n')
  for (const file of result.matchedFiles) {
    process.stderr.write(`  - ${file}\n`)
  }
  // FIX #5: corrected remediation command (resolve-private takes a file path, not a node_id).
  process.stderr.write(
    '\nTo look up the private repository locally, run: GH_TOKEN=<operator-PAT> node scripts/resolve-private.ts metadata/repos.yaml\n',
  )
  process.stderr.write('  (This prints a node_id → owner/name table for all private entries.)\n')
  process.stderr.write('To bypass (operator only): prefix the PR title with [allow-private-leak] and re-run.\n')
  process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--promotion')) {
    await runPromotionCli()
  } else {
    await main()
  }
}
