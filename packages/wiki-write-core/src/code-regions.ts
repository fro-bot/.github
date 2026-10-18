/** A half-open `[start, end)` range of offsets in a string that holds literal code, not markdown. */
export interface CodeRegion {
  readonly start: number
  readonly end: number
}

/**
 * Locate fenced code blocks and inline code spans in markdown, as sorted, non-overlapping regions.
 * Link extractors use it so link-shaped text inside code stays literal.
 *
 * - A fence opens at a line starting with three or more backticks or tildes and closes at a line
 *   with the same character and at least as many. An unclosed fence runs to the end of the content.
 *   The fence lines themselves are part of the region.
 * - Outside a fence, a run of N backticks opens an inline span that closes at the next run of
 *   exactly N backticks on the same line (CommonMark, minus spans that cross a line break). A run
 *   with no matching closer is literal text. A backslash outside a span escapes the next
 *   character, so an escaped backtick never opens a span.
 */
export function findCodeRegions(content: string): CodeRegion[] {
  const regions: CodeRegion[] = []
  let fence: {readonly character: string; readonly length: number; readonly start: number} | undefined
  let lineStart = 0

  while (lineStart <= content.length) {
    const newline = content.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? content.length : newline
    const line = content.slice(lineStart, lineEnd)
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1]

    if (marker !== undefined) {
      const character = marker[0] ?? ''
      if (fence === undefined) {
        fence = {character, length: marker.length, start: lineStart}
      } else if (fence.character === character && marker.length >= fence.length) {
        regions.push({start: fence.start, end: lineEnd})
        fence = undefined
      }
    } else if (fence === undefined) {
      for (const span of findInlineSpans(line)) {
        regions.push({start: lineStart + span.start, end: lineStart + span.end})
      }
    }

    lineStart = lineEnd + 1
  }

  if (fence !== undefined) {
    regions.push({start: fence.start, end: content.length})
  }

  return regions
}

/** The region that contains `offset`, if any. `regions` must come from {@link findCodeRegions}. */
export function findRegionAt(regions: readonly CodeRegion[], offset: number): CodeRegion | undefined {
  let low = 0
  let high = regions.length - 1

  while (low <= high) {
    const middle = (low + high) >> 1
    const region = regions[middle]
    if (region === undefined) {
      return undefined
    }
    if (offset < region.start) {
      high = middle - 1
    } else if (offset >= region.end) {
      low = middle + 1
    } else {
      return region
    }
  }

  return undefined
}

function findInlineSpans(line: string): CodeRegion[] {
  const spans: CodeRegion[] = []
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
