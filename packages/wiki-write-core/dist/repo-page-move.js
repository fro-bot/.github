/**
 * Pure planning for the operator rename: a wiki snapshot plus a proven repository rename in,
 * the next set of file changes (or a typed block reason) out.
 *
 * Nothing here reads a network, a clock or a branch. The caller proves the rename from GitHub,
 * supplies the snapshot and the timestamp, and decides how to commit the result. A block carries a
 * fixed reason code and nothing else, so it can never echo a private identifier.
 *
 * Decisions (see docs/plans/2026-10-09-004-fix-reconcile-redirect-rename-plan.md):
 * - The page moves; it gets no alias (`validateWikilinks` ignores aliases, so an alias would not
 *   keep a link valid, and a later repo reusing the old name would make it ambiguous).
 * - A page without `node_id` is adopted only when its structured `sources` contain the exact old
 *   repository URL. The body is never consulted.
 * - `log.md` history and `knowledge/wiki/README.md` are never rewritten.
 */
import { parseFrontmatterDocument, renderFrontmatterDocument } from "./frontmatter.js";
import { appendLogEntry, rebuildWikiIndex, validateWikilinks, WikiIngestError } from "./wiki-ingest.js";
import { buildPrivateNameTokens, computeRepoSlug } from "./wiki-slug.js";
import { findWikilinkSpans } from "./wiki-utils.js";
const INDEX_PATH = 'knowledge/index.md';
const LOG_PATH = 'knowledge/log.md';
const REPOS_DIR = 'knowledge/wiki/repos';
const WIKI_PAGE_PATTERN = /^knowledge\/wiki\/(?:repos|topics|entities|comparisons)\/[^/]+\.md$/u;
const RELATED_BLOCK_KEY = /^related:\s*(?:#.*)?$/u;
const RELATED_FLOW = /^related:\s*\[(.*)\]\s*(?:#.*)?$/u;
/** Apply a change set to a file map, returning a new map. */
export function applyPageChanges(files, changes) {
    const next = { ...files };
    for (const change of changes) {
        if (change.op === 'delete-page')
            delete next[change.path];
        else
            next[change.path] = change.content;
    }
    return next;
}
export function planRepoPageMove(params) {
    const slugs = computeSlugs(params);
    if (slugs === undefined)
        return blocked('invalid-name');
    const { oldSlug, newSlug } = slugs;
    if (collidesWithAnotherRow(params.otherRows, [oldSlug, newSlug]))
        return blocked('slug-collision');
    if (matchesPrivateToken(params))
        return blocked('private-name-collision');
    const pages = parsePages(params.files);
    if (pages === undefined)
        return blocked('unparseable-page');
    const oldPath = repoPagePath(oldSlug);
    const newPath = repoPagePath(newSlug);
    const oldPage = pages.get(oldPath);
    const newPage = pages.get(newPath);
    const target = describeTarget(params);
    if (oldSlug === newSlug) {
        if (oldPage === undefined)
            return { outcome: 'metadata-only' };
        if (!attributesPageTo(oldPage.document, params.nodeId, target.oldUrl))
            return blocked('old-page-not-attributed');
        if (isUpdated(oldPage.document, params.nodeId, target)) {
            return params.rowName === params.newName ? { outcome: 'already-applied' } : blocked('page-ahead-of-row');
        }
        return buildChanges({ params, pages, oldSlug, newSlug, oldPage, target, moving: false });
    }
    if (oldPage === undefined) {
        if (newPage === undefined)
            return { outcome: 'metadata-only' };
        if (params.rowName !== params.newName)
            return blocked('page-ahead-of-row');
        return newPage.document.values.node_id === params.nodeId
            ? { outcome: 'already-applied' }
            : blocked('target-page-occupied');
    }
    if (newPage !== undefined)
        return blocked('both-pages-present');
    if (!attributesPageTo(oldPage.document, params.nodeId, target.oldUrl))
        return blocked('old-page-not-attributed');
    return buildChanges({ params, pages, oldSlug, newSlug, oldPage, target, moving: true });
}
function blocked(reason) {
    return { outcome: 'blocked', reason };
}
function describeTarget(params) {
    return {
        oldUrl: `https://github.com/${params.owner}/${params.oldName}`,
        newUrl: `https://github.com/${params.owner}/${params.newName}`,
        newTitle: `${params.owner}/${params.newName}`,
    };
}
function computeSlugs(params) {
    try {
        return {
            oldSlug: computeRepoSlug(params.owner, params.oldName),
            newSlug: computeRepoSlug(params.owner, params.newName),
        };
    }
    catch {
        return undefined;
    }
}
function slugOrUndefined(row) {
    try {
        return computeRepoSlug(row.owner, row.name);
    }
    catch {
        return undefined;
    }
}
function collidesWithAnotherRow(rows, slugs) {
    return rows.some(row => {
        const slug = slugOrUndefined(row);
        return slug !== undefined && slugs.includes(slug);
    });
}
function matchesPrivateToken(params) {
    const privateTokens = new Set([...params.privateTokens].map(token => token.toLowerCase()));
    return buildPrivateNameTokens(`${params.owner}/${params.newName}`).some(token => privateTokens.has(token.toLowerCase()));
}
function repoPagePath(slug) {
    return `${REPOS_DIR}/${slug}.md`;
}
/**
 * Whether a parsed repo page belongs to `nodeId`: a page with a `node_id` belongs to exactly that
 * node; one without belongs to whoever its structured `sources` name (`oldUrl`, exact). The body is
 * never consulted. This is the one ownership rule: the planner, the writer's path policy and the
 * CLI's already-applied check all call it, so they cannot disagree about a page.
 */
export function attributesPageTo(document, nodeId, oldUrl) {
    const existing = document.values.node_id;
    if (existing !== undefined)
        return existing === nodeId;
    return pageSourceUrls(document).includes(oldUrl);
}
function isUpdated(document, nodeId, target) {
    return (document.values.node_id === nodeId &&
        document.values.title === target.newTitle &&
        pageSourceUrls(document).includes(target.newUrl));
}
/** The `url` of every structured `sources` entry of a parsed page. */
export function pageSourceUrls(document) {
    const sources = document.values.sources;
    if (!Array.isArray(sources))
        return [];
    return sources.flatMap((source) => (isRecord(source) && typeof source.url === 'string' ? [source.url] : []));
}
// ─── Snapshot ───────────────────────────────────────────────────────────────
function parsePages(files) {
    const pages = new Map();
    for (const path of Object.keys(files).sort()) {
        if (!WIKI_PAGE_PATTERN.test(path))
            continue;
        const content = files[path] ?? '';
        try {
            pages.set(path, { path, content, document: parseFrontmatterDocument(content) });
        }
        catch {
            return undefined;
        }
    }
    return pages;
}
// ─── Change set ─────────────────────────────────────────────────────────────
function buildChanges(input) {
    const { params, pages, oldSlug, newSlug, oldPage, target, moving } = input;
    const newPath = repoPagePath(newSlug);
    const accessed = formatDate(params.timestamp);
    const changes = [];
    const movedValues = updateRepoPageValues(oldPage.document.values, params.nodeId, target, accessed);
    const movedContent = repairReferences(renderFrontmatterDocument(movedValues, oldPage.document.body), oldSlug, newSlug);
    const nextWikiFiles = {};
    const repairs = [];
    for (const [path, page] of pages) {
        if (path === oldPage.path)
            continue;
        const repaired = moving ? repairReferences(page.content, oldSlug, newSlug) : page.content;
        nextWikiFiles[path] = repaired;
        if (repaired !== page.content)
            repairs.push({ op: 'repair-links', path, content: repaired });
    }
    nextWikiFiles[moving ? newPath : oldPage.path] = movedContent;
    if (moving) {
        changes.push({ op: 'create-page', path: newPath, content: movedContent }, { op: 'delete-page', path: oldPage.path });
    }
    else {
        changes.push({ op: 'edit-page', path: oldPage.path, content: movedContent });
    }
    changes.push(...repairs);
    // An in-place edit changes no slug, so the catalog lines (which are kept by slug) stay as they are.
    if (moving) {
        const index = buildIndex(params.files[INDEX_PATH], nextWikiFiles, oldSlug, newSlug);
        if (typeof index !== 'string')
            return blocked(index.reason);
        if (index !== params.files[INDEX_PATH])
            changes.push({ op: 'write-index', path: INDEX_PATH, content: index });
    }
    const wikilinkReason = checkWikilinks(nextWikiFiles);
    if (wikilinkReason !== undefined)
        return blocked(wikilinkReason);
    changes.push({
        op: 'append-log',
        path: LOG_PATH,
        content: appendLogEntry(params.files[LOG_PATH], {
            operation: 'manual-edit',
            target: `repo:${params.owner}/${params.newName}`,
            summary: describeRename(params, oldSlug, newSlug, moving),
            timestamp: params.timestamp,
            sources: [],
        }),
    });
    return { outcome: moving ? 'moved' : 'edited-in-place', changes };
}
function describeRename(params, oldSlug, newSlug, moving) {
    const rename = `Renamed \`${params.owner}/${params.oldName}\` to \`${params.owner}/${params.newName}\`.`;
    return moving
        ? `${rename} Moved the repo page from \`${oldSlug}.md\` to \`${newSlug}.md\` and repaired wikilinks and related entries.`
        : `${rename} Updated the repo page \`${oldSlug}.md\` in place; its slug is unchanged.`;
}
function updateRepoPageValues(values, nodeId, target, accessed) {
    const next = {};
    const hasNodeId = 'node_id' in values;
    for (const [key, value] of Object.entries(values)) {
        next[key] = value;
        // New pages put node_id right after `updated`, as the ingest writer does.
        if (!hasNodeId && key === 'updated')
            next.node_id = nodeId;
    }
    next.node_id = nodeId;
    next.title = target.newTitle;
    const sources = Array.isArray(values.sources) ? [...values.sources] : [];
    const alreadyListed = sources.some(source => isRecord(source) && source.url === target.newUrl);
    if (!alreadyListed)
        sources.push({ url: target.newUrl, accessed });
    next.sources = sources;
    return next;
}
function buildIndex(existingIndex, nextWikiFiles, oldSlug, newSlug) {
    // Carry the old entry (and any curated description) over to the new slug before rebuilding, so
    // the rebuild keeps it instead of regenerating a bare line.
    const carried = existingIndex === undefined ? undefined : rewriteLinks(existingIndex, oldSlug, newSlug);
    try {
        return rebuildWikiIndex({ existingIndex: carried, wikiFiles: nextWikiFiles });
    }
    catch (error) {
        if (error instanceof WikiIngestError)
            return { reason: 'invalid-index' };
        throw error;
    }
}
function checkWikilinks(nextWikiFiles) {
    try {
        validateWikilinks(nextWikiFiles);
        return undefined;
    }
    catch (error) {
        if (error instanceof WikiIngestError)
            return error.code === 'INVALID_WIKILINK' ? 'invalid-wikilinks' : 'invalid-index';
        throw error;
    }
}
// ─── Reference repair ───────────────────────────────────────────────────────
/** Repair `related:` entries and body wikilinks that point at `oldSlug`. Returns the input if none do. */
function repairReferences(content, oldSlug, newSlug) {
    return rewriteLinks(repairRelated(content, oldSlug, newSlug), oldSlug, newSlug);
}
/** Rewrite every `[[oldSlug]]`-style span, keeping its whitespace and label. Heading links are not spans. */
function rewriteLinks(content, oldSlug, newSlug) {
    const spans = findWikilinkSpans(content).filter(span => span.target === oldSlug);
    if (spans.length === 0)
        return content;
    let result = '';
    let cursor = 0;
    for (const span of spans) {
        const label = span.label === undefined ? '' : `|${span.label}`;
        result += `${content.slice(cursor, span.start)}[[${span.leading}${newSlug}${span.trailing}${label}]]`;
        cursor = span.end;
    }
    return result + content.slice(cursor);
}
function repairRelated(content, oldSlug, newSlug) {
    const document = parseFrontmatterDocument(content);
    const related = document.values.related;
    if (!Array.isArray(related) || !related.includes(oldSlug))
        return content;
    const expected = dedupe(related.map((entry) => (entry === oldSlug ? newSlug : entry)));
    const edited = editRelatedText(content, oldSlug, newSlug);
    if (edited !== undefined && sameList(readRelated(edited), expected))
        return edited;
    return renderFrontmatterDocument({ ...document.values, related: expected }, document.body);
}
/**
 * Edit only the `related:` lines of the frontmatter text, so the rest of the page keeps its bytes.
 * Returns `undefined` for a layout it does not recognize; the caller then re-renders structurally.
 */
function editRelatedText(content, oldSlug, newSlug) {
    const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content);
    const frontmatter = match?.[1];
    if (frontmatter === undefined)
        return undefined;
    const lines = frontmatter.split('\n');
    const flowIndex = lines.findIndex(line => RELATED_FLOW.test(line));
    if (flowIndex !== -1) {
        const inner = RELATED_FLOW.exec(lines[flowIndex] ?? '')?.[1] ?? '';
        const items = inner.split(',').map(item => item.trim());
        const mapped = dedupe(items.map(item => (stripQuotes(item) === oldSlug ? swapQuoted(item, newSlug) : item)));
        lines[flowIndex] = `related: [${mapped.join(', ')}]`;
        return replaceFrontmatter(content, frontmatter, lines.join('\n'));
    }
    const keyIndex = lines.findIndex(line => RELATED_BLOCK_KEY.test(line));
    if (keyIndex === -1)
        return undefined;
    const seen = new Set();
    const kept = [];
    let cursor = keyIndex + 1;
    for (; cursor < lines.length; cursor += 1) {
        const line = lines[cursor] ?? '';
        const item = parseBlockItem(line);
        if (item === undefined)
            break;
        const mapped = item.value === oldSlug ? newSlug : item.value;
        if (seen.has(mapped))
            continue;
        seen.add(mapped);
        kept.push(item.value === oldSlug ? `${item.prefix}${item.quote}${newSlug}${item.quote}${item.suffix}` : line);
    }
    lines.splice(keyIndex + 1, cursor - keyIndex - 1, ...kept);
    return replaceFrontmatter(content, frontmatter, lines.join('\n'));
}
/** Parse one `  - value` line of a block sequence without a backtracking regex. */
function parseBlockItem(line) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('-'))
        return undefined;
    const afterDash = trimmed.slice(1);
    if (afterDash === '' || afterDash.trimStart() === afterDash)
        return undefined;
    const valueText = afterDash.trimStart();
    const prefix = line.slice(0, line.length - valueText.length);
    const commentAt = valueText.indexOf(' #');
    const raw = (commentAt === -1 ? valueText : valueText.slice(0, commentAt)).trimEnd();
    const suffix = valueText.slice(raw.length);
    const first = raw[0];
    const quoted = raw.length >= 2 && (first === "'" || first === '"') && raw.endsWith(first);
    return { prefix, quote: quoted ? (first ?? '') : '', value: quoted ? raw.slice(1, -1) : raw, suffix };
}
function replaceFrontmatter(content, original, next) {
    const start = '---\n'.length;
    return `${content.slice(0, start)}${next}${content.slice(start + original.length)}`;
}
function readRelated(content) {
    try {
        const related = parseFrontmatterDocument(content).values.related;
        return Array.isArray(related) ? related : [];
    }
    catch {
        return [];
    }
}
function stripQuotes(item) {
    return item.replace(/^(['"])(.*)\1$/u, '$2');
}
function swapQuoted(item, replacement) {
    const quote = /^(['"])/u.exec(item)?.[1] ?? '';
    return `${quote}${replacement}${quote}`;
}
function dedupe(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        const key = typeof value === 'string' ? stripQuotes(value) : value;
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(value);
    }
    return result;
}
function sameList(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
function formatDate(value) {
    return value.toISOString().slice(0, 10);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
