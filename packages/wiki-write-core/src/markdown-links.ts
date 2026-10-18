import {existsSync} from 'node:fs'
import {dirname, join, normalize} from 'node:path'
import process from 'node:process'

const MARKDOWN_LINK_PATTERN = /\[[^\]\n]+\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/gu

export interface MarkdownLink {
  readonly target: string
  readonly line: number
  readonly resolvedPath: string
  readonly exists: boolean
}

export interface MarkdownLinkResolverOptions {
  readonly rootDir?: string
  readonly files?: Readonly<Record<string, string>>
}

/** Resolve live relative markdown links and report whether their targets exist. */
export function resolveMarkdownLinks(
  content: string,
  containingFile: string,
  options: MarkdownLinkResolverOptions = {},
): MarkdownLink[] {
  const links: MarkdownLink[] = []
  let fence: {readonly character: string; readonly length: number} | undefined

  for (const [lineIndex, line] of content.split('\n').entries()) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line)
    if (fenceMatch !== null) {
      const marker = fenceMatch[1]
      if (marker !== undefined) {
        const character = marker[0] ?? ''
        if (fence === undefined) {
          fence = {character, length: marker.length}
        } else if (fence.character === character && marker.length >= fence.length) {
          fence = undefined
        }
      }
      continue
    }

    if (fence !== undefined) {
      continue
    }

    const codeSpans = findCodeSpans(line)

    for (const match of line.matchAll(MARKDOWN_LINK_PATTERN)) {
      const target = match[1]
      const matchIndex = match.index
      if (target === undefined || matchIndex === undefined || (matchIndex > 0 && line[matchIndex - 1] === '!')) {
        continue
      }

      // Code spans bind tighter than links: a match that starts or ends inside one is literal text.
      if (isInsideSpan(codeSpans, matchIndex) || isInsideSpan(codeSpans, matchIndex + match[0].length - 1)) {
        continue
      }

      const normalizedTarget = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target
      if (isSkippedTarget(normalizedTarget)) {
        continue
      }

      const pathTarget = stripSuffix(normalizedTarget)
      if (pathTarget === '') {
        continue
      }

      const resolvedPath = normalize(
        pathTarget.startsWith('/') ? pathTarget.slice(1) : join(dirname(containingFile), pathTarget),
      ).replaceAll('\\', '/')
      const exists =
        options.files === undefined
          ? existsSync(join(options.rootDir ?? process.cwd(), resolvedPath))
          : options.files[resolvedPath] !== undefined

      links.push({target: normalizedTarget, line: lineIndex + 1, resolvedPath, exists})
    }
  }

  return links
}

interface CodeSpan {
  /** Offset of the opening backtick run. */
  readonly start: number
  /** Offset just past the closing backtick run. */
  readonly end: number
}

/**
 * Locate inline code spans on one line, per CommonMark: a run of N backticks opens a span that
 * closes at the next run of exactly N backticks. A run with no matching closer is literal text.
 * A backslash outside a span escapes the next character, so an escaped backtick never opens a span.
 */
function findCodeSpans(line: string): CodeSpan[] {
  const spans: CodeSpan[] = []
  let index = 0

  while (index < line.length) {
    const character = line[index]
    if (character === '\\') {
      index += 2
      continue
    }
    if (character !== '`') {
      index += 1
      continue
    }

    const openEnd = skipBackticks(line, index)
    const runLength = openEnd - index
    let searchFrom = openEnd
    let closeEnd = -1
    while (searchFrom < line.length) {
      const closeStart = line.indexOf('`', searchFrom)
      if (closeStart === -1) {
        break
      }
      const candidateEnd = skipBackticks(line, closeStart)
      if (candidateEnd - closeStart === runLength) {
        closeEnd = candidateEnd
        break
      }
      searchFrom = candidateEnd
    }

    if (closeEnd === -1) {
      index = openEnd
    } else {
      spans.push({start: index, end: closeEnd})
      index = closeEnd
    }
  }

  return spans
}

function skipBackticks(line: string, from: number): number {
  let index = from
  while (line[index] === '`') {
    index += 1
  }
  return index
}

function isInsideSpan(spans: readonly CodeSpan[], offset: number): boolean {
  return spans.some(span => offset >= span.start && offset < span.end)
}

function isSkippedTarget(target: string): boolean {
  return target === '' || target.startsWith('#') || target.startsWith('//') || /^(?:https?:|mailto:)/iu.test(target)
}

function stripSuffix(target: string): string {
  const fragmentIndex = target.indexOf('#')
  const queryIndex = target.indexOf('?')
  const suffixIndex = [fragmentIndex, queryIndex].filter(index => index >= 0).sort((a, b) => a - b)[0]
  return suffixIndex === undefined ? target : target.slice(0, suffixIndex)
}
