import {parse, stringify} from 'yaml'

export interface FrontmatterDocument {
  readonly values: Record<string, unknown>
  readonly body: string
}

/** Parse a validated wiki document while retaining its raw body. */
export function parseFrontmatterDocument(content: string): FrontmatterDocument {
  const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)
  if (match === null || match[1] === undefined) {
    throw new Error('validated wiki page is missing frontmatter')
  }
  const parsed: unknown = parse(match[1])
  if (!isRecord(parsed)) throw new Error('validated wiki page frontmatter is not an object')
  return {values: parsed, body: content.slice(match[0].length)}
}

/** Reconstruct a wiki document with system-owned frontmatter and normalized body. */
export function renderFrontmatterDocument(values: Record<string, unknown>, body: string): string {
  const normalized = body.endsWith('\n') ? body : `${body}\n`
  return `---\n${stringify(values).trimEnd()}\n---\n\n${normalized.trim()}\n`
}

export function reconstructFrontmatter(
  existingContent: string,
  body: string,
  preservedFields: readonly string[] = Object.keys(parseFrontmatterDocument(existingContent).values),
): string {
  const existing = parseFrontmatterDocument(existingContent)
  const next: Record<string, unknown> = {}
  for (const field of preservedFields) {
    if (field in existing.values) next[field] = existing.values[field]
  }
  return renderFrontmatterDocument(next, body)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
