/** A half-open `[start, end)` range of offsets in a string that holds literal code, not markdown. */
export interface CodeRegion {
  readonly start: number
  readonly end: number
}

// Up to three spaces of indentation, then a run of three or more backticks or tildes and an info string.
const FENCE_OPENER = /^ {0,3}(`{3,}|~{3,})/u
// A closing fence carries nothing but spaces or tabs after the marker.
const FENCE_CLOSER = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u

interface OpenFence {
  readonly character: string
  readonly length: number
  readonly start: number
}

/**
 * Locate fenced code blocks and inline code spans in markdown, as sorted, non-overlapping regions.
 * Link extractors use it so link-shaped text inside code stays literal.
 *
 * - A fence opens at a line with up to three spaces of indentation, then three or more backticks
 *   or tildes. A backtick fence's info string may not contain a backtick; a line that breaks that
 *   rule is not a fence and is parsed for inline spans instead. A tilde fence's info string may
 *   contain anything.
 * - A fence closes at a line of the same character, at least as long as the opener and followed
 *   only by spaces or tabs. An unclosed fence runs to the end of the content. The fence lines
 *   themselves are part of the region.
 * - Outside a fence, a run of N backticks opens an inline span that closes at the next run of
 *   exactly N backticks on the same line (CommonMark, minus spans that cross a line break). A run
 *   with no matching closer is literal text. A backslash outside a span escapes the next
 *   character, so an escaped backtick never opens a span.
 */
export function findCodeRegions(content: string): CodeRegion[] {
  const regions: CodeRegion[] = []
  let fence: OpenFence | undefined
  let lineStart = 0

  while (lineStart <= content.length) {
    const newline = content.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? content.length : newline
    const line = content.slice(lineStart, lineEnd)
    // A CRLF line ending is a line ending, not part of the line.
    const text = line.endsWith('\r') ? line.slice(0, -1) : line

    if (fence === undefined) {
      const opener = parseFenceOpener(text)
      if (opener === undefined) {
        for (const span of findInlineSpans(line)) {
          regions.push({start: lineStart + span.start, end: lineStart + span.end})
        }
      } else {
        fence = {...opener, start: lineStart}
      }
    } else if (closesFence(text, fence)) {
      regions.push({start: fence.start, end: lineEnd})
      fence = undefined
    }

    lineStart = lineEnd + 1
  }

  if (fence !== undefined) {
    regions.push({start: fence.start, end: content.length})
  }

  return regions
}

function parseFenceOpener(text: string): {readonly character: string; readonly length: number} | undefined {
  const match = FENCE_OPENER.exec(text)
  const marker = match?.[1]
  if (match === null || marker === undefined) {
    return undefined
  }

  const character = marker.charAt(0)
  const info = text.slice(match[0].length)
  return character === '`' && info.includes('`') ? undefined : {character, length: marker.length}
}

function closesFence(text: string, fence: OpenFence): boolean {
  const marker = FENCE_CLOSER.exec(text)?.[1]
  return marker !== undefined && marker.startsWith(fence.character) && marker.length >= fence.length
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
  // Where each length of backtick run starts on this line, built when the first opener needs it.
  let runStartsByLength: Map<number, BacktickRuns> | undefined
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
    runStartsByLength ??= indexBacktickRuns(line)
    // The closer is the first later run of exactly the opener's length. Openers only move forward, so each
    // length's cursor does too, and every run is passed over at most once.
    const closeStart = nextRunAtOrAfter(runStartsByLength.get(runLength), openEnd)

    if (closeStart === undefined) {
      index = openEnd
    } else {
      const closeEnd = closeStart + runLength
      spans.push({start: index, end: closeEnd})
      index = closeEnd
    }
  }

  return spans
}

/** The ascending start offsets of one length's backtick runs, and how far the scan has read them. */
interface BacktickRuns {
  readonly starts: number[]
  next: number
}

/** The start offsets of the maximal backtick runs of `line`, grouped by the length of the run. */
function indexBacktickRuns(line: string): Map<number, BacktickRuns> {
  const runStartsByLength = new Map<number, BacktickRuns>()
  for (let start = line.indexOf('`'); start !== -1;) {
    const end = skipBackticks(line, start)
    const runs = runStartsByLength.get(end - start)
    if (runs === undefined) {
      runStartsByLength.set(end - start, {starts: [start], next: 0})
    } else {
      runs.starts.push(start)
    }
    start = line.indexOf('`', end)
  }
  return runStartsByLength
}

/** The first run start at least `minimum`. Callers ask with increasing `minimum`, so the cursor only advances. */
function nextRunAtOrAfter(runs: BacktickRuns | undefined, minimum: number): number | undefined {
  if (runs === undefined) {
    return undefined
  }

  while (runs.next < runs.starts.length && (runs.starts[runs.next] ?? minimum) < minimum) {
    runs.next += 1
  }
  return runs.starts[runs.next]
}

function skipBackticks(line: string, from: number): number {
  let index = from
  while (line[index] === '`') {
    index += 1
  }
  return index
}
