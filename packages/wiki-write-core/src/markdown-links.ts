import {existsSync} from 'node:fs'
import {dirname, join, normalize} from 'node:path'
import process from 'node:process'

import {findCodeRegions, findRegionAt} from './code-regions.ts'
import {createInlineLinkFinder} from './inline-links.ts'

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
  const regions = findCodeRegions(content)
  let lineOffset = 0

  for (const [lineIndex, line] of content.split('\n').entries()) {
    const currentLineOffset = lineOffset
    lineOffset += line.length + 1

    // Each line gets its own finder; the loop asks it for the next link at or after `from`.
    const findLink = createInlineLinkFinder(line)
    let from = 0
    for (let match = findLink(from); match !== undefined; match = findLink(from)) {
      const {target} = match
      const matchIndex = match.index
      from = matchIndex + match.length
      if (matchIndex > 0 && line[matchIndex - 1] === '!') {
        continue
      }

      // Code binds tighter than links, so a match that touches a fence or span is literal text.
      // A rejected match must not consume what follows it: the regex runs through any live link
      // after an unclosed bracket in code. Resume after the region the match opened in, or just
      // past its first character when it only closes inside one.
      const matchStart = currentLineOffset + matchIndex
      const matchLast = matchStart + match.length - 1
      const openingRegion = findRegionAt(regions, matchStart)
      if (openingRegion !== undefined) {
        from = Math.max(openingRegion.end - currentLineOffset, matchIndex + 1)
        continue
      }
      if (findRegionAt(regions, matchLast) !== undefined) {
        from = matchIndex + 1
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
