import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { appendFile, readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { parse, stringify } from 'yaml';
import { assertBranchWritable } from "./branch-safety.js";
import { verifyCorrectionSurvival } from "./corrections-survival.js";
import { CorrectionStoreError, readCorrections } from "./corrections.js";
import { bootstrapDataBranch as defaultBootstrapDataBranch, } from "./data-branch-bootstrap.js";
import { assertReposFile } from "./schemas.js";
import { computeRepoSlug } from "./wiki-slug.js";
import { collectWikilinks } from "./wiki-utils.js";
const DEFAULT_OWNER = 'fro-bot';
const DEFAULT_REPO = '.github';
const DEFAULT_BRANCH = 'data';
const DEFAULT_MAX_RETRIES = 3;
const WIKI_ROOT = 'knowledge/wiki';
const INDEX_PATH = 'knowledge/index.md';
const LOG_PATH = 'knowledge/log.md';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const HANDOFF_BASE_REMEDIATION = 'The writer could not tie the handoff to the data commit the agent job synced. Re-run the workflow so the agent job runs again.';
const execFileAsync = promisify(execFile);
export class WikiIngestError extends Error {
    code;
    remediation;
    findings;
    constructor(params) {
        super(params.message);
        this.name = 'WikiIngestError';
        this.code = params.code;
        this.remediation = params.remediation;
        this.findings = params.findings ?? [];
    }
}
/** The two wiki files every writer shares. Writers rebuild both from their own sync; a handoff never supplies them. */
export function isSharedWikiFile(path) {
    return path === INDEX_PATH || path === LOG_PATH;
}
export function buildWikiIngestChanges(params) {
    if (params.pages.length === 0 &&
        (params.handoffDeletedPaths ?? []).length === 0 &&
        (params.agentLogEntries ?? '').trim() === '') {
        throw new WikiIngestError({
            code: 'INVALID_PAYLOAD',
            message: 'wiki ingest requires at least one page update',
            remediation: 'Populate payload.pages with one or more wiki pages before invoking wiki-ingest.',
        });
    }
    const files = {};
    const nextFiles = { ...params.existingFiles };
    let deletedPaths = [];
    const migrations = [];
    for (const inputPage of params.pages) {
        const page = prepareWikiPage(inputPage, nextFiles, params, deletedPaths, migrations);
        assertWikiPagePath(page.path);
        const normalized = normalizeText(validateWikiPage(page.path, page.content));
        nextFiles[page.path] = normalized;
        files[page.path] = normalized;
    }
    for (const path of params.handoffDeletedPaths ?? []) {
        if (nextFiles[path] === undefined && !deletedPaths.includes(path))
            deletedPaths.push(path);
    }
    rewriteInboundWikilinks(nextFiles, migrations);
    for (const [path, content] of Object.entries(nextFiles)) {
        if (params.existingFiles[path] !== content && !deletedPaths.includes(path)) {
            files[path] = content;
        }
    }
    validateWikilinks(nextFiles);
    const correctionSurvival = verifyCorrectionSurvival(nextFiles, params.corrections, params.existingFiles);
    const correctionFindings = [...correctionSurvival.deterministicFindings, ...correctionSurvival.advisoryFindings];
    if (!correctionSurvival.ok) {
        const blockedCorrectionIds = new Set(correctionSurvival.deterministicFindings
            .map(finding => finding.target)
            .filter((target) => target !== undefined));
        const blockedNodeIds = new Set((params.corrections?.corrections ?? [])
            .filter(correction => blockedCorrectionIds.has(correction.id))
            .map(correction => correction.page_node_id));
        const blockedPagePaths = new Set(correctionSurvival.deterministicFindings
            .map(finding => finding.path)
            .filter(path => path.startsWith(`${WIKI_ROOT}/`) && path.endsWith('.md')));
        const parsedNextFrontmatter = collectWikiFrontmatter(nextFiles);
        const parsedExistingFrontmatter = collectWikiFrontmatter(params.existingFiles);
        for (const [path, frontmatter] of parsedNextFrontmatter) {
            const nodeId = frontmatter.node_id;
            if (typeof nodeId === 'string' && blockedNodeIds.has(nodeId))
                blockedPagePaths.add(path);
        }
        const restoredPaths = restoreBlockedCorrectionPages(nextFiles, params.existingFiles, parsedNextFrontmatter, parsedExistingFrontmatter, blockedNodeIds, blockedPagePaths);
        for (const path of restoredPaths)
            delete files[path];
        deletedPaths = deletedPaths.filter(path => nextFiles[path] === undefined);
        const hasUnblockedPage = params.pages.some(page => !blockedPagePaths.has(page.path));
        if (!hasUnblockedPage || blockedPagePaths.size === 0) {
            throw new WikiIngestError({
                code: 'CORRECTION_ERODED',
                message: `wiki ingest refused: all regenerated pages were blocked by ${correctionSurvival.deterministicFindings.length} eroded correction(s)`,
                remediation: 'Restore each marked correction in the regenerated page or retire/supersede it explicitly before ingesting.',
                findings: correctionFindings,
            });
        }
    }
    const parsedPages = collectWikiPages(nextFiles);
    const index = buildIndexDocument(nextFiles[INDEX_PATH], parsedPages);
    const log = appendLogEntry(appendAgentLogEntries(nextFiles[LOG_PATH], params.agentLogEntries), params);
    files[INDEX_PATH] = index;
    files[LOG_PATH] = log;
    return { files, deletedPaths, findings: correctionFindings };
}
function restoreBlockedCorrectionPages(nextFiles, existingFiles, nextFrontmatter, existingFrontmatter, blockedNodeIds, blockedPagePaths) {
    const blockedPaths = new Set(blockedPagePaths);
    for (const [path, frontmatter] of [...nextFrontmatter, ...existingFrontmatter]) {
        const nodeId = frontmatter.node_id;
        if (typeof nodeId === 'string' && blockedNodeIds.has(nodeId))
            blockedPaths.add(path);
    }
    for (const path of blockedPaths) {
        if (existingFiles[path] === undefined)
            delete nextFiles[path];
        else
            nextFiles[path] = existingFiles[path];
    }
    return blockedPaths;
}
function collectWikiFrontmatter(files) {
    const frontmatter = new Map();
    for (const [path, content] of Object.entries(files)) {
        if (path.startsWith(`${WIKI_ROOT}/`) && path.endsWith('.md'))
            frontmatter.set(path, parseFrontmatter(path, content));
    }
    return frontmatter;
}
/**
 * Commits `params.files` (and removes `params.deletedPaths`) as one commit on the data branch.
 *
 * Every attempt is guarded: if any path in the write set (files and deletions) differs on the head read
 * in that attempt from the tree the files were derived from (`baseCommitSha`, or the first head read
 * when it is omitted), another writer changed it, so the write fails with `CONFLICT_EXHAUSTED` and
 * nothing is written. A ref race (`updateRef` 409, or 422 not-a-fast-forward) re-reads the head and
 * replays the same files on it, up to `maxRetries` attempts, under the same guard.
 *
 * With `handoff`, the handed-off paths are checked first on every attempt against the agent's data
 * commit (`HANDOFF_PAGE_CHANGED`), so a page conflict is never reported as a ref race.
 */
export async function commitWikiChanges(params) {
    const owner = params.owner ?? DEFAULT_OWNER;
    const repo = params.repo ?? DEFAULT_REPO;
    const branch = params.branch ?? DEFAULT_BRANCH;
    const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (maxRetries < 1) {
        throw new WikiIngestError({
            code: 'INVALID_RETRIES',
            message: `wiki ingest requires maxRetries >= 1, got ${maxRetries}`,
            remediation: 'Pass maxRetries as a positive integer (default: 3).',
        });
    }
    const octokit = params.octokit ?? (await createOctokitFromEnv());
    rejectProtectedWikiBranchName(branch);
    // Resolved outside the retry loop's try, ahead of any bootstrap or write: an unusable agent commit is
    // terminal, and the loop's 404 handler must not mistake it for a missing data branch.
    const handoffBaseTreeSha = params.handoff === undefined
        ? undefined
        : await resolveHandoffBaseTree(octokit, owner, repo, branch, params.handoff.agentCommitSha);
    const handoffPaths = (params.handoff?.paths ?? []).filter(path => !isSharedWikiFile(path));
    const shouldBootstrapDataBranch = branch === DEFAULT_BRANCH;
    const bootstrap = params.bootstrapDataBranch ?? defaultBootstrapDataBranch;
    const bootstrapDataBranch = async () => {
        await bootstrap({ octokit, owner, repo, dataBranch: branch });
    };
    if (shouldBootstrapDataBranch) {
        await bootstrapDataBranch();
    }
    // The tree the write set was derived from, once resolved (see `CommitWikiChangesParams.baseCommitSha`).
    let baseTreeSha;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        // Only an `updateRef` 422 is a ref race ("not a fast forward": the branch moved after this attempt
        // read its tip). A 422 from createBlob, createTree or createCommit is a bad request and stays terminal.
        let updatingRef = false;
        try {
            await assertWritableWikiBranch(octokit, owner, repo, branch);
            const head = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
            const commit = await octokit.rest.git.getCommit({ owner, repo, commit_sha: head.data.object.sha });
            // Resolved on the first attempt and reused: the base must not move while the write retries.
            baseTreeSha ??=
                params.baseCommitSha === undefined
                    ? commit.data.tree.sha
                    : await readCommitTreeSha(octokit, owner, repo, params.baseCommitSha);
            const location = `${owner}/${repo}@${branch}`;
            // Handed-off pages first, against the commit the agent read, so a page conflict surfaces as such
            // even when the head also moved under the shared files.
            if (handoffBaseTreeSha !== undefined && handoffPaths.length > 0 && commit.data.tree.sha !== handoffBaseTreeSha) {
                await assertWriteSetUnchanged(octokit, owner, repo, {
                    baseTreeSha: handoffBaseTreeSha,
                    headTreeSha: commit.data.tree.sha,
                    paths: handoffPaths,
                    location,
                    code: 'HANDOFF_PAGE_CHANGED',
                });
            }
            const guardBaseTreeSha = baseTreeSha;
            if (commit.data.tree.sha !== guardBaseTreeSha) {
                await assertWriteSetUnchanged(octokit, owner, repo, {
                    baseTreeSha: guardBaseTreeSha,
                    headTreeSha: commit.data.tree.sha,
                    paths: [...Object.keys(params.files), ...(params.deletedPaths ?? [])],
                    location,
                    code: 'CONFLICT_EXHAUSTED',
                });
            }
            const tree = [];
            // Read before the first write: a deletion of a path that cannot be confirmed must not be skipped.
            const presentPaths = params.deletedPaths === undefined || params.deletedPaths.length === 0
                ? new Set()
                : await getPresentPathsInTree(octokit, owner, repo, commit.data.tree.sha);
            for (const [path, content] of Object.entries(params.files)) {
                const blob = await octokit.rest.git.createBlob({ owner, repo, content, encoding: 'utf-8' });
                tree.push({ path, mode: '100644', type: 'blob', sha: blob.data.sha });
            }
            for (const path of params.deletedPaths ?? []) {
                if (params.files[path] !== undefined || !presentPaths.has(path)) {
                    continue;
                }
                tree.push({ path, mode: '100644', type: 'blob', sha: null });
            }
            const createdTree = await octokit.rest.git.createTree({
                owner,
                repo,
                base_tree: commit.data.tree.sha,
                tree,
            });
            const createdCommit = await octokit.rest.git.createCommit({
                owner,
                repo,
                message: params.message,
                tree: createdTree.data.sha,
                parents: [commit.data.sha],
            });
            updatingRef = true;
            await octokit.rest.git.updateRef({
                owner,
                repo,
                ref: `heads/${branch}`,
                sha: createdCommit.data.sha,
                force: false,
            });
            return { committed: true, commitSha: createdCommit.data.sha, attempts: attempt };
        }
        catch (error) {
            if (shouldBootstrapDataBranch && isApiErrorStatus(error, 404) && attempt < maxRetries) {
                await bootstrapDataBranch();
                continue;
            }
            const refRace = isConflictError(error) || (updatingRef && isApiErrorStatus(error, 422));
            if (refRace && attempt < maxRetries) {
                await delayConflictRetry(attempt);
                continue;
            }
            if (refRace) {
                throw new WikiIngestError({
                    code: 'CONFLICT_EXHAUSTED',
                    message: `wiki ingest exhausted ${maxRetries} attempt(s) updating ${owner}/${repo}@${branch}`,
                    remediation: 'Another writer updated the data branch concurrently. Retry the workflow or increase maxRetries.',
                });
            }
            throw error;
        }
    }
    throw new Error('wiki ingest reached an unreachable retry state');
}
function rejectProtectedWikiBranchName(branch) {
    if (branch === 'main') {
        throw new WikiIngestError({
            code: 'PROTECTED_BRANCH',
            message: 'wiki ingest refuses to write to main; use the data branch',
            remediation: 'Target the data branch. Promotions to main must go through the data-branch merge PR.',
        });
    }
}
async function assertWritableWikiBranch(octokit, owner, repo, branch) {
    await assertBranchWritable(octokit, owner, repo, branch, reason => {
        if (reason === 'main')
            rejectProtectedWikiBranchName(branch);
        throw new WikiIngestError({
            code: 'PROTECTED_BRANCH',
            message: `wiki ingest refuses to write to protected branch "${branch}"`,
            remediation: 'Target the canonical fro-bot/.github data branch or another unprotected branch. Review the ruleset and branch protection if this target should be writable.',
        });
    });
}
async function getPresentPathsInTree(octokit, owner, repo, treeSha) {
    const entries = await readTreeEntries(octokit, owner, repo, treeSha);
    if (entries === undefined)
        throw truncatedTreeRefusal('a deletion cannot be checked against a truncated tree');
    return new Set(entries.keys());
}
/** A truncated tree listing cannot be trusted either way, so the write fails closed. */
function truncatedTreeRefusal(reason) {
    return new WikiIngestError({
        code: 'CONFLICT_EXHAUSTED',
        message: `wiki ingest refused: ${reason}`,
        remediation: 'The data branch tree listing was truncated. Retry the workflow; if it persists, the tree has outgrown the recursive listing.',
    });
}
async function readCommitTreeSha(octokit, owner, repo, sha) {
    const commit = await octokit.rest.git.getCommit({ owner, repo, commit_sha: sha });
    return commit.data.tree.sha;
}
/**
 * Resolves the agent job's data commit to its tree, after checking it is a full commit SHA and an
 * ancestor of (or equal to) the branch head. Compare's `behind_by` is 0 and its merge base is the
 * commit itself exactly when that holds.
 */
async function resolveHandoffBaseTree(octokit, owner, repo, branch, agentCommitSha) {
    if (!COMMIT_SHA_PATTERN.test(agentCommitSha)) {
        throw handoffBaseInvalid('the agent job data commit is missing or is not a commit SHA');
    }
    try {
        const head = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
        const comparison = await octokit.rest.repos.compareCommitsWithBasehead({
            owner,
            repo,
            basehead: `${agentCommitSha}...${head.data.object.sha}`,
        });
        if (comparison.data.behind_by !== 0 || comparison.data.merge_base_commit.sha !== agentCommitSha) {
            throw handoffBaseInvalid(`the agent job data commit is not an ancestor of ${owner}/${repo}@${branch}`);
        }
        return await readCommitTreeSha(octokit, owner, repo, agentCommitSha);
    }
    catch (error) {
        if (error instanceof WikiIngestError)
            throw error;
        if (isApiErrorStatus(error, 404) || isApiErrorStatus(error, 422)) {
            throw handoffBaseInvalid(`the agent job data commit does not resolve on ${owner}/${repo}@${branch}`);
        }
        throw error;
    }
}
/**
 * Refuses, before any content is validated, a handoff whose pages another writer has changed since the
 * agent job synced. Validating a stale page against the current wiki can fail for an unrelated reason
 * (a link to a page the other writer deleted), which would hide the conflict. The commit repeats this
 * check on every attempt, which still catches a change that lands after this one.
 */
async function assertHandoffPagesCurrent(octokit, owner, repo, branch, handoff) {
    const baseTreeSha = await resolveHandoffBaseTree(octokit, owner, repo, branch, handoff.agentCommitSha);
    const paths = handoff.paths.filter(path => !isSharedWikiFile(path));
    if (paths.length === 0)
        return;
    const head = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const headTreeSha = await readCommitTreeSha(octokit, owner, repo, head.data.object.sha);
    if (headTreeSha === baseTreeSha)
        return;
    await assertWriteSetUnchanged(octokit, owner, repo, {
        baseTreeSha,
        headTreeSha,
        paths,
        location: `${owner}/${repo}@${branch}`,
        code: 'HANDOFF_PAGE_CHANGED',
    });
}
/**
 * Fail closed unless every path has the same tree entry (sha, mode, type; absence counts) on the new
 * head as in the tree the files were derived from. A replay onto a head where another writer touched
 * one of them would silently overwrite that writer's change. `code` names the refusal; a truncated
 * tree read always refuses with `CONFLICT_EXHAUSTED`, because it says nothing about the pages.
 */
async function assertWriteSetUnchanged(octokit, owner, repo, params) {
    const refuse = (code, reason) => {
        throw new WikiIngestError({
            code,
            message: code === 'HANDOFF_PAGE_CHANGED'
                ? `wiki ingest refused to write to ${params.location}: ${reason}`
                : `wiki ingest did not replay onto ${params.location}: ${reason}`,
            remediation: code === 'HANDOFF_PAGE_CHANGED'
                ? 'Another writer changed a page after the agent job synced. Re-run the agent job so it starts from the current data branch.'
                : 'Another writer updated the data branch concurrently. Retry the workflow so it rebuilds on the new head.',
        });
    };
    const base = await readTreeEntries(octokit, owner, repo, params.baseTreeSha);
    const head = await readTreeEntries(octokit, owner, repo, params.headTreeSha);
    if (base === undefined || head === undefined)
        return refuse('CONFLICT_EXHAUSTED', 'a tree read was truncated, so the write set cannot be verified');
    if (params.paths.some(path => !sameTreeEntry(base.get(path), head.get(path)))) {
        return refuse(params.code, params.code === 'HANDOFF_PAGE_CHANGED'
            ? 'a handed-off page changed after the agent job synced'
            : 'another writer changed a path in the write set');
    }
}
function sameTreeEntry(left, right) {
    if (left === undefined || right === undefined)
        return left === right;
    return left.mode === right.mode && left.type === right.type && left.sha === right.sha;
}
/** Path to its entry, for every non-directory entry. `undefined` when the read is truncated. */
async function readTreeEntries(octokit, owner, repo, treeSha) {
    const response = await octokit.rest.git.getTree({ owner, repo, tree_sha: treeSha, recursive: 'true' });
    if (response.data.truncated === true)
        return undefined;
    const tree = response.data.tree;
    const entries = new Map();
    if (!Array.isArray(tree))
        return entries;
    for (const entry of tree) {
        if (!isRecord(entry) || typeof entry.path !== 'string' || entry.type === 'tree')
            continue;
        entries.set(entry.path, { mode: String(entry.mode), type: String(entry.type), sha: String(entry.sha) });
    }
    return entries;
}
async function createOctokitFromEnv() {
    const token = process.env.GITHUB_TOKEN;
    if (token === undefined || token === '') {
        throw new WikiIngestError({
            code: 'MISSING_TOKEN',
            message: 'wiki-ingest requires params.octokit or GITHUB_TOKEN in the environment',
            remediation: 'Pass an authenticated Octokit via params.octokit, or export GITHUB_TOKEN before invocation.',
        });
    }
    const Octokit = await loadOctokitConstructor();
    return new Octokit({ auth: token });
}
async function loadOctokitConstructor() {
    const loaded = await import('@octokit/rest');
    if (!isRecord(loaded) || !('Octokit' in loaded) || typeof loaded.Octokit !== 'function') {
        throw new WikiIngestError({
            code: 'OCTOKIT_LOAD_FAILED',
            message: 'Failed to load @octokit/rest Octokit constructor',
            remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
        });
    }
    return loaded.Octokit;
}
function validateWikiPage(path, content) {
    const frontmatter = parseFrontmatter(path, content);
    const expectedType = pageTypeFromPath(path);
    if (frontmatter.type !== expectedType) {
        throw new WikiIngestError({
            code: 'INVALID_FRONTMATTER',
            message: `${path} declares type ${frontmatter.type} but lives under ${expectedType}`,
            remediation: 'Align the page type with its directory, or move the file to the correct wiki section.',
        });
    }
    if (!DATE_PATTERN.test(frontmatter.created) || !DATE_PATTERN.test(frontmatter.updated)) {
        throw new WikiIngestError({
            code: 'INVALID_FRONTMATTER',
            message: `${path} must use YYYY-MM-DD for created/updated`,
            remediation: 'Use ISO calendar dates for created and updated in wiki frontmatter.',
        });
    }
    const filename = basename(path);
    if (!isValidFilename(frontmatter.type, filename)) {
        throw new WikiIngestError({
            code: 'INVALID_PAGE_PATH',
            message: `${path} does not match wiki filename conventions for ${frontmatter.type}`,
            remediation: 'Use lowercase kebab-case filenames. Repo pages must be {owner}--{repo}.md and comparisons must be {a}-vs-{b}.md.',
        });
    }
    if (hasDatabaseId(content)) {
        const document = parseFrontmatterDocument(content);
        delete document.values.database_id;
        return renderFrontmatterDocument(document.values, document.body);
    }
    return content;
}
function hasDatabaseId(content) {
    return 'database_id' in parseFrontmatterDocument(content).values;
}
export function validateWikilinks(files) {
    const pages = collectWikiPages(files);
    const knownSlugs = new Set(pages.map(page => page.slug));
    for (const page of pages) {
        for (const wikilink of extractWikilinks(page.content)) {
            if (!knownSlugs.has(wikilink)) {
                throw new WikiIngestError({
                    code: 'INVALID_WIKILINK',
                    message: `${page.path} links to missing wiki page [[${wikilink}]]`,
                    remediation: 'Create the referenced page in the same ingest batch or update the wikilink to an existing page.',
                });
            }
        }
    }
}
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
export function rebuildWikiIndex(params) {
    return buildIndexDocument(params.existingIndex, collectWikiPages(params.wikiFiles));
}
const LOG_HEADER = '# Wiki Log\n\nChronological record of all wiki operations.\n\n---\n\n_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._\n';
// Finds only the fixed header marker. The rest of the line is parsed with string
// operations so malformed uncontrolled input cannot trigger regex backtracking.
const LOG_ENTRY_PATTERN = /\n## \[/gu;
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
export function mergeWikiLogs(logs) {
    const entryMap = new Map();
    for (const log of logs) {
        if (log === undefined || log === '')
            continue;
        for (const entry of parseWikiLogEntries(log)) {
            // Dedupe by the natural key (timestamp, target). When the same entry
            // appears in multiple inputs, the last one wins — but since entries are
            // normalized the content matches byte-for-byte.
            entryMap.set(`${entry.timestamp}\0${entry.target}`, entry);
        }
    }
    const entries = [...entryMap.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    return normalizeText(`${LOG_HEADER}${entries.map(entry => entry.raw).join('')}`);
}
function parseWikiLogEntries(log) {
    const entries = [];
    const matches = [...log.matchAll(LOG_ENTRY_PATTERN)];
    const validEntries = [];
    for (const match of matches) {
        if (match.index === undefined)
            continue;
        const start = match.index;
        const headerEnd = log.indexOf('\n', start + 1);
        if (headerEnd === -1)
            continue;
        const header = log.slice(start, headerEnd + 1);
        const parsed = parseWikiLogHeader(header);
        if (parsed === undefined)
            continue;
        validEntries.push({ start, timestamp: parsed.timestamp, target: parsed.target });
    }
    for (let i = 0; i < validEntries.length; i += 1) {
        const entry = validEntries[i];
        if (entry === undefined)
            continue;
        const nextEntry = validEntries[i + 1];
        const end = nextEntry?.start ?? log.length;
        entries.push({
            timestamp: entry.timestamp,
            target: entry.target,
            raw: log.slice(entry.start, end),
        });
    }
    return entries;
}
function parseWikiLogHeader(header) {
    const prefix = '\n## [';
    const timestampEnd = header.indexOf('] ');
    if (!header.startsWith(prefix) || timestampEnd <= prefix.length)
        return undefined;
    const timestamp = header.slice(prefix.length, timestampEnd);
    if (timestamp.includes(']'))
        return undefined;
    const operationAndTarget = header.slice(timestampEnd + 2, -1);
    const separator = operationAndTarget.indexOf(' | ');
    if (separator <= 0)
        return undefined;
    const operation = operationAndTarget.slice(0, separator);
    if (!['ingest', 'query', 'lint', 'manual-edit'].includes(operation))
        return undefined;
    const rawTarget = operationAndTarget.slice(separator + 3);
    return rawTarget === '' ? undefined : { timestamp: timestamp.trim(), target: rawTarget.trim() };
}
function buildIndexDocument(existingIndex, pages) {
    const header = existingIndex === undefined || existingIndex === ''
        ? '# Wiki Index\n\nMaster catalog of all wiki pages, organized by type.\n\n'
        : extractIndexHeader(existingIndex);
    const footer = existingIndex === undefined || existingIndex === ''
        ? '\n---\n\n_This index is maintained automatically by wiki ingest operations. Manual edits are preserved across updates._\n'
        : extractIndexFooter(existingIndex);
    // Preserve operator-curated or previously-generated entry descriptions when a
    // slug still has a wiki page. Rebuilds only add new entries and drop stale
    // ones — they never degrade richer descriptions back to bare frontmatter
    // titles.
    const existingLines = existingIndex === undefined ? new Map() : parseIndexEntryLines(existingIndex);
    const sections = [
        {
            heading: 'Repos',
            type: 'repo',
            empty: '_No repo pages yet. Pages will appear here as repositories are surveyed._',
        },
        {
            heading: 'Topics',
            type: 'topic',
            empty: '_No topic pages yet. Pages will appear here as cross-cutting themes emerge._',
        },
        {
            heading: 'Entities',
            type: 'entity',
            empty: '_No entity pages yet. Pages will appear here as tools and services are documented._',
        },
        {
            heading: 'Comparisons',
            type: 'comparison',
            empty: '_No comparison pages yet. Pages will appear here as alternatives are analyzed._',
        },
    ];
    const body = sections
        .map(section => {
        const entries = pages
            .filter(page => page.type === section.type)
            .sort((left, right) => left.title.localeCompare(right.title))
            .map(page => existingLines.get(page.slug) ?? `- [[${page.slug}]] — ${page.title}`);
        return [`## ${section.heading}`, '', ...(entries.length > 0 ? entries : [section.empty]), ''].join('\n');
    })
        .join('\n');
    return normalizeText(`${header}${body}${footer}`);
}
/**
 * Extract previously-rendered entry lines from an index document keyed by slug.
 * Used to preserve operator-curated or agent-generated rich descriptions across
 * rebuilds — only new slugs get fresh `slug — title` lines.
 */
function parseIndexEntryLines(index) {
    const entries = new Map();
    // Match the full line: "- [[slug]] — description"
    // Description may contain anything except a newline (we keep the entire trailing text).
    const pattern = /^- \[\[([^\]|]+)\]\]\s*—\s*(?:\S.*|[\t\v\f \u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF])$/gmu;
    for (const match of index.matchAll(pattern)) {
        const [line, slug] = match;
        if (line === undefined || slug === undefined)
            continue;
        entries.set(slug.trim(), line);
    }
    return entries;
}
/** Appends raw log entries (already in log format) to `existingLog`, keeping its text byte-for-byte. */
function appendAgentLogEntries(existingLog, entries) {
    if (entries === undefined || entries.trim() === '')
        return existingLog;
    const base = existingLog === undefined || existingLog === '' ? LOG_HEADER : normalizeText(existingLog);
    return normalizeText(`${base}${entries.startsWith('\n') ? entries : `\n${entries}`}`);
}
/**
 * Append one entry to `knowledge/log.md`, keeping the existing text byte-for-byte. The log is
 * append-only; callers must never rewrite history. Exported for the operator rename path.
 */
export function appendLogEntry(existingLog, params) {
    const base = existingLog === undefined || existingLog === ''
        ? '# Wiki Log\n\nChronological record of all wiki operations.\n\n---\n\n_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._\n'
        : normalizeText(existingLog);
    const stamp = formatTimestamp(params.timestamp);
    const sources = params.sources.length === 0
        ? 'Sources: none'
        : `Sources: ${params.sources
            .map(source => `${source.url}${source.sha === undefined ? '' : `@${source.sha}`}`)
            .join(', ')}`;
    const logOperation = params.operation === 'manual-edit' ? 'manual-edit' : 'ingest';
    return normalizeText(`${base}\n## [${stamp}] ${logOperation} | ${params.target}\n\n${params.summary}\n\n${sources}\n`);
}
function parseFrontmatter(path, content) {
    const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content);
    if (match === null) {
        throw new WikiIngestError({
            code: 'INVALID_FRONTMATTER',
            message: `${path} is missing YAML frontmatter`,
            remediation: 'Add frontmatter with type, title, created, and updated fields before ingesting the page.',
        });
    }
    const frontmatterText = match[1];
    if (frontmatterText === undefined) {
        throw new WikiIngestError({
            code: 'INVALID_FRONTMATTER',
            message: `${path} frontmatter could not be extracted`,
            remediation: 'Ensure the page begins with a valid YAML frontmatter block.',
        });
    }
    const parsed = parse(frontmatterText);
    if (!isRecord(parsed)) {
        throw new WikiIngestError({
            code: 'INVALID_FRONTMATTER',
            message: `${path} frontmatter must parse to an object`,
            remediation: 'Ensure the frontmatter is valid YAML mapping syntax.',
        });
    }
    if (!isWikiPageType(parsed.type) ||
        typeof parsed.title !== 'string' ||
        typeof parsed.created !== 'string' ||
        typeof parsed.updated !== 'string') {
        throw new WikiIngestError({
            code: 'INVALID_FRONTMATTER',
            message: `${path} frontmatter must include type, title, created, and updated`,
            remediation: 'Supply required fields in the page frontmatter and keep optional arrays as strings only.',
        });
    }
    return {
        type: parsed.type,
        title: parsed.title,
        created: parsed.created,
        updated: parsed.updated,
        node_id: typeof parsed.node_id === 'string' ? parsed.node_id : undefined,
        sources: Array.isArray(parsed.sources) ? parsed.sources.filter(isWikiSource) : undefined,
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter(tag => typeof tag === 'string') : undefined,
        aliases: Array.isArray(parsed.aliases) ? parsed.aliases.filter(alias => typeof alias === 'string') : undefined,
        related: Array.isArray(parsed.related) ? parsed.related.filter(related => typeof related === 'string') : undefined,
    };
}
function prepareWikiPage(page, existingFiles, params, deletedPaths, migrations) {
    if (!isRepoPagePath(page.path))
        return page;
    const incomingFrontmatter = parseFrontmatter(page.path, page.content);
    const pageSlug = basename(page.path, '.md');
    const targetSlug = repoTargetSlug(params.target);
    const trackedNodeId = params.trackedRepoNodeIds?.get(pageSlug);
    const isTargetPage = targetSlug === pageSlug;
    const identity = resolvePageIdentity({
        trackedNodeId,
        targetNodeId: isTargetPage ? params.targetNodeId : undefined,
        fallbackNodeId: isTargetPage ? params.fallbackNodeId : undefined,
        frontmatterNodeId: incomingFrontmatter.node_id,
    });
    if (identity === undefined || !identity.trusted) {
        const preserveNodeId = params.trackedMetadataAvailable === false
            ? (getExistingRepoNodeId(existingFiles[page.path], page.path) ?? incomingFrontmatter.node_id)
            : undefined;
        return {
            path: page.path,
            content: updateRepoPageFrontmatter(page.content, preserveNodeId),
        };
    }
    const nodeMatch = identity.trusted ? findRepoPageByNodeId(existingFiles, identity.nodeId) : undefined;
    const historicalPages = [];
    if (nodeMatch !== undefined && nodeMatch.path !== page.path) {
        historicalPages.push(nodeMatch.content);
        delete existingFiles[nodeMatch.path];
        if (!deletedPaths.includes(nodeMatch.path))
            deletedPaths.push(nodeMatch.path);
        const slugMatch = existingFiles[page.path];
        if (slugMatch !== undefined)
            historicalPages.push(slugMatch);
        migrations.push({ oldSlug: nodeMatch.slug, newSlug: pageSlug });
        return {
            path: page.path,
            content: mergeRepoPageContent(page.content, historicalPages, {
                nodeId: identity.nodeId,
                title: repoTargetTitle(params.target) ?? incomingFrontmatter.title,
                aliases: [nodeMatch.slug],
            }),
        };
    }
    return {
        path: page.path,
        content: updateRepoPageFrontmatter(page.content, identity.nodeId),
    };
}
function resolvePageIdentity(params) {
    if (params.trackedNodeId !== undefined)
        return { nodeId: params.trackedNodeId, trusted: true };
    if (params.targetNodeId !== undefined)
        return { nodeId: params.targetNodeId, trusted: true };
    if (params.fallbackNodeId !== undefined)
        return { nodeId: params.fallbackNodeId, trusted: false };
    if (params.frontmatterNodeId !== undefined)
        return { nodeId: params.frontmatterNodeId, trusted: false };
    return undefined;
}
function findRepoPageByNodeId(files, nodeId) {
    const candidates = Object.entries(files)
        .filter(([path]) => isRepoPagePath(path))
        .sort(([left], [right]) => left.localeCompare(right));
    for (const [path, content] of candidates) {
        const frontmatter = parseFrontmatter(path, content);
        if (frontmatter.node_id === nodeId) {
            return { path, slug: basename(path, '.md'), content };
        }
    }
    return undefined;
}
function mergeRepoPageContent(incomingContent, historicalContents, changes) {
    const incoming = parseFrontmatterDocument(incomingContent);
    const historical = historicalContents.map(content => parseFrontmatterDocument(content));
    const values = { ...incoming.values };
    const records = [incoming.values, ...historical.map(page => page.values)];
    for (const key of ['aliases', 'tags', 'related', 'sources']) {
        const merged = mergeFrontmatterArray(records, key);
        if (merged.length > 0)
            values[key] = merged;
    }
    const aliases = mergeFrontmatterArray(records, 'aliases').filter((value) => typeof value === 'string');
    for (const alias of changes.aliases ?? []) {
        if (!aliases.includes(alias))
            aliases.push(alias);
    }
    if (aliases.length > 0)
        values.aliases = aliases;
    if (changes.title !== undefined)
        values.title = changes.title;
    values.node_id = changes.nodeId;
    delete values.database_id;
    const createdDates = records
        .map(record => record.created)
        .filter((value) => typeof value === 'string' && DATE_PATTERN.test(value))
        .sort();
    if (createdDates[0] !== undefined)
        values.created = createdDates[0];
    let body = incoming.body.trim();
    for (const page of historical) {
        const historicalBody = page.body.trim();
        if (historicalBody !== '' && !body.includes(historicalBody)) {
            body = body === '' ? historicalBody : `${body}\n\n${historicalBody}`;
        }
    }
    return renderFrontmatterDocument(values, body);
}
function updateRepoPageFrontmatter(content, nodeId) {
    const document = parseFrontmatterDocument(content);
    if (nodeId === undefined)
        delete document.values.node_id;
    else
        document.values.node_id = nodeId;
    delete document.values.database_id;
    return renderFrontmatterDocument(document.values, document.body);
}
function getExistingRepoNodeId(content, path) {
    if (content === undefined)
        return undefined;
    return parseFrontmatter(path, content).node_id;
}
function renderFrontmatterDocument(values, body) {
    return normalizeText(`---\n${stringify(values).trimEnd()}\n---\n\n${body.trim()}\n`);
}
function rewriteInboundWikilinks(files, migrations) {
    for (const migration of migrations) {
        // eslint-disable-next-line unicorn/prefer-string-raw
        const escapedOldSlug = migration.oldSlug.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        // eslint-disable-next-line unicorn/prefer-string-raw
        const pattern = new RegExp(`\\[\\[${escapedOldSlug}(?=\\||\\]\\])`, 'gu');
        for (const [path, content] of Object.entries(files)) {
            files[path] = content.replace(pattern, `[[${migration.newSlug}`);
        }
    }
}
function mergeFrontmatterArray(records, key) {
    const values = [];
    const seen = new Set();
    for (const record of records) {
        const candidate = record[key];
        if (!Array.isArray(candidate))
            continue;
        for (const value of candidate) {
            const fingerprint = JSON.stringify(value);
            if (seen.has(fingerprint))
                continue;
            seen.add(fingerprint);
            values.push(value);
        }
    }
    return values;
}
function parseFrontmatterDocument(content) {
    const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content);
    if (match === null || match[1] === undefined) {
        throw new Error('validated wiki page is missing frontmatter');
    }
    const parsed = parse(match[1]);
    if (!isRecord(parsed))
        throw new Error('validated wiki page frontmatter is not an object');
    return { values: parsed, body: content.slice(match[0].length) };
}
function isRepoPagePath(path) {
    return path.startsWith(`${WIKI_ROOT}/repos/`) && path.endsWith('.md');
}
function repoTargetTitle(target) {
    if (!target.startsWith('repo:'))
        return undefined;
    const nameWithOwner = target.slice('repo:'.length);
    const slash = nameWithOwner.indexOf('/');
    if (slash < 1 || slash === nameWithOwner.length - 1)
        return undefined;
    return nameWithOwner;
}
function repoTargetSlug(target) {
    const parts = repoTargetParts(target);
    return parts === undefined ? undefined : computeRepoSlug(parts.owner, parts.name);
}
function collectWikiPages(files) {
    return Object.entries(files)
        .filter(([path]) => path.startsWith(`${WIKI_ROOT}/`) && path.endsWith('.md'))
        .map(([path, content]) => {
        const frontmatter = parseFrontmatter(path, content);
        return {
            path,
            slug: basename(path, '.md'),
            type: frontmatter.type,
            title: frontmatter.title,
            content,
        };
    });
}
function extractWikilinks(content) {
    return [...new Set(collectWikilinks(content).map(link => link.trim()))];
}
function extractIndexHeader(index) {
    const marker = index.indexOf('## Repos');
    return marker === -1
        ? '# Wiki Index\n\nMaster catalog of all wiki pages, organized by type.\n\n'
        : index.slice(0, marker);
}
function extractIndexFooter(index) {
    const marker = index.lastIndexOf('\n---');
    return marker === -1
        ? '\n---\n\n_This index is maintained automatically by wiki ingest operations. Manual edits are preserved across updates._\n'
        : index.slice(marker);
}
function assertWikiPagePath(path) {
    const pattern = /^knowledge\/wiki\/(?:repos|topics|entities|comparisons)\/[a-z0-9.-]+\.md$/;
    if (!pattern.test(path)) {
        throw new WikiIngestError({
            code: 'INVALID_PAGE_PATH',
            message: `${path} is outside the allowed wiki directories`,
            remediation: 'Write wiki pages only under knowledge/wiki/repos, topics, entities, or comparisons using kebab-case filenames.',
        });
    }
}
export function pageTypeFromPath(path) {
    if (path.includes('/repos/'))
        return 'repo';
    if (path.includes('/topics/'))
        return 'topic';
    if (path.includes('/entities/'))
        return 'entity';
    return 'comparison';
}
function isValidFilename(type, filename) {
    if (!/^[a-z0-9.-]+$/.test(filename) || !filename.endsWith('.md')) {
        return false;
    }
    const stem = filename.slice(0, -3);
    if (type === 'repo') {
        const parts = stem.split('--');
        return parts.length === 2 && parts.every(part => part !== '' && !part.startsWith('-') && !part.endsWith('-'));
    }
    if (type === 'comparison') {
        const parts = stem.split('-vs-');
        return parts.length === 2 && parts.every(part => part !== '' && !part.startsWith('-') && !part.endsWith('-'));
    }
    return stem !== '' && !stem.startsWith('-') && !stem.endsWith('-');
}
function isWikiPageType(value) {
    return value === 'repo' || value === 'topic' || value === 'entity' || value === 'comparison';
}
function isConflictError(error) {
    return isRecord(error) && error.status === 409;
}
function isApiErrorStatus(error, status) {
    return isRecord(error) && error.status === status;
}
async function delayConflictRetry(attempt) {
    const delayMs = Math.min(1000 * 2 ** (attempt - 1) + Math.random() * 500, 10_000);
    await new Promise(resolve => setTimeout(resolve, delayMs));
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function normalizeText(value) {
    return value.endsWith('\n') ? value : `${value}\n`;
}
function formatTimestamp(value) {
    const year = value.getUTCFullYear();
    const month = `${value.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${value.getUTCDate()}`.padStart(2, '0');
    const hour = `${value.getUTCHours()}`.padStart(2, '0');
    const minute = `${value.getUTCMinutes()}`.padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
}
/**
 * Read the existing wiki files from the working tree, and report the data-branch commit they were
 * synced from: `WIKI_INGEST_DATA_TIP_SHA`, when the workflow exports the tip it synced `knowledge/` from.
 * Without it there is no recorded base and the commit guards from its own first read.
 */
async function loadExistingWikiFiles() {
    const files = {};
    const recordedTip = process.env.WIKI_INGEST_DATA_TIP_SHA;
    const baseCommitSha = recordedTip === undefined || recordedTip === '' ? undefined : recordedTip;
    for (const path of [INDEX_PATH, LOG_PATH]) {
        try {
            files[path] = await readFile(path, 'utf8');
        }
        catch (error) {
            if (isEnoentError(error)) {
                files[path] = '';
                continue;
            }
            throw error;
        }
    }
    for (const directory of ['repos', 'topics', 'entities', 'comparisons']) {
        const directoryPath = `${WIKI_ROOT}/${directory}`;
        let entries;
        try {
            entries = await readdir(directoryPath, { withFileTypes: true });
        }
        catch (error) {
            if (isEnoentError(error)) {
                continue;
            }
            throw error;
        }
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) {
                continue;
            }
            const path = `${directoryPath}/${entry.name}`;
            try {
                files[path] = await readFile(path, 'utf8');
            }
            catch (error) {
                if (isEnoentError(error)) {
                    continue;
                }
                throw error;
            }
        }
    }
    return { files, baseCommitSha };
}
async function loadWorkingTreeWikiFiles(paths) {
    const files = {};
    for (const path of paths) {
        files[path] = await readFile(path, 'utf8');
    }
    return files;
}
async function getChangedWikiPaths() {
    const { stdout } = await execFileAsync('git', [
        'status',
        '--porcelain',
        '--',
        INDEX_PATH,
        LOG_PATH,
        `${WIKI_ROOT}/repos`,
        `${WIKI_ROOT}/topics`,
        `${WIKI_ROOT}/entities`,
        `${WIKI_ROOT}/comparisons`,
    ]);
    return parsePorcelainPaths(stdout).filter(path => !isSharedWikiFile(path) && path.endsWith('.md'));
}
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
export function parsePorcelainPaths(stdout) {
    return (stdout
        .split('\n')
        .map(line => line.replace(/\r$/, ''))
        .filter(line => line.length >= 4)
        // Skip any status where X or Y is 'D' (deletion). Working-tree ingestion only
        // reads surviving files; canonical page migrations carry deletions explicitly
        // through `BuildWikiIngestChangesResult.deletedPaths` into the Git Data API tree.
        .filter(line => !line.slice(0, 2).includes('D'))
        .map(line => line.slice(3))
        .filter(path => path !== ''));
}
function parsePayload(raw) {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) ||
        !isWikiOperation(parsed.operation) ||
        typeof parsed.target !== 'string' ||
        typeof parsed.summary !== 'string' ||
        !Array.isArray(parsed.sources) ||
        !Array.isArray(parsed.pages)) {
        throw new WikiIngestError({
            code: 'INVALID_PAYLOAD',
            message: 'wiki ingest payload is missing required fields',
            remediation: 'Provide operation, target, summary, sources, and pages in the JSON payload.',
        });
    }
    return {
        operation: parsed.operation,
        target: parsed.target,
        summary: parsed.summary,
        timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined,
        sources: parsed.sources.filter(isWikiSource),
        pages: parsed.pages.filter(isWikiPageInput),
        node_id: typeof parsed.node_id === 'string' ? parsed.node_id : undefined,
        message: typeof parsed.message === 'string' ? parsed.message : undefined,
        owner: typeof parsed.owner === 'string' ? parsed.owner : undefined,
        repo: typeof parsed.repo === 'string' ? parsed.repo : undefined,
        branch: typeof parsed.branch === 'string' ? parsed.branch : undefined,
    };
}
function isWikiOperation(value) {
    return value === 'survey' || value === 'event' || value === 'lint' || value === 'manual-edit';
}
function isWikiPageInput(value) {
    return isRecord(value) && typeof value.path === 'string' && typeof value.content === 'string';
}
function defaultCommitMessage(payload) {
    return `feat(knowledge): ${payload.operation} ${payload.target}`;
}
const WIKI_PAGE_PATTERN = /^knowledge\/wiki\/(?:repos|topics|entities|comparisons)\/[^/]+\.md$/;
/**
 * Count the number of wiki entry pages in a list of paths.
 * Only paths matching `knowledge/wiki/(repos|topics|entities|comparisons)/<filename>.md`
 * are counted. Excludes knowledge/index.md, knowledge/log.md, and any paths outside
 * the four category directories.
 */
export function countWikiPages(paths) {
    return paths.filter(p => WIKI_PAGE_PATTERN.test(p)).length;
}
async function emitPagesChanged(n) {
    const outputPath = process.env.GITHUB_OUTPUT;
    if (outputPath !== undefined && outputPath !== '') {
        await appendFile(outputPath, `pages_changed=${n}\n`);
    }
}
function envValue(name) {
    const value = process.env[name];
    return value === undefined || value === '' ? undefined : value;
}
function handoffBaseInvalid(message) {
    return new WikiIngestError({
        code: 'HANDOFF_BASE_INVALID',
        message: `wiki ingest refused: ${message}`,
        remediation: HANDOFF_BASE_REMEDIATION,
    });
}
/**
 * LF line endings and exactly one final newline; an empty log stays empty. Unlike `normalizeText`, which
 * only adds a missing final newline, this also converts CRLF and drops trailing blank lines.
 */
function toLfWithSingleFinalNewline(value) {
    const trimmed = value.replaceAll('\r\n', '\n').trimEnd();
    return trimmed === '' ? '' : `${trimmed}\n`;
}
/**
 * The log text an agent appended: what its `knowledge/log.md` adds after `knowledge/log.md` at the
 * commit it started from. `undefined` when the agent changed anything before that point, or the base
 * log is empty, so there is nothing safe to take. Both inputs are normalized first (LF, one final newline).
 */
export function deriveAgentLogEntries(baseLog, handoffLog) {
    const base = toLfWithSingleFinalNewline(baseLog);
    const handoff = toLfWithSingleFinalNewline(handoffLog);
    if (base === '' || !handoff.startsWith(base))
        return undefined;
    return handoff.slice(base.length);
}
async function readHandoffManifest(handoffDir) {
    const raw = await readFile(join(handoffDir, 'manifest.json'), 'utf8');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new WikiIngestError({
            code: 'INVALID_PAYLOAD',
            message: 'wiki handoff manifest.json is not valid JSON',
            remediation: 'Rebuild the handoff artifact with scripts/wiki-handoff-build.ts.',
        });
    }
    const isStringArray = (value) => Array.isArray(value) && value.every(entry => typeof entry === 'string');
    if (!isRecord(parsed) || !isStringArray(parsed.changed) || !isStringArray(parsed.deleted)) {
        throw new WikiIngestError({
            code: 'INVALID_PAYLOAD',
            message: 'wiki handoff manifest.json must hold string arrays "changed" and "deleted"',
            remediation: 'Rebuild the handoff artifact with scripts/wiki-handoff-build.ts.',
        });
    }
    return { changed: parsed.changed, deleted: parsed.deleted };
}
/** The text of `path` in the tree of `commitSha`, or `undefined` when the commit has no such file. */
async function readFileAtCommit(octokit, owner, repo, commitSha, path) {
    const entries = await readTreeEntries(octokit, owner, repo, await readCommitTreeSha(octokit, owner, repo, commitSha));
    if (entries === undefined)
        throw truncatedTreeRefusal(`${path} cannot be read from a truncated tree`);
    const entry = entries.get(path);
    if (entry === undefined || entry.type !== 'blob')
        return undefined;
    const blob = await octokit.rest.git.getBlob({ owner, repo, file_sha: entry.sha });
    return Buffer.from(blob.data.content, 'base64').toString('utf8');
}
/**
 * Reads the handoff the trusted job applied. `undefined` outside a handoff run (neither
 * `WIKI_HANDOFF_DIR` nor `WIKI_HANDOFF_BASE_SHA` set). Inside one, the agent job's data commit must be a
 * full commit SHA, the handed-off pages must be unchanged on the branch since that commit (checked here,
 * ahead of any validation of their content), and the log entries the agent appended are derived against that commit's `log.md`.
 */
async function loadHandoff(dependencies, target) {
    const handoffDir = envValue('WIKI_HANDOFF_DIR');
    const agentCommitSha = envValue('WIKI_HANDOFF_BASE_SHA');
    if (handoffDir === undefined && agentCommitSha === undefined)
        return undefined;
    if (handoffDir === undefined || agentCommitSha === undefined || !COMMIT_SHA_PATTERN.test(agentCommitSha)) {
        throw handoffBaseInvalid('the agent job data commit is missing or is not a commit SHA');
    }
    const octokit = dependencies.octokit ?? (await createOctokitFromEnv());
    const manifest = await readHandoffManifest(handoffDir);
    const pagePaths = [...manifest.changed, ...manifest.deleted];
    const deletedPagePaths = manifest.deleted.filter(path => !isSharedWikiFile(path));
    await assertHandoffPagesCurrent(octokit, target.owner ?? DEFAULT_OWNER, target.repo ?? DEFAULT_REPO, target.branch ?? DEFAULT_BRANCH, { agentCommitSha, paths: pagePaths });
    if (!manifest.changed.includes(LOG_PATH)) {
        return { octokit, agentCommitSha, agentLogEntries: undefined, pagePaths, deletedPagePaths, warnings: [] };
    }
    const handoffLog = await readFile(join(handoffDir, 'files', LOG_PATH), 'utf8');
    let baseLog;
    try {
        baseLog = await readFileAtCommit(octokit, target.owner ?? DEFAULT_OWNER, target.repo ?? DEFAULT_REPO, agentCommitSha, LOG_PATH);
    }
    catch (error) {
        // Only a commit or file that does not exist is a bad base; any other failure is not about the base.
        if (isApiErrorStatus(error, 404))
            throw handoffBaseInvalid(`the agent job data commit does not resolve`);
        throw error;
    }
    if (baseLog === undefined)
        throw handoffBaseInvalid(`${LOG_PATH} does not exist at the agent job data commit`);
    const agentLogEntries = deriveAgentLogEntries(baseLog, handoffLog);
    const warnings = agentLogEntries === undefined ? [{ code: 'agent-log-entries-dropped', reason: 'not-append-only' }] : [];
    return { octokit, agentCommitSha, agentLogEntries, pagePaths, deletedPagePaths, warnings };
}
function writeWarnings(warnings) {
    for (const warning of warnings)
        process.stderr.write(`wiki-ingest:warning:${JSON.stringify(warning)}\n`);
}
export async function runWikiIngestCli(dependencies = {}) {
    const payloadPath = process.argv[2] ?? process.env.WIKI_INGEST_INPUT;
    const readCorrectionsImpl = dependencies.readCorrections ?? readCorrections;
    const commitWikiChangesImpl = dependencies.commitWikiChanges ?? commitWikiChanges;
    const getChangedWikiPathsImpl = dependencies.getChangedWikiPaths ?? getChangedWikiPaths;
    const { files: existingFiles, baseCommitSha } = await loadExistingWikiFiles();
    let correctionRead;
    try {
        correctionRead = await readCorrectionsImpl();
    }
    catch (error) {
        if (error instanceof CorrectionStoreError) {
            process.stderr.write(`wiki-ingest:warning:${JSON.stringify({
                code: 'corrections-read-failed',
                error: error.code,
                path: error.path,
                message: error.message,
            })}\n`);
        }
        throw error;
    }
    for (const warning of correctionRead.warnings) {
        process.stderr.write(`wiki-ingest:warning:${JSON.stringify({ code: 'corrections-read-failed', message: warning })}\n`);
    }
    let built;
    let owner;
    let repo;
    let branch;
    let message;
    let identityWarnings = [];
    let committedPagePaths;
    let handoff;
    try {
        if (payloadPath !== undefined && payloadPath !== '') {
            const payload = parsePayload(await readFile(payloadPath, 'utf8'));
            handoff = await loadHandoff(dependencies, payload);
            writeWarnings(handoff?.warnings ?? []);
            const tracked = await loadTrackedRepoNodeIds();
            identityWarnings = tracked.warnings;
            built = buildWikiIngestChanges({
                existingFiles,
                operation: payload.operation,
                target: payload.target,
                summary: payload.summary,
                timestamp: payload.timestamp === undefined ? new Date() : new Date(payload.timestamp),
                sources: payload.sources,
                pages: payload.pages,
                trackedRepoNodeIds: tracked.nodeIds,
                fallbackNodeId: payload.node_id,
                trackedMetadataAvailable: tracked.metadataAvailable,
                corrections: correctionRead.corrections,
                agentLogEntries: handoff?.agentLogEntries,
                handoffDeletedPaths: handoff?.deletedPagePaths,
            });
            owner = payload.owner;
            repo = payload.repo;
            branch = payload.branch;
            message = payload.message ?? defaultCommitMessage(payload);
            committedPagePaths = payload.pages.map(p => p.path);
        }
        else {
            const changedPaths = await getChangedWikiPathsImpl();
            handoff = await loadHandoff(dependencies, {
                owner: process.env.WIKI_OWNER,
                repo: process.env.WIKI_REPO,
                branch: process.env.WIKI_BRANCH,
            });
            writeWarnings(handoff?.warnings ?? []);
            // `git status` drops deletions, so an agent's deleted pages come from the manifest. A handoff
            // whose only change is appended log entries still commits the log and the rebuilt index.
            if (changedPaths.length === 0 &&
                (handoff?.deletedPagePaths ?? []).length === 0 &&
                (handoff?.agentLogEntries ?? '').trim() === '') {
                await emitPagesChanged(0);
                process.stdout.write(`${JSON.stringify({ committed: false, attempts: 1, pagesChanged: 0 })}\n`);
                return;
            }
            const pages = await loadWorkingTreeWikiFiles(changedPaths);
            const operation = isWikiOperation(process.env.WIKI_OPERATION) ? process.env.WIKI_OPERATION : 'event';
            const target = process.env.WIKI_TARGET ?? 'repo:unknown/unknown';
            const tracked = await loadTrackedRepoNodeIds();
            identityWarnings = tracked.warnings;
            built = buildWikiIngestChanges({
                existingFiles,
                operation,
                target,
                summary: process.env.WIKI_SUMMARY ?? 'Updated wiki content from working tree changes.',
                timestamp: process.env.WIKI_TIMESTAMP === undefined ? new Date() : new Date(process.env.WIKI_TIMESTAMP),
                sources: parseSources(process.env.WIKI_SOURCES),
                pages: Object.entries(pages).map(([path, content]) => ({ path, content })),
                trackedRepoNodeIds: tracked.nodeIds,
                targetNodeId: process.env.REPO_NODE_ID,
                trackedMetadataAvailable: tracked.metadataAvailable,
                corrections: correctionRead.corrections,
                agentLogEntries: handoff?.agentLogEntries,
                handoffDeletedPaths: handoff?.deletedPagePaths,
            });
            owner = process.env.WIKI_OWNER;
            repo = process.env.WIKI_REPO;
            branch = process.env.WIKI_BRANCH;
            message =
                process.env.WIKI_COMMIT_MESSAGE ??
                    `feat(knowledge): ${process.env.WIKI_OPERATION ?? 'event'} ${process.env.WIKI_TARGET ?? 'wiki update'}`;
            committedPagePaths = changedPaths;
        }
    }
    catch (error) {
        if (error instanceof WikiIngestError) {
            for (const finding of error.findings) {
                process.stderr.write(`wiki-ingest:finding:${JSON.stringify(finding)}\n`);
            }
        }
        throw error;
    }
    writeWarnings(identityWarnings);
    for (const finding of built.findings) {
        process.stderr.write(`wiki-ingest:finding:${JSON.stringify(finding)}\n`);
    }
    const result = await commitWikiChangesImpl({
        owner,
        repo,
        branch,
        message,
        files: built.files,
        deletedPaths: built.deletedPaths,
        ...(baseCommitSha === undefined ? {} : { baseCommitSha }),
        ...(handoff === undefined
            ? {}
            : { octokit: handoff.octokit, handoff: { agentCommitSha: handoff.agentCommitSha, paths: handoff.pagePaths } }),
    });
    const pagesChanged = countWikiPages(committedPagePaths);
    await emitPagesChanged(pagesChanged);
    process.stdout.write(`${JSON.stringify({ ...result, pagesChanged })}\n`);
}
const readUtf8File = async (path, encoding) => readFile(path, encoding);
export async function loadTrackedRepoNodeIds(readFileImpl = readUtf8File) {
    let raw;
    try {
        raw = await readFileImpl('metadata/repos.yaml', 'utf8');
    }
    catch {
        return {
            metadataAvailable: false,
            nodeIds: new Map(),
            warnings: [{ code: 'repos-metadata-unavailable', reason: 'read-failed' }],
        };
    }
    let parsed;
    try {
        parsed = parse(raw);
        assertReposFile(parsed);
    }
    catch {
        return {
            metadataAvailable: false,
            nodeIds: new Map(),
            warnings: [{ code: 'repos-metadata-unavailable', reason: 'parse-failed' }],
        };
    }
    const candidates = parsed.repos.flatMap(entry => {
        if (entry.private !== false || typeof entry.node_id !== 'string')
            return [];
        return [
            {
                databaseId: entry.database_id,
                nodeId: entry.node_id,
                slug: computeRepoSlug(entry.owner, entry.name),
            },
        ];
    });
    const nodeSlugs = new Map();
    const databaseSlugs = new Map();
    for (const candidate of candidates) {
        const nodeGroup = nodeSlugs.get(candidate.nodeId) ?? new Set();
        nodeGroup.add(candidate.slug);
        nodeSlugs.set(candidate.nodeId, nodeGroup);
        if (candidate.databaseId !== undefined) {
            const databaseGroup = databaseSlugs.get(candidate.databaseId) ?? new Set();
            databaseGroup.add(candidate.slug);
            databaseSlugs.set(candidate.databaseId, databaseGroup);
        }
    }
    const collidingSlugs = new Set();
    const warningGroups = new Map();
    const registerCollision = (slugs) => {
        if (slugs.size < 2)
            return;
        const orderedSlugs = [...slugs].sort((left, right) => left.localeCompare(right));
        const key = orderedSlugs.join('\u0000');
        warningGroups.set(key, slugs);
        for (const slug of slugs)
            collidingSlugs.add(slug);
    };
    for (const slugs of nodeSlugs.values())
        registerCollision(slugs);
    for (const slugs of databaseSlugs.values())
        registerCollision(slugs);
    const warnings = [...warningGroups.values()]
        .map((slugs) => ({
        code: 'duplicate-repo-identity',
        node_ids: candidates
            .filter(candidate => slugs.has(candidate.slug))
            .map(candidate => candidate.nodeId)
            .filter((nodeId, index, values) => values.indexOf(nodeId) === index)
            .sort((left, right) => left.localeCompare(right)),
        slugs: [...slugs].sort((left, right) => left.localeCompare(right)),
    }))
        .sort((left, right) => (left.slugs?.join('\u0000') ?? left.code).localeCompare(right.slugs?.join('\u0000') ?? right.code));
    const nodeIds = new Map();
    for (const candidate of candidates) {
        if (collidingSlugs.has(candidate.slug))
            continue;
        nodeIds.set(candidate.slug, candidate.nodeId);
    }
    return { metadataAvailable: true, nodeIds, warnings };
}
function repoTargetParts(target) {
    if (!target.startsWith('repo:'))
        return undefined;
    const nameWithOwner = target.slice('repo:'.length);
    const slash = nameWithOwner.indexOf('/');
    if (slash < 1 || slash === nameWithOwner.length - 1)
        return undefined;
    return { owner: nameWithOwner.slice(0, slash), name: nameWithOwner.slice(slash + 1) };
}
function parseSources(raw) {
    if (raw === undefined || raw === '') {
        return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isWikiSource) : [];
}
function isWikiSource(value) {
    return isRecord(value) && typeof value.url === 'string' && typeof value.accessed === 'string';
}
function isEnoentError(error) {
    return isRecord(error) && error.code === 'ENOENT';
}
if (import.meta.url === `file://${process.argv[1]}`) {
    await runWikiIngestCli();
}
