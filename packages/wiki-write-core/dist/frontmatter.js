import { parse, stringify } from 'yaml';
/** Parse a validated wiki document while retaining its raw body. */
export function parseFrontmatterDocument(content) {
    const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content);
    if (match === null || match[1] === undefined) {
        throw new Error('validated wiki page is missing frontmatter');
    }
    const parsed = parse(match[1]);
    if (!isRecord(parsed))
        throw new Error('validated wiki page frontmatter is not an object');
    return { values: parsed, body: content.slice(match[0].length) };
}
/** Reconstruct a wiki document with system-owned frontmatter and normalized body. */
export function renderFrontmatterDocument(values, body) {
    const normalized = body.endsWith('\n') ? body : `${body}\n`;
    return `---\n${stringify(values).trimEnd()}\n---\n\n${normalized.trim()}\n`;
}
export function reconstructFrontmatter(existingContent, body, preservedFields = Object.keys(parseFrontmatterDocument(existingContent).values)) {
    const existing = parseFrontmatterDocument(existingContent);
    const next = {};
    for (const field of preservedFields) {
        if (field in existing.values)
            next[field] = existing.values[field];
    }
    return renderFrontmatterDocument(next, body);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
