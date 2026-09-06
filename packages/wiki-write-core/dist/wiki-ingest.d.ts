import type { Octokit } from '@octokit/rest';
import type { WikiLintFinding } from './wiki-lint.js';
import { readCorrections, type CorrectionsFile } from './corrections.js';
import { type DataBranchBootstrapParams, type DataBranchBootstrapResult } from './data-branch-bootstrap.js';
export type WikiOperation = 'survey' | 'event' | 'lint' | 'manual-edit';
export type WikiPageType = 'repo' | 'topic' | 'entity' | 'comparison';
export interface WikiSource {
    url: string;
    sha?: string;
    accessed: string;
}
export interface WikiPageInput {
    path: string;
    content: string;
}
export interface BuildWikiIngestChangesParams {
    existingFiles: Record<string, string>;
    operation: WikiOperation;
    target: string;
    summary: string;
    timestamp: Date;
    sources: WikiSource[];
    pages: WikiPageInput[];
    /** Trusted metadata identities keyed by canonical repo-page slug. */
    trackedRepoNodeIds?: ReadonlyMap<string, string>;
    /** Trusted dispatch identity; usable only for the page matching `target`. */
    targetNodeId?: string;
    /** Untrusted payload fallback; never authorizes a page migration or deletion. */
    fallbackNodeId?: string;
    /** False means metadata state is unknown; preserve existing page identity. */
    trackedMetadataAvailable?: boolean;
    /** System-owned correction state used for post-regeneration survival verification. */
    corrections?: CorrectionsFile;
}
export interface BuildWikiIngestChangesResult {
    files: Record<string, string>;
    deletedPaths: string[];
    findings: readonly WikiLintFinding[];
}
export interface WikiIngestWarning {
    code: 'duplicate-repo-identity' | 'repos-metadata-unavailable';
    node_ids?: string[];
    reason?: 'read-failed' | 'parse-failed';
    slugs?: string[];
}
export interface TrackedRepoNodeIdsResult {
    metadataAvailable: boolean;
    nodeIds: Map<string, string>;
    warnings: WikiIngestWarning[];
}
export interface CommitWikiChangesParams {
    owner?: string;
    repo?: string;
    branch?: string;
    message: string;
    files: Record<string, string>;
    deletedPaths?: readonly string[];
    octokit?: OctokitClient;
    maxRetries?: number;
    /**
     * Idempotent data-branch bootstrap. Called before data-branch writes so wiki
     * ingest recovers when GitHub deletes the `data` source ref after promotion.
     */
    bootstrapDataBranch?: (params: DataBranchBootstrapParams) => Promise<DataBranchBootstrapResult>;
}
export interface CommitWikiChangesResult {
    committed: boolean;
    commitSha: string;
    attempts: number;
}
export interface RunWikiIngestCliDependencies {
    readonly readCorrections?: typeof readCorrections;
    readonly commitWikiChanges?: typeof commitWikiChanges;
    readonly getChangedWikiPaths?: typeof getChangedWikiPaths;
}
/**
 * Narrow Octokit client type derived from the real `@octokit/rest` SDK.
 * See commit-metadata.ts for the rationale behind deriving rather than handwriting.
 */
export type OctokitClient = Octokit;
export type WikiIngestErrorCode = 'INVALID_PAYLOAD' | 'INVALID_PAGE_PATH' | 'INVALID_FRONTMATTER' | 'INVALID_WIKILINK' | 'CORRECTION_ERODED' | 'INVALID_RETRIES' | 'PROTECTED_BRANCH' | 'MISSING_TOKEN' | 'OCTOKIT_LOAD_FAILED' | 'CONFLICT_EXHAUSTED';
export declare class WikiIngestError extends Error {
    readonly code: WikiIngestErrorCode;
    readonly remediation: string;
    readonly findings: readonly WikiLintFinding[];
    constructor(params: {
        code: WikiIngestErrorCode;
        message: string;
        remediation: string;
        findings?: readonly WikiLintFinding[];
    });
}
export declare function buildWikiIngestChanges(params: BuildWikiIngestChangesParams): BuildWikiIngestChangesResult;
export declare function commitWikiChanges(params: CommitWikiChangesParams): Promise<CommitWikiChangesResult>;
export declare function validateWikilinks(files: Record<string, string>): void;
/**
 * Regenerate `knowledge/index.md` deterministically from a snapshot of wiki files.
 *
 * Used both by ingest (to update the catalog inline with new pages) and by
 * `scripts/rebuild-wiki-index.ts` (to heal `index.md` after merge conflicts on
 * the shared catalog file — see PR #3114's companion context).
 *
 * Preserves any header/footer prose found in `existingIndex` so operator notes
 * above `## Repos` and below the closing `---` survive regeneration.
 */
export declare function rebuildWikiIndex(params: {
    existingIndex?: string;
    wikiFiles: Record<string, string>;
}): string;
/**
 * Merge multiple `knowledge/log.md` contents into a single canonical log.
 *
 * Used to resolve merge conflicts on the append-only log: given log.md from
 * main and log.md from a PR, produce a combined log with every entry present
 * (deduplicated by timestamp+target) in chronological order.
 *
 * The log's documented contract is append-only. This helper keeps that contract
 * intact across concurrent writers by canonicalizing the order rather than
 * forcing operators to hand-merge conflict markers.
 */
export declare function mergeWikiLogs(logs: (string | undefined)[]): string;
export declare function pageTypeFromPath(path: string): WikiPageType;
declare function getChangedWikiPaths(): Promise<string[]>;
/**
 * Parse paths from `git status --porcelain=v1` output.
 *
 * Porcelain v1 format is `XY<space>PATH\n` where X = index status and Y = worktree
 * status. Either position may be a literal space for "unchanged". Example lines:
 * - ` M path/to/file` — modified in worktree, not staged (X = space)
 * - `M  path/to/file` — staged modification (Y = space)
 * - `A  path/to/file` — newly added (staged)
 * - `?? path/to/file` — untracked
 * - ` D path/to/file` — worktree deletion (file gone from disk)
 * - `D  path/to/file` — staged deletion
 *
 * Rename lines (`XY OLD -> NEW`) and submodules are out of scope — this script
 * only commits additive wiki markdown files, never renames.
 *
 * Deletions are filtered out. The wiki commit path's contract is additive-only,
 * and `loadWorkingTreeWikiFiles` would crash with ENOENT trying to read a deleted
 * path. Production incident (2026-04-19): the survey-repo workflow's
 * `Sync wiki from data branch` step removed files that exist on main but not on
 * data, surfacing those deletions through porcelain and crashing the ingest.
 * Any status where X or Y is `D` signals the file is absent or being removed —
 * skip it.
 *
 * Historical bug: a prior implementation used `line.trim()` before `line.slice(3)`,
 * which stripped the X-position space for unstaged changes and caused
 * `line.slice(3)` to eat the first character of the path (e.g. `knowledge/...`
 * became `nowledge/...` and the subsequent `readFile` failed with ENOENT). The
 * fix: preserve the fixed 3-char prefix and only strip trailing CR for cross-platform safety.
 */
export declare function parsePorcelainPaths(stdout: string): string[];
/**
 * Count the number of wiki entry pages in a list of paths.
 * Only paths matching `knowledge/wiki/(repos|topics|entities|comparisons)/<filename>.md`
 * are counted. Excludes knowledge/index.md, knowledge/log.md, and any paths outside
 * the four category directories.
 */
export declare function countWikiPages(paths: string[]): number;
export declare function runWikiIngestCli(dependencies?: RunWikiIngestCliDependencies): Promise<void>;
type ReadUtf8File = (path: string, encoding: 'utf8') => Promise<string>;
export declare function loadTrackedRepoNodeIds(readFileImpl?: ReadUtf8File): Promise<TrackedRepoNodeIdsResult>;
export {};
