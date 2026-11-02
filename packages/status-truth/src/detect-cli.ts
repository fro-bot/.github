/**
 * The `scripts/status-truth-detect.ts` entrypoint on the goke runner. It takes no argument: one read-only
 * root command scans the public docs and the current repository's issues for status claims, resolves them
 * against live state, writes the report artifact and prints a counts-only summary on stdout. Any argument,
 * `--help` included, is a usage error and scans nothing.
 *
 * A failed precondition or an unwritable report throws a message-only error: the runner prints it on stderr
 * and exits 1, which `status-truth.yaml` reads as a failed step. The report upload and summary steps run
 * `if: always()`.
 */

import {readFile, writeFile} from 'node:fs/promises'
import process from 'node:process'
import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {createOctokit, noopLog} from '@fro-bot/core/github'
import {detectStatusTruthClaims} from './detect-classify.ts'
import {
  SCAN_GLOB_PATTERNS,
  scanIssueStatusTruthClaims,
  scanStatusTruthClaims,
  type FileLister,
  type FileReader,
  type IssueCommentFetcher,
  type IssueLister,
} from './detect-extract.ts'
import {
  listCurrentRepoIssueComments,
  listCurrentRepoIssues,
  resolveAllClaims,
  resolveFileParseClaims,
  type DetectOctokitClient,
} from './detect-live-state.ts'
import {scanPlanConsistencyFindings} from './detect-plan-consistency.ts'
import {loadRolloutSnapshot} from './detect-rollout.ts'
import {
  buildStatusTruthReport,
  selectDetectFailureClass,
  type ResolverResult,
  type StatusTruthClaim,
  type StatusTruthJsonReport,
} from './report-model.ts'

/** The env a run reads: what the runner hands the action, `process.env` in production. */
type Env = Readonly<Record<string, string | undefined>>

/** Where a run writes: the counts-only summary to `stdout`, a diagnostic line to `stderr`. */
export interface DetectIo {
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}

/**
 * Build Octokit constructor options for the detect step.
 *
 * Includes:
 * - `auth`: the GitHub token
 * - `request.timeout`: 10 second timeout
 * - `log`: no-op logger to suppress request URL leaks to stderr
 *
 * The default Octokit logger writes request URLs and error details to stderr, which leaks raw source
 * refs (e.g., `GET /repos/owner/repo/pulls/579 - 404`) from caught errors.
 *
 * Exported for testability — callers can verify the log handlers are no-ops.
 */
export function buildDetectOctokitOptions(token: string): {
  auth: string
  request: {timeout: number}
  log: ReturnType<typeof noopLog>
} {
  return {
    auth: token,
    request: {timeout: 10_000},
    log: noopLog(),
  }
}

/**
 * Run the status-truth detect step.
 *
 * Environment variables:
 * - STATUS_TRUTH_REPORT_PATH: path to write the JSON report artifact (required)
 * - GITHUB_TOKEN: read-only token for current-repo API resolution (optional;
 *   without it, all API claims are classified as unavailable/unresolved)
 * - GITHUB_REPOSITORY: owner/repo for current-repo resolution (optional;
 *   defaults to 'fro-bot/.github')
 * - STATUS_TRUTH_ROLLOUT_SNAPSHOT_PATH: the rollout snapshot written by the pre-detect step (optional)
 *
 * Behavior:
 * - Scans public docs paths (README.md, SECURITY.md, docs/**, knowledge/**,
 *   .github/**\/*.md) for status-truth claims using CLAIM_KIND_DEFINITIONS patterns.
 * - Resolves live state for current-repo PR/issues/releases/tags using the
 *   read-only GITHUB_TOKEN. Cross-repo references are proven public first.
 * - Emits a structured report artifact plus counts-only summary to stdout.
 * - stdout/stderr carry counts only; no raw claim text, source paths, or fingerprints.
 * - If scanning/resolution fails unexpectedly, emits an execution-failure report.
 *   Never emits a fake clean report when scanning has not run.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */
export async function runDetect(env: Env, io: DetectIo): Promise<void> {
  const reportPath = env.STATUS_TRUTH_REPORT_PATH

  if (reportPath === undefined || reportPath === '') {
    throw new Error('status-truth-detect: STATUS_TRUTH_REPORT_PATH is required')
  }

  const generatedAt = new Date().toISOString()

  // Determine owner/repo from environment
  const githubRepository = env.GITHUB_REPOSITORY ?? 'fro-bot/.github'
  const slashIndex = githubRepository.indexOf('/')
  const owner = slashIndex === -1 ? githubRepository : githubRepository.slice(0, slashIndex)
  const repo = slashIndex === -1 ? '' : githubRepository.slice(slashIndex + 1)

  if (owner === '' || repo === '') {
    throw new Error('status-truth-detect: GITHUB_REPOSITORY must be in owner/repo format')
  }

  // Build file lister using Node 24 native glob
  const fileLister: FileLister = async () => {
    const {glob: fsGlob} = await import('node:fs/promises')
    const paths: string[] = []
    for (const pattern of SCAN_GLOB_PATTERNS) {
      for await (const entry of fsGlob(pattern, {cwd: process.cwd()})) {
        paths.push(entry)
      }
    }
    return paths
  }

  // Build file reader
  const fileReader: FileReader = async (filePath: string) => readFile(filePath, 'utf8')

  let report: StatusTruthJsonReport

  try {
    // Step 1: Scan file-system docs for claims (plan-status included via DEFAULT_ENABLED_KINDS)
    const {claims: fileClaims, scanErrors: fileScanErrors} = await scanStatusTruthClaims({fileLister, fileReader})

    // Step 1b: Plan-consistency self-audit — bounded second pass over docs/plans/*.md.
    // Produces findings directly (not claims): this kind has its own single
    // drift-matrix resolver and never enters the CLAIM_KIND_DEFINITIONS/
    // classifyClaim pipeline. Read failures here are file-parse errors, same
    // class as fileScanErrors, so they fold into the same failure accounting.
    const {findings: planConsistencyFindings, scanErrors: planConsistencyScanErrors} =
      await scanPlanConsistencyFindings({fileLister, fileReader})
    const totalFileScanErrors = fileScanErrors + planConsistencyScanErrors

    // Step 2: Resolve live state and scan GitHub issues (if token available)
    const token = env.GITHUB_TOKEN
    let resolveErrors = 0
    let issueScanErrors = 0
    let issueClaims: StatusTruthClaim[] = []

    // Load rollout snapshot (best-effort; absence/failure → null, not a hard error).
    // The snapshot path is exported by the pre-detect workflow step via env var.
    // If absent or malformed, rollout-tracker claims remain unresolved (no fake drift).
    const snapshotPath = env.STATUS_TRUTH_ROLLOUT_SNAPSHOT_PATH
    const snapshot = await loadRolloutSnapshot({snapshotPath, fileReader})

    let resolverResults: Record<string, ResolverResult>

    if (token !== undefined && token !== '') {
      const options = buildDetectOctokitOptions(token)
      // `DetectOctokitClient` declares narrower response shapes than the real client (for example
      // `issues.listForRepo` data), so the real client is not assignable and the boundary casts.
      const octokit = (await createOctokit(options.auth, {
        timeoutMs: options.request.timeout,
        log: options.log,
      })) as unknown as DetectOctokitClient

      // Build injected issue lister/comment fetcher using paginated helpers
      // (avoids the per_page:100 truncation bug — fetches all pages)
      const issueLister: IssueLister = async ({owner: o, repo: r}) => listCurrentRepoIssues(octokit, o, r)

      const commentFetcher: IssueCommentFetcher = async ({owner: o, repo: r, issueNumber}) =>
        listCurrentRepoIssueComments(octokit, o, r, issueNumber)

      // Scan GitHub issue bodies and comments
      const issueResult = await scanIssueStatusTruthClaims({owner, repo, issueLister, commentFetcher})
      issueClaims = issueResult.claims
      issueScanErrors = issueResult.scanErrors

      // Resolve all claims (file + issue) against live state.
      // resolveAllClaims handles file-parse (plan-status) via fileReader, API-backed
      // claims via octokit, and compound claims via snapshot. No pre-pass needed.
      const allClaims = [...fileClaims, ...issueClaims]
      const resolved = await resolveAllClaims({claims: allClaims, octokit, owner, repo, fileReader, snapshot})
      resolverResults = resolved.resolverResults
      resolveErrors = resolved.resolveErrors
    } else {
      // No token: resolve file-parse claims (plan-status) locally; API claims remain unresolved.
      resolverResults = await resolveFileParseClaims({claims: fileClaims, fileReader})
    }

    // Step 3: Classify all claims into findings, then append plan-consistency
    // findings (already fully classified by scanPlanConsistencyFindings).
    // No planner/report-shape changes: PublicStatusTruthFinding is generic.
    const allClaims = [...fileClaims, ...issueClaims]
    const findings = [...detectStatusTruthClaims(allClaims, resolverResults), ...planConsistencyFindings]

    // Scan is complete if no per-file, issue-scan, or resolve errors occurred.
    // Failure class distinguishes the error source:
    // - file-parse-error: per-file read/parse errors during file-system scanning
    //   (includes plan-consistency's own docs/plans/*.md read failures)
    // - api-unavailable: issue list/comment fetch failures or resolver API errors
    const scanComplete = totalFileScanErrors === 0 && issueScanErrors === 0 && resolveErrors === 0

    const failureClass = selectDetectFailureClass({
      fileScanErrors: totalFileScanErrors,
      issueScanErrors,
      resolveErrors,
    })

    report = buildStatusTruthReport({
      findings,
      scanComplete,
      generatedAt,
      failureClass,
    })
  } catch {
    // Unexpected failure — emit execution-failure report, not fake clean
    io.stderr('status-truth-detect: unexpected scan failure: error-class=execution-error\n')
    report = buildStatusTruthReport({
      findings: [],
      scanComplete: false,
      generatedAt,
      failureClass: 'execution-error',
    })
  }

  const reportJson = `${JSON.stringify(report, null, 2)}\n`

  try {
    await writeFile(reportPath, reportJson, {flag: 'w'})
  } catch {
    throw new Error('status-truth-detect: could not write report: error-class=write-failure')
  }

  // Counts-only summary to stdout — no raw claim text, source paths, or fingerprints
  const summary = {
    status: report.status,
    scan_complete: report.scan_complete,
    counts: report.counts,
  }
  io.stdout(`${JSON.stringify(summary)}\n`)
}

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function statusTruthDetectCli(): CliConfig {
  return {
    name: 'status-truth-detect',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => {
          await runDetect(context.env, {stdout: context.stdout, stderr: context.stderr})
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(statusTruthDetectCli())
}
