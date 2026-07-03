import type {PrivateWikiLeak, WikiPageSnapshot} from './check-wiki-private-presence.ts'
import type {RepoEntry} from './schemas.ts'
import type {CommitWikiChangesParams, CommitWikiChangesResult, OctokitClient} from './wiki-ingest.ts'
import type {WikiLintFinding} from './wiki-lint.ts'
import {createHash} from 'node:crypto'
import {readdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import process from 'node:process'

import YAML from 'yaml'
import {
  buildPublicSlugMap,
  detectPrivateWikiLeaks,
  loadWikiPages,
  requireGrandfatherDir,
} from './check-wiki-private-presence.ts'
import {assertReposFile} from './schemas.ts'
import {commitWikiChanges, pageTypeFromPath, rebuildWikiIndex, WikiIngestError} from './wiki-ingest.ts'
import {lintWikiSnapshot, splitFrontmatter} from './wiki-lint.ts'

// ---------------------------------------------------------------------------
// Unit 1: pure repair core
// ---------------------------------------------------------------------------

const KNOWLEDGE_PREFIX = 'knowledge/'
const INDEX_PATH = 'knowledge/index.md'
const INDEX_KINDS = new Set<WikiLintFinding['kind']>(['index-drift', 'orphan-page'])
const FRONTMATTER_KINDS = new Set<WikiLintFinding['kind']>(['missing-frontmatter', 'invalid-frontmatter'])
const JUDGMENT_KINDS = new Set<WikiLintFinding['kind']>([
  'broken-wikilink',
  'stale-claim',
  'missing-cross-reference',
  'knowledge-gap',
])

export interface PlanWikiRepairsParams {
  readonly baselineFindings: readonly WikiLintFinding[]
  readonly wikiFiles: Record<string, string>
}

export interface WikiRepairPlanCounts {
  readonly repairableSeen: number
  readonly repaired: number
  readonly outOfScope: number
  readonly pathRefused: number
}

export interface WikiRepairPlanResult {
  readonly repairedFiles: Record<string, string>
  readonly targetedFindings: readonly WikiLintFinding[]
  readonly counts: WikiRepairPlanCounts
  readonly noop: boolean
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Extract the page's canonical title from its first body line.
 *
 * Strict rule: the FIRST line of the (already-trimmed) body must match `^# `.
 * Anything else — no heading, a different heading level, leading prose —
 * yields no title. Verbatim text after `# ` is copied unmodified.
 */
function extractCanonicalTitle(body: string): string | undefined {
  const firstLine = body.split('\n', 1)[0] ?? ''
  return firstLine.startsWith('# ') ? firstLine.slice(2) : undefined
}

/**
 * Apply the two-field mechanical frontmatter allowlist to a single page's content.
 *
 * Returns `undefined` when the page has unparseable frontmatter or when neither
 * allowlisted field is repairable (nothing changed). `created`, `updated`,
 * `sources`, `tags`, `aliases`, and `related` are never touched.
 */
function repairPageFrontmatter(path: string, content: string): string | undefined {
  const {frontmatter, body, error} = splitFrontmatter(content)
  if (error !== undefined) {
    return undefined
  }

  const next: Record<string, unknown> = {...frontmatter}
  let changed = false

  if (!hasNonEmptyString(next.type)) {
    next.type = pageTypeFromPath(path)
    changed = true
  }

  if (!hasNonEmptyString(next.title)) {
    const title = extractCanonicalTitle(body)
    if (title !== undefined) {
      next.title = title
      changed = true
    }
  }

  if (!changed) {
    return undefined
  }

  const yamlText = YAML.stringify(next).trimEnd()
  return `---\n${yamlText}\n---\n\n${body}\n`
}

/**
 * Partition baseline lint findings into repairable actions and compute the
 * repaired file map. Index regeneration (index-drift, orphan-page) is one
 * operation; frontmatter repair is per-page and shrink-only. Pages whose
 * finding cannot fully clear within the allowlist are reverted and counted
 * out-of-scope rather than aborting the whole run.
 */
export function planWikiRepairs(params: PlanWikiRepairsParams): WikiRepairPlanResult {
  const {baselineFindings, wikiFiles} = params

  let repaired = 0
  let outOfScope = 0
  let pathRefused = 0

  const repairedFiles: Record<string, string> = {...wikiFiles}
  const targetedFindings: WikiLintFinding[] = []

  const hasIndexRepair = baselineFindings.some(f => INDEX_KINDS.has(f.kind))
  if (hasIndexRepair) {
    // rebuildWikiIndex parses every wiki page's frontmatter strictly and throws on
    // pages that are missing required fields — a page with an unrelated frontmatter
    // defect must not crash index regeneration for the rest of the tree.
    let newIndex: string | undefined
    try {
      newIndex = rebuildWikiIndex({existingIndex: wikiFiles[INDEX_PATH], wikiFiles})
    } catch {
      newIndex = undefined
    }

    if (newIndex !== undefined && newIndex !== wikiFiles[INDEX_PATH]) {
      repairedFiles[INDEX_PATH] = newIndex
      for (const finding of baselineFindings) {
        if (INDEX_KINDS.has(finding.kind)) {
          targetedFindings.push(finding)
        }
      }
    } else {
      // Regeneration either threw or produced byte-identical output — the
      // index-drift/orphan-page findings cannot be cleared by this repair.
      // Count them out-of-scope rather than letting them vanish from the ledger.
      for (const finding of baselineFindings) {
        if (INDEX_KINDS.has(finding.kind)) {
          outOfScope += 1
        }
      }
    }
  }

  const frontmatterFindingsByPath = new Map<string, WikiLintFinding>()
  for (const finding of baselineFindings) {
    if (FRONTMATTER_KINDS.has(finding.kind) && !frontmatterFindingsByPath.has(finding.path)) {
      frontmatterFindingsByPath.set(finding.path, finding)
    }
  }

  const attemptedPaths: string[] = []

  for (const [path, finding] of frontmatterFindingsByPath) {
    if (!path.startsWith(KNOWLEDGE_PREFIX)) {
      pathRefused += 1
      continue
    }

    if (finding.kind === 'invalid-frontmatter') {
      outOfScope += 1
      continue
    }

    const content = wikiFiles[path]
    if (content === undefined) {
      outOfScope += 1
      continue
    }

    const candidate = repairPageFrontmatter(path, content)
    if (candidate === undefined) {
      outOfScope += 1
      continue
    }

    repairedFiles[path] = candidate
    attemptedPaths.push(path)
  }

  if (attemptedPaths.length > 0) {
    const relint = lintWikiSnapshot({files: repairedFiles})
    const stillFailing = new Set(
      relint.deterministicFindings
        .filter(f => f.kind === 'missing-frontmatter' || f.kind === 'invalid-frontmatter')
        .map(f => f.path),
    )

    for (const path of attemptedPaths) {
      if (stillFailing.has(path)) {
        const original = wikiFiles[path]
        if (original !== undefined) {
          repairedFiles[path] = original
        }
        outOfScope += 1
      } else {
        repaired += 1
        const finding = frontmatterFindingsByPath.get(path)
        if (finding !== undefined) {
          targetedFindings.push(finding)
        }
      }
    }
  }

  outOfScope += baselineFindings.filter(f => JUDGMENT_KINDS.has(f.kind)).length

  const repairableSeen = baselineFindings.filter(f => INDEX_KINDS.has(f.kind) || FRONTMATTER_KINDS.has(f.kind)).length

  const noop = Object.entries(repairedFiles).every(([path, content]) => wikiFiles[path] === content)

  return {
    repairedFiles,
    targetedFindings,
    counts: {repairableSeen, repaired, outOfScope, pathRefused},
    noop,
  }
}

export interface VerifyWikiRepairsParams {
  readonly baselineFindings: readonly WikiLintFinding[]
  readonly targetedFindings: readonly WikiLintFinding[]
  readonly repairedFiles: Record<string, string>
}

export interface VerifyWikiRepairsResult {
  readonly ok: boolean
  readonly survivingFindings: readonly WikiLintFinding[]
  readonly newFindings: readonly WikiLintFinding[]
}

function findingIdentity(finding: WikiLintFinding): string {
  return `${finding.kind}\u0000${finding.path}\u0000${finding.target ?? ''}`
}

/**
 * Re-lint the repaired file map and require every targeted finding to clear,
 * with a no-worse rule: any deterministic finding absent from the baseline
 * that appears in the repaired tree is a regression and aborts the run.
 */
export function verifyWikiRepairs(params: VerifyWikiRepairsParams): VerifyWikiRepairsResult {
  const relint = lintWikiSnapshot({files: params.repairedFiles})
  const baselineIds = new Set(params.baselineFindings.map(findingIdentity))
  const newIds = new Set(relint.deterministicFindings.map(findingIdentity))

  const survivingFindings = params.targetedFindings.filter(f => newIds.has(findingIdentity(f)))
  const newFindings = relint.deterministicFindings.filter(f => !baselineIds.has(findingIdentity(f)))

  return {
    ok: survivingFindings.length === 0 && newFindings.length === 0,
    survivingFindings,
    newFindings,
  }
}

export interface GateWikiRepairsParams {
  readonly repairedWikiFiles: Record<string, string>
  readonly publicSlugMap: ReadonlyMap<string, readonly RepoEntry[]>
  readonly grandfatherPages: readonly WikiPageSnapshot[]
}

export interface GateWikiRepairsResult {
  readonly ok: boolean
  readonly leaks: readonly PrivateWikiLeak[]
}

const REPO_PAGE_PREFIX = 'knowledge/wiki/repos/'

/**
 * Pre-commit private-presence gate: reruns the promotion pipeline's leak
 * detector over the repaired repo wiki pages using current-tip authority
 * metadata. Any leak aborts the run.
 */
export function gateWikiRepairs(params: GateWikiRepairsParams): GateWikiRepairsResult {
  const dataWikiPages: WikiPageSnapshot[] = Object.entries(params.repairedWikiFiles)
    .filter(([path]) => path.startsWith(REPO_PAGE_PREFIX) && path.endsWith('.md'))
    .map(([path, content]) => {
      const filename = path.slice(REPO_PAGE_PREFIX.length)
      return {
        filename,
        stem: filename.replace(/\.md$/iu, '').toLowerCase(),
        hash: createHash('sha256').update(content).digest('hex'),
        content,
      }
    })

  const leaks = detectPrivateWikiLeaks({
    dataWikiPages,
    publicSlugMap: params.publicSlugMap,
    grandfatherPages: params.grandfatherPages,
  })

  return {ok: leaks.length === 0, leaks}
}

export type WikiRepairAbortReason = 'verification-survivor' | 'verification-regression' | 'privacy-leak'

export interface PlanAndVerifyWikiRepairsParams {
  readonly baselineFindings: readonly WikiLintFinding[]
  readonly wikiFiles: Record<string, string>
  readonly publicSlugMap: ReadonlyMap<string, readonly RepoEntry[]>
  readonly grandfatherPages: readonly WikiPageSnapshot[]
}

export interface WikiRepairPipelineResult {
  readonly status: 'noop' | 'repaired' | 'aborted'
  readonly abortReason?: WikiRepairAbortReason
  readonly repairedFiles: Record<string, string>
  readonly counts: WikiRepairPlanCounts
}

/**
 * Compose plan → verify → gate into a single pure pipeline result. The shell
 * calls this once per attempt (including conflict-recompute retries).
 */
export function planAndVerifyWikiRepairs(params: PlanAndVerifyWikiRepairsParams): WikiRepairPipelineResult {
  const plan = planWikiRepairs({baselineFindings: params.baselineFindings, wikiFiles: params.wikiFiles})

  if (plan.noop) {
    return {status: 'noop', repairedFiles: params.wikiFiles, counts: plan.counts}
  }

  const verify = verifyWikiRepairs({
    baselineFindings: params.baselineFindings,
    targetedFindings: plan.targetedFindings,
    repairedFiles: plan.repairedFiles,
  })

  if (!verify.ok) {
    const abortReason: WikiRepairAbortReason =
      verify.survivingFindings.length > 0 ? 'verification-survivor' : 'verification-regression'
    return {status: 'aborted', abortReason, repairedFiles: params.wikiFiles, counts: plan.counts}
  }

  const gate = gateWikiRepairs({
    repairedWikiFiles: plan.repairedFiles,
    publicSlugMap: params.publicSlugMap,
    grandfatherPages: params.grandfatherPages,
  })

  if (!gate.ok) {
    return {status: 'aborted', abortReason: 'privacy-leak', repairedFiles: params.wikiFiles, counts: plan.counts}
  }

  return {status: 'repaired', repairedFiles: plan.repairedFiles, counts: plan.counts}
}

// ---------------------------------------------------------------------------
// Unit 2: repair shell — snapshot load, conflict retry, atomic commit
// ---------------------------------------------------------------------------

export const WIKI_REPAIR_DATA_BRANCH = 'data'
export const WIKI_REPAIR_COMMIT_MESSAGE = 'chore(knowledge): repair wiki integrity findings'
const DEFAULT_MAX_RETRIES = 3

export interface WikiRepairTreeSnapshot {
  readonly tipSha: string
  readonly wikiFiles: Record<string, string>
  readonly publicSlugMap: ReadonlyMap<string, readonly RepoEntry[]>
  readonly grandfatherPages: readonly WikiPageSnapshot[]
}

export interface RunWikiRepairParams {
  readonly loadTree: () => Promise<WikiRepairTreeSnapshot>
  readonly getCurrentDataTipSha: () => Promise<string>
  readonly commitWikiChanges: (commitParams: CommitWikiChangesParams) => Promise<CommitWikiChangesResult>
  readonly maxRetries?: number
  readonly dryRun?: boolean
}

export interface WikiRepairResultCounts {
  readonly repairable_seen: number
  readonly repaired: number
  readonly aborted: number
  readonly out_of_scope: number
  readonly privacy_blocked: number
  readonly path_refused: number
  readonly conflict_retries: number
  readonly noop: number
  readonly dry_run: boolean
}

function emptyResultCounts(dryRun: boolean): WikiRepairResultCounts {
  return {
    repairable_seen: 0,
    repaired: 0,
    aborted: 0,
    out_of_scope: 0,
    privacy_blocked: 0,
    path_refused: 0,
    conflict_retries: 0,
    noop: 0,
    dry_run: dryRun,
  }
}

function diffChangedFiles(before: Record<string, string>, after: Record<string, string>): Record<string, string> {
  const changed: Record<string, string> = {}
  for (const [path, content] of Object.entries(after)) {
    if (before[path] !== content) {
      changed[path] = content
    }
  }
  return changed
}

/**
 * Load the working tree, run the repair pipeline against the current-tip
 * baseline, and commit exactly once to `data` — or recompute on conflict.
 *
 * Environment variables (see `main()` below): `WIKI_REPAIR_RESULT_PATH`,
 * `WIKI_REPAIR_DRY_RUN`, `WIKI_REPAIR_DATA_TIP_SHA`, `GRANDFATHER_WIKI_REPOS_DIR`,
 * `GITHUB_TOKEN`.
 */
export async function runWikiRepair(params: RunWikiRepairParams): Promise<WikiRepairResultCounts> {
  const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES
  const dryRun = params.dryRun ?? false

  let tree = await params.loadTree()
  let conflictRetries = 0

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const baseline = lintWikiSnapshot({files: tree.wikiFiles}).deterministicFindings

    if (baseline.length === 0) {
      return {...emptyResultCounts(dryRun), noop: 1, conflict_retries: conflictRetries}
    }

    const pipeline = planAndVerifyWikiRepairs({
      baselineFindings: baseline,
      wikiFiles: tree.wikiFiles,
      publicSlugMap: tree.publicSlugMap,
      grandfatherPages: tree.grandfatherPages,
    })

    if (pipeline.status === 'noop') {
      return {
        repairable_seen: pipeline.counts.repairableSeen,
        repaired: 0,
        aborted: 0,
        out_of_scope: pipeline.counts.outOfScope,
        privacy_blocked: 0,
        path_refused: pipeline.counts.pathRefused,
        conflict_retries: conflictRetries,
        noop: 1,
        dry_run: dryRun,
      }
    }

    if (pipeline.status === 'aborted') {
      return {
        repairable_seen: pipeline.counts.repairableSeen,
        repaired: 0,
        aborted: 1,
        out_of_scope: pipeline.counts.outOfScope,
        privacy_blocked: pipeline.abortReason === 'privacy-leak' ? 1 : 0,
        path_refused: pipeline.counts.pathRefused,
        conflict_retries: conflictRetries,
        noop: 0,
        dry_run: dryRun,
      }
    }

    const changedFiles = diffChangedFiles(tree.wikiFiles, pipeline.repairedFiles)

    if (dryRun) {
      return {
        repairable_seen: pipeline.counts.repairableSeen,
        repaired: pipeline.counts.repaired,
        aborted: 0,
        out_of_scope: pipeline.counts.outOfScope,
        privacy_blocked: 0,
        path_refused: pipeline.counts.pathRefused,
        conflict_retries: conflictRetries,
        noop: 0,
        dry_run: true,
      }
    }

    const currentTip = await params.getCurrentDataTipSha()
    if (currentTip !== tree.tipSha) {
      conflictRetries += 1
      tree = await params.loadTree()
      continue
    }

    try {
      await params.commitWikiChanges({
        branch: WIKI_REPAIR_DATA_BRANCH,
        message: WIKI_REPAIR_COMMIT_MESSAGE,
        files: changedFiles,
        maxRetries: 1,
      })
    } catch (error: unknown) {
      if (error instanceof WikiIngestError && error.code === 'CONFLICT_EXHAUSTED') {
        conflictRetries += 1
        tree = await params.loadTree()
        continue
      }
      throw error
    }

    return {
      repairable_seen: pipeline.counts.repairableSeen,
      repaired: pipeline.counts.repaired,
      aborted: 0,
      out_of_scope: pipeline.counts.outOfScope,
      privacy_blocked: 0,
      path_refused: pipeline.counts.pathRefused,
      conflict_retries: conflictRetries,
      noop: 0,
      dry_run: false,
    }
  }

  return {...emptyResultCounts(dryRun), aborted: 1, conflict_retries: conflictRetries}
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const WIKI_DIRECTORIES = ['repos', 'topics', 'entities', 'comparisons']

async function loadWikiFilesFromDisk(rootDir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  files[INDEX_PATH] = await readFile(join(rootDir, 'knowledge', 'index.md'), 'utf8')

  for (const directory of WIKI_DIRECTORIES) {
    const directoryPath = join(rootDir, 'knowledge', 'wiki', directory)
    let entries

    try {
      entries = await readdir(directoryPath, {withFileTypes: true})
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue
      }
      throw error
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }
      const relativePath = `knowledge/wiki/${directory}/${entry.name}`
      files[relativePath] = await readFile(join(directoryPath, entry.name), 'utf8')
    }
  }

  return files
}

type OctokitConstructor = new (params: {auth: string}) => OctokitClient

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  const loaded: unknown = await import('@octokit/rest')
  if (
    typeof loaded !== 'object' ||
    loaded === null ||
    !('Octokit' in loaded) ||
    typeof (loaded as {Octokit: unknown}).Octokit !== 'function'
  ) {
    throw new Error('wiki-repair: failed to load @octokit/rest Octokit constructor')
  }
  return (loaded as {Octokit: OctokitConstructor}).Octokit
}

async function createOctokitFromEnv(): Promise<OctokitClient> {
  const token = process.env.GITHUB_TOKEN
  if (token === undefined || token === '') {
    throw new Error('wiki-repair: GITHUB_TOKEN is required in the environment')
  }
  const Octokit = await loadOctokitConstructor()
  return new Octokit({auth: token})
}

async function main(): Promise<void> {
  const dryRun = process.env.WIKI_REPAIR_DRY_RUN === 'true'
  const resultPath = process.env.WIKI_REPAIR_RESULT_PATH
  const rootDir = process.cwd()
  const owner = process.env.WIKI_REPAIR_OWNER
  const repo = process.env.WIKI_REPAIR_REPO

  const loadTree = async (): Promise<WikiRepairTreeSnapshot> => {
    const tipSha = process.env.WIKI_REPAIR_DATA_TIP_SHA
    if (tipSha === undefined || tipSha === '') {
      throw new Error('wiki-repair: WIKI_REPAIR_DATA_TIP_SHA is required in the environment')
    }

    const wikiFiles = await loadWikiFilesFromDisk(rootDir)

    const reposRaw = await readFile(join(rootDir, 'metadata', 'repos.yaml'), 'utf8')
    const reposParsed: unknown = YAML.parse(reposRaw)
    assertReposFile(reposParsed)
    const publicSlugMap = buildPublicSlugMap(reposParsed.repos)

    const grandfatherDir = requireGrandfatherDir(process.env.GRANDFATHER_WIKI_REPOS_DIR)
    const grandfatherPages = await loadWikiPages(grandfatherDir)

    return {tipSha, wikiFiles, publicSlugMap, grandfatherPages}
  }

  let octokitPromise: Promise<OctokitClient> | undefined
  const getOctokit = async (): Promise<OctokitClient> => {
    octokitPromise ??= createOctokitFromEnv()
    return octokitPromise
  }

  const getCurrentDataTipSha = async (): Promise<string> => {
    const octokit = await getOctokit()
    const ref = await octokit.rest.git.getRef({
      owner: owner ?? 'fro-bot',
      repo: repo ?? '.github',
      ref: `heads/${WIKI_REPAIR_DATA_BRANCH}`,
    })
    return ref.data.object.sha
  }

  const commitWikiChangesInjected = async (commitParams: CommitWikiChangesParams): Promise<CommitWikiChangesResult> => {
    const octokit = await getOctokit()
    return commitWikiChanges({...commitParams, owner, repo, octokit})
  }

  const result = await runWikiRepair({
    loadTree,
    getCurrentDataTipSha,
    commitWikiChanges: commitWikiChangesInjected,
    dryRun,
  })

  const json = `${JSON.stringify(result)}\n`
  process.stdout.write(json)
  if (resultPath !== undefined && resultPath !== '') {
    await writeFile(resultPath, json, 'utf8')
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
