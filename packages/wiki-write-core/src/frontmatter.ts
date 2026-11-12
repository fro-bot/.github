import {parse, stringify} from 'yaml'

import {splitFrontmatterBlock} from './frontmatter-block.ts'

export {splitFrontmatterBlock, type FrontmatterBlockSplit} from './frontmatter-block.ts'

export interface FrontmatterDocument {
  readonly values: Record<string, unknown>
  readonly body: string
}

/**
 * Parse a validated wiki document while retaining its raw body. A document with no block, or with a block that is
 * never closed, is missing its frontmatter. An empty block is an empty mapping; any other block must parse to one.
 */
export function parseFrontmatterDocument(content: string): FrontmatterDocument {
  const split = splitFrontmatterBlock(content)
  if (split.kind !== 'block') {
    throw new Error('validated wiki page is missing frontmatter')
  }
  const parsed: unknown = split.text === '' ? {} : parse(split.text)
  if (!isRecord(parsed)) throw new Error('validated wiki page frontmatter is not an object')
  return {values: parsed, body: split.body}
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
