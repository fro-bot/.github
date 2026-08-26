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

    for (const match of line.matchAll(MARKDOWN_LINK_PATTERN)) {
      const target = match[1]
      const matchIndex = match.index
      if (target === undefined || matchIndex === undefined || (matchIndex > 0 && line[matchIndex - 1] === '!')) {
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

function isSkippedTarget(target: string): boolean {
  return target === '' || target.startsWith('#') || target.startsWith('//') || /^(?:https?:|mailto:)/iu.test(target)
}

function stripSuffix(target: string): string {
  const fragmentIndex = target.indexOf('#')
  const queryIndex = target.indexOf('?')
  const suffixIndex = [fragmentIndex, queryIndex].filter(index => index >= 0).sort((a, b) => a - b)[0]
  return suffixIndex === undefined ? target : target.slice(0, suffixIndex)
}
