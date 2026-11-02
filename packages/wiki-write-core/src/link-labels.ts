import {buildStopTable} from './inline-links.ts'

const OPEN_BRACKET = '['
const CLOSE_BRACKET = ']'
const OPEN_PAREN = '('
const CLOSE_PAREN = ')'
const PIPE = '|'
const BANG = '!'

/**
 * One link in `replaceLinkLabels`: the capture groups of a markdown link `[text](target)` or a wiki link
 * `[[target]]` / `[[target|label]]`. The groups of the branch that did not match are `undefined`.
 */
export interface LinkLabelParts {
  readonly markdownText: string | undefined
  readonly wikiTarget: string | undefined
  readonly wikiLabel: string | undefined
}

interface LinkLabelMatch extends LinkLabelParts {
  readonly end: number
}

/**
 * Replaces every markdown link and wiki link in `text` with `render(parts)`, scanning left to right once, as
 * `text.replaceAll(/!?(?:\[([^\]]*)\]\([^)]*\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/gu, ...)` does. A leading `!`
 * (an image) is part of the match. The markdown form is tried before the wiki form at each `[`:
 * - markdown: `[`, any text up to the first `]`, `](`, any run up to the first `)`, and that `)`;
 * - wiki: `[[`, a non-empty target up to the first `]` or `|`, then either `]]` or `|`, a non-empty label up to
 *   the first `]`, and `]]`.
 *
 * Every run ends at the first character that cannot continue it, so the stop offsets are read from tables built
 * right to left and each `[` is decided in constant time. The regex form rescans the rest of the text from every
 * unclosed `[`, which is quadratic in the length of the text.
 */
export function replaceLinkLabels(text: string, render: (parts: LinkLabelParts) => string): string {
  if (!text.includes(OPEN_BRACKET)) return text

  const closeBracketAt = buildStopTable(text, code => code === 0x5d)
  const closeParenAt = buildStopTable(text, code => code === 0x29)
  const closeBracketOrPipeAt = buildStopTable(text, code => code === 0x5d || code === 0x7c)

  const matchAt = (open: number): LinkLabelMatch | undefined => {
    const textEnd = closeBracketAt[open + 1] ?? text.length
    if (text.charAt(textEnd) === CLOSE_BRACKET && text.charAt(textEnd + 1) === OPEN_PAREN) {
      const parenEnd = closeParenAt[textEnd + 2] ?? text.length
      if (text.charAt(parenEnd) === CLOSE_PAREN) {
        return {
          end: parenEnd + 1,
          markdownText: text.slice(open + 1, textEnd),
          wikiTarget: undefined,
          wikiLabel: undefined,
        }
      }
    }

    if (text.charAt(open + 1) !== OPEN_BRACKET) return undefined
    const targetEnd = closeBracketOrPipeAt[open + 2] ?? text.length
    if (targetEnd === open + 2) return undefined
    const wikiTarget = text.slice(open + 2, targetEnd)
    if (text.charAt(targetEnd) === PIPE) {
      const labelEnd = closeBracketAt[targetEnd + 1] ?? text.length
      if (labelEnd > targetEnd + 1 && text.startsWith(']]', labelEnd)) {
        return {end: labelEnd + 2, markdownText: undefined, wikiTarget, wikiLabel: text.slice(targetEnd + 1, labelEnd)}
      }
      return undefined
    }
    return text.startsWith(']]', targetEnd)
      ? {end: targetEnd + 2, markdownText: undefined, wikiTarget, wikiLabel: undefined}
      : undefined
  }

  let replaced = ''
  let copiedTo = 0
  for (let open = text.indexOf(OPEN_BRACKET); open !== -1;) {
    const match = matchAt(open)
    if (match === undefined) {
      open = text.indexOf(OPEN_BRACKET, open + 1)
      continue
    }

    // An image's `!` belongs to the match, unless an earlier match already took it.
    const start = open > copiedTo && text.charAt(open - 1) === BANG ? open - 1 : open
    replaced += text.slice(copiedTo, start) + render(match)
    copiedTo = match.end
    open = text.indexOf(OPEN_BRACKET, match.end)
  }
  return replaced + text.slice(copiedTo)
}
