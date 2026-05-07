import type {ReposFile} from './schemas.ts'

import {execFileSync} from 'node:child_process'
import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'
import process from 'node:process'

import {parse as parseYaml} from 'yaml'

import {assertReposFile} from './schemas.ts'

/**
 * Operator-supplied canonical mapping for one private repo. The `node_id` is GitHub's
 * GraphQL global node ID (e.g. `R_kgDO...`), used as the redacted name in
 * `metadata/repos.yaml`. The `owner`/`name` pair is the canonical identifier the
 * operator wants to scrub from public artifacts.
 *
 * This mapping never persists in the repo — the operator passes it via CLI args at
 * enumeration time, the script processes it in-memory, and the values disappear when
 * the process exits.
 */
export interface PrivateRepoMapping {
  readonly node_id: string
  readonly owner: string
  readonly name: string
}

/**
 * One surface where canonical info about a private repo currently exists in a public
 * artifact. Each surface carries the remediation command the operator can run to
 * scrub it (or accept it via the documented disclosure path).
 */
export interface LeakSurface {
  readonly type: 'commit-subject' | 'workflow-run' | 'metadata-entry' | 'wiki-page'
  readonly identifier: string
  readonly description: string
  readonly remediation: {
    readonly action: 'rebase-rewrite' | 'delete-run' | 'redact-entry' | 'delete-page'
    readonly command: string
  }
}

export interface EnumerateLeaksInput {
  readonly privateRepos: readonly PrivateRepoMapping[]
  readonly commitLog: readonly {sha: string; subject: string}[]
  readonly workflowRuns: readonly {id: number; name: string; inputs: Record<string, unknown>}[]
  readonly reposFile: ReposFile
  readonly wikiFilenames: readonly string[]
}

/**
 * Pure function: scan all data sources for surfaces where any private repo's canonical
 * `owner/name` appears, and emit a structured remediation list.
 *
 * Detection rules:
 * - **commit-subject**: case-insensitive match of `owner/name` as a contiguous token in
 *   the commit subject. Substring matches inside other words are excluded by anchoring
 *   on the slash character — so `polymorphism` doesn't match `poly`.
 * - **workflow-run**: matches when the run's `inputs.owner` and `inputs.repo` both
 *   equal the canonical pair (case-sensitive — GitHub stores logins canonically), OR
 *   when the run's display name contains `owner/name` as a substring.
 * - **metadata-entry**: matches when an entry in `metadata/repos.yaml` has
 *   `owner === canonical.owner && name === canonical.name`. Entries already redacted
 *   (owner: `[REDACTED]`, name: `<node_id>`) are NOT reported.
 * - **wiki-page**: matches when a filename in `knowledge/wiki/repos/` equals the
 *   canonical slug `${owner}--${name}.md`.
 */
export function enumerateLeaks(input: EnumerateLeaksInput): LeakSurface[] {
  const surfaces: LeakSurface[] = []

  for (const priv of input.privateRepos) {
    const canonical = `${priv.owner}/${priv.name}`
    const canonicalLower = canonical.toLowerCase()

    // commit-subject — slash-anchored case-insensitive token match.
    for (const commit of input.commitLog) {
      if (commit.subject.toLowerCase().includes(canonicalLower)) {
        surfaces.push({
          type: 'commit-subject',
          identifier: commit.sha,
          description: `commit subject names ${canonical}`,
          remediation: {
            action: 'rebase-rewrite',
            command: `git rebase -i ${commit.sha}~1  # then 'reword' and replace ${canonical} with ${priv.node_id}; or use 'git filter-repo --replace-message <expr>'`,
          },
        })
      }
    }

    // workflow-run — match by inputs first (most reliable), then fall back to run name.
    for (const run of input.workflowRuns) {
      const inputsMatch = run.inputs.owner === priv.owner && run.inputs.repo === priv.name
      const nameMatch = run.name.toLowerCase().includes(canonicalLower)
      if (inputsMatch || nameMatch) {
        surfaces.push({
          type: 'workflow-run',
          identifier: String(run.id),
          description: `workflow run "${run.name}" references ${canonical}`,
          remediation: {
            action: 'delete-run',
            command: `gh api -X DELETE /repos/fro-bot/.github/actions/runs/${run.id}`,
          },
        })
      }
    }

    // metadata-entry — match by current owner/name (entries already redacted are skipped).
    for (const entry of input.reposFile.repos) {
      if (entry.owner === priv.owner && entry.name === priv.name) {
        surfaces.push({
          type: 'metadata-entry',
          identifier: `${entry.owner}/${entry.name}`,
          description: `metadata/repos.yaml entry names ${canonical} canonically (not yet redacted)`,
          remediation: {
            action: 'redact-entry',
            command: `# Author a one-shot PR (operator identity, not bot) that sets owner='[REDACTED]' and name='${priv.node_id}' on this entry. The check-wiki-authority guard skips author=marcusrbrown for explicit operator rewrites.`,
          },
        })
      }
    }

    // wiki-page — match canonical slug pattern owner--name.md (double-dash separator).
    const canonicalSlug = `${priv.owner}--${priv.name}.md`.toLowerCase()
    for (const filename of input.wikiFilenames) {
      if (filename.toLowerCase() === canonicalSlug) {
        surfaces.push({
          type: 'wiki-page',
          identifier: filename,
          description: `knowledge/wiki/repos/${filename} is named after ${canonical}`,
          remediation: {
            action: 'delete-page',
            command: `# Operator removes knowledge/wiki/repos/${filename} on the data branch and rebuilds the index via 'node scripts/rebuild-wiki-index.ts'.`,
          },
        })
      }
    }
  }

  return surfaces
}

/**
 * Render a human-readable report grouping surfaces by type and listing the remediation
 * command for each. Used by the CLI to print to stdout. Returns a "no surfaces" message
 * when the input is empty so the operator gets an explicit confirmation rather than
 * blank output.
 */
export function formatLeakReport(surfaces: readonly LeakSurface[]): string {
  if (surfaces.length === 0) {
    return 'No leak surfaces found. None of the supplied private repos appear in any scanned source.'
  }

  const grouped = new Map<LeakSurface['type'], LeakSurface[]>()
  for (const s of surfaces) {
    const bucket = grouped.get(s.type) ?? []
    bucket.push(s)
    grouped.set(s.type, bucket)
  }

  const lines: string[] = [`Found ${surfaces.length} leak surface(s):`, '']
  for (const [type, group] of grouped) {
    lines.push(`## ${type} (${group.length})`)
    lines.push('')
    for (const s of group) {
      lines.push(`- ${s.identifier}`)
      lines.push(`  ${s.description}`)
      lines.push(`  remediation (${s.remediation.action}):`)
      lines.push(`    ${s.remediation.command}`)
    }
    lines.push('')
  }
  lines.push(
    'Per-surface decision: REMEDIATE (run the command) or ACCEPT (record the disclosure in metadata/README.md).',
  )
  return lines.join('\n')
}

interface CliInput {
  readonly privateRepos: readonly PrivateRepoMapping[]
  readonly repoRoot: string
  readonly mainBranch: string
  /**
   * Optional git ref to read `metadata/repos.yaml` from. Defaults to the working tree
   * (typically `main`). Pass `data` (or `origin/data`) to catch entries that have not
   * yet promoted via the weekly merge-data PR — operators should run both passes.
   */
  readonly metadataRef?: string
}

/**
 * Parse `--private node_id:owner/name` arguments into structured mappings. Each flag
 * may appear multiple times. The `node_id` segment is required because it's needed
 * for the redact-entry remediation command output.
 */
function parsePrivateArgs(argv: readonly string[]): PrivateRepoMapping[] {
  const mappings: PrivateRepoMapping[] = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--private') continue
    const value = argv[i + 1]
    if (value === undefined) {
      throw new Error('--private flag requires a value of the form node_id:owner/name')
    }
    const colonIdx = value.indexOf(':')
    const slashIdx = value.indexOf('/')
    if (colonIdx === -1 || slashIdx === -1 || slashIdx < colonIdx) {
      throw new Error(`--private value must be of the form node_id:owner/name (got: ${value})`)
    }
    const nodeId = value.slice(0, colonIdx)
    const owner = value.slice(colonIdx + 1, slashIdx)
    const name = value.slice(slashIdx + 1)
    if (nodeId === '' || owner === '' || name === '') {
      throw new Error(`--private value has empty segment(s) (got: ${value})`)
    }
    mappings.push({node_id: nodeId, owner, name})
    i += 1
  }
  return mappings
}

async function gatherCommitLog(mainBranch: string): Promise<{sha: string; subject: string}[]> {
  // Limit to a reasonable history window (default: all commits on main since repo creation).
  // Format: `<sha>\t<subject>` per line.
  const stdout = execFileSync('git', ['log', mainBranch, '--format=%h\t%s'], {encoding: 'utf8'})
  return stdout
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => {
      const tabIdx = line.indexOf('\t')
      return {sha: line.slice(0, tabIdx), subject: line.slice(tabIdx + 1)}
    })
}

async function gatherWorkflowRuns(): Promise<{id: number; name: string; inputs: Record<string, unknown>}[]> {
  // Pull recent run history for the Survey Repo workflow specifically. Other workflows
  // (poll-invitations, fro-bot.yaml) take only repo-internal context, not target-repo
  // names, so they don't contribute to the leak surface.
  //
  // The list-runs endpoint exposes `display_title` (visible in the public Actions tab)
  // but NOT the original workflow_dispatch inputs — those would require a per-run fetch
  // against /actions/runs/<id> which is rate-limit prohibitive at scale. The display
  // title is the actual public leak surface anyway: anyone browsing the Actions tab
  // sees it. The pure `enumerateLeaks` still accepts inputs for fixture-driven tests,
  // but the CLI shell populates only the display title.
  try {
    const stdout = execFileSync(
      'gh',
      [
        'api',
        '/repos/fro-bot/.github/actions/workflows/survey-repo.yaml/runs?per_page=100',
        '--jq',
        '.workflow_runs[] | {id, name: (.display_title // "")}',
      ],
      {encoding: 'utf8'},
    )
    return stdout
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const parsed = JSON.parse(line) as {id: number; name: string}
        return {id: parsed.id, name: parsed.name, inputs: {}}
      })
  } catch (error: unknown) {
    process.stderr.write(
      `enumerate-existing-leaks: failed to fetch workflow runs (${(error as Error).message}); continuing without them.\n`,
    )
    return []
  }
}

/**
 * Read `metadata/repos.yaml` either from the local working tree (default) or from a
 * specific git ref (e.g. `data`). The data branch is where autonomous commits land
 * before the weekly merge-data PR promotes them to `main`. Operators running this
 * enumeration should generally check both: a leak that hasn't promoted yet still
 * counts, since it WILL promote on the next merge-data cycle if not redacted first.
 */
async function gatherReposFile(repoRoot: string, ref?: string): Promise<ReposFile> {
  let raw: string
  if (ref === undefined) {
    const path = join(repoRoot, 'metadata', 'repos.yaml')
    raw = await readFile(path, 'utf8')
  } else {
    raw = execFileSync('git', ['show', `${ref}:metadata/repos.yaml`], {encoding: 'utf8'})
  }
  const parsed: unknown = parseYaml(raw)
  assertReposFile(parsed, 'repos')
  return parsed
}

async function gatherWikiFilenames(repoRoot: string): Promise<string[]> {
  const dir = join(repoRoot, 'knowledge', 'wiki', 'repos')
  try {
    const entries = await readdir(dir)
    return entries.filter(e => e.endsWith('.md') && e !== 'README.md')
  } catch {
    return []
  }
}

export async function runCli(input: CliInput): Promise<LeakSurface[]> {
  const [commitLog, workflowRuns, reposFile, wikiFilenames] = await Promise.all([
    gatherCommitLog(input.mainBranch),
    gatherWorkflowRuns(),
    gatherReposFile(input.repoRoot, input.metadataRef),
    gatherWikiFilenames(input.repoRoot),
  ])

  return enumerateLeaks({
    privateRepos: input.privateRepos,
    commitLog,
    workflowRuns,
    reposFile,
    wikiFilenames,
  })
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) {
    process.stdout.write(
      `${[
        'Usage: node scripts/enumerate-existing-leaks.ts --private <node_id>:<owner>/<name> [--private ...] [--branch <ref>]',
        '',
        'Scans the local checkout for surfaces where the supplied private repo identifiers appear',
        'in public artifacts (commit subjects on main, recent Survey Repo workflow runs,',
        'metadata/repos.yaml entries, and knowledge/wiki/repos/ filenames).',
        '',
        'By default reads metadata/repos.yaml from the working tree (typically main). Pass',
        '--branch origin/data to also catch entries that have not yet promoted via the weekly',
        'merge-data PR. Operators should run both passes for full coverage.',
        '',
        'Examples:',
        '  node scripts/enumerate-existing-leaks.ts --private <node_id>:<owner>/<name>',
        '  node scripts/enumerate-existing-leaks.ts --private <node_id>:<owner>/<name> --branch origin/data',
        '',
        'For each surface, the operator decides REMEDIATE (run the printed command) or ACCEPT',
        '(record the disclosure in metadata/README.md). Phase 0 closes when every surface has',
        'an explicit decision.',
      ].join('\n')}\n`,
    )
    process.exit(argv.includes('--help') ? 0 : 1)
  }

  const privateRepos = parsePrivateArgs(argv)
  if (privateRepos.length === 0) {
    process.stderr.write('enumerate-existing-leaks: no --private mappings supplied\n')
    process.exit(1)
  }

  // Optional --branch <ref> overrides the metadata read source. Defaults to working
  // tree (typically main). Useful values: `origin/data` to catch entries that have
  // not yet promoted via the weekly merge-data PR.
  const branchIdx = argv.indexOf('--branch')
  const metadataRef = branchIdx === -1 ? undefined : argv[branchIdx + 1]

  const repoRoot = process.cwd()
  const mainBranch = 'main'

  const surfaces = await runCli({privateRepos, repoRoot, mainBranch, metadataRef})
  process.stdout.write(`${formatLeakReport(surfaces)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
