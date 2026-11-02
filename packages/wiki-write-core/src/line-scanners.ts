import {buildStopTable, isWhitespaceCode} from './inline-links.ts'

const NEWLINE = 0x0a
const CARRIAGE_RETURN = 0x0d
const LINE_SEPARATOR = 0x20_28
const PARAGRAPH_SEPARATOR = 0x20_29
const EM_DASH = 0x20_14
const CLOSE_BRACKET = 0x5d
const PIPE = 0x7c
const HASH = 0x23

/** The characters a regex `^`, `$` and `.` treat as line boundaries. */
function isLineTerminator(code: number): boolean {
  return code === NEWLINE || code === CARRIAGE_RETURN || code === LINE_SEPARATOR || code === PARAGRAPH_SEPARATOR
}

export interface IndexEntryLine {
  /** The text between `- [[` and `]]`, not trimmed. */
  readonly slug: string
  /** The whole entry line, from the dash to the end of its text. */
  readonly line: string
}

/**
 * Finds the index entry lines `- [[slug]] — description` of an index document, left to right, as
 * `/^- \[\[([^\]|]+)\]\]\s*—\s*(?:\S.*|[\t\v\f \u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF])$/gmu`
 * does:
 * - the line starts at the beginning of the text or after a line terminator, with `- [[`;
 * - the slug is a non-empty run up to the first `]` or `|`, which may cross lines, and `]]` follows it;
 * - whitespace (newlines included), an em dash, whitespace again;
 * - then either a non-whitespace character and the rest of its line, or, when only whitespace remains to the end
 *   of the text, a single non-newline whitespace character that ends its line.
 *
 * Each run ends at the first character that cannot continue it, so a run is read once from a table of stop
 * offsets and each candidate line is decided in constant time. The regex rescans the rest of the text from every
 * `- [[` line that has no `]]` after it, which is quadratic in the length of the text.
 */
export function findIndexEntryLines(index: string): IndexEntryLine[] {
  const entries: IndexEntryLine[] = []
  const opener = '- [['
  if (!index.includes(opener)) return entries

  const slugStop = buildStopTable(index, code => code === CLOSE_BRACKET || code === PIPE)
  const nonSpace = buildStopTable(index, code => !isWhitespaceCode(code))
  const lineEnd = buildStopTable(index, isLineTerminator)

  const entryEndAt = (slugEnd: number): number => {
    const dash = nonSpace[slugEnd + 2] ?? index.length
    if (index.charCodeAt(dash) !== EM_DASH) return -1
    const textStart = nonSpace[dash + 1] ?? index.length
    if (textStart < index.length) return lineEnd[textStart + 1] ?? index.length

    // Only whitespace follows the dash: the last character before a line end, at the end of the text, must be
    // a whitespace character that is not itself a line terminator.
    for (let at = index.length - 1; at > dash; at -= 1) {
      const code = index.charCodeAt(at)
      if (
        isWhitespaceCode(code) &&
        !isLineTerminator(code) &&
        (at + 1 === index.length || isLineTerminator(index.charCodeAt(at + 1)))
      ) {
        return at + 1
      }
    }
    return -1
  }

  for (let start = index.indexOf(opener); start !== -1;) {
    const atLineStart = start === 0 || isLineTerminator(index.charCodeAt(start - 1))
    const slugEnd = slugStop[start + 4] ?? index.length
    if (atLineStart && slugEnd > start + 4 && index.startsWith(']]', slugEnd)) {
      const end = entryEndAt(slugEnd)
      if (end !== -1) {
        entries.push({slug: index.slice(start + 4, slugEnd), line: index.slice(start, end)})
        start = index.indexOf(opener, end)
        continue
      }
    }
    start = index.indexOf(opener, start + 1)
  }
  return entries
}

/**
 * The inside of a flow-style `related: [a, b]` line, or `undefined` when the line is not one, as
 * `/^related:\s*\[(.*)\]\s*(?:#.*)?$/u` does. The inside runs to the last `]` before the line's first terminator
 * that is followed only by whitespace and an optional `#` comment running to the end of the text.
 *
 * The regex tries every `]` from the right and rescans the tail from each, which is quadratic when the tail
 * stops short of the end of the text (a carriage return inside a `#` comment, say). Here the tail is decided
 * from two tables of stop offsets in constant time per `]`.
 */
export function parseRelatedFlow(line: string): string | undefined {
  const key = 'related:'
  if (!line.startsWith(key)) return undefined

  let bracket = key.length
  while (bracket < line.length && isWhitespaceCode(line.charCodeAt(bracket))) bracket += 1
  if (line.charAt(bracket) !== '[') return undefined

  const lineEnd = buildStopTable(line, isLineTerminator)
  const nonSpace = buildStopTable(line, code => !isWhitespaceCode(code))
  const insideStart = bracket + 1
  const insideLimit = lineEnd[insideStart] ?? line.length
  for (let close = insideLimit - 1; close >= insideStart; close -= 1) {
    if (line.charCodeAt(close) !== CLOSE_BRACKET) continue
    const tail = nonSpace[close + 1] ?? line.length
    const tailIsComment = line.charCodeAt(tail) === HASH && (lineEnd[tail + 1] ?? line.length) === line.length
    if (tail === line.length || tailIsComment) return line.slice(insideStart, close)
  }
  return undefined
}
