import { Buffer } from 'node:buffer';
import { basename } from 'node:path';
import { parse } from 'yaml';
/** Canonical root directory for wiki page content. Shared by every wiki script. */
export const WIKI_ROOT = 'knowledge/wiki';
/**
 * Split raw wiki page content into frontmatter and body.
 *
 * Stricter than a naive split: malformed YAML frontmatter is surfaced via `error`
 * rather than silently discarded, so downstream safety/lint logic can observe it.
 */
export function splitFrontmatter(content) {
    const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content);
    if (match === null) {
        return { frontmatter: {}, body: content.trim() };
    }
    const frontmatterText = match[1];
    if (frontmatterText === undefined) {
        return { frontmatter: {}, body: content.trim() };
    }
    let parsed;
    try {
        parsed = parse(frontmatterText);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown YAML parse error';
        return {
            frontmatter: {},
            body: content.slice(match[0].length).trim(),
            error: `Invalid YAML frontmatter: ${message}`,
        };
    }
    return {
        frontmatter: isRecord(parsed) ? parsed : {},
        body: content.slice(match[0].length).trim(),
    };
}
/** Collect `[[target]]` and `[[target|label]]` wikilink targets from page body content. */
export function collectWikilinks(content) {
    const links = [];
    const pattern = /\[\[/gu;
    let match = pattern.exec(content);
    while (match !== null) {
        const start = match.index;
        const close = content.indexOf(']]', start + 2);
        if (close === -1) {
            break;
        }
        const inner = content.slice(start + 2, close);
        const separator = inner.indexOf('|');
        const target = separator === -1 ? inner : inner.slice(0, separator);
        const label = separator === -1 ? undefined : inner.slice(separator + 1);
        if (target !== '' && (label === undefined || label !== '')) {
            links.push(target);
        }
        pattern.lastIndex = close + 2;
        match = pattern.exec(content);
    }
    return links;
}
/** Parse a single wiki page's content (relative path + raw content) into a page record. */
export function parseWikiPage(path, content) {
    const { frontmatter, body, error } = splitFrontmatter(content);
    const slug = basename(path, '.md');
    return {
        path,
        slug,
        title: typeof frontmatter.title === 'string' ? frontmatter.title : slug,
        type: isPageType(frontmatter.type) ? frontmatter.type : inferTypeFromPath(path),
        aliases: collectAliases(frontmatter),
        tags: Array.isArray(frontmatter.tags)
            ? frontmatter.tags.filter((tag) => typeof tag === 'string')
            : [],
        body,
        frontmatter,
        frontmatterError: error,
    };
}
/** Collect all `knowledge/wiki/**.md` pages from a path→content file map. */
export function collectWikiPages(files) {
    return Object.entries(files)
        .filter(([path]) => path.startsWith(`${WIKI_ROOT}/`) && path.endsWith('.md'))
        .map(([path, content]) => parseWikiPage(path, content));
}
function collectAliases(frontmatter) {
    const aliases = frontmatter.aliases;
    if (!Array.isArray(aliases)) {
        return [];
    }
    return aliases.filter((alias) => typeof alias === 'string' && alias.trim() !== '');
}
/**
 * Build the set of all resolvable link targets (slug + aliases) across a page collection.
 * Used by wiki-lint to validate wikilinks and index entries against pages on disk.
 */
export function collectPageTargets(pages) {
    const targets = new Set();
    for (const page of pages) {
        targets.add(page.slug);
        for (const alias of page.aliases) {
            targets.add(alias);
        }
    }
    return targets;
}
const AMBIGUOUS = Symbol('ambiguous');
export function buildWikiTargetIndex(pages) {
    const map = new Map();
    const register = (key, page) => {
        const existing = map.get(key);
        if (existing === undefined) {
            map.set(key, page);
            return;
        }
        if (existing === AMBIGUOUS || existing.path !== page.path) {
            map.set(key, AMBIGUOUS);
        }
    };
    for (const page of pages) {
        register(page.path, page);
        register(page.slug, page);
        for (const alias of page.aliases) {
            register(alias, page);
        }
    }
    return {
        resolve(target) {
            const entry = map.get(target);
            return entry === undefined || entry === AMBIGUOUS ? undefined : entry;
        },
    };
}
function isPageType(value) {
    return value === 'repo' || value === 'topic' || value === 'entity' || value === 'comparison';
}
function inferTypeFromPath(path) {
    if (path.includes('/repos/'))
        return 'repo';
    if (path.includes('/topics/'))
        return 'topic';
    if (path.includes('/entities/'))
        return 'entity';
    return 'comparison';
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
// ---------------------------------------------------------------------------
// Byte-safe truncation (multi-byte-safe; shared shape with solutions-query.ts)
// ---------------------------------------------------------------------------
export function byteLength(value) {
    return Buffer.byteLength(value, 'utf8');
}
export function truncateToBytes(value, maxBytes) {
    if (byteLength(value) <= maxBytes) {
        return value;
    }
    const ellipsis = '…';
    const contentBudget = maxBytes - byteLength(ellipsis);
    if (contentBudget <= 0) {
        return '';
    }
    const truncated = Buffer.from(value)
        .subarray(0, contentBudget)
        .toString('utf8')
        .replaceAll(/\uFFFD+$/gu, '');
    return truncated === '' ? '' : `${truncated}${ellipsis}`;
}
