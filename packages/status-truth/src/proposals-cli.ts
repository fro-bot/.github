/**
 * The `scripts/status-truth-proposals.ts` entrypoint on the goke runner. It takes no argument: one writing
 * root command reads the report artifact the detect step wrote, plans the proposal lifecycle and applies it,
 * and prints a counts-only result on stdout and, when asked, in a result file. Any argument, `--help`
 * included, is a usage error and plans nothing.
 *
 * `STATUS_TRUTH_DRY_RUN=true` is a dry run: nothing is written and the GitHub token is optional. Any other
 * value, and an unset variable, takes the live path, so the workflow always sets it
 * (`github.event.inputs.dry_run || 'true'`) and the dry run is the default of the workflow, not of this
 * module. A failed precondition throws a message-only error: the runner prints it on stderr and exits 1.
 * The summary step runs `if: always()` and reads the result file.
 */

import type {ExistingProposalIssue, OutcomeCounts} from './proposal-outcomes.ts'
import {readFile, writeFile} from 'node:fs/promises'
import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {createOctokit, noopLog} from '@fro-bot/core/github'
import {loadPrivateTokensFromDisk} from '@fro-bot/privacy/capture-learnings-privacy'
import {loadRedactedCanonicalIdsFromDisk} from '@fro-bot/privacy/redacted-ids'
import {makePublicOutputTokens} from '@fro-bot/privacy/status-truth-public-output'
import {
  executeStatusTruthProposalActions,
  fetchExistingProposalIssues,
  type ExecuteStatusTruthProposalActionsCounts,
  type ExecuteStatusTruthProposalActionsResult,
  type StatusTruthOctokitClient,
} from './proposal-exec.ts'
import {planStatusTruthProposalActions, type KindActionCounts, type ProposalCounts} from './proposal-plan.ts'
import {validateStatusTruthArtifact} from './report-model.ts'

/** The env a run reads: what the runner hands the action, `process.env` in production. */
type Env = Readonly<Record<string, string | undefined>>

/** Where a run writes: the counts-only result to `stdout`, a diagnostic line to `stderr`. */
export interface ProposalsIo {
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}

const REQUEST_TIMEOUT_MS = 10_000

// `StatusTruthOctokitClient` declares narrower response shapes than the real client (for example
// `issues.listForRepo` data), so the real client is not assignable and each boundary casts.
async function createOctokitFromEnv(env: Env): Promise<StatusTruthOctokitClient> {
  const octokit = await createOctokit(env.GITHUB_TOKEN, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    log: noopLog(),
    missingToken: () => new Error('status-truth-proposals: GITHUB_TOKEN is required in the environment'),
  })
  return octokit as unknown as StatusTruthOctokitClient
}

/** Counts-only result written to stdout and STATUS_TRUTH_OPEN_RESULT_PATH. */
interface OpenResult {
  dryRun: boolean
  labelGateFailed: boolean
  counts: ExecuteStatusTruthProposalActionsCounts
  /**
   * Planned per-kind action counts from the planner (counts-only, no paths or fingerprints).
   * These are the counts the planner intended to execute, not the executed counts.
   * Allows downstream workflow steps to report per-kind summaries without exposing
   * any identity-bearing fields.
   */
  plannedCountsByKind: Readonly<Record<string, KindActionCounts>>
  /**
   * Aggregate planned counts from the planner (counts-only).
   * Includes versionRejected, blocked, overflowed, and other planner-level counters
   * not present in executor counts.
   */
  plannedCounts: Pick<
    ProposalCounts,
    'versionRejected' | 'blocked' | 'overflowed' | 'sameRunDeduplicated' | 'needsOutcomeCooldown'
  >
  /**
   * Aggregate outcome counts from all existing proposal issues (read-model).
   * Separate from action counts (counts) and planned counts (plannedCounts).
   * Reflects the current state of all proposal issues, not the actions taken this run.
   * Counts-only: no raw issue bodies, titles, paths, or fingerprints.
   */
  outcomeCounts: OutcomeCounts
  /**
   * Per-claim-kind aggregate outcome counts from all existing proposal issues.
   * Same read-model as `outcomeCounts`, bucketed by kind. Counts-only: no
   * paths, titles, or fingerprints.
   */
  outcomeCountsByKind: Readonly<Record<string, OutcomeCounts>>
}

/**
 * Run the status-truth open/proposals step.
 *
 * Environment variables:
 * - STATUS_TRUTH_REPORT_PATH: path to the JSON report artifact from the detect step (required)
 * - STATUS_TRUTH_OPEN_RESULT_PATH: path to write the counts-only result JSON (optional)
 * - STATUS_TRUTH_DRY_RUN: set to 'true' for dry-run mode (optional)
 * - GITHUB_TOKEN: write-scoped app token for issue mutations (required unless dry-run)
 *
 * Behavior:
 * - Reads and validates the report artifact (schema/fingerprint version, required fields,
 *   prohibited fields, count consistency). Fails closed on any validation error.
 * - Loads privacy tokens from metadata/repos.yaml (fail-closed).
 * - Plans proposal lifecycle actions (pure planner).
 * - Executes actions (or counts only in dry-run mode).
 * - Writes counts-only result to stdout and optionally to STATUS_TRUTH_OPEN_RESULT_PATH.
 * - stdout/stderr carry counts only; no raw claim text, source paths, fingerprints, or tokens.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */
export async function runOpen(env: Env, io: ProposalsIo): Promise<void> {
  const reportPath = env.STATUS_TRUTH_REPORT_PATH
  const resultPath = env.STATUS_TRUTH_OPEN_RESULT_PATH
  const dryRun = env.STATUS_TRUTH_DRY_RUN === 'true'

  if (reportPath === undefined || reportPath === '') {
    throw new Error('status-truth-proposals: STATUS_TRUTH_REPORT_PATH is required')
  }

  // Read and parse the report artifact
  let rawJson: string
  try {
    rawJson = await readFile(reportPath, 'utf8')
  } catch {
    throw new Error('status-truth-proposals: could not read report artifact: error-class=read-failure')
  }

  let rawParsed: unknown
  try {
    rawParsed = JSON.parse(rawJson)
  } catch {
    throw new Error('status-truth-proposals: could not parse report artifact: error-class=parse-failure')
  }

  // Validate the artifact before any write planning
  const validation = validateStatusTruthArtifact(rawParsed)
  if (!validation.valid) {
    throw new Error('status-truth-proposals: artifact validation failed: error-class=validation-failure')
  }

  const report = validation.report

  // Load privacy tokens (fail-closed)
  let publicOutputTokens: ReturnType<typeof makePublicOutputTokens>
  try {
    const [privateTokens, redactedCanonicalIds] = await Promise.all([
      loadPrivateTokensFromDisk(),
      loadRedactedCanonicalIdsFromDisk(),
    ])
    publicOutputTokens = makePublicOutputTokens({
      privateTokens,
      redactedCanonicalIds,
    })
  } catch {
    throw new Error('status-truth-proposals: privacy token load failed: error-class=token-load-failure')
  }

  // Determine owner/repo from environment
  const githubRepository = env.GITHUB_REPOSITORY ?? 'fro-bot/.github'
  const slashIndex = githubRepository.indexOf('/')
  const owner = slashIndex === -1 ? githubRepository : githubRepository.slice(0, slashIndex)
  const repo = slashIndex === -1 ? '' : githubRepository.slice(slashIndex + 1)

  // Fetch existing proposal issues from GitHub before planning.
  // In dry-run mode we attempt a read-only fetch (best-effort) so the planner can
  // no-op/update/reopen correctly rather than always opening duplicates.
  // If the token is absent or the fetch fails in dry-run, fall back to empty list
  // (no mutations happen anyway, so over-counting planned opens is acceptable).
  //
  // In live mode the fetch is fail-closed: if it fails we exit before planning or
  // executing any mutations. Proceeding with an empty list in live mode would cause
  // duplicate proposals to be opened for every existing finding.
  let existingIssues: ExistingProposalIssue[] = []
  // In live mode, a single Octokit instance is created for both the fetch and execute
  // steps to avoid constructing it twice (and re-reading the token twice).
  let liveOctokit: StatusTruthOctokitClient | undefined

  if (dryRun) {
    // Dry-run: attempt read-only fetch if token is available; fall back to empty list
    const dryRunToken = env.GITHUB_TOKEN
    if (dryRunToken !== undefined && dryRunToken !== '' && owner !== '' && repo !== '') {
      try {
        const dryRunOctokit = (await createOctokit(dryRunToken, {
          timeoutMs: REQUEST_TIMEOUT_MS,
          log: noopLog(),
        })) as unknown as StatusTruthOctokitClient
        existingIssues = await fetchExistingProposalIssues({octokit: dryRunOctokit, owner, repo})
      } catch {
        // Non-fatal in dry-run: proceed with empty list (counts may over-estimate opens)
      }
    }
  } else {
    // Live mode: create a single Octokit instance for both the issue fetch and
    // the execute step. Fail closed: if the fetch fails, exit before planning
    // or executing mutations. Proceeding with an empty list would open duplicate
    // proposals for all findings.
    liveOctokit = await createOctokitFromEnv(env)
    try {
      existingIssues = await fetchExistingProposalIssues({octokit: liveOctokit, owner, repo})
    } catch {
      throw new Error('status-truth-proposals: existing issue fetch failed: error-class=fetch-failure')
    }
  }

  // Plan proposal lifecycle actions (pure, no I/O)
  const planResult = planStatusTruthProposalActions({
    report,
    existingIssues,
    publicOutputTokens,
    sameRunCreatedFingerprints: new Set<string>(),
  })

  // Execute actions (or count only in dry-run)
  let executeResult: ExecuteStatusTruthProposalActionsResult

  if (dryRun) {
    executeResult = await executeStatusTruthProposalActions({
      octokit: {} as StatusTruthOctokitClient, // not used in dry-run
      owner: owner || 'fro-bot',
      repo: repo || '.github',
      actions: planResult.actions,
      dryRun: true,
      sameRunCreatedFingerprints: new Set<string>(),
    })
  } else {
    // Reuse the single Octokit instance created for the fetch step above.
    // liveOctokit is always defined here because dryRun is false.
    executeResult = await executeStatusTruthProposalActions({
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      octokit: liveOctokit!,
      owner: owner || 'fro-bot',
      repo: repo || '.github',
      actions: planResult.actions,
      dryRun: false,
      sameRunCreatedFingerprints: new Set<string>(),
    })
  }

  // Counts-only result — no raw claim text, source paths, fingerprints, or tokens
  const result: OpenResult = {
    dryRun: executeResult.dryRun,
    labelGateFailed: executeResult.labelGateFailed,
    counts: executeResult.counts,
    plannedCountsByKind: planResult.countsByKind,
    plannedCounts: {
      versionRejected: planResult.counts.versionRejected,
      blocked: planResult.counts.blocked,
      overflowed: planResult.counts.overflowed,
      sameRunDeduplicated: planResult.counts.sameRunDeduplicated,
      needsOutcomeCooldown: planResult.counts.needsOutcomeCooldown,
    },
    outcomeCounts: planResult.outcomeCounts,
    outcomeCountsByKind: planResult.outcomeCountsByKind,
  }

  const resultJson = `${JSON.stringify(result)}\n`
  io.stdout(resultJson)

  if (resultPath !== undefined && resultPath !== '') {
    try {
      await writeFile(resultPath, resultJson, {flag: 'w'})
    } catch {
      io.stderr('status-truth-proposals: could not write result: error-class=write-failure\n')
    }
  }
}

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function statusTruthProposalsCli(): CliConfig {
  return {
    name: 'status-truth-proposals',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => {
          await runOpen(context.env, {stdout: context.stdout, stderr: context.stderr})
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(statusTruthProposalsCli())
}
