import { createHash } from 'node:crypto';
import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { resolveMarkdownLinks } from "./markdown-links.js";
import { collectWikilinks, collectPageTargets as collectWikiPageTargets, splitFrontmatter } from "./wiki-utils.js";
const PAGE_PATH_PATTERN = /^knowledge\/wiki\/[^/]+\/.+\.md$/u;
const REQUIRED_FRONTMATTER_FIELDS = ['type', 'title', 'created', 'updated'];
const STALE_DAYS = 90;
export function buildWikiLintJsonReport(params) {
    const { result, status, scanComplete, snapshotSha, generatedAt, failureClass } = params;
    const deterministicFindings = result.deterministicFindings.map(f => ({
        kind: f.kind,
        severity: 'deterministic',
        path: f.path,
        target: f.target ?? null,
        message: f.message,
        fingerprint: computeFingerprint(f.kind, f.path, f.target ?? null),
        ...(f.recovery === undefined ? {} : { recovery: f.recovery }),
    }));
    const advisoryFindings = result.advisoryFindings.map(f => ({
        kind: f.kind,
        severity: 'advisory',
        path: f.path,
        target: f.target ?? null,
        message: f.message,
        fingerprint: computeFingerprint(f.kind, f.path, f.target ?? null),
        ...(f.recovery === undefined ? {} : { recovery: f.recovery }),
    }));
    const allFindings = [...deterministicFindings, ...advisoryFindings];
    const freshnessNow = new Date(generatedAt);
    const freshness = result.pages.map(page => {
        const daysStale = computeDaysStale(page.updated, freshnessNow);
        return {
            path: page.path,
            updated: page.updated,
            days_stale: daysStale,
            stale_threshold_days: STALE_DAYS,
        };
    });
    const pagesStale = freshness.filter(f => f.days_stale !== null && f.days_stale >= STALE_DAYS).length;
    return {
        schema_version: 1,
        fingerprint_version: 1,
        status,
        scan_complete: scanComplete,
        snapshot_sha: snapshotSha,
        generated_at: generatedAt,
        failure_class: failureClass,
        repair_eligible: scanComplete && status === 'findings',
        findings: allFindings,
        freshness,
        counts: {
            findings_total: allFindings.length,
            findings_deterministic: deterministicFindings.length,
            findings_advisory: advisoryFindings.length,
            pages_scanned: result.pages.length,
            pages_stale: pagesStale,
        },
    };
}
function computeFingerprint(kind, path, target) {
    const input = `${kind}\u0000${path}\u0000${target ?? ''}`;
    return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
function computeDaysStale(updated, now) {
    if (updated === null || updated === '') {
        return null;
    }
    const updatedDate = new Date(`${updated}T00:00:00Z`);
    if (Number.isNaN(updatedDate.getTime())) {
        return null;
    }
    const ageMs = now.getTime() - updatedDate.getTime();
    return Math.floor(ageMs / (24 * 60 * 60 * 1000));
}
export function lintWikiSnapshot(params) {
    const now = params.now ?? new Date();
    const pages = collectPages(params.files);
    const pageTargets = collectPageTargets(pages);
    const indexedSlugs = collectIndexedSlugs(params.files['knowledge/index.md'] ?? '');
    const hasNonRepoKnowledge = pages.some(page => page.frontmatter.type === 'topic' || page.frontmatter.type === 'entity' || page.frontmatter.type === 'comparison');
    const deterministicFindings = [];
    const advisoryFindings = [];
    const markdownLinkSources = [
        { path: 'knowledge/index.md', content: params.files['knowledge/index.md'] ?? '' },
        ...pages.map(page => ({ path: page.path, content: page.content })),
    ];
    for (const source of markdownLinkSources) {
        for (const link of resolveMarkdownLinks(source.content, source.path, { files: params.files })) {
            if (!link.exists) {
                deterministicFindings.push({
                    kind: 'broken-markdown-link',
                    path: source.path,
                    target: link.target,
                    message: `Broken markdown link to ${link.target}`,
                });
            }
        }
    }
    for (const page of pages) {
        const missingFields = REQUIRED_FRONTMATTER_FIELDS.filter(field => !hasNonEmptyString(page.frontmatter[field]));
        if (page.frontmatterError !== undefined) {
            deterministicFindings.push({
                kind: 'invalid-frontmatter',
                path: page.path,
                message: page.frontmatterError,
            });
            continue;
        }
        if (missingFields.length > 0) {
            deterministicFindings.push({
                kind: 'missing-frontmatter',
                path: page.path,
                message: `Missing required frontmatter: ${missingFields.join(', ')}`,
            });
        }
        for (const target of collectWikilinks(page.body)) {
            if (!pageTargets.has(target)) {
                deterministicFindings.push({
                    kind: 'broken-wikilink',
                    path: page.path,
                    target,
                    message: `Broken wikilink to [[${target}]]`,
                });
            }
        }
        if (!indexedSlugs.has(page.slug)) {
            deterministicFindings.push({
                kind: 'orphan-page',
                path: page.path,
                message: `Page ${page.slug} exists on disk but is missing from knowledge/index.md`,
            });
        }
        if (isStale(page.frontmatter.updated, now)) {
            advisoryFindings.push({
                kind: 'stale-claim',
                path: page.path,
                message: `Page has not been updated in ${STALE_DAYS}+ days`,
            });
        }
        if (!page.body.includes('[[')) {
            advisoryFindings.push({
                kind: 'missing-cross-reference',
                path: page.path,
                message: 'Page has no wikilinks to related knowledge',
            });
            if (page.frontmatter.type === 'repo' && hasNonRepoKnowledge) {
                advisoryFindings.push({
                    kind: 'knowledge-gap',
                    path: 'knowledge/index.md',
                    message: `Repo page ${page.slug} is not connected to existing non-repo knowledge`,
                });
            }
        }
    }
    for (const indexedSlug of indexedSlugs) {
        if (pageTargets.has(indexedSlug)) {
            continue;
        }
        deterministicFindings.push({
            kind: 'index-drift',
            path: 'knowledge/index.md',
            target: indexedSlug,
            message: `Index references [[${indexedSlug}]] but no page exists on disk`,
        });
    }
    const summary = [
        '# Wiki lint summary',
        '',
        `Deterministic findings: ${deterministicFindings.length}`,
        `Advisory findings: ${advisoryFindings.length}`,
    ].join('\n');
    const reportSections = [
        '# Wiki Lint Report',
        '',
        renderSection('Deterministic findings', deterministicFindings),
        '',
        '## Advisory findings',
        '',
        '_These are non-blocking advisory signals._',
        '',
        ...renderFindingLines(advisoryFindings),
    ];
    const report = reportSections.join('\n');
    const pageInfos = pages.map(page => ({
        path: page.path,
        updated: hasNonEmptyString(page.frontmatter.updated) ? String(page.frontmatter.updated) : null,
    }));
    return {
        ok: deterministicFindings.length === 0,
        deterministicFindings,
        advisoryFindings,
        summary,
        report,
        pages: pageInfos,
    };
}
export async function writeWikiLintOutputs(params) {
    const status = params.result.deterministicFindings.length === 0 && params.result.advisoryFindings.length === 0
        ? 'clean'
        : 'findings';
    await writeFile(params.reportPath, `${params.result.report}\n`, 'utf8');
    const resolvedJsonPath = params.jsonPath ?? process.env.WIKI_LINT_JSON_PATH ?? 'wiki-lint-report.json';
    const generatedAt = params.generatedAt ?? new Date().toISOString();
    const snapshotSha = params.snapshotSha ?? null;
    const jsonReport = buildWikiLintJsonReport({
        result: params.result,
        status,
        scanComplete: true,
        snapshotSha,
        generatedAt,
        failureClass: null,
    });
    await writeFile(resolvedJsonPath, `${JSON.stringify(jsonReport, null, 2)}\n`, 'utf8');
    if (params.githubStepSummaryPath !== undefined && params.githubStepSummaryPath !== '') {
        await appendFile(params.githubStepSummaryPath, `${params.result.summary}\n`, 'utf8');
    }
    if (params.githubOutputPath !== undefined && params.githubOutputPath !== '') {
        const lines = [`status=${status}`, `report_path=${params.reportPath}`];
        await appendFile(params.githubOutputPath, `${lines.join('\n')}\n`, 'utf8');
    }
    return { status, reportPath: params.reportPath, jsonPath: resolvedJsonPath };
}
export async function writeWikiLintFailureOutputs(params) {
    const summary = ['# Wiki lint summary', '', 'Execution failure', '', params.message].join('\n');
    const report = ['# Wiki Lint Report', '', '## Execution failure', '', params.message].join('\n');
    await writeFile(params.reportPath, `${report}\n`, 'utf8');
    const resolvedJsonPath = params.jsonPath ?? process.env.WIKI_LINT_JSON_PATH ?? 'wiki-lint-report.json';
    const failureClass = params.failureClass ?? 'lint-execution';
    const emptyResult = {
        ok: false,
        deterministicFindings: [],
        advisoryFindings: [],
        summary: '',
        report: '',
        pages: [],
    };
    const jsonReport = buildWikiLintJsonReport({
        result: emptyResult,
        status: 'execution-failure',
        scanComplete: false,
        snapshotSha: null,
        generatedAt: new Date().toISOString(),
        failureClass,
    });
    await writeFile(resolvedJsonPath, `${JSON.stringify(jsonReport, null, 2)}\n`, 'utf8');
    if (params.githubStepSummaryPath !== undefined && params.githubStepSummaryPath !== '') {
        await appendFile(params.githubStepSummaryPath, `${summary}\n`, 'utf8');
    }
    if (params.githubOutputPath !== undefined && params.githubOutputPath !== '') {
        const lines = ['status=execution-failure', `report_path=${params.reportPath}`];
        await appendFile(params.githubOutputPath, `${lines.join('\n')}\n`, 'utf8');
    }
    return { status: 'execution-failure', reportPath: params.reportPath, jsonPath: resolvedJsonPath };
}
export async function runWikiLint(params) {
    const rootDir = params.rootDir ?? process.cwd();
    const files = await loadWikiFilesFromDisk(rootDir);
    const result = lintWikiSnapshot({ files, now: params.now });
    const outputs = await writeWikiLintOutputs({
        result,
        reportPath: params.reportPath,
        jsonPath: params.jsonPath,
        snapshotSha: params.snapshotSha,
        githubStepSummaryPath: params.githubStepSummaryPath,
        githubOutputPath: params.githubOutputPath,
    });
    return { ...outputs, result };
}
function renderSection(title, findings) {
    return [`## ${title}`, '', ...renderFindingLines(findings)].join('\n');
}
function renderFindingLines(findings) {
    if (findings.length === 0) {
        return ['No findings.'];
    }
    return findings.map(finding => `- \`${finding.kind}\` | ${finding.path}${finding.target === undefined ? '' : ` | target=${finding.target}`} | ${finding.message}`);
}
async function loadWikiFilesFromDisk(rootDir) {
    const files = {};
    const indexPath = join(rootDir, 'knowledge', 'index.md');
    files['knowledge/index.md'] = await readFile(indexPath, 'utf8');
    for (const directory of ['repos', 'topics', 'entities', 'comparisons']) {
        const directoryPath = join(rootDir, 'knowledge', 'wiki', directory);
        let entries;
        try {
            entries = await readdir(directoryPath, { withFileTypes: true });
        }
        catch (error) {
            if (isErrorWithCode(error, 'ENOENT')) {
                continue;
            }
            throw error;
        }
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) {
                continue;
            }
            const relativePath = `knowledge/wiki/${directory}/${entry.name}`;
            files[relativePath] = await readFile(join(directoryPath, entry.name), 'utf8');
        }
    }
    return files;
}
function collectPages(files) {
    return Object.entries(files)
        .filter(([path]) => PAGE_PATH_PATTERN.test(path))
        .map(([path, content]) => {
        const { frontmatter, body, error } = splitFrontmatter(content);
        const pathParts = path.split('/');
        // eslint-disable-next-line unicorn/prefer-at -- false-positive here; tsconfig/lsp intermittently flags .at()
        const fileName = pathParts[pathParts.length - 1];
        return {
            path,
            slug: (fileName ?? path).replace(/\.md$/u, ''),
            content,
            body,
            frontmatter,
            frontmatterError: error,
        };
    });
}
function collectIndexedSlugs(indexContent) {
    return new Set(collectWikilinks(indexContent));
}
function collectPageTargets(pages) {
    return collectWikiPageTargets(pages.map(page => ({
        slug: page.slug,
        aliases: Array.isArray(page.frontmatter.aliases)
            ? page.frontmatter.aliases.filter((alias) => typeof alias === 'string' && alias.trim() !== '')
            : [],
    })));
}
export { splitFrontmatter } from "./wiki-utils.js";
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isErrorWithCode(error, code) {
    return isRecord(error) && typeof error.code === 'string' && error.code === code;
}
function hasNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}
function isStale(updated, now) {
    if (!hasNonEmptyString(updated)) {
        return false;
    }
    const updatedDate = new Date(`${String(updated)}T00:00:00Z`);
    if (Number.isNaN(updatedDate.getTime())) {
        return false;
    }
    const ageMs = now.getTime() - updatedDate.getTime();
    return ageMs >= STALE_DAYS * 24 * 60 * 60 * 1000;
}
export async function runWikiLintCli() {
    const reportPath = process.env.WIKI_LINT_REPORT_PATH ?? 'wiki-lint-report.md';
    const jsonPath = process.env.WIKI_LINT_JSON_PATH ?? 'wiki-lint-report.json';
    const failureMessage = process.env.WIKI_LINT_FAILURE_MESSAGE;
    const snapshotSha = process.env.WIKI_LINT_SNAPSHOT_SHA ?? null;
    if (failureMessage !== undefined && failureMessage !== '') {
        await writeWikiLintFailureOutputs({
            message: failureMessage,
            reportPath,
            jsonPath,
            failureClass: 'snapshot-restore',
            githubStepSummaryPath: process.env.GITHUB_STEP_SUMMARY,
            githubOutputPath: process.env.GITHUB_OUTPUT,
        });
        process.stderr.write(`wiki-lint: ${failureMessage}\n`);
        process.exit(1);
    }
    try {
        const result = await runWikiLint({
            reportPath,
            jsonPath,
            snapshotSha,
            githubStepSummaryPath: process.env.GITHUB_STEP_SUMMARY,
            githubOutputPath: process.env.GITHUB_OUTPUT,
        });
        process.stdout.write(`${JSON.stringify(result.result)}\n`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown wiki lint execution failure';
        await writeWikiLintFailureOutputs({
            message,
            reportPath,
            jsonPath,
            failureClass: 'lint-execution',
            githubStepSummaryPath: process.env.GITHUB_STEP_SUMMARY,
            githubOutputPath: process.env.GITHUB_OUTPUT,
        });
        process.stderr.write(`wiki-lint: ${message}\n`);
        process.exit(1);
    }
}
if (import.meta.url === `file://${process.argv[1]}`) {
    await runWikiLintCli();
}
